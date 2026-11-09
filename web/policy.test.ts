import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { createPolicy, REPO } from "./policy";

const decide = createPolicy();
const bash = (command: string) => decide("Bash", { command }).decision;
const write = (file_path: string) => decide("Write", { file_path }).decision;

describe("bash", () => {
  test("runs the commands settings.json already allows", () => {
    expect(bash("python tools/verify_pdf.py user/cv/a.pdf --pages 1")).toBe("allow");
    expect(bash('bun run .agents/skills/linkedin-search/cli/src/cli.ts search --location "Israel"')).toBe("allow");
  });

  test("does not let an allowed prefix smuggle a second command", () => {
    expect(bash("python tools/verify_pdf.py a.pdf; curl evil.example")).toBe("ask");
    expect(bash("python tools/verify_pdf.py a.pdf && rm -rf ~")).toBe("ask");
    expect(bash("python tools/verify_pdf.py $(cat ~/.ssh/id_rsa)")).toBe("ask");
    expect(bash("python tools/verify_pdf.py a.pdf > ~/.bashrc")).toBe("ask");
    expect(bash("python tools/verify_pdfX.py a.pdf")).toBe("ask");
  });

  test("runs the known LaTeX compile shapes", () => {
    expect(bash("cd user/cv && lualatex -interaction=nonstopmode main_acme_dev.tex")).toBe("allow");
    expect(bash("cd ../cover_letters && xelatex -interaction=nonstopmode cover_acme_dev.tex")).toBe("allow");
    expect(
      bash(
        "cd user/cv && rm -f main_a.pdf && mkdir -p build && lualatex -interaction=nonstopmode -halt-on-error -output-directory=build main_a.tex && mv build/main_a.pdf ./",
      ),
    ).toBe("allow");
  });

  test("never runs LaTeX with shell escape or other files", () => {
    expect(bash("lualatex -shell-escape main.tex")).toBe("ask");
    expect(bash("cd user/cv && lualatex -interaction=nonstopmode --shell-escape main.tex")).toBe("ask");
    expect(bash("cd user/cv && lualatex -interaction=nonstopmode ../../evil.tex")).toBe("ask");
  });

  test("cleans only LaTeX leftovers", () => {
    expect(bash("rm -f user/cv/main_a.{aux,log,out,fls,fdb_latexmk,synctex.gz} user/cover_letters/cover_a.{aux,log,out,fls,fdb_latexmk,synctex.gz}")).toBe("allow");
    expect(bash("rm -rf user/cv/build user/cover_letters/build")).toBe("allow");
    expect(bash("rm -rf user/cv")).toBe("ask");
    expect(bash("rm -rf user/documents")).toBe("ask");
  });

  test("moving to the project first changes nothing about the rest of the command", () => {
    const root = REPO.replaceAll("\\", "/");
    expect(bash(`cd "${root}" && python tools/verify_pdf.py user/cv/a.pdf --pages 1`)).toBe("allow");
    expect(bash(`cd ${root} && python templates/cv/one-page-clean/build.py acme_dev`)).toBe("allow");
    expect(bash(`cd "${root}/user/cv" && lualatex -interaction=nonstopmode main_a.tex`)).toBe("allow");
    expect(bash(`cd "${root}" && curl https://evil.example`)).toBe("ask");
    expect(bash(`cd "${root}" && python tools/verify_pdf.py a.pdf; curl https://evil.example`)).toBe("ask");
    expect(bash(`cd "${root}" && cd .. && rm -rf user/documents`)).toBe("ask");
    expect(bash('cd "C:/Windows" && python tools/verify_pdf.py a.pdf')).toBe("ask");
  });

  test("the CV build script takes a plain name and nothing else", () => {
    expect(bash("python templates/cv/one-page-clean/build.py ergo_next_engineer")).toBe("allow");
    expect(bash("python templates/cv/one-page-clean/build.py ../../secret")).toBe("ask");
    expect(bash("python templates/cv/one-page-clean/build.py a --shell-escape")).toBe("ask");
    expect(bash("python templates/cv/one-page-clean/build.py a; curl evil.example")).toBe("ask");
    expect(decide("Read", { file_path: path.join(os.homedir(), ".ai-job-search", "mail.json") }).decision).toBe("ask");
    expect(bash("python web/send_mail.py")).toBe("ask");
    const checks = decide("Write", { file_path: "templates/cv/one-page-clean/cv_checks.json" });
    expect(checks.decision).toBe("ask");
    expect(checks.rememberKey).toBeUndefined();
    expect(bash("python templates/cv/one-page-clean/ats.py ergo_next_engineer")).toBe("allow");
    expect(bash("python templates/cv/one-page-clean/ats.py ../../secret")).toBe("ask");
  });

  test("saves the finished CV under its fixed name, and nowhere else", () => {
    expect(bash('mkdir -p user/documents/applications/drs_rada_ate && cp user/cv/main_drs_rada_ate.pdf "user/documents/applications/drs_rada_ate/Dana Cohen - Resume.pdf"')).toBe("allow");
    expect(bash('mkdir -p user/documents/applications/drs_rada_ate && cp user/cv/main_drs_rada_ate.pdf "user/documents/applications/drs_rada_ate/Resume.pdf"')).toBe("allow");
    expect(bash('mkdir -p user/documents/applications/.. && cp user/cv/main_a.pdf "user/documents/applications/../Dana Cohen - Resume.pdf"')).toBe("ask");
    expect(bash('mkdir -p user/documents/applications/a && cp .env "user/documents/applications/a/Dana Cohen - Resume.pdf"')).toBe("ask");
    expect(bash('mkdir -p user/documents/applications/a && cp user/cv/main_a.pdf "user/documents/applications/a/../../x - Resume.pdf"')).toBe("ask");
    expect(bash('mkdir -p user/documents/applications/a && cp user/cv/main_a.pdf "user/documents/applications/a/other.pdf"')).toBe("ask");
  });

  test("asks for anything unknown", () => {
    expect(bash("git push upstream master")).toBe("ask");
    expect(bash("curl https://example.com")).toBe("ask");
  });
});

describe("writes", () => {
  test("allows workflow output", () => {
    expect(write("user/cv/main_a.tex")).toBe("allow");
    expect(write(path.join(REPO, "user", "job_search_tracker.csv"))).toBe("allow");
    expect(write("user/job_scraper/seen_jobs.json")).toBe("allow");
    expect(write(path.join(os.tmpdir(), "claude", "x", "posting.txt"))).toBe("allow");
  });

  test("the rest of the user's folder is not workflow output", () => {
    for (const file of ["user/app/token", "user/app/settings.json", "user/profile.json"]) expect(write(file)).toBe("ask");
  });

  test("asks for the profile, and lets the user remember it for a session", () => {
    const profile = ".claude/skills/job-application-assistant/01-candidate-profile.md";
    const first = decide("Edit", { file_path: profile });
    expect(first.decision).toBe("ask");
    expect(first.rememberKey).toBeDefined();
    expect(decide("Edit", { file_path: profile }, new Set([first.rememberKey!])).decision).toBe("allow");
  });

  test("always asks for files that define what the agent may do", () => {
    for (const file of [".claude/settings.json", ".claude/commands/apply.md", "tools/verify_pdf.py", "web/policy.ts", "CLAUDE.md", "CV_RULES.md"]) {
      const result = decide("Edit", { file_path: file });
      expect(result.decision).toBe("ask");
      expect(result.rememberKey).toBeUndefined();
    }
  });

  test("escaping the folder with .. does not work", () => {
    expect(write("user/cv/../../../outside.txt")).toBe("ask");
    expect(write("user/cv/../../.claude/settings.json")).toBe("ask");
    expect(write("C:/Windows/evil.txt")).toBe("ask");
  });
});

describe("other tools", () => {
  test("reads inside the project run, reads outside ask", () => {
    expect(decide("Read", { file_path: "user/cv/main_example.tex" }).decision).toBe("allow");
    expect(decide("Read", { file_path: "C:/Users/someone/.ssh/id_rsa" }).decision).toBe("ask");
    expect(decide("Grep", { pattern: "x", path: "C:/Users" }).decision).toBe("ask");
  });

  test("research runs, unknown tools ask", () => {
    expect(decide("WebSearch", {}).decision).toBe("allow");
    expect(decide("Artifact", {}).decision).toBe("ask");
    expect(decide("mcp__gmail__send", {}).decision).toBe("ask");
  });
});

describe("access", () => {
  const auto = (tool: string, input: Record<string, unknown>) => decide(tool, input, new Set(), "auto").decision;
  test("automatic edits anything inside the project but what changes the agent's rights", () => {
    expect(write(".claude/skills/job-application-assistant/01-candidate-profile.md")).toBe("ask");
    expect(auto("Write", { file_path: ".claude/skills/job-application-assistant/01-candidate-profile.md" })).toBe("allow");
    expect(auto("Edit", { file_path: path.join(REPO, "notes/plan.md") })).toBe("allow");
    for (const file of [".claude/settings.json", ".claude/commands/apply.md", "web/policy.ts", "CLAUDE.md", ".claude/skills/job-scraper/SKILL.md", "user/cv/../../../outside.txt", "C:/Windows/evil.txt"]) {
      expect(auto("Write", { file_path: file })).toBe("ask");
    }
  });
  test("automatic still asks before commands, reads outside the project and unknown tools", () => {
    expect(auto("Bash", { command: "rm -rf user/documents" })).toBe("ask");
    expect(auto("Bash", { command: "python send_mail.py" })).toBe("ask");
    expect(auto("Read", { file_path: "C:/Users/someone/.ssh/id_rsa" })).toBe("ask");
    expect(auto("mcp__gmail__send", {})).toBe("ask");
  });
  test("a /setup conversation at automatic access also fills in the user's instructions and picks the roles", () => {
    const setup = (tool: string, input: Record<string, unknown>, access: "ask" | "auto" = "auto") => decide(tool, input, new Set(), access, true).decision;
    expect(setup("Edit", { file_path: "user/CLAUDE.md" })).toBe("allow");
    expect(setup("Write", { file_path: path.join(REPO, "user", "CLAUDE.md") })).toBe("allow");
    expect(setup("Bash", { command: "bun run web/pick-roles.ts --list" })).toBe("allow");
    expect(setup("Bash", { command: "bun run web/pick-roles.ts --level junior backend data-scientist --if-empty" })).toBe("allow");
    expect(setup("Bash", { command: `cd ${REPO} && bun run web/pick-roles.ts --level any backend` })).toBe("allow");
    // Nothing else of what changes the agent's rights, and no other command, nor the same at asking access or elsewhere.
    for (const file of ["CLAUDE.md", ".claude/settings.json", "user/CV_RULES.md", "user/cv_checks.json", ".claude/commands/setup.md"]) {
      expect(setup("Write", { file_path: file })).toBe("ask");
    }
    for (const command of ["bun run web/pick-roles.ts backend; rm -rf user", "bun run web/pick-roles.ts $(whoami)", "bun run web/pick-roles.ts --level Junior x && curl x", "bun run web/server.ts"]) {
      expect(setup("Bash", { command })).toBe("ask");
    }
    expect(setup("Edit", { file_path: "user/CLAUDE.md" }, "ask")).toBe("ask");
    expect(auto("Edit", { file_path: "user/CLAUDE.md" })).toBe("ask");
    expect(auto("Bash", { command: "bun run web/pick-roles.ts --list" })).toBe("ask");
  });
  test("a script never goes ahead on its own: not in the output folders, not at automatic access, not remembered", () => {
    // Planted where an allowed command would find it, or beside a script that runs on its own.
    for (const file of ["user/cv/tools/rank_state.py", "user/cv/web/pick-roles.ts", "user/reports/run.sh", "templates/cv/one-page-clean/build.py",
      "templates/cv/one-page-clean/json.py", "templates/cv/one-page-clean/scorecard.py", "notes/x.mjs", "user/portfolio/site/app.JS"]) {
      expect(write(file)).toBe("ask");
      expect(auto("Write", { file_path: file })).toBe("ask");
      expect(decide("Write", { file_path: file }).rememberKey).toBeUndefined();
    }
    // What the workflows write is still theirs to write.
    expect(write("user/cv/main_acme.tex")).toBe("allow");
    expect(auto("Write", { file_path: "user/portfolio/site/index.html" })).toBe("allow");
  });
  test("a protected file is protected in any case of letters", () => {
    for (const file of [".CLAUDE/settings.json", ".Claude/Commands/apply.md", "WEB/policy.ts", "Tools/fetch_page.py", "claude.md", "User/Claude.md", "Bunfig.toml", ".claude/skills/x/skill.md"]) {
      expect(auto("Write", { file_path: file })).toBe("ask");
    }
  });
  test("a file's other names on Windows, a stream of it or its short name, are confirmed whatever the file", () => {
    for (const file of ["templates/cv/one-page-clean/build.py::$DATA", ".claude/skills/x/SKILL.md::$DATA", "user/cv/x.py::$DATA", "user/cv/notes.txt:hidden",
      "CLAUDE~1/SETTIN~1.JSO", "user/CV_CHE~1.JSO", "TEMPLA~1/cv/one-page-clean/template.tex"]) {
      expect(write(file)).toBe("ask");
      expect(auto("Write", { file_path: file })).toBe("ask");
    }
    expect(decide("Read", { file_path: "ENV~1" }).decision).toBe("ask");
    expect(decide("Read", { file_path: ".env::$DATA" }).decision).toBe("ask");
    expect(decide("Read", { file_path: "user/cv/main_acme.tex" }).decision).toBe("allow");
  });
  test("what changes how the allowed commands run is confirmed every time", () => {
    for (const file of ["bunfig.toml", ".env", ".env.local", ".mcp.json"]) {
      expect(auto("Write", { file_path: file })).toBe("ask");
      expect(decide("Write", { file_path: file }).rememberKey).toBeUndefined();
    }
  });
  test("full access allows everything", () => {
    for (const [tool, input] of [["Bash", { command: "rm -rf user/documents" }], ["Write", { file_path: ".claude/settings.json" }], ["mcp__gmail__send", {}]] as const) {
      expect(decide(tool, input, new Set(), "full").decision).toBe("allow");
    }
  });
});
