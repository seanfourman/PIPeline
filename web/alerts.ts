// Live alerts: the search watched with no AI, each new job told by email and on the computer the moment it is stored
// and its posting read (a job above the level searched for isn't told, server.ts), marked by its group (groups.ts): a
// high-tech company's or a known employer's, or another's. Two lanes, each at its
// own pace, so the slow one never holds the quick one back. The quick search (LinkedIn and freehire for the last day,
// newest first, and the Telegram channels, scraper.ts searchDaily), some ten seconds, runs every few minutes
// (settings.alerts.every). The sites' sweep (scanPortals) runs every half hour: an employer's own site is read when its
// last check is old enough (server.ts), one whose last check found nothing rests six hours, and the Israeli boards are
// searched each time. It takes a quarter of an hour, most of it the some 400 employers read through AllJobs one page at
// a time, so what it finds is told as it is stored, a minute's worth at a time. A lane starts only while the daily run
// or a search of the user's own isn't going, and never twice at once.
import { levelGate, STUDENT } from "./experience";
import type { Group } from "./groups";
import { chip, jobCard, mailPage, sectionHead } from "./mail-html";
import type { Settings } from "./settings";

// posted: the day the posting was published, YYYY-MM-DD, when its source gives one.
export type NewJob = { title: string; company: string; url: string; location: string; portalId?: string; fit?: string; posted?: string };
export type AlertJob = NewJob & { group: Group };
type Found = (jobs: NewJob[]) => void;

// What is told is what was just published, not all that is new to the list, which a search two weeks back and an
// employer's site read for the first time fill with older jobs. A job with its day is told when published today, or
// yesterday in the night's first hours, as the boards and the sites are read hourly. A job with no day, from an
// employer's own site, is told when the site was read before this round, and not when one read brings more than a few
// at once, which is a site read in a new way or a list that changed its links rather than jobs just posted.
const EARLY_HOURS = 2;
const SITE_BURST = 5;
const localDay = (t: number) => new Date(t).toLocaleDateString("en-CA");
export function justPublished(jobs: NewJob[], o: { now: number; readBefore: (portalId: string) => boolean }) {
  const today = localDay(o.now);
  const yesterday = localDay(o.now - 86_400_000);
  const night = new Date(o.now).getHours() < EARLY_HOURS;
  const undated = new Map<string, number>();
  for (const j of jobs) if (!j.posted && j.portalId) undated.set(j.portalId, (undated.get(j.portalId) ?? 0) + 1);
  return jobs.filter((j) => {
    if (j.posted) return j.posted.slice(0, 10) >= today || (night && j.posted.slice(0, 10) === yesterday);
    if (!j.portalId) return true;
    return o.readBefore(j.portalId) && (undated.get(j.portalId) ?? 0) <= SITE_BURST;
  });
}

// The just published jobs worth a message, once each posting is read: none the list would leave out, a job a junior
// search shouldn't see (a senior title, or three years or more asked, experience.ts levelGate) or one found closed;
// nor a student's position when the settings rank those low (still on the list, not worth a message). The batch waits
// so long for its postings; one not read by then, or that won't open, is judged by its title.
const SCREEN_WAIT_MS = 3 * 60_000;
type Read = { status?: string; years?: number | null } | null;
export async function worthTelling(jobs: NewJob[], o: { read: (job: NewJob) => Promise<Read>; seniority: string; students: string; waitMs?: number }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<null>((go) => { timer = setTimeout(() => go(null), o.waitMs ?? SCREEN_WAIT_MS); });
  try {
    const judged = await Promise.all(jobs.map(async (j) => {
      if (o.students !== "normal" && STUDENT.test(j.title)) return null;
      const read = await Promise.race([o.read(j).catch((): Read => null), waited]);
      if (read?.status === "expired") return null;
      const years = read?.status === "read" ? read.years ?? null : null;
      return levelGate({ title: j.title, years, seniority: o.seniority }).verdict === "PASS" ? j : null;
    }));
    return judged.filter((j): j is NewJob => j !== null);
  } finally {
    clearTimeout(timer);
  }
}

export type WatchDeps = {
  loadSettings: () => Settings;
  // The quick search and the sites' sweep (the portals check with the boards), each handing the jobs it stored as new
  // to found as it stores them, the sweep several times. The quick search is told whether LinkedIn is due this round.
  search: (found: Found, signal: AbortSignal, o: { linkedin: boolean }) => Promise<unknown>;
  scan: (found: Found, signal: AbortSignal) => Promise<unknown>;
  busy: () => boolean;
  // The just published jobs worth telling, once their postings are read (server.ts): a search judges a job by its title
  // alone, and the years a posting asks are in its words. When it fails, they are told as they are.
  screen?: (jobs: NewJob[]) => Promise<NewJob[]>;
  tell: (jobs: AlertJob[]) => Promise<unknown>;
  group: (job: NewJob) => Group;
  // Asked as a round starts: whether an employer's site was read, with no error, before it (scraper.ts's portal checks).
  readBefore?: () => (portalId: string) => boolean;
  now?: () => number;
  log?: (line: string) => void;
};

// A lane's run that goes longer than this is stopped where it is; what it stored by then was told already.
const ROUND_LIMIT_MS = 50 * 60_000;
const SITES_EVERY_MS = 30 * 60_000;
// LinkedIn is read by the quick search at most this often, however often the rest is (Sean 2026-11-23: the channels and
// freehire every 5 minutes, LinkedIn as it was): a search for each role every few minutes is the sort of load that
// gets an address held back by LinkedIn for a while, and every 15 minutes is how it has run without that.
const LINKEDIN_EVERY_MS = 15 * 60_000;

type Lane = { running: boolean; last: number; stop: AbortController | null };

export function createWatcher(deps: WatchDeps) {
  const now = deps.now ?? Date.now;
  const quick: Lane = { running: false, last: 0, stop: null };
  const sites: Lane = { running: false, last: 0, stop: null };
  let lastTold = "";
  let told = 0;
  // Each job told once, however many runs hand it on.
  const seen = new Set<string>();
  // One telling at a time, each job's after the one before it has gone.
  let telling: Promise<void> = Promise.resolve();
  // Every job still being read or told, so a round ends only once they all have.
  const pending = new Set<Promise<void>>();

  const tellOne = (job: NewJob) => {
    telling = telling.then(async () => {
      try {
        await deps.tell([{ ...job, group: deps.group(job) }]);
        told++;
        lastTold = new Date(now()).toISOString();
      } catch (err) {
        deps.log?.(`alerts: telling "${job.title}" failed: ${(err as Error)?.message ?? err}`);
      }
    });
    return telling;
  };

  // Each job looked at once: one that isn't just published isn't told later either. Each is then read and told on its
  // own, the moment its own posting is read, never waiting for the others found with it (Sean 2026-11-23: "אני רוצה כל
  // משרה בנפרד ברגע שהיא מתפרסמת לא כמה ביחד"). A posting that can't be read says nothing against its job.
  const tellNew = (jobs: NewJob[], readBefore: (portalId: string) => boolean) => {
    const fresh = justPublished(jobs.filter((j) => j.url && !seen.has(j.url) && seen.add(j.url)), { now: now(), readBefore });
    for (const job of fresh) {
      const work = (async () => {
        let worth = true;
        if (deps.screen) {
          try { worth = (await deps.screen([job])).length > 0; } catch (err) { deps.log?.(`alerts: reading "${job.title}" failed: ${(err as Error)?.message ?? err}`); }
        }
        if (worth) await tellOne(job);
      })();
      pending.add(work);
      void work.finally(() => pending.delete(work));
    }
  };
  const settled = async () => {
    while (pending.size) await Promise.all([...pending]);
    await telling;
  };

  async function run(lane: Lane, work: (signal: AbortSignal) => Promise<unknown>) {
    if (lane.running) return;
    lane.running = true;
    lane.stop = new AbortController();
    const timer = setTimeout(() => lane.stop?.abort(), ROUND_LIMIT_MS);
    lane.last = now();
    try {
      await work(lane.stop.signal);
      await settled();
    } finally {
      clearTimeout(timer);
      lane.running = false;
      lane.stop = null;
    }
  }

  const failed = (what: string) => (err: unknown) => deps.log?.(`alerts: ${what} failed: ${(err as Error)?.message ?? err}`);
  // The quick lane's jobs come from searches, with no employer's site to have been read before. LinkedIn comes in a
  // round only once LINKEDIN_EVERY_MS has passed since it last did.
  let linkedinLast = 0;
  const search = () => run(quick, (signal) => {
    const linkedin = now() - linkedinLast >= LINKEDIN_EVERY_MS;
    if (linkedin) linkedinLast = now();
    return deps.search((jobs) => void tellNew(jobs, () => true), signal, { linkedin }).catch(failed("the search"));
  });
  // Which sites were read before is asked once, as the sweep starts.
  const sweep = () => run(sites, (signal) => {
    const readBefore = deps.readBefore?.() ?? (() => true);
    return deps.scan((jobs) => void tellNew(jobs, readBefore), signal).catch(failed("the portals check"));
  });

  return {
    // Once a minute (server.ts): each lane when the alerts are on, nothing else is working the list, it isn't running
    // and its time has come: the quick one every minutes (LinkedIn in it every 15 at most), the sweep every half hour
    // (or every minutes, when longer).
    tick() {
      const alerts = deps.loadSettings().alerts;
      if (!alerts.enabled || deps.busy()) return;
      const t = now();
      const every = alerts.every * 60_000;
      if (!quick.running && t - quick.last >= every) void search();
      if (!sites.running && t - sites.last >= Math.max(every, SITES_EVERY_MS)) void sweep();
    },
    // Both lanes, the quick one first, waited for (the tests, and a check by hand).
    async round() {
      await search();
      await sweep();
    },
    stop: () => { quick.stop?.abort(); sites.stop?.abort(); },
    status: () => ({ running: quick.running || sites.running, last: quick.last ? new Date(quick.last).toISOString() : "", lastTold, told }),
  };
}

// ---------- what an alert says ----------

const WORDS = {
  he: {
    groups: { known: "הייטק וחברות מוכרות", other: "לואו טק וחברות לא מוכרות" },
    one: (title: string, company: string) => `משרה חדשה: ${title}${company ? `, ${company}` : ""}`,
    many: (n: number, known: number) => `${n} משרות חדשות${known ? `, ${known} בהייטק ובחברות מוכרות` : ""}`,
    headline: (group: Group) => (group === "known" ? "פיפ: משרה חדשה בהייטק או בחברה מוכרת" : "פיפ: משרה חדשה"),
    chatHead: (group: Group) => (group === "known" ? "משרה חדשה בהייטק או בחברה מוכרת" : "משרה חדשה"),
    headlineMany: (n: number) => `פיפ: ${n} משרות חדשות`,
    open: "פתיחת המשרה",
    list: "כל המשרות באתר המקומי",
    footer: "נשלח מההתראות החיות של פיפ. אפשר לכבות אותן בהגדרות.",
    kind: "התראה חיה",
    titleOne: "משרה חדשה בשבילך",
    lead: (known: number) => `פורסמו עכשיו, וכדאי להגיש ראשונים.${known ? ` ${known === 1 ? "אחת מהן" : `${known} מהן`} בהייטק או בחברה מוכרת.` : ""}`,
    leadOne: (group: Group) => (group === "known" ? "פורסמה עכשיו, בהייטק או בחברה מוכרת. כדאי להגיש ראשונים." : "פורסמה עכשיו, וכדאי להגיש ראשונים."),
    today: "פורסמה היום",
  },
  en: {
    groups: { known: "High-tech and known companies", other: "Low-tech and unknown companies" },
    one: (title: string, company: string) => `New job: ${title}${company ? `, ${company}` : ""}`,
    many: (n: number, known: number) => `${n} new jobs${known ? `, ${known} at high-tech or known companies` : ""}`,
    headline: (group: Group) => (group === "known" ? "Pip: a new job at a high-tech or known company" : "Pip: a new job"),
    chatHead: (group: Group) => (group === "known" ? "A new job at a high-tech or known company" : "A new job"),
    headlineMany: (n: number) => `Pip: ${n} new jobs`,
    open: "Open the job",
    list: "All the jobs on the local site",
    footer: "Sent by Pip's live alerts. They can be turned off in the settings.",
    kind: "Live alert",
    titleOne: "A new job for you",
    lead: (known: number) => `Just published, and worth applying early.${known ? ` ${known === 1 ? "One of them is" : `${known} of them are`} at a high-tech or known company.` : ""}`,
    leadOne: (group: Group) => (group === "known" ? "Just published, at a high-tech or known company. Worth applying early." : "Just published, and worth applying early."),
    today: "Published today",
  },
};

const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const line = (j: AlertJob) => [j.title, j.company, j.location].map((s) => short(String(s ?? "").replace(/\s+/g, " ").trim(), 90)).filter(Boolean).join(" · ");

// The email's subject and words, and the computer's notice, the high-tech and known group first. list is the local
// site's job list, which a notice for several jobs opens.
export function alertText(jobs: AlertJob[], lang: "he" | "en", list: string) {
  const w = WORDS[lang];
  const ordered = [...jobs.filter((j) => j.group === "known"), ...jobs.filter((j) => j.group === "other")];
  const known = ordered.filter((j) => j.group === "known").length;
  const first = ordered[0];
  const subject = short(ordered.length === 1 ? w.one(first.title, first.company) : w.many(ordered.length, known), 160);
  const sections = (["known", "other"] as const).flatMap((g) => {
    const these = ordered.filter((j) => j.group === g);
    return these.length ? [`${w.groups[g]} (${these.length})`, ...these.map((j) => `• ${line(j)}\n  ${j.url}`), ""] : [];
  });
  const body = [...sections, `${w.list}: ${list}`, "", w.footer].join("\n");
  // The same on Telegram (telegram-bot.ts), read on a phone, and never the local site's list, which a phone can't open.
  // Each job comes in a message of its own (the watcher tells them one by one): what kind of job, its title, the
  // company and place, and its link, with no footer to read again on every message. Several at once keep the list.
  const plain = (s: string) => short(String(s ?? "").replace(/\s+/g, " ").trim(), 120);
  const chat = ordered.length === 1
    ? [w.chatHead(first.group), plain(first.title), [plain(first.company), plain(first.location)].filter(Boolean).join(" · "), first.url].filter(Boolean).join("\n")
    : [subject, "", ...sections, w.footer].join("\n");
  const headline = ordered.length === 1 ? w.headline(first.group) : w.headlineMany(ordered.length);
  const notice = ordered.slice(0, 3).map(line).join("\n");
  // The same as a page: the jobs as cards under their group's name, each with its day and a button to open it.
  const today = new Date().toLocaleDateString("en-CA");
  const card = (j: AlertJob) => jobCard({
    title: j.title, company: j.company, location: j.location, url: j.url, lang, action: w.open,
    chips: j.posted ? [chip(j.posted === today ? w.today : j.posted, j.posted === today ? "green" : "plain")] : [],
  });
  const parts = (["known", "other"] as const).flatMap((g) => {
    const these = ordered.filter((j) => j.group === g);
    return these.length ? [sectionHead(w.groups[g], ordered.length > 1 ? these.length : null, lang), ...these.map(card)] : [];
  });
  const html = mailPage({
    lang, kind: w.kind, title: ordered.length === 1 ? w.titleOne : w.many(ordered.length, 0),
    lead: ordered.length === 1 ? w.leadOne(first.group) : w.lead(known), preheader: notice.replace(/\n/g, " | "),
    parts, link: { label: w.list, url: list }, footer: w.footer,
  });
  return { subject, body, chat, html, headline, notice, open: ordered.length === 1 ? first.url : list };
}

// ---------- the computer's notice ----------

// A notice on this computer: Windows' toast, through PowerShell, its words handed over in the environment and escaped
// there, never written into the command; a Mac's through osascript, its words as arguments; elsewhere notify-send. A
// click opens open, when it is a web address. False when it couldn't be shown.
const TOAST = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$e = { param($s) [System.Security.SecurityElement]::Escape([string]$s) }
$title = & $e $env:PIP_NOTICE_TITLE
$lines = ($env:PIP_NOTICE_BODY -split "\`n" | ForEach-Object { "<text>$(& $e $_)</text>" }) -join ""
$open = & $e $env:PIP_NOTICE_OPEN
$launch = if ($open) { " activationType=\`"protocol\`" launch=\`"$open\`"" } else { "" }
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast$launch><visual><binding template=\`"ToastGeneric\`"><text>$title</text>$lines</binding></visual></toast>")
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)
`;

type Spawn = (cmd: string[], env: Record<string, string>) => Promise<number>;
const spawnQuiet: Spawn = async (cmd, env) => {
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  return proc.exited;
};

export function noticeCommand(title: string, body: string, open: string, platform: string = process.platform): { cmd: string[]; env: Record<string, string> } | null {
  const url = /^https?:\/\/[^\s"'<>]+$/i.test(open) ? open : "";
  const t = short(title, 120);
  // A toast has room for two lines under its title.
  const b = body.split("\n").slice(0, 2).map((l) => short(l, 160)).join("\n");
  if (platform === "win32") {
    return {
      cmd: ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(TOAST, "utf16le").toString("base64")],
      env: { PIP_NOTICE_TITLE: t, PIP_NOTICE_BODY: b, PIP_NOTICE_OPEN: url },
    };
  }
  if (platform === "darwin") {
    return { cmd: ["osascript", "-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", t, b.replace(/\n/g, " · ")], env: {} };
  }
  return { cmd: ["notify-send", t, b], env: {} };
}

export async function desktopNotice(title: string, body: string, open: string, o: { platform?: string; spawn?: Spawn } = {}) {
  const command = noticeCommand(title, body, open, o.platform);
  if (!command) return false;
  try { return (await (o.spawn ?? spawnQuiet)(command.cmd, command.env)) === 0; } catch { return false; }
}

