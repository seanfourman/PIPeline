import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Fetch } from "./boards";
import { ChatbotError } from "./chatbots";
import { PORTALS } from "./portals";
import type { Run } from "./ranker";
import { fitSystem, parseFits, scanPortals, scrapeJobs, type Search } from "./scraper";
import { EMPTY_SETTINGS, validateSettings, type Settings } from "./settings";

const never = new AbortController().signal;
const settings: Settings = {
  ...EMPTY_SETTINGS,
  markets: [{ code: "IL", country: "Israel", city: "", label: "Israel" }],
  roles: [{ label: "Backend", query: "Junior Backend Developer" }, { label: "QA", query: "Junior QA Engineer" }],
};
const hit = (n: number, extra: Partial<Record<string, string>> = {}) => ({
  title: `Role ${n}`, company: `Co ${n}`, location: "Tel Aviv", tier: "ok", date: "2026-11-01T10:00:00Z", url: `https://il.linkedin.com/jobs/view/${n}`, source: "linkedin", ...extra,
});
const steps = () => { const lines: string[] = []; return { lines, steps: { start: (id: string, target: string, name?: string) => lines.push(`${name}:${target}`), done: (id: string, ok: boolean, p: string) => lines.push(`${ok ? "ok" : "no"} ${p}`) } }; };

// The tools as this test tells them to answer: candidates leaves out the listed URLs, store keeps what it got.
function fakeTools(seen: string[] = []) {
  const stored: any[][] = [];
  const run: Run = async (argv) => {
    const file = argv[argv.indexOf("--results") + 1];
    const jobs = JSON.parse(readFileSync(file, "utf8"));
    if (argv.includes("candidates")) return { code: 0, out: JSON.stringify({ selected: jobs.filter((j: any) => !seen.includes(j.url)), already_seen: seen.length, already_applied: 0, repeated_in_batch: 0 }), err: "" };
    stored.push(jobs);
    return { code: 0, out: JSON.stringify({ added: jobs.map((j: any) => j.url) }), err: "" };
  };
  return { run, stored };
}

describe("scraper", () => {
  test("reads the model's fits by number, leaving out one it garbled", () => {
    const fits = parseFits('Sure: [{"i":0,"fit":"high","keep":true},{"i":1,"fit":"great"},{"i":2,"fit":"low","keep":false,"reason":"needs <b>German</b>"},{"i":9,"fit":"low"}]', 3);
    expect([...fits.keys()]).toEqual([0, 2]);
    expect(fits.get(2)).toEqual({ fit: "low", keep: false, reason: "needs bGerman/b" });
    expect(() => parseFits("no", 3)).toThrow();
  });

  test("tells the model the rules and the candidate's context", () => {
    const system = fitSystem("he", ["# Candidate profile", "Python"]);
    expect(system).toContain("When unsure, keep it");
    expect(system).toContain("in Hebrew");
    expect(system).toContain("Python");
  });

  test("searches every role once, leaves out what the list has, and stores the rest with their fits", async () => {
    const searched: string[] = [];
    const search: Search = async (role) => {
      searched.push(role);
      return role.includes("Backend") ? { results: [hit(1), hit(2), hit(3)], failed: [] } : { results: [hit(2), hit(4, { tier: "far" })], failed: ["freehire Israel"] };
    };
    const { run, stored } = fakeTools([hit(3).url]);
    const asked: string[] = [];
    const ask = async (_s: string, prompt: string) => {
      asked.push(prompt);
      const listed = JSON.parse(prompt.slice(prompt.indexOf("[")));
      expect(listed.find((h: any) => h.title === "Role 4").area).toBe("far");
      return { text: JSON.stringify(listed.map((h: any) => (h.title === "Role 4" ? { i: h.i, fit: "medium", keep: false, reason: "אזור מוחרג" } : h.title === "Role 2" ? { i: h.i, fit: "low" } : { i: h.i, fit: "high", keep: true }))), by: "ChatGPT" };
    };
    const { lines, steps: s } = steps();
    const text = await scrapeJobs({ ask, steps: s, signal: never, lang: "he", settings, run, search, system: "rules", today: "2026-11-04" });
    expect(searched.sort()).toEqual(["Junior Backend Developer", "Junior QA Engineer"]);
    expect(asked).toHaveLength(1);
    const saved = stored[0];
    expect(saved.map((j) => j.title).sort()).toEqual(["Role 1", "Role 2", "Role 4"]);
    expect(saved.find((j) => j.title === "Role 4")).toMatchObject({ status: "skipped", fit: "medium", portal: "linkedin-search", source: "cli", first_seen: "2026-11-04", posted_date: "2026-11-01", deadline: null });
    expect(saved.find((j) => j.title === "Role 1")).toMatchObject({ status: "new", fit: "high" });
    expect(saved.every((j) => !("tier" in j))).toBe(true);
    expect(lines).toEqual(expect.arrayContaining(["SearchRole:Junior Backend Developer", "FitCheck:1-3", "ok ChatGPT", "SaveJobs:3"]));
    expect(text).toContain("נשמרו 2 משרות חדשות.");
    expect(text).toContain("1 כבר היו ברשימה.");
    expect(text).toContain("ההתאמה מ-ChatGPT.");
    expect(text.indexOf("| גבוהה | Role 1")).toBeLessThan(text.indexOf("| נמוכה | Role 2"));
    expect(text).toContain("Role 4, Co 4: אזור מוחרג");
    expect(text).toContain("freehire Israel");
  });

  test("a stop ends the searches under way at once, and nothing is judged or kept", async () => {
    // Each search hangs until it is stopped, as a site that takes its time does.
    const search: Search = (_role, _settings, signal) => new Promise((resolve) => {
      signal?.addEventListener("abort", () => resolve({ results: [hit(1)], failed: [] }));
    });
    const { run, stored } = fakeTools();
    let asked = 0;
    const stop = new AbortController();
    const started = Date.now();
    setTimeout(() => stop.abort(), 50);
    const text = await scrapeJobs({ ask: async () => { asked++; return "[]"; }, steps: steps().steps, signal: stop.signal, lang: "en", settings, run, search, system: "rules" });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(asked).toBe(0);
    expect(stored).toHaveLength(0);
    expect(text).toContain("stopped partway");
  });

  test("stores nothing it couldn't judge, and stops on a key the provider refused", async () => {
    const search: Search = async () => ({ results: [hit(1)], failed: [] });
    const { run, stored } = fakeTools();
    const text = await scrapeJobs({ ask: async () => "[]", steps: steps().steps, signal: never, lang: "en", settings, run, search, system: "rules" });
    expect(stored).toHaveLength(0);
    expect(text).toContain("1 weren't checked");
    const failing = scrapeJobs({ ask: async () => { throw new ChatbotError("ai_none"); }, steps: steps().steps, signal: never, lang: "en", settings, run, search, system: "rules" });
    await expect(failing).rejects.toMatchObject({ code: "ai_none" });
  });

  // The insurers, with every one but the Phoenix switched off.
  const onlyPhoenix = () => validateSettings({
    ...settings, roles: [{ id: "analyst" }], industries: ["insurance"],
    portals: { off: PORTALS.filter((p) => p.industry === "insurance" && p.id !== "phoenix").map((p) => p.id) },
  });

  test("the portals check reads each employer, judges what fits the roles, stores it with its portal, and keeps each one's result", async () => {
    const checks = path.join(mkdtempSync(path.join(os.tmpdir(), "job-portals-")), "portals.json");
    const portalSettings = onlyPhoenix();
    // Of the insurers, only the Phoenix is on: its page has a data category with one analyst job.
    const fetch: Fetch = async (url) => (url.endsWith("cid=173831")
      ? `<a href="/x?cid=173831&amp;JobCategoriesFilter=1806">דאטה (1)</a><div class="job-content-top-date">לפני שעה</div><a href="/Search/UploadSingle.aspx?JobID=5"><h2>אנליסט/ית נתונים</h2></a>`
      : url.includes("JobCategoriesFilter=1806") ? `<a href="/Search/UploadSingle.aspx?JobID=5"><h2>אנליסט/ית נתונים</h2></a>` : null);
    const { run, stored } = fakeTools();
    const { lines, steps: s } = steps();
    const ask = async (_s: string, prompt: string) => JSON.stringify(JSON.parse(prompt.slice(prompt.indexOf("["))).map((h: any) => ({ i: h.i, fit: "high", keep: true })));
    const text = await scanPortals({ ask, steps: s, signal: never, lang: "he", settings: portalSettings, run, fetch, system: "rules", today: "2026-11-05", checks });
    expect(lines).toEqual(expect.arrayContaining(["ReadPortal:הפניקס", "ok 1", "SaveJobs:1"]));
    expect(stored[0]).toEqual([expect.objectContaining({ title: "אנליסט/ית נתונים", company: "הפניקס", portal: "alljobs-search", portal_id: "phoenix", status: "new" })]);
    expect(JSON.parse(readFileSync(checks, "utf8")).phoenix).toMatchObject({ found: 1, kept: 1 });
    expect(text).toContain("בדיקת פורטלים");
    expect(text).toContain("נשמרו 1 משרות חדשות.");
  });

  test("the daily run leaves an employer that had nothing at its last check alone for a few days", async () => {
    const checks = path.join(mkdtempSync(path.join(os.tmpdir(), "job-portals-")), "portals.json");
    const asked: string[] = [];
    const fetch: Fetch = async (url) => { asked.push(url); return null; };
    const scan = (rest?: number) => scanPortals({ ask: async () => "[]", steps: steps().steps, signal: never, lang: "en", settings: onlyPhoenix(), run: fakeTools().run, fetch, system: "rules", today: "2026-11-05", checks, rest });
    writeFileSync(checks, JSON.stringify({ phoenix: { checked: new Date().toISOString(), found: 0, kept: 0 } }));
    await scan(3);
    expect(asked).toEqual([]);
    writeFileSync(checks, JSON.stringify({ phoenix: { checked: new Date(Date.now() - 4 * 86_400_000).toISOString(), found: 0, kept: 0 } }));
    await scan(3);
    expect(asked).toEqual(["https://www.alljobs.co.il/Employer/HP/Default.aspx?cid=173831"]);
  });

  test("the portals check with nothing to read says so", async () => {
    const off = validateSettings({ ...settings, roles: [{ id: "analyst" }], lowTech: false, industries: ["health"] });
    const text = await scanPortals({ ask: async () => "[]", steps: steps().steps, signal: never, lang: "en", settings: { ...off, markets: [] }, run: fakeTools().run, fetch: async () => null, system: "rules" });
    expect(text).toContain("no portals to read");
  });

  test("needs a market and a role first", async () => {
    const base = { ask: async () => "", steps: steps().steps, signal: never, lang: "he" as const, system: "rules" };
    await expect(scrapeJobs({ ...base, settings: { ...settings, markets: [] } })).rejects.toMatchObject({ code: "scrape_no_market" });
    await expect(scrapeJobs({ ...base, settings: { ...settings, roles: [] } })).rejects.toMatchObject({ code: "scrape_no_roles" });
  });
});
