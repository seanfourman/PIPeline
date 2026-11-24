import { describe, expect, test } from "bun:test";
import { alertText, createWatcher, desktopNotice, justPublished, noticeCommand, worthTelling, type AlertJob, type NewJob } from "./alerts";
import { forgetKnown, jobGroup, jobIndustry, plainName } from "./groups";
import { EMPTY_SETTINGS, type Settings } from "./settings";

const job = (title: string, extra: Partial<NewJob> = {}): NewJob => ({ title, company: "", url: `https://jobs.example/${encodeURIComponent(title)}`, location: "תל אביב", ...extra });
const on = (alerts: Partial<Settings["alerts"]> = {}): Settings => ({ ...EMPTY_SETTINGS, alerts: { ...EMPTY_SETTINGS.alerts, enabled: true, ...alerts } });

describe("the live alerts", () => {
  test("only what was just published is told: a dated job of today, an employer's site's new job, not a burst or a first read", () => {
    const noon = new Date(2026, 10, 14, 12, 0).getTime();
    const read = (id: string) => id !== "first-time";
    const titles = (jobs: NewJob[], now = noon) => justPublished(jobs, { now, readBefore: read }).map((j) => j.title);
    expect(titles([
      job("Today", { posted: "2026-11-14" }),
      job("Yesterday", { posted: "2026-11-13" }),
      job("Last week", { posted: "2026-11-07T10:00:00" }),
      job("On a site read before", { portalId: "elbit" }),
      job("On a site read for the first time", { portalId: "first-time" }),
      job("From a search with no day"),
    ])).toEqual(["Today", "On a site read before", "From a search with no day"]);
    // Yesterday's still counts in the night's first hours, as the boards and the sites are read hourly.
    expect(titles([job("Yesterday", { posted: "2026-11-13" })], new Date(2026, 10, 14, 1, 30).getTime())).toEqual(["Yesterday"]);
    // A site whose one read brings more than five undated jobs was read in a new way: none of them is told.
    const burst = Array.from({ length: 6 }, (_, i) => job(`Dialog ${i}`, { portalId: "dialog" }));
    expect(titles([...burst, job("Ness", { portalId: "ness" }), job("Dated at Dialog", { portalId: "dialog", posted: "2026-11-14" })])).toEqual(["Ness", "Dated at Dialog"]);
  });

  test("a round asks once which sites were read before it, and an old job isn't told in a later round either", async () => {
    const told: string[] = [];
    let asked = 0;
    const old = job("Old", { posted: "2026-11-01" });
    const watcher = createWatcher({
      loadSettings: () => on(),
      search: async (found) => found([old, job("New", { posted: "2026-11-14" })]),
      scan: async (found) => found([job("Site job", { portalId: "new-site" }), old]),
      busy: () => false,
      tell: async (jobs) => { told.push(...jobs.map((j) => j.title)); },
      group: () => "other",
      readBefore: () => { asked++; return (id) => id !== "new-site"; },
      now: () => new Date(2026, 10, 14, 12, 0).getTime(),
    });
    await watcher.round();
    await watcher.round();
    expect(told).toEqual(["New"]);
    expect(asked).toBe(2);
  });

  // Sean got several jobs in one message (2026-11-23): each job is told on its own, even when found together.
  test("a round tells each new job on its own as soon as it is found, the sweep's while it still reads, each job once, by its group", async () => {
    const told: AlertJob[][] = [];
    const order: string[] = [];
    const watcher = createWatcher({
      loadSettings: () => on(),
      search: async (found) => { order.push("search"); found([job("Junior Developer", { company: "Elbit Systems" }), job("Junior Developer", { company: "Elbit Systems" })]); },
      // The sweep hands on what it stored a batch at a time: each batch is told while the sweep still reads.
      scan: async (found) => {
        order.push("scan");
        found([job("QA Engineer")]);
        await Bun.sleep(1);
        order.push("next batch");
        found([job("Junior Developer", { company: "Elbit Systems" }), job("Data Engineer"), job("DevOps Engineer", { company: "Wix" })]);
      },
      busy: () => false,
      tell: async (jobs) => { order.push(`tell ${jobs.length}`); told.push(jobs); },
      group: (j) => (j.company ? "known" : "other"),
    });
    await watcher.round();
    expect(order).toEqual(["search", "tell 1", "scan", "tell 1", "next batch", "tell 1", "tell 1"]);
    expect(told.map((t) => t.map((j) => [j.title, j.group]))).toEqual([
      [["Junior Developer", "known"]], [["QA Engineer", "other"]], [["Data Engineer", "other"]], [["DevOps Engineer", "known"]],
    ]);
    expect(watcher.status()).toMatchObject({ running: false, told: 4 });
  });

  test("the quick search keeps its own time, never held back by a sweep still reading, and each lane runs once at a time", async () => {
    let clock = 60 * 60_000;
    let searches = 0;
    let scans = 0;
    let finishScan!: () => void;
    const watcher = createWatcher({
      loadSettings: () => on({ every: 5 }),
      search: async () => { searches++; },
      scan: () => { scans++; return new Promise<void>((r) => (finishScan = r)); },
      busy: () => false,
      tell: async () => {},
      group: () => "other",
      now: () => clock,
    });
    const tickAfter = async (minutes: number) => { clock += minutes * 60_000; watcher.tick(); await Bun.sleep(5); };
    await tickAfter(0);
    expect([searches, scans]).toEqual([1, 1]);
    // Ten and twenty minutes on, the sweep still reads its sites: the quick search runs anyway, the sweep not again.
    await tickAfter(10);
    await tickAfter(10);
    expect([searches, scans]).toEqual([3, 1]);
    expect(watcher.status().running).toBe(true);
    finishScan();
    await Bun.sleep(5);
    // The sweep runs again half an hour after it last began, whatever the quick search's minutes.
    await tickAfter(5);
    expect([searches, scans]).toEqual([4, 1]);
    await tickAfter(5);
    expect([searches, scans]).toEqual([5, 2]);
  });

  test("a tick starts a round only when the alerts are on, the time has come and nothing else works the list", async () => {
    let rounds = 0;
    let clock = 0;
    let settings = on({ every: 30 });
    let busy = false;
    const watcher = createWatcher({
      loadSettings: () => settings,
      search: async () => { rounds++; },
      scan: async () => {},
      busy: () => busy,
      tell: async () => {},
      group: () => "other",
      now: () => clock,
    });
    clock = 60 * 60_000;
    settings = { ...settings, alerts: { ...settings.alerts, enabled: false } };
    watcher.tick();
    settings = on({ every: 30 });
    busy = true;
    watcher.tick();
    busy = false;
    watcher.tick();
    await Bun.sleep(5);
    expect(rounds).toBe(1);
    clock += 20 * 60_000;
    watcher.tick();
    await Bun.sleep(5);
    expect(rounds).toBe(1);
    clock += 10 * 60_000;
    watcher.tick();
    await Bun.sleep(5);
    expect(rounds).toBe(2);
  });

  // Sean asked for the channels and freehire every 5 minutes with LinkedIn as it was (2026-11-23).
  test("the quick search every 5 minutes takes LinkedIn into a round only every 15", async () => {
    let clock = 60 * 60_000;
    const linkedin: boolean[] = [];
    const watcher = createWatcher({
      loadSettings: () => on({ every: 5 }),
      search: async (_found, _signal, o) => { linkedin.push(o.linkedin); },
      scan: async () => {},
      busy: () => false,
      tell: async () => {},
      group: () => "other",
      now: () => clock,
    });
    for (let i = 0; i < 7; i++) {
      watcher.tick();
      await Bun.sleep(5);
      clock += 5 * 60_000;
    }
    expect(linkedin).toEqual([true, false, false, true, false, false, true]);
  });

  test("a job is told once its posting is read: not one asking three years or more, a senior one, a closed one, or a student's the settings rank low", async () => {
    const postings: Record<string, { status?: string; years?: number | null } | null> = {
      "Software Engineer II": { status: "read", years: 4 },
      "Software Engineer": { status: "read", years: 1 },
      "Backend Developer": { status: "expired" },
      "QA Engineer": { status: "unreachable" },
      "Data Engineer": null,
    };
    const titles = async (jobs: NewJob[], o: { students?: string; seniority?: string; waitMs?: number; read?: (j: NewJob) => Promise<any> } = {}) =>
      (await worthTelling(jobs, { read: o.read ?? (async (j) => postings[j.title] ?? null), seniority: o.seniority ?? "junior", students: o.students ?? "low", waitMs: o.waitMs })).map((j) => j.title);
    const jobs = ["Software Engineer II", "Software Engineer", "Backend Developer", "QA Engineer", "Data Engineer", "Senior Data Engineer", "Software Engineering Student"].map((t) => job(t));
    // A page that won't open, or none read, is judged by its title.
    expect(await titles(jobs)).toEqual(["Software Engineer", "QA Engineer", "Data Engineer"]);
    expect(await titles(jobs, { students: "normal" })).toEqual(["Software Engineer", "QA Engineer", "Data Engineer", "Software Engineering Student"]);
    // Any other level keeps the years and the senior title.
    expect(await titles(jobs, { seniority: "any", students: "normal" })).toEqual(["Software Engineer II", "Software Engineer", "QA Engineer", "Data Engineer", "Senior Data Engineer", "Software Engineering Student"]);
    // A reading that fails, or isn't done when the batch has waited its while, leaves the title to judge.
    expect(await titles([job("Software Engineer II")], { read: async () => { throw new Error("no page"); } })).toEqual(["Software Engineer II"]);
    expect(await titles([job("Software Engineer II")], { read: () => new Promise(() => {}), waitMs: 5 })).toEqual(["Software Engineer II"]);
  });

  test("the watcher tells only what its screen keeps, and tells all when the screen fails", async () => {
    const told: string[] = [];
    let failing = false;
    const watcher = createWatcher({
      loadSettings: () => on(),
      search: async (found) => found([job(failing ? "Data Engineer" : "Junior QA Engineer"), job(failing ? "Data Analyst" : "QA Engineer, 5 years")]),
      scan: async () => {},
      busy: () => false,
      screen: async (jobs) => { if (failing) throw new Error("no postings"); return jobs.filter((j) => !j.title.includes("years")); },
      tell: async (jobs) => { told.push(...jobs.map((j) => j.title)); },
      group: () => "other",
      log: () => {},
    });
    await watcher.round();
    expect(told).toEqual(["Junior QA Engineer"]);
    failing = true;
    await watcher.round();
    expect(told).toEqual(["Junior QA Engineer", "Data Engineer", "Data Analyst"]);
    expect(watcher.status().told).toBe(3);
  });

  test("a search that fails doesn't stop the round: the portals check's jobs are still told, and the failure logged", async () => {
    const told: string[] = [];
    const logged: string[] = [];
    const watcher = createWatcher({
      loadSettings: () => on(),
      search: async () => { throw new Error("LinkedIn did not answer"); },
      scan: async (found) => found([job("Data Analyst")]),
      busy: () => false,
      tell: async (jobs) => { told.push(...jobs.map((j) => j.title)); },
      group: () => "other",
      log: (line) => logged.push(line),
    });
    await watcher.round();
    expect(told).toEqual(["Data Analyst"]);
    expect(logged[0]).toContain("LinkedIn did not answer");
  });

  test("an alert's email and notice: the high-tech and known group first, each job's line and page", () => {
    const jobs: AlertJob[] = [
      { ...job("QA Engineer", { company: "Shefa", location: "חדרה" }), group: "other" },
      { ...job("Junior Backend Developer", { company: "One Zero", location: "Tel Aviv" }), group: "known" },
    ];
    const he = alertText(jobs, "he", "http://localhost:4174/jobs");
    expect(he.subject).toBe("2 משרות חדשות, 1 בהייטק ובחברות מוכרות");
    expect(he.body.split("\n").slice(0, 7)).toEqual([
      "הייטק וחברות מוכרות (1)", "• Junior Backend Developer · One Zero · Tel Aviv", "  https://jobs.example/Junior%20Backend%20Developer", "",
      "לואו טק וחברות לא מוכרות (1)", "• QA Engineer · Shefa · חדרה", "  https://jobs.example/QA%20Engineer",
    ]);
    expect(he.headline).toBe("פיפ: 2 משרות חדשות");
    expect(he.open).toBe("http://localhost:4174/jobs");
    const one = alertText([jobs[1]], "en", "http://localhost:4174/jobs");
    expect(one.subject).toBe("New job: Junior Backend Developer, One Zero");
    expect(one.headline).toBe("Pip: a new job at a high-tech or known company");
    expect(one.open).toBe("https://jobs.example/Junior%20Backend%20Developer");
  });

  // Sean got nothing about new jobs on his Telegram bot (2026-11-23): the alerts went only by email and as a notice.
  test("the same alert on Telegram, one job a message: its kind, title, company and place, and link, no local site", () => {
    const jobs: AlertJob[] = [{ ...job("Junior Backend Developer", { company: "One Zero", location: "Tel Aviv" }), group: "known" }];
    const { chat } = alertText(jobs, "he", "http://localhost:4174/jobs");
    expect(chat.split("\n")).toEqual([
      "משרה חדשה בהייטק או בחברה מוכרת", "Junior Backend Developer", "One Zero · Tel Aviv", "https://jobs.example/Junior%20Backend%20Developer",
    ]);
    expect(chat).not.toContain("localhost");
    expect(EMPTY_SETTINGS.alerts.telegram).toBe(true);
  });

  test("the same alert as a page: each job a card with its link, a job's words escaped, the page in its language's direction", () => {
    const jobs: AlertJob[] = [
      { ...job("QA <b>Engineer</b>", { company: "Shefa & Sons", location: "חדרה" }), group: "other" },
      { ...job("Junior Backend Developer", { company: "One Zero", location: "Tel Aviv" }), group: "known", url: "javascript:alert(1)" },
    ];
    const { html } = alertText(jobs, "he", "http://localhost:4174/jobs");
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain("QA &lt;b&gt;Engineer&lt;/b&gt;");
    expect(html).toContain("Shefa &amp; Sons");
    expect(html).not.toContain("<b>Engineer");
    expect(html).toContain('href="https://jobs.example/QA%20%3Cb%3EEngineer%3C%2Fb%3E"');
    expect(html).not.toContain("javascript:");
    expect(html.indexOf("הייטק וחברות מוכרות")).toBeLessThan(html.indexOf("לואו טק וחברות לא מוכרות"));
    expect(html).toContain('href="http://localhost:4174/jobs"');
    expect(alertText([jobs[0]], "en", "http://localhost:4174/jobs").html).toContain('<html lang="en" dir="ltr">');
  });

  test("the computer's notice keeps the job's words out of the command, and opens only a web address", async () => {
    const win = noticeCommand('Pip: <script>"', "line one\nline two\nline three", "https://jobs.example/1", "win32")!;
    expect(win.cmd.slice(0, 2)).toEqual(["powershell.exe", "-NoProfile"]);
    expect(win.cmd.join(" ")).not.toContain("script");
    expect(win.env).toEqual({ PIP_NOTICE_TITLE: 'Pip: <script>"', PIP_NOTICE_BODY: "line one\nline two", PIP_NOTICE_OPEN: "https://jobs.example/1" });
    const script = Buffer.from(win.cmd.at(-1)!, "base64").toString("utf16le");
    expect(script).toContain("SecurityElement]::Escape");
    expect(noticeCommand("t", "b", "javascript:alert(1)", "win32")!.env.PIP_NOTICE_OPEN).toBe("");
    const mac = noticeCommand("Pip", "a\nb", "https://jobs.example/1", "darwin")!;
    expect(mac.cmd.slice(-2)).toEqual(["Pip", "a · b"]);
    const ran: string[][] = [];
    expect(await desktopNotice("Pip", "a", "", { platform: "linux", spawn: async (cmd) => (ran.push(cmd), 0) })).toBe(true);
    expect(ran).toEqual([["notify-send", "Pip", "a"]]);
    expect(await desktopNotice("Pip", "a", "", { platform: "linux", spawn: async () => { throw new Error("none"); } })).toBe(false);
  });
});

describe("a job's group", () => {
  test("an employer on the portals page, by its portal or its name, or a job on a tech hiring platform, is known", () => {
    forgetKnown();
    const found = () => [{ id: "found-acme", kind: "employer" as const, how: "read" as const, he: "Acme AI", en: "Acme AI", industry: "hightech" as const, url: "https://acme.example" }];
    expect(jobGroup({ portalId: "elbit" }, found)).toBe("known");
    expect(jobGroup({ company: "Elbit Systems Ltd." }, found)).toBe("known");
    expect(jobGroup({ company: "אלביט מערכות בע\"מ" }, found)).toBe("known");
    expect(jobGroup({ company: "Acme AI" }, found)).toBe("known");
    expect(jobGroup({ company: "Tiny Startup", url: "https://www.comeet.com/jobs/tiny/12.345/dev/AB.123" }, found)).toBe("known");
    // A job board's own id isn't an employer's.
    expect(jobGroup({ portalId: "jobnet", company: "חברה דיסקרטית" }, found)).toBe("other");
    expect(jobGroup({ company: "Shefa Logistics", url: "https://il.linkedin.com/jobs/view/1" }, found)).toBe("other");
    forgetKnown();
  });

  test("a job's industry is its employer's on the portals page, by portal or name; a tech platform's is high-tech", () => {
    forgetKnown();
    const found = () => [{ id: "found-acme", kind: "employer" as const, how: "read" as const, he: "Acme AI", en: "Acme AI", industry: "hightech" as const, url: "https://acme.example" }];
    expect(jobIndustry({ portalId: "clalit" }, found)).toBe("health");
    expect(jobIndustry({ company: "מכבי שירותי בריאות" }, found)).toBe("health");
    expect(jobIndustry({ company: "Elbit Systems Ltd." }, found)).toBe("defense");
    expect(jobIndustry({ company: "Acme AI" }, found)).toBe("hightech");
    expect(jobIndustry({ company: "Tiny Startup", url: "https://jobs.lever.co/tiny/1" }, found)).toBe("hightech");
    expect(jobIndustry({ company: "Shefa Logistics", url: "https://il.linkedin.com/jobs/view/1" }, found)).toBe("");
    forgetKnown();
  });

  test("a company's name is matched without its legal words and punctuation", () => {
    expect(plainName("Elbit Systems Ltd.")).toBe("elbit");
    expect(plainName("אלביט מערכות בע\"מ")).toBe("אלביט");
    expect(plainName("Check Point Software Technologies, Inc")).toBe("check point");
    expect(plainName("Elad Software")).toBe(plainName("Elad Systems"));
    expect(plainName("Software Group")).toBe("");
  });
});
