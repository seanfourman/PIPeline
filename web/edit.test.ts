import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCsv } from "./data";
import { listEditableFiles, listSources, readChecks, readDocument, readEditableFile, readSource, saveChecks, saveDocument, saveEditableFile, saveSource, setApplicationStatus } from "./edit";

const PROFILE = ".claude/skills/job-application-assistant/01-candidate-profile.md";

function tempRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), "job-edit-"));
  for (const dir of [".claude/skills/job-application-assistant", "templates/cv/one-page-clean", "cv"]) mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, "CV_RULES.md"), "# Rules\n\nOld rule\n");
  writeFileSync(path.join(root, PROFILE), "---\nframework_version: 1\n---\n\n# Profile\r\n<!-- note -->\r\nFact\r\n");
  writeFileSync(path.join(root, "templates/cv/one-page-clean/cv_checks.json"), "{}");
  writeFileSync(path.join(root, "cv/main_acme_dev.tex"), "\\cvname{A}\n");
  return root;
}

describe("documents", () => {
  test("saves the text and keeps what the editor does not show", () => {
    const root = tempRepo();
    const doc = readDocument("profile", root);
    expect(doc.text.startsWith("# Profile")).toBe(true);
    expect(doc.markdown).not.toContain("note");
    saveDocument("profile", "# Profile\nNew fact\n", doc.version, root);
    const raw = readFileSync(path.join(root, PROFILE), "utf8");
    expect(raw).toContain("framework_version: 1");
    expect(raw).toContain("New fact\r\n");
  });

  test("refuses an empty text, and a file that changed since it was opened", () => {
    const root = tempRepo();
    const doc = readDocument("rules", root);
    expect(() => saveDocument("rules", "  \n", doc.version, root)).toThrow();
    writeFileSync(path.join(root, "CV_RULES.md"), "# A session changed this\n");
    expect(() => saveDocument("rules", "# Mine\n", doc.version, root)).toThrow();
    expect(readFileSync(path.join(root, "CV_RULES.md"), "utf8")).toContain("A session changed this");
  });
});

describe("saveChecks", () => {
  const limits = { summaryLines: 4, summaryFill: 85, skillLines: 6, skillItems: 20 };

  test("writes the file the build reads", () => {
    const root = tempRepo();
    saveChecks({ limits: { ...limits, skillItems: "18" }, banned: [{ reason: "no", phrases: ["Vibe", "vibe", "  ", "# test file"] }] }, root);
    expect(readChecks(root)).toEqual({ limits: { ...limits, skillItems: 18 }, banned: [{ reason: "no", phrases: ["vibe", "# test file"] }] });
  });

  test("refuses a limit out of range, and a phrase with no word in it", () => {
    const root = tempRepo();
    expect(() => saveChecks({ limits: { ...limits, skillItems: 500 } }, root)).toThrow();
    expect(() => saveChecks({ limits: { ...limits, summaryLines: 2.5 } }, root)).toThrow();
    expect(() => saveChecks({ limits }, root)).not.toThrow();
    expect(() => saveChecks({ limits, banned: [{ reason: "no", phrases: ["# *"] }] }, root)).toThrow();
  });
});

describe("setApplicationStatus", () => {
  const HEADER = "date,company,role,status,notes,cv_file,deadline";
  const write = (root: string, ...rows: string[]) => writeFileSync(path.join(root, "job_search_tracker.csv"), [HEADER, ...rows].join("\r\n") + "\r\n");
  const read = (root: string) => readFileSync(path.join(root, "job_search_tracker.csv"), "utf8");
  const today = "2026-11-02";
  const acme = { date: "2026-10-01", company: "Acme, Inc", role: "Dev" };

  test("leaving drafted sets the real send date and a dated note", () => {
    const root = tempRepo();
    write(root, '2026-10-01,"Acme, Inc",Dev,drafted,CV only,cv/main_a.tex,2026-12-01', "2026-10-02,Other,QA,applied,,cv/main_b.tex,");
    setApplicationStatus({ ...acme, status: "applied" }, root, today);
    expect(read(root)).toBe(`${HEADER}\r\n2026-11-02,"Acme, Inc",Dev,applied,CV only; applied 2026-11-02,cv/main_a.tex,2026-12-01\r\n2026-10-02,Other,QA,applied,,cv/main_b.tex,\r\n`);
  });

  test("a later status keeps the date, and a quoted note stays one cell", () => {
    const root = tempRepo();
    write(root, '2026-10-01,"Acme, Inc",Dev,applied,"said ""hi"", then left",cv/main_a.tex,');
    setApplicationStatus({ ...acme, status: "rejected" }, root, today);
    const [row] = parseCsv(read(root));
    expect(row.date).toBe("2026-10-01");
    expect(row.status).toBe("rejected");
    expect(row.notes).toBe('said "hi", then left; rejected 2026-11-02');
    expect(row.cv_file).toBe("cv/main_a.tex");
  });

  test("an empty note gets no separator, and the same status changes nothing", () => {
    const root = tempRepo();
    write(root, '2026-10-01,"Acme, Inc",Dev,no response,,cv/main_a.tex,');
    const before = read(root);
    setApplicationStatus({ ...acme, status: "no_response" }, root, today);
    expect(read(root)).toBe(before);
    setApplicationStatus({ ...acme, status: "interview" }, root, today);
    expect(parseCsv(read(root))[0].notes).toBe("interview 2026-11-02");
  });

  test("refuses an unknown status and a row that is not there", () => {
    const root = tempRepo();
    write(root, '2026-10-01,"Acme, Inc",Dev,applied,,cv/main_a.tex,');
    expect(() => setApplicationStatus({ ...acme, status: "hacked" }, root, today)).toThrow();
    expect(() => setApplicationStatus({ ...acme, company: "Nope", status: "offer" }, root, today)).toThrow();
  });
});

describe("the CV and letter editor", () => {
  test("only opens a document by its plain name", () => {
    const root = tempRepo();
    expect(readSource("cv", "acme_dev", root).source).toContain("cvname");
    for (const bad of ["../secret", "acme_dev.tex", "missing", ""]) expect(() => readSource("cv", bad, root)).toThrow();
  });

  test("refuses to overwrite a CV a session changed", () => {
    const root = tempRepo();
    const { version } = readSource("cv", "acme_dev", root);
    saveSource("cv", "acme_dev", "\\cvname{B}\n", version, root);
    expect(readSource("cv", "acme_dev", root).source).toContain("{B}");
    expect(() => saveSource("cv", "acme_dev", "\\cvname{C}\n", version, root)).toThrow();
  });

  test("lists every CV and letter, with or without a tracker row", () => {
    const root = tempRepo();
    mkdirSync(path.join(root, "cover_letters"));
    writeFileSync(path.join(root, "cover_letters/cover_acme_dev.tex"), "x");
    writeFileSync(path.join(root, "cover_letters/cover.cls"), "x");
    writeFileSync(path.join(root, "cv/notes.txt"), "x");
    const found = listSources(root).map((s) => `${s.kind}:${s.name}`).sort();
    expect(found).toEqual(["cv:acme_dev", "letter:acme_dev"]);
    expect(readSource("letter", "acme_dev", root).ats).toBeNull();
  });
});

describe("the files screen", () => {
  function withFiles() {
    const root = tempRepo();
    mkdirSync(path.join(root, ".claude/commands"), { recursive: true });
    mkdirSync(path.join(root, "web"));
    writeFileSync(path.join(root, ".claude/commands/apply.md"), "# Apply\n");
    writeFileSync(path.join(root, ".claude/skills/job-application-assistant/07-interview-prep.md"), "# Prep\n");
    writeFileSync(path.join(root, ".claude/settings.json"), "{}");
    writeFileSync(path.join(root, "web/policy.ts"), "// policy\n");
    writeFileSync(path.join(root, ".env"), "SECRET=1\n");
    return root;
  }

  test("edits a listed file and leaves the profile to its own screen", () => {
    const root = withFiles();
    const files = listEditableFiles(root).flatMap((g) => g.files);
    expect(files).toContain(".claude/commands/apply.md");
    expect(files).toContain(".claude/skills/job-application-assistant/07-interview-prep.md");
    expect(files).not.toContain(PROFILE);
    const doc = readEditableFile(".claude/commands/apply.md", root);
    saveEditableFile(doc.path, "# Changed\n", doc.version, root);
    expect(readFileSync(path.join(root, doc.path), "utf8")).toBe("# Changed\n");
    expect(() => saveEditableFile(doc.path, "# Again\n", doc.version, root)).toThrow();
  });

  test("permissions can be read here but never saved", () => {
    const root = withFiles();
    for (const file of [".claude/settings.json", "web/policy.ts"]) {
      const doc = readEditableFile(file, root);
      expect(doc.readOnly).toBe(true);
      expect(() => saveEditableFile(file, "changed", doc.version, root)).toThrow();
      expect(readFileSync(path.join(root, file), "utf8")).toBe(doc.text);
    }
  });

  test("nothing outside the list can be read or written", () => {
    const root = withFiles();
    for (const bad of [".env", "../secret", ".claude/commands/../../.env", "web/data/token", "web/server.ts", "", undefined]) {
      expect(() => readEditableFile(bad, root)).toThrow();
      expect(() => saveEditableFile(bad, "x", "v", root)).toThrow();
    }
  });
});
