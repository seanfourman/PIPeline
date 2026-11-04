// Decides which agent tool calls run on their own and which wait for the user.
// Job postings are untrusted input, so everything not listed here asks.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO = path.resolve(import.meta.dir, "..");

const AUTO_TOOLS = new Set([
  "WebFetch", "WebSearch", "Skill", "Agent", "Task", "TaskOutput", "TodoWrite", "ToolSearch",
]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
const WRITE_TOOLS = new Set(["Write", "Edit"]);

// Where the workflow's own output goes. Profile, command and permission files are not here.
const WRITABLE = [
  "cv", "cover_letters", "documents/applications", "documents/postings", "company_research",
  "job_scraper", ".claude/skills/job-scraper/job_scraper", "upskill", "reports", "gmail_sync",
  "job_search_tracker.csv",
];
// Editing these changes what the agent may do, so each edit is confirmed separately.
const NEVER_REMEMBER = [
  ".claude/settings", ".claude/commands", ".claude/agents", ".agents", ".github", "tools",
  "salary_lookup.py", "web", "CLAUDE.md", "CV_RULES.md", "templates/cv/one-page-clean/cv_checks.json",
];

const NAME = "[A-Za-z0-9_.-]+";
const SAFE_COMMANDS = [
  // The LaTeX compile, in the shapes /apply and the templates use. -shell-escape never matches.
  new RegExp(
    `^(cd (\\.\\./)?(cv|cover_letters) && )?(rm -f ${NAME}\\.pdf && )?(mkdir -p build && )?` +
      `(lualatex|xelatex) -interaction=nonstopmode( -halt-on-error)?( -output-directory=build)? ` +
      `${NAME}\\.tex( && mv build/${NAME}\\.pdf \\./)?$`,
  ),
  new RegExp(`^rm -f( (cv|cover_letters)/${NAME}\\.\\{aux,log,out,fls,fdb_latexmk,synctex\\.gz\\})+$`),
  /^rm -rf (cv|cover_letters)\/build( (cv|cover_letters)\/build)?$/,
  new RegExp(`^cd cv && pdftotext -layout -enc UTF-8 ${NAME}\\.pdf ${NAME}\\.txt$`),
  // Compiles, verifies and saves a CV. The name allows no path, flag or shell characters.
  /^python3? templates\/cv\/one-page-clean\/(build|ats)\.py [a-z0-9_]+$/,
  // Saving the finished CV under the name employers see. The folder name cannot climb out with "..".
  /^mkdir -p documents\/applications\/[A-Za-z0-9_-]+ && cp cv\/main_[A-Za-z0-9_-]+\.pdf "documents\/applications\/[A-Za-z0-9_-]+\/Sean Fourman - Resume\.pdf"$/,
];

function allowedPrefixes(repo: string): string[] {
  const settings = JSON.parse(readFileSync(path.join(repo, ".claude/settings.json"), "utf8"));
  return (settings.permissions?.allow ?? []).flatMap((rule: string) => {
    const match = rule.match(/^Bash\((.+):\*\)$/);
    return match ? [match[1]] : [];
  });
}

const norm = (p: string) => path.resolve(p).replaceAll("\\", "/").toLowerCase();
const isInside = (file: string, dir: string) => {
  const f = norm(file);
  const d = norm(dir);
  return f === d || f.startsWith(d + "/");
};

export type Decision = { decision: "allow" | "ask"; rememberKey?: string };

// How much a conversation may do without asking, picked per conversation in the chat. ask is everything above;
// auto adds every edit inside the project, but for the files that change what the agent may do; full allows
// everything, which a pasted posting could then use, so the chat warns before it is picked. The deny rules in
// .claude/settings.json hold in every mode, since the SDK checks them before asking here.
export type Access = "ask" | "auto" | "full";
export const ACCESS: Access[] = ["ask", "auto", "full"];

export function createPolicy(repo = REPO, tempRoot = path.join(os.tmpdir(), "claude")) {
  const prefixes = allowedPrefixes(repo);
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.join(repo, p));

  // The agent often starts a command by moving to the project, so that step is judged as harmless
  // only when it lands exactly there. The rest of the command still has to pass on its own.
  const withoutProjectCd = (command: string) => {
    const match = command.match(/^cd\s+"?([^"&;|]+?)"?\s*&&\s*([\s\S]+)$/);
    if (!match) return command;
    const target = norm(match[1]);
    if (target === norm(repo)) return match[2];
    if (target === norm(path.join(repo, "cv"))) return `cd cv && ${match[2]}`;
    return command;
  };

  const bashIsSafe = (command: string) => {
    const cmd = withoutProjectCd(command.trim()).trim();
    if (SAFE_COMMANDS.some((re) => re.test(cmd))) return true;
    if (/[;&|<>`$\n\r]/.test(cmd)) return false;
    return prefixes.some((p) => cmd === p || cmd.startsWith(p + " "));
  };

  const asked = (tool: string, input: Record<string, unknown>, remembered: Set<string>): Decision => {
    if (AUTO_TOOLS.has(tool)) return { decision: "allow" };

    if (READ_TOOLS.has(tool)) {
      const target = String(input.file_path ?? input.path ?? ".");
      const inside = isInside(resolve(target), repo) || isInside(resolve(target), tempRoot);
      return { decision: inside ? "allow" : "ask" };
    }

    if (WRITE_TOOLS.has(tool)) {
      const file = resolve(String(input.file_path ?? ""));
      if (isInside(file, tempRoot) || WRITABLE.some((w) => isInside(file, path.join(repo, w)))) {
        return { decision: "allow" };
      }
      if (!isInside(file, repo)) return { decision: "ask" };
      const rel = path.relative(repo, file).replaceAll("\\", "/");
      if (NEVER_REMEMBER.some((n) => rel === n || rel.startsWith(n)) || rel.endsWith("SKILL.md")) {
        return { decision: "ask" };
      }
      const rememberKey = `write:${path.posix.dirname(rel)}`;
      return { decision: remembered.has(rememberKey) ? "allow" : "ask", rememberKey };
    }

    if (tool === "Bash") return { decision: bashIsSafe(String(input.command ?? "")) ? "allow" : "ask" };

    return { decision: "ask" };
  };

  // An edit inside the project that does not change what the agent may do.
  const projectEdit = (tool: string, input: Record<string, unknown>) => {
    if (!WRITE_TOOLS.has(tool) && tool !== "NotebookEdit") return false;
    const file = resolve(String(input.file_path ?? input.notebook_path ?? ""));
    if (!isInside(file, repo)) return false;
    const rel = path.relative(repo, file).replaceAll("\\", "/");
    return !(NEVER_REMEMBER.some((n) => rel === n || rel.startsWith(n)) || rel.endsWith("SKILL.md"));
  };

  return (tool: string, input: Record<string, unknown>, remembered: Set<string> = new Set(), access: Access = "ask"): Decision => {
    if (access === "full") return { decision: "allow" };
    const verdict = asked(tool, input, remembered);
    if (access === "auto" && verdict.decision === "ask" && projectEdit(tool, input)) return { decision: "allow" };
    return verdict;
  };
}
