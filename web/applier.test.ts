import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { allowedCommands, applyJob, checkSource, draftingSystem, folderName, parseEvaluation, portalFor, sourceFrom, sourceHost } from "./applier";
import { recordDraft } from "./edit";
import type { Run } from "./ranker";

const never = new AbortController().signal;
const TEMPLATE = "\\documentclass{article}\n\\usepackage{../../templates/cv/one-page-clean/onepage}\n\\begin{document}\n\\cvname{NAME}\n\\cvsection{SKILLS}\n\\cvbullet{x}\n\\end{document}\n";
const CV = "\\documentclass{article}\n\\usepackage{../../templates/cv/one-page-clean/onepage}\n\\begin{document}\n\\cvname{DANA}\n\\cvbullet{Python \\& SQL}\n\\end{document}\n";
const EVALUATION = { company: "Acme Ltd.", role: "Junior Backend Developer", location: "Tel Aviv", language: "English", deadline: "2026-12-01", scores: { technical: 80, experience: 70, behavioral: 60, career: 75 }, location_verdict: "PASS", language_gate: "PASS", strengths: ["Python"], gaps: ["Go"], requirements: [{ term: "Python", priority: "required" }], asks_cover_letter: true };

describe("applier", () => {
  test("names the folder by user/documents/README.md's rule", () => {
    expect(folderName("Novo Nordisk A/S", "ML Engineer")).toBe("novo_nordisk_as_ml_engineer");
    expect(folderName("  Acme--Ltd. ", "Dev (Junior)")).toBe("acmeltd_dev_junior");
    expect(folderName("הזול", "מפתח")).toBe("");
  });

  test("knows a portal by its host, and sorts a source as portal, hiring system or unverified", () => {
    const portals = ["linkedin-search", "freehire-search"];
    expect(portalFor("https://il.linkedin.com/jobs/view/1", portals)).toBe("linkedin-search");
    expect(portalFor("https://careers.example.com/1", portals)).toBe("");
    expect(sourceHost("https://boards.greenhouse.io/acme/1", "").kind).toBe("ats");
    expect(sourceHost("https://evil-greenhouse.io/x", "").kind).toBe("unverified");
    expect(sourceHost("https://job-boards.greenhouse.io.evil.com/x", "").kind).toBe("unverified");
    expect(sourceHost("not a url", "").kind).toBe("pasted");
  });

  test("the CV's writer gets the best practices' rules, not the evidence after them", () => {
    const guide = "# CV Best Practices\n\n## Part 1: The rules\n\n3. **Use the posting's job title.**\n\n## Part 2: The evidence\n\n- **The XYZ formula.** Quartz.";
    const system = draftingSystem((rel) => (rel.endsWith("10-cv-best-practices.md") ? guide : ""), "");
    expect(system).toContain("Use the posting's job title");
    expect(system).not.toContain("XYZ formula");
  });

  test("lets a CV use only the template's commands and its one package line", () => {
    const allowed = allowedCommands([TEMPLATE]);
    const pkg = "\\usepackage{../../templates/cv/one-page-clean/onepage}";
    expect(checkSource(CV, allowed, pkg)).toEqual([]);
    expect(checkSource(CV.replace("\\cvbullet", "\\directlua{os.execute('x')}\\cvbullet"), allowed, pkg)[0]).toContain("\\directlua");
    expect(checkSource(CV.replace("\\cvbullet{", "\\input{../../secrets}\\cvbullet{"), allowed, pkg)[0]).toContain("\\input");
    expect(checkSource(CV.replace(pkg, `${pkg}\n\\usepackage{shellesc}`), allowedCommands([TEMPLATE]), pkg)).toEqual(expect.arrayContaining([expect.stringContaining("only package line")]));
    expect(checkSource("\\cvname{x}", allowed, pkg)[0]).toContain("whole CV");
  });

  test("takes the source out of a fenced answer or a bare one", () => {
    expect(sourceFrom("Here:\n```latex\n" + CV + "```\nDone.")).toBe(CV);
    expect(sourceFrom("chatter " + CV + " more chatter")).toBe(CV);
    expect(sourceFrom("no cv")).toBe("");
  });

  test("reads the evaluation, weighting the score as the framework does", () => {
    const ev = parseEvaluation(JSON.stringify(EVALUATION));
    expect(ev.overall).toBe(73);
    expect(ev.verdict).toBe("Good Fit");
    expect(ev.deadline).toBe("2026-12-01");
    expect(() => parseEvaluation(JSON.stringify({ ...EVALUATION, company: "" }))).toThrow();
  });

  test("records a draft as a new row, then refreshes the open one without moving it back", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tracker-"));
    const file = path.join(root, "user", "job_search_tracker.csv");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'date,company,sector,role,role_type,channel,status,contact_person,fit_rating,notes,cv_file,cover_letter_file,source\n2026-10-01,Other,,QA,,,applied,,60,"sent, waiting",user/cv/main_other_qa.tex,,\n');
    expect(recordDraft({ company: "Acme", role: "Dev", fit_rating: 73, cv_file: "user/cv/main_acme_dev.tex", source: "https://x", deadline: "" }, root, "2026-11-04")).toBe("added");
    let text = readFileSync(file, "utf8");
    expect(text.split("\n")[0].endsWith(",deadline")).toBe(true);
    expect(text).toContain('"sent, waiting"');
    expect(text).toContain("2026-11-04,Acme,,Dev,,,drafted,,73,,user/cv/main_acme_dev.tex,,https://x,");
    expect(recordDraft({ company: "acme", role: "dev", fit_rating: 80, cv_file: "user/cv/main_acme_dev.tex", deadline: "2026-12-01" }, root, "2026-11-05")).toBe("updated");
    text = readFileSync(file, "utf8");
    expect(text).toContain("2026-11-05,Acme,,Dev,,,drafted,,80,redrafted,user/cv/main_acme_dev.tex,,https://x,2026-12-01");
    expect(text.trim().split("\n")).toHaveLength(3);
  });

  test("applies: opens, judges, drafts, reviews, fixes until the build passes, and records", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "apply-"));
    mkdirSync(path.join(root, "user", "cv"), { recursive: true });
    const files: Record<string, string> = {
      "templates/cv/one-page-clean/template.tex": TEMPLATE, "user/cv/main_example.tex": CV, "user/CV_RULES.md": "rules",
      ".claude/skills/job-application-assistant/03-writing-style.md": "style", "templates/cv/one-page-clean/TEMPLATE.md": "guide",
      "user/profile/01-candidate-profile.md": "profile",
    };
    const run: Run = async (argv) => {
      if (argv.includes("detail")) return { code: 0, out: "Junior Backend Developer at Acme. Python and SQL. ".repeat(8), err: "" };
      if (argv.some((a) => a.includes("posting_guard.py"))) return { code: 0, out: 'posting_guard: clean\n--- findings ---\n{"hidden_blocks": [1, 2]}\n--- text ---\nJunior Backend Developer at Acme. Python and SQL.', err: "" };
      if (argv.some((a) => a.includes("ats.py"))) return { code: 0, out: "ATS score: 88 (7 of 8 posting terms)\nMissing: Kafka", err: "" };
      return { code: 2, out: "", err: "unexpected" };
    };
    const prompts: string[] = [];
    const ask = async (system: string, prompt: string) => {
      prompts.push(prompt);
      if (system.startsWith("You evaluate")) return { text: JSON.stringify(EVALUATION), by: "ChatGPT" };
      // The draft first tries a command the template doesn't have; the fix sends a clean one.
      if (prompt.startsWith("Write the CV")) return { text: "```latex\n" + CV.replace("\\cvbullet", "\\directlua{x}\\cvbullet") + "```", by: "ChatGPT" };
      return { text: "```latex\n" + CV + "```", by: "ChatGPT" };
    };
    let builds = 0;
    const build = async (name: string) => { builds++; return builds === 1 ? { ok: false, output: "BUILD STOPPED. line 4: \"passionate\": banned" } : { ok: true, output: `Saved user/documents/applications/${name}/Dana Cohen - Resume.pdf` }; };
    const recorded: any[] = [];
    const steps: string[] = [];
    // The scorecard ats.py would save beside the CV.
    const folder = path.join(root, "user", "documents", "applications", "acme_ltd_junior_backend_developer");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "scorecard.json"), JSON.stringify({ overall: 88, lenses: [{ id: "google", score: 90, checks: [] }, { id: "workday", score: 85, grade: "A", checks: [] }] }));
    const text = await applyJob({
      input: "https://il.linkedin.com/jobs/view/1", lang: "he", signal: never, run, build, root, ask, context: ["# Candidate profile", "profile"],
      r: (rel) => files[rel] ?? "", record: (d) => { recorded.push(d); return "added"; },
      steps: { start: (id, t, n) => steps.push(`${n}`), done: (id, ok) => steps.push(ok ? "ok" : "no") },
    });
    const name = "acme_ltd_junior_backend_developer";
    expect(readFileSync(path.join(root, "user", "cv", `main_${name}.tex`), "utf8")).toBe(CV);
    expect(builds).toBe(2);
    expect(prompts.some((p) => p.includes("banned"))).toBe(true);
    expect(recorded[0]).toMatchObject({ company: "Acme Ltd.", role: "Junior Backend Developer", fit_rating: 73, cv_file: `user/cv/main_${name}.tex`, channel: "portal", deadline: "2026-12-01" });
    const archived = readFileSync(path.join(root, "user", "documents", "applications", name, "job_posting.md"), "utf8");
    expect(archived).toContain("## posting_guard");
    expect(archived).toContain("hidden_blocks: 2");
    expect(steps.filter((s) => s === "BuildCv")).toHaveLength(2);
    expect(text).toContain(`user/documents/applications/${name}/Dana Cohen - Resume.pdf`);
    expect(text).toContain("ציון ATS: 88. חסרים: Kafka.");
    expect(text).toContain("ציון לפי מה שכל חברה מפרסמת: Google 90 · Workday A (85) · כללי 88.");
    expect(text).toContain("מכתב מקדים");
    expect(text).toContain("בגרסה המלאה של ההגשה");
  });

  test("stops before writing a CV when the location fails", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "apply-"));
    const run: Run = async (argv) => (argv.some((a) => a.includes("posting_guard.py")) ? { code: 0, out: "posting_guard: clean\n--- text ---\nA job in Eilat, on site.", err: "" } : { code: 2, out: "", err: "" });
    const text = await applyJob({
      input: "A job in Eilat, on site.", lang: "en", signal: never, run, root, context: [], r: () => "",
      ask: async () => JSON.stringify({ ...EVALUATION, location_verdict: "FAIL" }), build: async () => { throw new Error("no build"); },
      steps: { start: () => {}, done: () => {} },
    });
    expect(text).toContain("I didn't write a CV, because the location doesn't fit your settings.");
    expect(existsSync(path.join(root, "user", "cv"))).toBe(false);
  });
});
