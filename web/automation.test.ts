import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPrompt, createAutomation, isDue, pickJobs, readMailAccount, saveMailAccount, slotOf, type Deps } from "./automation";
import { validateSettings } from "./settings";

const settings = (automation = {}) => validateSettings({ automation: { enabled: true, email: "me@x.co", maxPerDay: 2, ...automation } });
const job = (over = {}) => ({ title: "Dev", company: "Acme", url: "https://x.co/1", status: "ranked", score: 80, tier: "near", ...over });

describe("pickJobs", () => {
  test("takes the best open jobs, up to the daily limit", () => {
    const jobs = [job({ url: "u1", score: 70, company: "A" }), job({ url: "u2", score: 90, company: "B" }), job({ url: "u3", score: 80, company: "C" })];
    expect(pickJobs(jobs, [], [], settings()).map((j) => j.url)).toEqual(["u2", "u3"]);
  });

  test("skips what should not get a CV", () => {
    const skipped = [
      job({ status: "new" }), job({ status: "expired" }), job({ score: 59 }), job({ score: null }),
      job({ tier: "far" }), job({ veto: true }), job({ url: "" }),
    ];
    expect(pickJobs(skipped, [], [], settings())).toEqual([]);
  });

  test("never repeats a job already applied to or already tried", () => {
    expect(pickJobs([job()], [{ source: "https://x.co/1" }], [], settings())).toEqual([]);
    expect(pickJobs([job()], [{ company: "ACME", role: "dev" }], [], settings())).toEqual([]);
    expect(pickJobs([job()], [], ["https://x.co/1"], settings())).toEqual([]);
  });
});

describe("isDue", () => {
  const at = (time: string) => new Date(`2026-11-02T${time}:00`);
  test("runs once a day from the set hour, including after a late start", () => {
    expect(isDue(settings(), "", at("08:59"))).toBe(false);
    expect(isDue(settings(), "", at("09:00"))).toBe(true);
    expect(isDue(settings(), "", at("21:30"))).toBe(true);
    expect(isDue(settings(), "2026-11-02", at("21:30"))).toBe(false);
    expect(isDue(settings(), "2026-11-01", at("09:00"))).toBe(true);
  });
  test("never runs while switched off, and it starts switched off", () => {
    expect(isDue(settings({ enabled: false }), "", at("12:00"))).toBe(false);
    expect(validateSettings({}).automation.enabled).toBe(false);
  });
  test("with several run times, each that comes runs once, and a late window runs once for all it missed", () => {
    const twice = settings({ runTimes: ["09:00", "13:00"] });
    expect(isDue(twice, "2026-11-02 09:00", at("12:00"))).toBe(false);
    expect(isDue(twice, "2026-11-02 09:00", at("13:00"))).toBe(true);
    expect(isDue(twice, "2026-11-02 13:00", at("20:00"))).toBe(false);
    expect(isDue(twice, "2026-11-01 09:00", at("20:00"))).toBe(true);
    // An older file's date stands for that day's first run time.
    expect(isDue(twice, "2026-11-02", at("13:00"))).toBe(true);
    // A run started by hand before the day's first time stands for it.
    expect(slotOf(twice, at("07:00"))).toBe("2026-11-02 09:00");
    expect(slotOf(twice, at("14:00"))).toBe("2026-11-02 13:00");
  });
});

describe("the prompt", () => {
  test("forbids contacting employers and stops on a flagged posting", () => {
    const prompt = applyPrompt("https://x.co/1");
    expect(prompt).toContain("Never send anything to an employer");
    expect(prompt).toContain("Stop if the posting guard flags");
  });
});

describe("a run", () => {
  function setup(over: Partial<Deps> = {}) {
    const root = mkdtempSync(path.join(os.tmpdir(), "job-auto-"));
    const folder = path.join(root, "user/documents/applications/acme_dev");
    mkdirSync(folder, { recursive: true });
    // The CV is named after the user in user/profile.json, as build.py names it.
    mkdirSync(path.join(root, "user"), { recursive: true });
    writeFileSync(path.join(root, "user", "profile.json"), JSON.stringify({ name: "Dana Cohen" }));
    writeFileSync(path.join(folder, "Dana Cohen - Resume.pdf"), "pdf");
    writeFileSync(path.join(folder, "ats.json"), JSON.stringify({ score: 77, missing: [], problems: [] }));
    const applications: Record<string, string>[] = [];
    const prompts: string[] = [];
    const mails: any[] = [];
    const deps: Deps = {
      root,
      stateFile: path.join(root, "automation.json"),
      now: () => new Date("2026-11-02T10:00:00"),
      loadSettings: () => settings(),
      loadState: () => ({ applications: [...applications], jobs: [job()] }),
      runSession: async (prompt) => {
        prompts.push(prompt);
        if (prompt.includes("apply.md")) applications.push({ source: "https://x.co/1", cv_file: "cv/main_acme_dev.tex" /* an older row's form, read as user/cv/ */ });
        return { id: `s${prompts.length}`, ok: true, text: "Added: Docker" };
      },
      sendMail: async (mail) => { mails.push(mail); return { status: "sent", detail: mail.to }; },
      ...over,
    };
    return { deps, prompts, mails, root };
  }

  test("searches, ranks, drafts, and emails the CV to the candidate only", async () => {
    const { deps, prompts, mails } = setup();
    const automation = createAutomation(deps);
    await automation.run("manual");
    expect(prompts.map((p) => p.match(/(job-scraper|rank\.md|apply\.md)/)?.[1])).toEqual(["job-scraper", "rank.md", "apply.md"]);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("me@x.co");
    expect(mails[0].attachments[0].name).toBe("Dana Cohen - Resume.pdf");
    expect(mails[0].body).toContain("ציון ATS: 77");
    expect(mails[0].body).toContain("Added: Docker");
    expect(automation.runs()[0].drafted).toHaveLength(1);
    expect(automation.runs()[0].finished).toBeTruthy();
    expect(automation.runs()[0].mail).toEqual({ status: "sent", detail: "me@x.co" });
  });

  test("checks the portals between the search and the ranking, when the server can", async () => {
    const order: string[] = [];
    const { deps } = setup({
      runSession: async (prompt) => { order.push(prompt.includes("job-scraper") ? "search" : prompt.includes("rank.md") ? "rank" : "apply"); return { id: "s", ok: true, text: "" }; },
      scanPortals: async (title) => { order.push(`portals:${title}`); return { id: "p", ok: false, text: "AllJobs did not answer" }; },
    });
    const automation = createAutomation(deps);
    await automation.run("manual");
    expect(order.slice(0, 3)).toEqual(["search", "portals:הריצה היומית: פורטלים", "rank"]);
    expect(automation.runs()[0].steps.find((s) => s.step === "portals")).toEqual({ step: "portals", session: "p", ok: false, note: "AllJobs did not answer" });
  });

  test("writes the email in the interface language", async () => {
    const { deps, mails } = setup({ loadSettings: () => validateSettings({ language: "en", automation: { enabled: true, email: "me@x.co" } }) });
    await createAutomation(deps).run("manual");
    expect(mails[0].subject).toBe("Job search: 1 new CV");
    expect(mails[0].body).toContain("ATS score: 77");
  });

  test("tries a job once, even when no CV came out", async () => {
    const { deps, prompts, mails } = setup({ loadState: () => ({ applications: [], jobs: [job()] }) });
    const automation = createAutomation(deps);
    await automation.run("manual");
    expect(mails[0].attachments).toEqual([]);
    expect(mails[0].body).toContain("לא נוצרו קורות חיים");
    const count = prompts.length;
    await automation.run("manual");
    expect(prompts.slice(count).some((p) => p.includes("apply.md"))).toBe(false);
  });

  test("a failed step is reported, and the run still finishes", async () => {
    const { deps, mails } = setup({ runSession: async () => { throw new Error("no login"); } });
    const automation = createAutomation(deps);
    await automation.run("manual");
    const [run] = automation.runs();
    expect(run.finished).toBeTruthy();
    expect(run.steps.at(-1)?.note).toContain("no login");
    expect(mails).toEqual([]);
    expect(automation.isRunning()).toBe(false);
  });

  test("the schedule runs once a day and not at all when switched off", async () => {
    const { deps, prompts } = setup();
    const automation = createAutomation(deps);
    await automation.tick();
    const count = prompts.length;
    expect(count).toBeGreaterThan(0);
    await automation.tick();
    expect(prompts.length).toBe(count);

    const off = setup({ loadSettings: () => settings({ enabled: false }) });
    await createAutomation(off.deps).tick();
    expect(off.prompts).toEqual([]);
  });

  test("the day's runs share its jobs: with none left, a later run time passes without a search", async () => {
    let clock = new Date("2026-11-02T09:30:00");
    const { deps, prompts, mails } = setup({ now: () => clock, loadSettings: () => settings({ runTimes: ["09:00", "13:00"], maxPerDay: 1 }) });
    const automation = createAutomation(deps);
    await automation.tick();
    expect(automation.runs()[0].drafted).toHaveLength(1);
    expect(mails).toHaveLength(1);
    clock = new Date("2026-11-02T12:00:00");
    await automation.tick();
    expect(automation.runs()).toHaveLength(1);
    clock = new Date("2026-11-02T13:05:00");
    const count = prompts.length;
    await automation.tick();
    expect(prompts.length).toBe(count);
    expect(automation.runs()).toHaveLength(1);
  });

  test("a later run of the day emails only when it drafted something", async () => {
    let clock = new Date("2026-11-02T09:30:00");
    const { deps, mails } = setup({ now: () => clock, loadState: () => ({ applications: [], jobs: [] }), loadSettings: () => settings({ runTimes: ["09:00", "13:00"] }) });
    const automation = createAutomation(deps);
    await automation.tick();
    expect(mails).toHaveLength(1);
    clock = new Date("2026-11-02T13:30:00");
    await automation.tick();
    expect(automation.runs()).toHaveLength(2);
    expect(mails).toHaveLength(1);
    expect(automation.runs()[0].mail).toBeNull();
  });
});

describe("the mail account", () => {
  test("is read back whole, and missing parts count as no account", () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "job-mail-")), "sub", "mail.json");
    expect(readMailAccount(file)).toBeNull();
    saveMailAccount("me@gmail.com", "abcd-secret", file);
    expect(readMailAccount(file)).toEqual({ user: "me@gmail.com", password: "abcd-secret" });
    // Sealed on Windows: the file never holds the password itself.
    if (process.platform === "win32") expect(readFileSync(file, "utf8")).not.toContain("abcd-secret");
    // One saved before sealing still reads, and is sealed in place.
    writeFileSync(file, JSON.stringify({ user: "me@gmail.com", password: "old-plain" }));
    expect(readMailAccount(file)?.password).toBe("old-plain");
    if (process.platform === "win32") expect(readFileSync(file, "utf8")).not.toContain("old-plain");
    writeFileSync(file, JSON.stringify({ user: "me@gmail.com" }));
    expect(readMailAccount(file)).toBeNull();
    expect(readFileSync(file, "utf8")).toContain("me@gmail.com");
  });
});
