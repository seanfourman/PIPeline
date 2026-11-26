import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { addedFrom, allowedCommands, applyJob, checkSource, draftingSystem, evaluationSystem, folderName, parseEvaluation, portalFor, reviewPrompt, sourceFrom, sourceHost } from "./applier";
import { recordDraft } from "./edit";
import type { Run } from "./ranker";

const never = new AbortController().signal;
const TEMPLATE = "\\documentclass{article}\n\\usepackage{../../templates/cv/one-page-clean/onepage}\n\\begin{document}\n\\cvname{NAME}\n\\cvsection{SKILLS}\n\\cvbullet{x}\n\\end{document}\n";
const CV = "\\documentclass{article}\n\\usepackage{../../templates/cv/one-page-clean/onepage}\n\\begin{document}\n\\cvname{DANA}\n\\cvbullet{Python \\& SQL}\n\\end{document}\n";
const ADDED_CV = `% Added beyond the profile: Docker, Tailwind CSS\n${CV}`;
const WITH_KAFKA = ADDED_CV.replace("Python \\& SQL", "Python, SQL \\& Kafka");
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

  test("the CV's second pass is asked with the humanizer's patterns, not its frontmatter or how it answers", () => {
    const guide = "---\nname: humanizer\nlicense: MIT\n---\n\n# Humanizer\n\n## How to work\n\n### What to return\n\nThe draft, a critique and the final rewrite.\n\n## A. Staging instead of stating\n\n### 1. Not X but Y\n";
    const asked = reviewPrompt("THE DRAFT", "THE POSTING", (rel) => (rel.endsWith("humanizer/SKILL.md") ? guide : ""));
    expect(asked).toContain("Not X but Y");
    expect(asked).toContain("How to work");
    expect(asked).toContain("THE DRAFT");
    expect(asked).toContain("THE POSTING");
    expect(asked).not.toContain("name: humanizer");
    expect(asked).not.toContain("a critique and the final rewrite");
    const without = reviewPrompt("THE DRAFT", "THE POSTING", () => { throw new Error("no such file"); });
    expect(without).not.toContain("# The humanizer");
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
    // The line naming what the CV adds beyond the profile comes before \documentclass, and stays.
    expect(sourceFrom("```latex\n" + ADDED_CV + "```")).toBe(ADDED_CV);
  });

  test("reads what a CV adds beyond the profile from its first line", () => {
    expect(addedFrom(ADDED_CV)).toEqual(["Docker", "Tailwind CSS"]);
    expect(addedFrom("% Added beyond the profile: none\n" + CV)).toEqual([]);
    expect(addedFrom(CV)).toEqual([]);
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
      // The check finds Kafka missing, and once the keyword pass has added it, nothing.
      if (argv.some((a) => a.includes("ats.py"))) return atsRuns++ ? { code: 0, out: "ATS score: 100 (8 of 8 posting terms)\nMissing: nothing", err: "" } : { code: 0, out: "ATS score: 88 (7 of 8 posting terms)\nMissing: Kafka", err: "" };
      return { code: 2, out: "", err: "unexpected" };
    };
    let atsRuns = 0;
    const prompts: string[] = [];
    const ask = async (system: string, prompt: string) => {
      prompts.push(prompt);
      if (system.startsWith("You evaluate")) return { text: JSON.stringify(EVALUATION), by: "ChatGPT" };
      // The draft first tries a command the template doesn't have; the fix sends a clean one.
      if (prompt.startsWith("Write the CV")) return { text: "```latex\n" + CV.replace("\\cvbullet", "\\directlua{x}\\cvbullet") + "```", by: "ChatGPT" };
      if (prompt.includes("keyword check finds these terms")) return { text: "```latex\n" + WITH_KAFKA + "```", by: "ChatGPT" };
      return { text: "```latex\n" + ADDED_CV + "```", by: "ChatGPT" };
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
    expect(readFileSync(path.join(root, "user", "cv", `main_${name}.tex`), "utf8")).toBe(WITH_KAFKA);
    // Two for the draft (one refused, one fixed) and one after the keyword pass.
    expect(builds).toBe(3);
    expect(prompts.some((p) => p.includes("banned"))).toBe(true);
    expect(recorded[0]).toMatchObject({ company: "Acme Ltd.", role: "Junior Backend Developer", fit_rating: 73, cv_file: `user/cv/main_${name}.tex`, channel: "portal", deadline: "2026-12-01" });
    const archived = readFileSync(path.join(root, "user", "documents", "applications", name, "job_posting.md"), "utf8");
    expect(archived).toContain("## posting_guard");
    expect(archived).toContain("hidden_blocks: 2");
    expect(steps.filter((s) => s === "BuildCv")).toHaveLength(2);
    expect(text).toContain(`user/documents/applications/${name}/Dana Cohen - Resume.pdf`);
    expect(prompts.find((p) => p.includes("keyword check finds these terms"))).toContain("missing from it: Kafka.");
    expect(steps).toContain("AddKeywords");
    expect(text).toContain("ציון ATS: 100. חסרים: כלום.");
    expect(text).toContain("ציון לפי מה שכל חברה מפרסמת: Google 90, Workday A (85), כללי 88.");
    expect(text).toContain("מכתב מקדים");
    expect(text).toContain("נוסף מעבר לפרופיל, כדאי להתכונן לשאלות עליו: Docker, Tailwind CSS.");
    // What comes next is asked for in the same conversation, with no command to learn.
    expect(text).toContain("אפשר להמשיך כאן כרגיל");
    expect(text).not.toContain("/apply");
    // Five calls to the AI: the fit, the draft, the review, one fix after the build stopped, and the keyword pass.
    expect(prompts).toHaveLength(5);
  });

  // Sean (2026-11-26) wanted a panel of seven reviewers trying to reject each CV, to turn on or off.
  test("with the Wolf Pack on: seven seats read the draft, the reasons are fixed, the Gate reads it again, and it is kept", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "apply-"));
    mkdirSync(path.join(root, "user", "cv"), { recursive: true });
    const pack = readFileSync(path.join(import.meta.dir, "..", ".claude", "agents", "wolf-pack-reviewer.md"), "utf8");
    const files: Record<string, string> = {
      "templates/cv/one-page-clean/template.tex": TEMPLATE, "user/cv/main_example.tex": CV, "user/CV_RULES.md": "rules",
      "user/profile/01-candidate-profile.md": "profile", ".claude/agents/wolf-pack-reviewer.md": pack,
    };
    const run: Run = async (argv) => {
      if (argv.some((a) => a.includes("posting_guard.py"))) return { code: 0, out: "posting_guard: clean\n--- text ---\nJunior Backend Developer at Acme. Python and SQL.", err: "" };
      if (argv.some((a) => a.includes("ats.py"))) return { code: 0, out: "ATS score: 100 (8 of 8 posting terms)\nMissing: nothing", err: "" };
      return { code: 2, out: "", err: "unexpected" };
    };
    const wolves: { seat: string; posting: boolean; cv: string }[] = [];
    let gateReads = 0;
    const ask = async (system: string, prompt: string) => {
      if (system.startsWith("You evaluate")) return JSON.stringify(EVALUATION);
      if (system.includes("one wolf of the Wolf Pack")) {
        const seat = prompt.match(/Your seat: (The [^.]+)\./)![1];
        wolves.push({ seat, posting: prompt.includes("POSTING-"), cv: prompt });
        if (seat === "The Gate" && gateReads++) return "SEAT: The Gate\nVERDICT: PASS\nSCORE: 91\nDECIDED BY: clear.";
        return `SEAT: ${seat}\nVERDICT: ${seat === "The CEO" ? "PASS" : "REJECT"}\nSCORE: 40\nDECIDED BY: small work first.\nREASONS (worst first, at most 5):\n1. LINE: "Cut memory" WHY: too minor. FIX: lead with the AR station.`;
      }
      if (prompt.includes("the Wolf Pack, each tried to reject")) return `1. "Cut memory": too minor. FIXED: led with the AR station.\n2. (missing): no Kafka. GAP: Kafka never used.\n\`\`\`latex\n${ADDED_CV}\`\`\``;
      return "```latex\n" + CV + "```";
    };
    const steps: string[] = [];
    const text = await applyJob({
      input: "Junior Backend Developer at Acme. Python and SQL.", lang: "he", signal: never, run, root, ask, context: [], wolfPack: true,
      build: async (name) => ({ ok: true, output: `Saved user/documents/applications/${name}/Dana Cohen - Resume.pdf` }),
      r: (rel) => files[rel] ?? "", record: () => "added", steps: { start: (id, t, n) => steps.push(`${n}`), done: () => {} },
    });
    const name = "acme_ltd_junior_backend_developer";
    // The seven seats, the four marked so with the posting; then the Gate once more on the built CV.
    expect(wolves.slice(0, 7).map((w) => w.seat).sort()).toEqual(["The CEO", "The Gate", "The Hiring Manager", "The Interrogator", "The Recruiter", "The Rival", "The Teammate"]);
    expect(wolves.slice(0, 7).filter((w) => w.posting).map((w) => w.seat).sort()).toEqual(["The Gate", "The Hiring Manager", "The Interrogator", "The Rival"]);
    expect(wolves).toHaveLength(8);
    expect(wolves[7].cv).toContain(ADDED_CV.trim().split("\n")[0]);
    expect(steps).toEqual(expect.arrayContaining(["WolfPack", "FixPackReasons", "GateAgain"]));
    expect(readFileSync(path.join(root, "user", "cv", `main_${name}.tex`), "utf8")).toBe(ADDED_CV);
    const kept = readFileSync(path.join(root, "user", "documents", "applications", name, "wolf-pack.md"), "utf8");
    expect(kept).toContain("- The CEO: PASS, 40");
    expect(kept).toContain("GAP: Kafka never used.");
    expect(kept).toContain("## The Gate, reading the final CV");
    expect(text).toContain("להקת הזאבים: 6 מתוך 7 דחו את הטיוטה. תוקנו 1 סיבות, וסיבה אחת נשארה פער.");
    expect(text).toContain("הסינון האוטומטי: דוחה (40) לפני, עובר (91) אחרי.");
    expect(text).toContain(`user/documents/applications/${name}/wolf-pack.md`);
  });

  test("with the Wolf Pack off, no wolf is asked", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "apply-"));
    const prompts: string[] = [];
    const run: Run = async (argv) => (argv.some((a) => a.includes("posting_guard.py")) ? { code: 0, out: "posting_guard: clean\n--- text ---\nA backend job.", err: "" } : { code: 0, out: "ATS score: 90\nMissing: nothing", err: "" });
    await applyJob({
      input: "A backend job.", lang: "en", signal: never, run, root, context: [], r: () => "",
      ask: async (system, prompt) => { prompts.push(system + prompt); return system.startsWith("You evaluate") ? JSON.stringify(EVALUATION) : "```latex\n" + CV + "```"; },
      build: async (name) => ({ ok: true, output: `Saved user/documents/applications/${name}/x.pdf` }), record: () => "added", steps: { start: () => {}, done: () => {} },
    });
    expect(prompts.some((p) => p.includes("Wolf Pack"))).toBe(false);
  });

  test("in the daily run, writes a CV only for a strong or good fit, and none for a posting the guard flags", async () => {
    const tryIt = async (evaluation: object, guard = "posting_guard: clean") => {
      const root = mkdtempSync(path.join(os.tmpdir(), "apply-"));
      let built = false;
      const run: Run = async (argv) => (argv.some((a) => a.includes("posting_guard.py")) ? { code: 0, out: `${guard}\n--- text ---\nA backend job in Tel Aviv.`, err: "" } : { code: 2, out: "", err: "" });
      const text = await applyJob({
        input: "A backend job in Tel Aviv.", lang: "en", signal: never, run, root, context: [], r: () => "", strict: true,
        ask: async () => JSON.stringify(evaluation), build: async () => { built = true; return { ok: false, output: "" }; },
        steps: { start: () => {}, done: () => {} },
      });
      return { text, built };
    };
    const moderate = await tryIt({ ...EVALUATION, scores: { technical: 50, experience: 50, behavioral: 50, career: 50 } });
    expect(moderate.text).toContain("I didn't write a CV, because the fit is Moderate Fit");
    expect(moderate.built).toBe(false);
    const flagged = await tryIt(EVALUATION, "posting_guard: ⚠ instructions aimed at an AI");
    expect(flagged.text).toContain("the posting check found something suspicious");
    expect(flagged.built).toBe(false);
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

  test("goes on when the company comes back in Hebrew, and names the conversation by the role and company", async () => {
    // A Hebrew posting once stopped here with apply_no_name (2026-11-17): its folder name had no Latin letter left.
    const root = mkdtempSync(path.join(os.tmpdir(), "apply-"));
    const run: Run = async (argv) => (argv.some((a) => a.includes("posting_guard.py")) ? { code: 0, out: "posting_guard: clean\n--- text ---\nA software tester job in Tel Aviv.", err: "" } : { code: 2, out: "", err: "" });
    const names: string[] = [];
    const text = await applyJob({
      input: "A software tester job in Tel Aviv.", lang: "en", signal: never, run, root, context: [], r: () => "",
      ask: async () => JSON.stringify({ ...EVALUATION, company: "אקמה", role: "בודק תוכנה", location_verdict: "FAIL" }), build: async () => { throw new Error("no build"); },
      steps: { start: () => {}, done: () => {}, named: (n) => names.push(n) },
    });
    expect(text).toContain("I didn't write a CV");
    expect(names).toEqual(["בודק תוכנה, אקמה"]);
  });

  test("asks for the company and role in Latin letters", () => {
    expect(evaluationSystem("he", [])).toContain("the employer name in Latin letters");
  });
});
