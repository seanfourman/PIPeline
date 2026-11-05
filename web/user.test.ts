import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { englishOnly } from "./names";
import { cvFileName, ensureUserFolder, listUserDocuments, moveToUserFolder, saveUserDocument, saveUserName } from "./user";

function project(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "user-folder-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const read = (root: string, rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("moveToUserFolder", () => {
  test("moves an older version's files into user/, and leaves the project's own", () => {
    const root = project({
      "job_search_tracker.csv": "date,company\n",
      "cv/main_example.tex": "\\usepackage{../templates/cv/one-page-clean/onepage}\n",
      "cv/main_acme_dev.pdf": "pdf",
      "cv/main_acme_dev.txt": "text",
      "cover_letters/cover_acme_dev.tex": "\\documentclass[]{cover}\n\\fontspec[Path = OpenFonts/fonts/raleway/]{Raleway-Medium}\n",
      "cover_letters/cover_example.tex": "example",
      "cover_letters/cover.cls": "class",
      "documents/README.md": "readme",
      "documents/cv/.gitkeep": "",
      "documents/cv/old.pdf": "cv",
      "documents/applications/acme_dev/job_posting.md": "posting",
      "job_scraper/.gitkeep": "",
      "job_scraper/seen_jobs.json": "{}",
      "company_research/acme.json": "{}",
      "upskill/report-2026-11-01.md": "report",
      "web/data/token": "abc",
      "web/data/sessions/1.json": "{}",
    });
    const { moved, kept } = moveToUserFolder(root);
    expect(kept).toEqual([]);
    expect(moved).toHaveLength(12);
    expect(read(root, "user/job_search_tracker.csv")).toBe("date,company\n");
    expect(read(root, "user/cv/main_example.tex")).toBe("\\usepackage{../../templates/cv/one-page-clean/onepage}\n");
    expect(read(root, "user/cover_letters/cover_acme_dev.tex")).toBe("\\documentclass[]{../../cover_letters/cover}\n\\fontspec[Path = \\coverfonts raleway/]{Raleway-Medium}\n");
    for (const rel of ["user/cv/main_acme_dev.pdf", "user/cv/main_acme_dev.txt", "user/documents/cv/old.pdf", "user/documents/applications/acme_dev/job_posting.md",
      "user/job_scraper/seen_jobs.json", "user/company_research/acme.json", "user/upskill/report-2026-11-01.md", "user/app/token", "user/app/sessions/1.json"]) {
      expect(existsSync(path.join(root, rel))).toBe(true);
    }
    // The project's own files stay, and a folder left empty goes.
    for (const rel of ["cover_letters/cover_example.tex", "cover_letters/cover.cls", "documents/README.md", "documents/cv/.gitkeep", "job_scraper/.gitkeep"]) {
      expect(existsSync(path.join(root, rel))).toBe(true);
    }
    for (const rel of ["cv", "web/data", "company_research", "documents/applications"]) expect(existsSync(path.join(root, rel))).toBe(false);
  });

  test("never overwrites a file user/ has, and runs again with nothing to do", () => {
    const root = project({ "job_search_tracker.csv": "old\n", "user/job_search_tracker.csv": "new\n", "reports/a.html": "a" });
    expect(moveToUserFolder(root)).toEqual({ moved: ["reports/a.html"], kept: ["job_search_tracker.csv"] });
    expect(read(root, "user/job_search_tracker.csv")).toBe("new\n");
    expect(read(root, "job_search_tracker.csv")).toBe("old\n");
    expect(moveToUserFolder(root)).toEqual({ moved: [], kept: ["job_search_tracker.csv"] });
  });

  test("a project with nothing old moves nothing", () => {
    expect(moveToUserFolder(project({ "README.md": "x" }))).toEqual({ moved: [], kept: [] });
  });
});

describe("the introduction's saves", () => {
  test("the name goes into profile.json beside what is there, and names the CV", () => {
    const root = project({ "user/profile.json": JSON.stringify({ phone: "x" }) });
    const user = path.join(root, "user");
    expect(saveUserName("  Dana   Cohen ", user)).toBe("Dana Cohen");
    expect(JSON.parse(read(root, "user/profile.json"))).toEqual({ phone: "x", name: "Dana Cohen" });
    expect(cvFileName(user)).toBe("Dana Cohen - Resume.pdf");
    for (const bad of ["", "   ", "<>", "x".repeat(61)]) expect(() => saveUserName(bad, user)).toThrow("name_invalid");
  });

  test("the name is in English letters, with the marks names carry", () => {
    const user = path.join(project({}), "user");
    expect(saveUserName("Jean-Luc O'Neil Jr.", user)).toBe("Jean-Luc O'Neil Jr.");
    for (const bad of ["שון פורמן", "Sean פורמן", "José", "-Dana", "Dana 2"]) expect(() => saveUserName(bad, user)).toThrow("name_english");
    // What the introduction's field keeps of what was typed.
    expect(englishOnly("שון Sean 2 O'Neil-Jr.")).toBe(" Sean  O'Neil-Jr.");
  });

  test("documents land in the folder /setup reads, never over one already there", () => {
    const root = project({});
    const user = path.join(root, "user");
    const data = Buffer.from("%PDF-1.4 cv").toString("base64");
    expect(saveUserDocument("cv", "My CV.pdf", data, user)).toBe("My CV.pdf");
    expect(saveUserDocument("cv", "My CV.pdf", data, user)).toBe("My CV (2).pdf");
    expect(saveUserDocument("linkedin", "..\\../Profile.PDF", data, user)).toBe("Profile.pdf");
    expect(read(root, "user/documents/cv/My CV.pdf")).toBe("%PDF-1.4 cv");
    expect(listUserDocuments(user)).toEqual({ cv: ["My CV (2).pdf", "My CV.pdf"], linkedin: ["Profile.pdf"] });
  });

  test("refuses another folder, another kind of file, or nothing", () => {
    const user = path.join(project({}), "user");
    const data = Buffer.from("x").toString("base64");
    expect(() => saveUserDocument("diplomas", "a.pdf", data, user)).toThrow("document_kind");
    expect(() => saveUserDocument("cv", "run.exe", data, user)).toThrow("document_type");
    expect(() => saveUserDocument("cv", ".pdf", data, user)).toThrow("document_type");
    expect(() => saveUserDocument("cv", "a.pdf", "", user)).toThrow("document_empty");
    expect(listUserDocuments(user)).toEqual({ cv: [], linkedin: [] });
  });
});

describe("ensureUserFolder", () => {
  test("adds the starting files a user is missing, never over theirs", () => {
    const root = project({ "templates/user/CLAUDE.md": "start", "templates/user/cv/main_example.tex": "example", "user/CLAUDE.md": "mine" });
    expect(ensureUserFolder(path.join(root, "user"), path.join(root, "templates", "user"))).toEqual(["cv/main_example.tex"]);
    expect(read(root, "user/CLAUDE.md")).toBe("mine");
  });
});
