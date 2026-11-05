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
  test("full access allows everything", () => {
    for (const [tool, input] of [["Bash", { command: "rm -rf user/documents" }], ["Write", { file_path: ".claude/settings.json" }], ["mcp__gmail__send", {}]] as const) {
      expect(decide(tool, input, new Set(), "full").decision).toBe("allow");
    }
  });
});
