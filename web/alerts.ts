// Live alerts: the search watched with no AI every few minutes (settings.alerts.every), each new job told by email and on
// the computer the moment it is stored, marked by its group (groups.ts): a high-tech company's or a known employer's,
// or another's. Each round runs the fast search first (LinkedIn, freehire and the Telegram channels, scraper.ts
// searchDaily) and tells what it found at once, then the portals check (scanPortals), where an employer's own site is
// read at most once an hour, one whose last check found nothing rests six hours, and the Israeli boards' searches go
// hourly. A round waits while the daily run or a search of the user's own is going, and two never run at once.
import type { Group } from "./groups";
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

export type WatchDeps = {
  loadSettings: () => Settings;
  // The fast search and the portals check, each handing the jobs it stored as new to found.
  search: (found: Found, signal: AbortSignal) => Promise<unknown>;
  scan: (found: Found, signal: AbortSignal, boards: boolean) => Promise<unknown>;
  busy: () => boolean;
  tell: (jobs: AlertJob[]) => Promise<unknown>;
  group: (job: NewJob) => Group;
  // Asked as a round starts: whether an employer's site was read, with no error, before it (scraper.ts's portal checks).
  readBefore?: () => (portalId: string) => boolean;
  now?: () => number;
  log?: (line: string) => void;
};

// A round that runs longer than this is stopped where it is; what it stored by then was told already.
const ROUND_LIMIT_MS = 50 * 60_000;
const BOARDS_EVERY_MS = 60 * 60_000;

export function createWatcher(deps: WatchDeps) {
  const now = deps.now ?? Date.now;
  let running = false;
  let last = 0;
  let lastBoards = 0;
  let lastTold = "";
  let told = 0;
  let stop: AbortController | null = null;
  // Each job told once, however many rounds hand it on.
  const seen = new Set<string>();

  // Each job looked at once: one that isn't just published isn't told later either.
  const tellNew = async (jobs: NewJob[], readBefore: (portalId: string) => boolean) => {
    const fresh = justPublished(jobs.filter((j) => j.url && !seen.has(j.url) && seen.add(j.url)), { now: now(), readBefore });
    if (!fresh.length) return;
    try {
      await deps.tell(fresh.map((j) => ({ ...j, group: deps.group(j) })));
      told += fresh.length;
      lastTold = new Date(now()).toISOString();
    } catch (err) {
      deps.log?.(`alerts: telling ${fresh.length} jobs failed: ${(err as Error)?.message ?? err}`);
    }
  };

  async function round() {
    if (running) return;
    running = true;
    stop = new AbortController();
    const signal = stop.signal;
    const timer = setTimeout(() => stop?.abort(), ROUND_LIMIT_MS);
    const started = now();
    last = started;
    try {
      const readBefore = deps.readBefore?.() ?? (() => true);
      const fast: NewJob[] = [];
      await deps.search((jobs) => fast.push(...jobs), signal).catch((err) => deps.log?.(`alerts: the search failed: ${(err as Error)?.message ?? err}`));
      await tellNew(fast, readBefore);
      if (signal.aborted) return;
      const boards = started - lastBoards >= BOARDS_EVERY_MS;
      if (boards) lastBoards = started;
      const portals: NewJob[] = [];
      await deps.scan((jobs) => portals.push(...jobs), signal, boards).catch((err) => deps.log?.(`alerts: the portals check failed: ${(err as Error)?.message ?? err}`));
      await tellNew(portals, readBefore);
    } finally {
      clearTimeout(timer);
      running = false;
      stop = null;
    }
  }

  return {
    // Once a minute (server.ts): a round when the alerts are on, the last one began at least every minutes ago, and
    // nothing else is working the list.
    tick() {
      const alerts = deps.loadSettings().alerts;
      if (!alerts.enabled || running || deps.busy() || now() - last < alerts.every * 60_000) return;
      void round();
    },
    round,
    stop: () => stop?.abort(),
    status: () => ({ running, last: last ? new Date(last).toISOString() : "", lastTold, told }),
  };
}

// ---------- what an alert says ----------

const WORDS = {
  he: {
    groups: { known: "הייטק וחברות מוכרות", other: "לואו טק וחברות לא מוכרות" },
    one: (title: string, company: string) => `משרה חדשה: ${title}${company ? `, ${company}` : ""}`,
    many: (n: number, known: number) => `${n} משרות חדשות${known ? `, ${known} בהייטק ובחברות מוכרות` : ""}`,
    headline: (group: Group) => (group === "known" ? "פיפ: משרה חדשה בהייטק או בחברה מוכרת" : "פיפ: משרה חדשה"),
    headlineMany: (n: number) => `פיפ: ${n} משרות חדשות`,
    open: "פתיחת המשרה",
    list: "כל המשרות באתר המקומי",
    footer: "נשלח מההתראות החיות של פיפ. אפשר לכבות אותן בהגדרות.",
  },
  en: {
    groups: { known: "High-tech and known companies", other: "Low-tech and unknown companies" },
    one: (title: string, company: string) => `New job: ${title}${company ? `, ${company}` : ""}`,
    many: (n: number, known: number) => `${n} new jobs${known ? `, ${known} at high-tech or known companies` : ""}`,
    headline: (group: Group) => (group === "known" ? "Pip: a new job at a high-tech or known company" : "Pip: a new job"),
    headlineMany: (n: number) => `Pip: ${n} new jobs`,
    open: "Open the job",
    list: "All the jobs on the local site",
    footer: "Sent by Pip's live alerts. They can be turned off in the settings.",
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
  const headline = ordered.length === 1 ? w.headline(first.group) : w.headlineMany(ordered.length);
  const notice = ordered.slice(0, 3).map(line).join("\n");
  return { subject, body, headline, notice, open: ordered.length === 1 ? first.url : list };
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

