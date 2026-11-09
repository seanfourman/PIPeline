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
  "user/cv", "user/cover_letters", "user/documents/applications", "user/documents/postings", "user/company_research",
  "user/job_scraper", "user/upskill", "user/reports", "user/gmail_sync", "user/job_search_tracker.csv",
];
// Editing these changes what the agent may do, so each edit is confirmed separately.
const NEVER_REMEMBER = [
  ".claude/settings", ".claude/commands", ".claude/agents", ".agents", ".github", "tools",
  "salary_lookup.py", "web", "CLAUDE.md", "CV_RULES.md", "templates/cv/one-page-clean/cv_checks.json",
  // The user's own instructions, rules and checks (user/), which shape every CV as much as the files above.
  "user/CLAUDE.md", "user/CV_RULES.md", "user/cv_checks.json", "templates/user",
  // What changes how the allowed commands run or what a new conversation starts: bun's own settings (a preload, or a
  // loader that runs any file as code), the environment bun reads at start, and the project's MCP servers.
  "bunfig.toml", ".env", ".mcp.json",
];
// Code: a script never goes ahead on its own, not in the workflow's output folders, not at automatic access, and not by
// being remembered, so nothing the agent writes can be run by a command allowed to run on its own (those name their
// files by a path in the project: a script planted where one resolves, or one a script there imports, would be).
const SCRIPT = /\.(py|pyw|ts|tsx|mts|cts|js|jsx|mjs|cjs|sh|bash|cmd|bat|ps1|psm1|vbs|exe)$/i;
// Other names a disk on Windows gives a file: one of its streams (build.py::$DATA is build.py itself) and its short
// name (CLAUDE~1/SETTIN~1.JSO is .claude/settings.json). No file of the project has either in its name, so a name with
// one is confirmed, whichever file it turns out to be, read or written.
const ALIAS = /:|~\d/;

// What /setup does besides the profile (.claude/commands/setup.md, Step 3): it fills in the user's own instructions,
// and chooses the site's roles with the project's own script, whose words are only its flags and the roles' ids (it
// checks them itself). In a /setup conversation at automatic access, as the introduction starts the reading of the CV
// and the interview, these go ahead too, so the profile is made without a stop; everywhere else they ask as before.
const SETUP_FILES = ["user/claude.md"];
const PICK_ROLES = /^bun run web\/pick-roles\.ts( [a-z0-9-]+)*$/;

const NAME = "[A-Za-z0-9_.-]+";
const SAFE_COMMANDS = [
  // The LaTeX compile, in the shapes /apply and the templates use. -shell-escape never matches.
  new RegExp(
    `^(cd (user/|\\.\\./)(cv|cover_letters) && )?(rm -f ${NAME}\\.pdf && )?(mkdir -p build && )?` +
      `(lualatex|xelatex) -interaction=nonstopmode( -halt-on-error)?( -output-directory=build)? ` +
      `${NAME}\\.tex( && mv build/${NAME}\\.pdf \\./)?$`,
  ),
  new RegExp(`^rm -f( user/(cv|cover_letters)/${NAME}\\.\\{aux,log,out,fls,fdb_latexmk,synctex\\.gz\\})+$`),
  /^rm -rf user\/(cv|cover_letters)\/build( user\/(cv|cover_letters)\/build)?$/,
  new RegExp(`^cd user/cv && pdftotext -layout -enc UTF-8 ${NAME}\\.pdf ${NAME}\\.txt$`),
  // Compiles, verifies and saves a CV. The name allows no path, flag or shell characters.
  /^python3? templates\/cv\/one-page-clean\/(build|ats)\.py [a-z0-9_]+$/,
  // Saving the finished CV under the name employers see, "<the user's name> - Resume.pdf" (user/profile.json): a
  // name of letters, spaces, dots, apostrophes and hyphens only. The folder name cannot climb out with "..".
  /^mkdir -p user\/documents\/applications\/[A-Za-z0-9_-]+ && cp user\/cv\/main_[A-Za-z0-9_-]+\.pdf "user\/documents\/applications\/[A-Za-z0-9_-]+\/(?:[\p{L}][\p{L} .'-]{0,59} - )?Resume\.pdf"$/u,
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
    if (target === norm(path.join(repo, "user", "cv"))) return `cd user/cv && ${match[2]}`;
    return command;
  };

  const bashIsSafe = (command: string) => {
    const cmd = withoutProjectCd(command.trim()).trim();
    if (SAFE_COMMANDS.some((re) => re.test(cmd))) return true;
    if (/[;&|<>`$\n\r]/.test(cmd)) return false;
    return prefixes.some((p) => cmd === p || cmd.startsWith(p + " "));
  };

  // A file each edit of which is confirmed on its own: what changes what the agent may do, a skill, or a script. In any
  // case of letters, as the disks of Windows and of a Mac find the file in any (.CLAUDE/settings.json is the same file).
  const guarded = (rel: string) => {
    const low = rel.toLowerCase();
    return ALIAS.test(low) || NEVER_REMEMBER.some((n) => low === n.toLowerCase() || low.startsWith(n.toLowerCase())) || low.endsWith("skill.md") || SCRIPT.test(low);
  };

  const asked = (tool: string, input: Record<string, unknown>, remembered: Set<string>): Decision => {
    if (AUTO_TOOLS.has(tool)) return { decision: "allow" };

    if (READ_TOOLS.has(tool)) {
      const target = resolve(String(input.file_path ?? input.path ?? "."));
      const aliased = isInside(target, repo) && ALIAS.test(path.relative(repo, target));
      const inside = isInside(target, repo) || isInside(target, tempRoot);
      return { decision: inside && !aliased ? "allow" : "ask" };
    }

    if (WRITE_TOOLS.has(tool)) {
      const file = resolve(String(input.file_path ?? ""));
      if (isInside(file, tempRoot)) return { decision: "allow" };
      if (!isInside(file, repo)) return { decision: "ask" };
      const rel = path.relative(repo, file).replaceAll("\\", "/");
      if (guarded(rel)) return { decision: "ask" };
      if (WRITABLE.some((w) => isInside(file, path.join(repo, w)))) return { decision: "allow" };
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
    return !guarded(path.relative(repo, file).replaceAll("\\", "/"));
  };

  // What a /setup conversation does besides editing the project (SETUP_FILES, PICK_ROLES).
  const setupStep = (tool: string, input: Record<string, unknown>) => {
    if (tool === "Bash") return PICK_ROLES.test(withoutProjectCd(String(input.command ?? "").trim()).trim());
    if (!WRITE_TOOLS.has(tool)) return false;
    const rel = path.relative(repo, resolve(String(input.file_path ?? ""))).replaceAll("\\", "/").toLowerCase();
    return SETUP_FILES.includes(rel);
  };

  // setup: the conversation is /setup's (its first message starts with the command).
  return (tool: string, input: Record<string, unknown>, remembered: Set<string> = new Set(), access: Access = "ask", setup = false): Decision => {
    if (access === "full") return { decision: "allow" };
    const verdict = asked(tool, input, remembered);
    if (access === "auto" && verdict.decision === "ask" && (projectEdit(tool, input) || (setup && setupStep(tool, input)))) return { decision: "allow" };
    return verdict;
  };
}
