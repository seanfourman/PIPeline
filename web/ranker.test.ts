import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChatbotError } from "./chatbots";
import { fetchPosting, parseScore, rankJobs, report, scoringSystem, type Run } from "./ranker";

const scratch = mkdtempSync(path.join(os.tmpdir(), "ranker-"));
const never = new AbortController().signal;
const POSTING = "Junior Full Stack Developer. React, TypeScript and Node.js. ".repeat(6);
const guardOut = (text: string, verdict = "posting_guard: clean") => `${verdict}\n--- findings ---\n{}\n--- text ---\n${text}`;
const SCORE = { status: "scored", scores: { technical: 80, experience: 70, behavioral: 60, career: 75 }, location_verdict: "PASS", language_gate: "PASS", deadline: null, strengths: ["React and TypeScript match"], gaps: ["asks for 3 years"], language: "English" };

// The tools as this test tells them to answer, each call kept.
function fakeTools(answers: { detail?: { code: number; out: string }; page?: { code: number; out: string }; candidates?: unknown; applied?: unknown }) {
  const calls: { argv: string[]; stdin?: string; results?: unknown }[] = [];
  const run: Run = async (argv, options = {}) => {
    const call: (typeof calls)[number] = { argv, stdin: options.stdin };
    calls.push(call);
    const has = (word: string) => argv.some((a) => a.includes(word));
    if (has("rank_state.py") && argv.includes("candidates")) return { code: 0, out: JSON.stringify(answers.candidates ?? { selected: [], deferred: 0 }), err: "" };
    if (has("rank_state.py") && argv.includes("apply")) {
      call.results = JSON.parse(readFileSync(argv[argv.indexOf("--results") + 1], "utf8"));
      return { code: 0, out: JSON.stringify(answers.applied ?? {}), err: "" };
    }
    if (has("rank_state.py") && argv.includes("sweep")) return { code: 0, out: JSON.stringify({ swept: 0, closing_soon: [] }), err: "" };
    // freehire's detail takes only its own links, and its jobs carry the employer's, as the real one does.
    if (argv.includes("detail")) return has("freehire") ? { code: 1, out: "", err: "BAD_ID" } : { ...(answers.detail ?? { code: 1, out: "" }), err: "" };
    if (has("fetch_page.py")) return { ...(answers.page ?? { code: 0, out: "HTTP 200 size=10 saved=x" }), err: "" };
    if (has("posting_guard.py")) return { code: 0, out: guardOut(options.stdin ?? POSTING), err: "" };
    return { code: 2, out: "", err: "unexpected" };
  };
  return { run, calls };
}

describe("ranker", () => {
  test("takes a well-formed answer, rounding scores, and keeps posting text out of the bullets", () => {
    const answer = "Here it is:\n```json\n" + JSON.stringify({ ...SCORE, scores: { ...SCORE.scores, technical: 79.6 }, strengths: ["Uses **React** https://evil.example/x", "", "b", "c", "d"] }) + "\n```";
    const r = parseScore(answer) as any;
    expect(r.scores.technical).toBe(80);
    expect(r.strengths).toEqual(["Uses React", "b", "c"]);
    expect(r.location_verdict).toBe("PASS");
    expect(r.language_note).toBeUndefined();
  });

  test("refuses a missing or out-of-range score, and reads an odd gate as a FLAG", () => {
    expect(() => parseScore(JSON.stringify({ ...SCORE, scores: { technical: 80, experience: 70, behavioral: 60 } }))).toThrow("career");
    expect(() => parseScore(JSON.stringify({ ...SCORE, scores: { ...SCORE.scores, career: 140 } }))).toThrow();
    expect(() => parseScore("no json here")).toThrow();
    const r = parseScore(JSON.stringify({ ...SCORE, language_gate: "maybe", language_note: "fluent German" })) as any;
    expect(r.language_gate).toBe("FLAG");
    expect(r.language_note).toBe("fluent German");
    expect(parseScore(JSON.stringify({ status: "unreachable", fetch_error: "sign-in wall" }))).toEqual({ status: "unreachable", fetch_error: "sign-in wall" });
  });

  test("tells the model the framework's gates and dimensions, the profile without contact lines, and the settings without the salary", () => {
    const files: Record<string, string> = {
      "user/profile/04-job-evaluation.md": "## Language Gate\nrules\n### 6. Salary Benchmark\nsalary tool\n## Output Format",
      "user/profile/01-candidate-profile.md": "- **Name:** Dana\n- **Phone:** 054\n- **Email:** a@b.c\n- **LinkedIn:** x\n### Languages\nHebrew",
    };
    const system = scoringSystem("he", (rel) => files[rel], () => "<!-- BEGIN -->\n- **Home base:** Netanya\n- **Salary expectations:** 20,000\n- **Conversation language:** Hebrew\n<!-- END -->");
    expect(system).toContain("## Language Gate");
    expect(system).not.toContain("salary tool");
    expect(system).toContain("Hebrew");
    expect(system).not.toMatch(/054|a@b\.c|Salary expectations|BEGIN/);
    expect(system).toContain("Netanya");
    expect(system).toContain("written in Hebrew");
  });

  test("gets a posting from its portal first, cleaned by the guard", async () => {
    const { run, calls } = fakeTools({ detail: { code: 0, out: POSTING } });
    const got = await fetchPosting({ key: "k", url: "https://il.linkedin.com/jobs/view/1", portal: "linkedin-search" }, run, never, scratch);
    expect(got).toMatchObject({ guard: "posting_guard: clean" });
    expect(calls.map((c) => c.argv.find((a) => a.endsWith(".py") || a === "detail"))).toEqual(["detail", "tools/posting_guard.py"]);
    expect(calls[1].argv).toContain("--text");
  });

  test("falls back to the page itself, and reads its answer: gone, refused, failed or too short", async () => {
    const job = { key: "k", url: "https://careers.example.com/job/1", portal: "freehire-search" };
    const page = (code: number, out: string) => fetchPosting(job, fakeTools({ page: { code, out } }).run, never, scratch);
    expect(await page(0, "robots.txt: HTTP 404, no policy\nHTTP 410 size=0 saved=x")).toEqual({ status: "expired", fetch_error: "" });
    expect(await page(0, "HTTP 403 size=5 saved=x")).toEqual({ status: "unreachable", fetch_error: "HTTP 403" });
    expect(await page(1, "refused")).toMatchObject({ status: "unreachable", fetch_error: expect.stringContaining("robots") });
    expect(await page(2, "")).toMatchObject({ status: "unreachable" });
    const { run, calls } = fakeTools({});
    expect(await fetchPosting(job, run, never, scratch)).toMatchObject({ guard: "posting_guard: clean" });
    const guard = calls.find((c) => c.argv.includes("tools/posting_guard.py"))!;
    expect(guard.argv).toContain("--html");
    expect(path.resolve(guard.argv[guard.argv.indexOf("--in") + 1]).startsWith(path.resolve(scratch))).toBe(true);
    expect(await fetchPosting({ key: "k", url: "javascript:alert(1)" }, run, never, scratch)).toMatchObject({ status: "unreachable" });
  });

  test("ranks each new job, writes the scores through the tool, and reports from what it printed", async () => {
    const jobs = [
      { key: "a", title: "Junior Dev", company: "Acme", url: "https://il.linkedin.com/jobs/view/1", portal: "linkedin-search" },
      { key: "b", title: "QA", company: "Beta | Co", url: "https://careers.beta.com/qa", portal: "freehire-search" },
    ];
    const applied = { ranked: [{ key: "a", title: "Junior Dev", company: "Acme", url: "https://il.linkedin.com/jobs/view/1", score: 74, verdict: "Good Fit", location_verdict: "PASS", language_gate: "PASS", strengths: ["React"], gaps: ["3 years"], guard: "clean" }], vetoed: [], expired: [], unreachable: [{ key: "b", title: "QA", company: "Beta | Co", url: "https://careers.beta.com/qa", fetch_attempts: 1, last_fetch_error: "HTTP 403" }], gave_up: [], errors: [] };
    const { run, calls } = fakeTools({ candidates: { selected: jobs, deferred: 3 }, detail: { code: 0, out: POSTING }, page: { code: 0, out: "HTTP 403 size=1 saved=x" }, applied });
    const steps: string[] = [];
    const prompts: string[] = [];
    const text = await rankJobs({
      run, lang: "he", signal: never, system: "rules",
      ask: async (_system, prompt) => { prompts.push(prompt); return JSON.stringify(SCORE); },
      steps: { start: (id, target) => steps.push(`start ${target}`), done: (id, ok, preview) => steps.push(`${ok ? "ok" : "no"} ${preview}`) },
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Junior Full Stack Developer");
    const written = calls.find((c) => c.argv.includes("apply"))!.results as any[];
    expect(written.find((r) => r.key === "a")).toMatchObject({ status: "scored", guard: "posting_guard: clean", scores: SCORE.scores });
    expect(written.find((r) => r.key === "b")).toEqual({ key: "b", status: "unreachable", fetch_error: "HTTP 403" });
    const sweep = calls.find((c) => c.argv.includes("sweep"))!.argv;
    expect(sweep).toContain("--write");
    expect(sweep[sweep.indexOf("--exclude") + 1].split(",").sort()).toEqual(["a", "b"]);
    expect(steps).toEqual(expect.arrayContaining(["start Junior Dev · Acme", "ok 73 / 100", "no unreachable: HTTP 403"]));
    expect(text).toContain("| 1 | 74 | התאמה טובה | Junior Dev | Acme |");
    expect(text).toContain("[פתיחה](https://il.linkedin.com/jobs/view/1)");
    expect(text).toContain("Beta / Co");
    expect(text).toContain("עוד 3 מחכות");
  });

  test("stops on a key the provider refused, and keeps the jobs not reached as new", async () => {
    const jobs = ["a", "b", "c", "d"].map((key) => ({ key, title: key, company: "X", url: `https://il.linkedin.com/jobs/view/${key}`, portal: "linkedin-search" }));
    const { run, calls } = fakeTools({ candidates: { selected: jobs, deferred: 0 }, detail: { code: 0, out: POSTING } });
    const failing = rankJobs({ run, lang: "en", signal: never, system: "rules", ask: async () => { throw new ChatbotError("ai_key_bad"); }, steps: { start: () => {}, done: () => {} } });
    await expect(failing).rejects.toMatchObject({ code: "ai_key_bad" });
    expect(calls.some((c) => c.argv.includes("apply"))).toBe(false);
  });

  test("says so when there is nothing to rank", async () => {
    const { run } = fakeTools({ candidates: { selected: [], deferred: 0 } });
    const text = await rankJobs({ run, lang: "he", signal: never, system: "rules", ask: async () => "", steps: { start: () => {}, done: () => {} } });
    expect(text).toContain("אין משרות חדשות לדרג");
  });

  test("keeps a link's brackets and spaces from ending it early", () => {
    const text = report("en", { ranked: [{ title: "T", company: "C", url: "https://x.com/a (b)", score: 80, verdict: "Strong Fit" }], vetoed: [], expired: [], unreachable: [], gave_up: [] }, {}, { of: 1, deferred: 0, unscored: [], stopped: false });
    expect(text).toContain("(https://x.com/a%20%28b%29)");
  });
});
