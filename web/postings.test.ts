import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChatbotError } from "./chatbots";
import { appliedTo, createPostings, type Deps } from "./postings";
import type { Run } from "./ranker";
import { jobId } from "./ui/jobid";

// A page as the guard cleans it: the site's menu round the posting, which has headings, a list and what it counts an
// advantage.
const PAGE_TEXT = [
  "Menu", "Sign in", "## About the role",
  "We build data pipelines with Python, and run them for teams across the company, from the first idea to production, with care for quality, speed and the people who use them every day.",
  "Hybrid: 3 days a week in the office.", "## Requirements", "• 2+ years of experience with Python", "• SQL", "## Nice to have", "• Airflow", "Footer",
].join("\n");
const SENIOR_TEXT = PAGE_TEXT.replace("2+ years of experience", "4+ years of experience");
const guardOut = (text: string) => `posting_guard: clean\n--- findings ---\n{}\n--- text ---\n${text}`;
const ANSWER = {
  status: "scored", scores: { technical: 80, experience: 70, behavioral: 60, career: 75 }, location_verdict: "PASS", language_gate: "PASS", deadline: null,
  strengths: ["Python matches"], gaps: ["no Airflow"], language: "English",
  posting: {
    sections: [{ title: "About the role", from: 3, to: 4, list: false }, { title: "Requirements", from: 6, to: 7, list: true }, { title: "Backwards", from: 9, to: 4 }],
    facts: { employment: "full_time", work_mode: "hybrid", office_days: 3, experience_min: 2, experience_max: null, level: "entry" },
    skills: [{ name: "Python", must: true, have: true }, { name: "C#", must: false, have: false }],
  },
};
const JOB = { url: "https://careers.acme.example/jobs/7", title: "Data Engineer", company: "Acme", location: "Tel Aviv" };

function setup(over: Partial<Deps> = {}, page = { code: 0, out: "HTTP 200 size=10 saved=x" }, text = PAGE_TEXT) {
  const calls: string[][] = [];
  const run: Run = async (argv) => {
    calls.push(argv);
    if (argv.some((a) => a.includes("fetch_page.py"))) return { ...page, err: "" };
    if (argv.some((a) => a.includes("posting_guard.py"))) return { code: 0, out: guardOut(text), err: "" };
    return { code: 2, out: "", err: "unexpected" };
  };
  const applied: Record<string, unknown>[] = [];
  const asks: string[] = [];
  const dir = mkdtempSync(path.join(os.tmpdir(), "postings-"));
  const postings = createPostings({
    dir, run, lang: () => "he", seen: () => ({}), tracker: () => [], system: () => "rules", seniority: () => "junior", profile: () => "- **Python**, SQL",
    ask: async (_system, prompt) => { asks.push(prompt); return { text: JSON.stringify(ANSWER), by: "Claude" }; },
    apply: (rows) => applied.push(...rows),
    pace: { pause: 0, sameSite: 0 },
    ...over,
  });
  const fetches = () => calls.filter((c) => c.some((a) => a.includes("fetch_page.py"))).length;
  return { dir, postings, calls, applied, asks, fetches };
}

describe("postings", () => {
  test("opens a job like a crawler: reads its page with no AI, and finds its facts and skills in its words", async () => {
    const s = setup();
    const first = s.postings.open(JOB)!;
    expect(first.reading).toBe("page");
    await s.postings.readJob(first.id);
    const v = s.postings.view(first.id)!;
    expect(v.reading).toBeNull();
    expect(v.posting.status).toBe("read");
    expect(v.posting.lines).toHaveLength(11);
    expect(v.posting.sections).toEqual([]);
    expect(v.posting.facts).toMatchObject({ workMode: "hybrid", officeDays: 3, experience: [2, null] });
    expect(v.posting.skills).toEqual([{ name: "Python", must: true, have: true }, { name: "SQL", must: true, have: true }, { name: "Airflow", must: false, have: false }]);
    expect(v.match).toBeNull();
    expect(v.level).toEqual({ verdict: "PASS" });
    expect(s.asks).toHaveLength(0);
    expect(existsSync(path.join(s.dir, `${first.id}.json`))).toBe(true);
    // Opened again, it is all there and nothing is read.
    expect(s.postings.open(JOB)!.reading).toBeNull();
    expect(s.fetches()).toBe(1);
  });

  test("the AI reads a job only when asked, once, and its score and layout are kept for the page", async () => {
    const s = setup();
    const id = s.postings.open(JOB)!.id;
    await s.postings.readJob(id);
    expect(s.postings.analyze(id)!.reading).toBe("ai");
    await s.postings.readJob(id, "ai");
    const v = s.postings.view(id)!;
    expect(s.asks).toHaveLength(1);
    expect(s.asks[0]).toContain("3| We build data pipelines with Python,");
    expect(v.match).toMatchObject({ score: 73, verdict: "Good Fit", strengths: ["Python matches"], gaps: ["no Airflow"] });
    expect(v.posting.sections).toEqual([{ title: "About the role", from: 3, to: 4, list: false }, { title: "Requirements", from: 6, to: 7, list: true }]);
    expect(v.posting.facts).toMatchObject({ employment: "full_time", workMode: "hybrid", officeDays: 3, experience: [2, null], level: "entry" });
    expect(v.posting.skills).toEqual(ANSWER.posting.skills);
    expect(s.fetches()).toBe(1);
  });

  test("a job on Pip's list gets the AI's score through the list's tool, and its page shows the list's score", async () => {
    const seen: Record<string, Record<string, any>> = { "acme-7": { url: `${JOB.url}?utm_source=x`, title: "Data Engineer", company: "Acme", status: "new" } };
    const s = setup({ seen: () => seen });
    const id = s.postings.open(JOB)!.id;
    await s.postings.readJob(id);
    expect(s.applied).toEqual([]);
    s.postings.analyze(id);
    await s.postings.readJob(id, "ai");
    expect(s.applied).toHaveLength(1);
    expect(s.applied[0]).toMatchObject({ key: "acme-7", status: "scored", scores: ANSWER.scores, guard: "posting_guard: clean" });
    expect(s.applied[0]).not.toHaveProperty("posting");
    seen["acme-7"] = { ...seen["acme-7"], rank_score: 81, rank_verdict: "Strong Fit", strengths: ["from the list"] };
    expect(s.postings.view(id)!.match).toMatchObject({ score: 81, verdict: "Strong Fit", strengths: ["from the list"] });
    expect(s.postings.view(id)!.job.key).toBe("acme-7");
  });

  test("a junior search's listed job asking for three years or more leaves the list as it is read, a score and all", async () => {
    const seen = { "acme-7": { url: JOB.url, title: "Data Engineer", company: "Acme", status: "ranked", rank_score: 60 } };
    const s = setup({ seen: () => seen }, undefined, SENIOR_TEXT);
    const id = s.postings.open(JOB)!.id;
    await s.postings.readJob(id);
    expect(s.applied).toEqual([{ key: "acme-7", status: "filtered", reason: "years", years: 4 }]);
    expect(s.postings.view(id)!.level).toEqual({ verdict: "FAIL", why: "years", years: 4 });
    expect(s.asks).toHaveLength(0);
    const any = setup({ seen: () => seen, seniority: () => "any" }, undefined, SENIOR_TEXT);
    await any.postings.readJob(any.postings.open(JOB)!.id);
    expect(any.applied).toEqual([]);
  });

  test("a page that won't open is kept so, told to the list, and read again by the button", async () => {
    const seen = { "acme-7": { url: JOB.url, title: "Data Engineer", company: "Acme", status: "new" } };
    const s = setup({ seen: () => seen }, { code: 0, out: "HTTP 403 size=1 saved=x" });
    const id = s.postings.open(JOB)!.id;
    await s.postings.readJob(id);
    const v = s.postings.view(id)!;
    expect(v.posting).toMatchObject({ status: "unreachable", error: "HTTP 403", lines: [] });
    expect(s.applied).toEqual([{ key: "acme-7", status: "unreachable", fetch_error: "HTTP 403" }]);
    expect(s.asks).toHaveLength(0);
    // Opened again the same day, it isn't read again; the button reads it now.
    expect(s.postings.open(JOB)!.reading).toBeNull();
    expect(s.fetches()).toBe(1);
    expect(s.postings.again(id)!.reading).toBe("page");
    await s.postings.readJob(id, "again");
    expect(s.fetches()).toBe(2);
  });

  test("an AI that can't answer leaves the posting to read and says why, and its button asks again", async () => {
    let fail = true;
    const s = setup({ ask: async () => { if (fail) throw new ChatbotError("ai_none"); return { text: JSON.stringify(ANSWER), by: "ChatGPT" }; } });
    const id = s.postings.open(JOB)!.id;
    await s.postings.readJob(id);
    s.postings.analyze(id);
    await s.postings.readJob(id, "ai");
    let v = s.postings.view(id)!;
    expect(v.aiError).toBe("ai_none");
    expect(v.posting.status).toBe("read");
    expect(v.match).toBeNull();
    fail = false;
    expect(s.postings.analyze(id)!.reading).toBe("ai");
    await s.postings.readJob(id, "ai");
    v = s.postings.view(id)!;
    expect(v.aiError).toBe("");
    expect(v.match?.score).toBe(73);
  });

  test("reads a junior search's list in the background: the jobs not read yet, never LinkedIn, and not for other searches", async () => {
    const seen: Record<string, Record<string, any>> = {
      a: { url: JOB.url, title: "Data Engineer", company: "Acme", status: "new", posted_date: "2026-11-09" },
      b: { url: "https://il.linkedin.com/jobs/view/123", title: "Developer", company: "Beta", status: "new", posted_date: "2026-11-10" },
      c: { url: "https://jobs.gamma.example/1", title: "QA", company: "Gamma", status: "skipped" },
    };
    const s = setup({ seen: () => seen }, undefined, SENIOR_TEXT);
    expect(await s.postings.crawl()).toBe(1);
    expect(s.fetches()).toBe(1);
    expect(s.applied).toEqual([{ key: "a", status: "filtered", reason: "years", years: 4 }]);
    expect(s.postings.view(jobId(JOB.url))!.posting.status).toBe("read");
    // Read once: the next round has nothing to read.
    expect(await s.postings.crawl()).toBe(0);
    const other = setup({ seen: () => seen, seniority: () => "middle" });
    expect(await other.postings.crawl()).toBe(0);
    // A site that turns the background reading away says nothing of its jobs to the list.
    const refused = setup({ seen: () => seen }, { code: 0, out: "HTTP 403 size=1 saved=x" });
    expect(await refused.postings.crawl()).toBe(1);
    expect(refused.applied).toEqual([]);
  });

  test("a ranking run keeps each job's posting for its page, and sections past the last line are cut to it", () => {
    const s = setup();
    const score = { ...ANSWER, posting: { ...ANSWER.posting, sections: [{ title: "All", from: 2, to: 99, list: false }, { title: "Past", from: 40, to: 41, list: false }], facts: {}, skills: [] } };
    s.postings.keepRanked({ key: "acme-7", title: "Data Engineer", company: "Acme", url: JOB.url }, { text: PAGE_TEXT, guard: "posting_guard: clean", source: "page" }, score as any, "Claude");
    const v = s.postings.view(jobId(JOB.url))!;
    expect(v.posting.lines).toHaveLength(11);
    expect(v.posting.sections).toEqual([{ title: "All", from: 2, to: 10, list: false }]);
  });

  test("says when the user applied: by the job's link, else by the same company and role", () => {
    const job = { url: "https://acme.example/jobs/7?utm_source=a", title: "מפתח/ת Full Stack", company: "Acme" };
    expect(appliedTo(job, [{ source: "https://www.acme.example/jobs/7/", status: "applied", date: "2026-11-01" }])).toEqual({ status: "applied", date: "2026-11-01" });
    expect(appliedTo(job, [{ source: "", company: "ACME", role: "מפתח Full-Stack", status: "interview", date: "2026-10-30T09:00" }])).toEqual({ status: "interview", date: "2026-10-30" });
    expect(appliedTo(job, [{ source: "", company: "Beta", role: "מפתח Full Stack", status: "applied", date: "" }])).toBeNull();
  });

  test("refuses what isn't a job: an id that isn't one, a link that isn't a web page's", () => {
    const s = setup();
    expect(s.postings.view("../../secret")).toBeNull();
    expect(s.postings.open({ ...JOB, url: "javascript:alert(1)" })).toBeNull();
  });
});
