import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ChatbotError } from "./chatbots";
import type { Run } from "./ranker";
import { fitSystem, parseFits, scrapeJobs, type Search } from "./scraper";
import { EMPTY_SETTINGS, type Settings } from "./settings";

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

  test("stores nothing it couldn't judge, and stops on a key the provider refused", async () => {
    const search: Search = async () => ({ results: [hit(1)], failed: [] });
    const { run, stored } = fakeTools();
    const text = await scrapeJobs({ ask: async () => "[]", steps: steps().steps, signal: never, lang: "en", settings, run, search, system: "rules" });
    expect(stored).toHaveLength(0);
    expect(text).toContain("1 weren't checked");
    const failing = scrapeJobs({ ask: async () => { throw new ChatbotError("ai_none"); }, steps: steps().steps, signal: never, lang: "en", settings, run, search, system: "rules" });
    await expect(failing).rejects.toMatchObject({ code: "ai_none" });
  });

  test("needs a market and a role first", async () => {
    const base = { ask: async () => "", steps: steps().steps, signal: never, lang: "he" as const, system: "rules" };
    await expect(scrapeJobs({ ...base, settings: { ...settings, markets: [] } })).rejects.toMatchObject({ code: "scrape_no_market" });
    await expect(scrapeJobs({ ...base, settings: { ...settings, roles: [] } })).rejects.toMatchObject({ code: "scrape_no_roles" });
  });
});
