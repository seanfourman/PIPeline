import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { createPolicy, REPO } from "./policy";

const decide = createPolicy();
const bash = (command: string) => decide("Bash", { command }).decision;
const write = (file_path: string) => decide("Write", { file_path }).decision;

describe("bash", () => {
  test("runs the commands settings.json already allows", () => {
    expect(bash("python tools/verify_pdf.py cv/a.pdf --pages 1")).toBe("allow");
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
    expect(bash("cd cv && lualatex -interaction=nonstopmode main_acme_dev.tex")).toBe("allow");
    expect(bash("cd ../cover_letters && xelatex -interaction=nonstopmode cover_acme_dev.tex")).toBe("allow");
    expect(
      bash(
        "cd cv && rm -f main_a.pdf && mkdir -p build && lualatex -interaction=nonstopmode -halt-on-error -output-directory=build main_a.tex && mv build/main_a.pdf ./",
      ),
    ).toBe("allow");
  });

  test("never runs LaTeX with shell escape or other files", () => {
    expect(bash("lualatex -shell-escape main.tex")).toBe("ask");
    expect(bash("cd cv && lualatex -interaction=nonstopmode --shell-escape main.tex")).toBe("ask");
    expect(bash("cd cv && lualatex -interaction=nonstopmode ../../evil.tex")).toBe("ask");
  });

  test("cleans only LaTeX leftovers", () => {
    expect(bash("rm -f cv/main_a.{aux,log,out,fls,fdb_latexmk,synctex.gz} cover_letters/cover_a.{aux,log,out,fls,fdb_latexmk,synctex.gz}")).toBe("allow");
    expect(bash("rm -rf cv/build cover_letters/build")).toBe("allow");
    expect(bash("rm -rf cv")).toBe("ask");
    expect(bash("rm -rf documents")).toBe("ask");
  });

  test("moving to the project first changes nothing about the rest of the command", () => {
    const root = REPO.replaceAll("\\", "/");
    expect(bash(`cd "${root}" && python tools/verify_pdf.py cv/a.pdf --pages 1`)).toBe("allow");
    expect(bash(`cd ${root} && python templates/cv/one-page-clean/build.py acme_dev`)).toBe("allow");
    expect(bash(`cd "${root}/cv" && lualatex -interaction=nonstopmode main_a.tex`)).toBe("allow");
    expect(bash(`cd "${root}" && curl https://evil.example`)).toBe("ask");
    expect(bash(`cd "${root}" && python tools/verify_pdf.py a.pdf; curl https://evil.example`)).toBe("ask");
    expect(bash(`cd "${root}" && cd .. && rm -rf documents`)).toBe("ask");
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
    expect(bash('mkdir -p documents/applications/drs_rada_ate && cp cv/main_drs_rada_ate.pdf "documents/applications/drs_rada_ate/Sean Fourman - Resume.pdf"')).toBe("allow");
    expect(bash('mkdir -p documents/applications/.. && cp cv/main_a.pdf "documents/applications/../Sean Fourman - Resume.pdf"')).toBe("ask");
    expect(bash('mkdir -p documents/applications/a && cp .env "documents/applications/a/Sean Fourman - Resume.pdf"')).toBe("ask");
    expect(bash('mkdir -p documents/applications/a && cp cv/main_a.pdf "documents/applications/a/other.pdf"')).toBe("ask");
  });

  test("asks for anything unknown", () => {
    expect(bash("git push upstream master")).toBe("ask");
    expect(bash("curl https://example.com")).toBe("ask");
  });
});

describe("writes", () => {
  test("allows workflow output", () => {
    expect(write("cv/main_a.tex")).toBe("allow");
    expect(write(path.join(REPO, "job_search_tracker.csv"))).toBe("allow");
    expect(write(".claude/skills/job-scraper/job_scraper/seen_jobs.json")).toBe("allow");
    expect(write(path.join(os.tmpdir(), "claude", "x", "posting.txt"))).toBe("allow");
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
    expect(write("cv/../../outside.txt")).toBe("ask");
    expect(write("cv/../.claude/settings.json")).toBe("ask");
    expect(write("C:/Windows/evil.txt")).toBe("ask");
  });
});

describe("other tools", () => {
  test("reads inside the project run, reads outside ask", () => {
    expect(decide("Read", { file_path: "cv/main_example.tex" }).decision).toBe("allow");
    expect(decide("Read", { file_path: "C:/Users/Sean-PC/.ssh/id_rsa" }).decision).toBe("ask");
    expect(decide("Grep", { pattern: "x", path: "C:/Users" }).decision).toBe("ask");
  });

  test("research runs, unknown tools ask", () => {
    expect(decide("WebSearch", {}).decision).toBe("allow");
    expect(decide("Artifact", {}).decision).toBe("ask");
    expect(decide("mcp__gmail__send", {}).decision).toBe("ask");
  });
});
