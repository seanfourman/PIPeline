// The daily run: find jobs, rank them, draft a CV for the best few, and email them to the candidate, at each of the
// run times the settings give, up to one an hour. It never contacts an employer. The candidate reads each CV and
// sends it.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cardLine, inUserFolder, readAts, readCard } from "./data";
import { REPO } from "./policy";
import type { Settings } from "./settings";
import { APP_DIR, cvFileName } from "./user";
import { canSeal, isSealed, seal, unseal } from "./vault";

const STATE_FILE = path.join(APP_DIR, "automation.json");
// Outside the project, so a session's free reads of the project cannot reach the password.
const MAIL_FILE = path.join(os.homedir(), ".ai-job-search", "mail.json");
const STEP_TIMEOUT = 30 * 60 * 1000;
const APPLY_TIMEOUT = 40 * 60 * 1000;
// The portals check reads a few hundred employers' pages, from AllJobs one at a time.
const PORTALS_TIMEOUT = 60 * 60 * 1000;
const KEPT_RUNS = 20;
const KEPT_TRIED = 500;

const UNATTENDED = "This is an unattended daily run, and nobody is watching. Nobody can answer a question or approve anything, so a tool call that needs approval is refused: do not retry it or work around it. Skip that step and say so in your final message. Never send anything to an employer.";
export const SEARCH_PROMPT = `${UNATTENDED}\n\nUse the job-scraper skill to search for new jobs under Search settings in user/CLAUDE.md, and save the results. Where it asks for a choice, use the defaults.`;
export const RANK_PROMPT = `${UNATTENDED}\n\nRead .claude/commands/rank.md and follow it with no arguments.`;
export const applyPrompt = (url: string) => `${UNATTENDED}\n\nRead .claude/commands/apply.md and follow it, with this as $ARGUMENTS: ${url}\n\nWhere it asks the candidate something, decide like this:\n- Continue to drafting only for a Strong Fit or Good Fit with no failed hard requirement. Otherwise stop, record nothing in the tracker, and say why.\n- Stop if the posting guard flags the posting.\n- Write a cover letter only if the posting asks for one.\n\nEnd with what was added beyond the profile, as user/CV_RULES.md requires, and any step you had to skip.`;

export type MailResult = { status: "sent" | "no_address" | "no_account" | "failed"; detail?: string };
export type RunStep = { step: "search" | "portals" | "rank" | "apply" | "stopped"; company?: string; session?: string; ok: boolean; note?: string };
export type Run = { started: string; finished?: string; trigger: "schedule" | "manual"; steps: RunStep[]; drafted: string[]; mail: MailResult | null };
// lastSlot is the run time the last run stood for, "2026-11-05 13:00"; an older file has only lastRunDate.
type State = { lastRunDate: string; lastSlot?: string; tried: string[]; runs: Run[] };
type Job = { title: string; company: string; url: string; status: string; score: number | null; tier: string; veto?: boolean };
type Application = Record<string, any>;
type Mail = { to: string; subject: string; body: string; attachments: { path: string; name: string }[] };

export type Deps = {
  loadSettings: () => Settings;
  loadState: (settings: Settings) => { applications: Application[]; jobs: Job[] };
  runSession: (prompt: string, title: string, timeoutMs: number) => Promise<{ id: string; ok: boolean; text: string }>;
  // The portals check (scraper.ts scanPortals), done by the server between the search and the ranking: the Israeli
  // boards and the employers on the portals page, which the search's agent doesn't cover.
  scanPortals?: (title: string, timeoutMs: number) => Promise<{ id: string; ok: boolean; text: string }>;
  sendMail: (mail: Mail) => Promise<MailResult>;
  stateFile?: string;
  root?: string;
  now?: () => Date;
};

// The email and the conversation titles follow the interface language.
const WORDS = {
  he: {
    title: { search: "הריצה היומית: חיפוש", portals: "הריצה היומית: פורטלים", rank: "הריצה היומית: דירוג", apply: "הריצה היומית: " },
    drafted: (n: number) => `נוצרו ${n} קורות חיים. כדאי לבדוק כל אחד ולשלוח אותו בעצמך.`,
    none: "הריצה הסתיימה בלי קורות חיים חדשים.",
    noCv: "לא נוצרו קורות חיים.",
    ats: "ציון ATS",
    card: "ציון לפי מה שכל חברה מפרסמת",
    noScore: "אין",
    failed: "שלבים שלא הושלמו:",
    unfinished: "לא הסתיים",
    footer: "הפרטים המלאים בשיחות, באתר המקומי.",
    subject: (n: number) => `חיפוש עבודה: ${n} קורות חיים חדשים`,
    steps: { search: "חיפוש", portals: "פורטלים", rank: "דירוג", apply: "הגשה", stopped: "הריצה נעצרה" },
    testSubject: "חיפוש עבודה: מייל בדיקה",
    testBody: "אם הגיע אליך המייל הזה, הריצה היומית תוכל לשלוח לך קורות חיים.",
  },
  en: {
    title: { search: "Daily run: search", portals: "Daily run: portals", rank: "Daily run: ranking", apply: "Daily run: " },
    drafted: (n: number) => `${n} new CV${n === 1 ? "" : "s"}. Read each one and send it yourself.`,
    none: "The run finished with no new CVs.",
    noCv: "No CV came out.",
    ats: "ATS score",
    card: "By what each company publishes",
    noScore: "none",
    failed: "Steps that did not finish:",
    unfinished: "did not finish",
    footer: "The full details are in the conversations on the local site.",
    subject: (n: number) => `Job search: ${n} new CV${n === 1 ? "" : "s"}`,
    steps: { search: "Search", portals: "Portals", rank: "Ranking", apply: "Application", stopped: "The run stopped" },
    testSubject: "Job search: test email",
    testBody: "If this email reached you, the daily run can send you CVs.",
  },
};
export const mailWords = (settings: Settings) => WORDS[settings.language];

const localDate = (d: Date) => d.toLocaleDateString("en-CA");
const localTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

// The best open jobs that have not been tried, by the score /rank gave them, up to limit.
export function pickJobs(jobs: Job[], applications: Application[], tried: string[], settings: Settings, limit = settings.automation.maxPerDay) {
  const { minScore } = settings.automation;
  return jobs
    .filter((j) => j.status === "ranked" && j.url && j.score !== null && j.score >= minScore && j.tier !== "far" && !j.veto && !tried.includes(j.url))
    .filter((j) => !applications.some((a) => same(a.source, j.url) || (same(a.company, j.company) && same(a.role, j.title))))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, Math.max(0, limit));
}

// The run time a run starting now stands for: the latest that has come today, or else the first still to come, so a
// run started by hand before it isn't repeated by the schedule.
export function slotOf(settings: Settings, now: Date) {
  const times = [...settings.automation.runTimes].sort();
  return `${localDate(now)} ${times.filter((t) => t <= localTime(now)).at(-1) ?? times[0]}`;
}

// Due when a run time has come today that no run has stood for yet. A window opened late runs once, for the latest
// time that has come, not once for every time it missed. last is the state's lastSlot, or an older file's date,
// which stands for that day's first run time.
export function isDue(settings: Settings, last: string, now: Date) {
  const times = [...settings.automation.runTimes].sort();
  const come = times.filter((t) => t <= localTime(now)).at(-1);
  if (!settings.automation.enabled || !come) return false;
  return `${localDate(now)} ${come}` > (/^\d{4}-\d{2}-\d{2}$/.test(last) ? `${last} ${times[0]}` : last);
}

// When the schedule runs next, as the end of the introduction says it: now, while a run goes or one is due (the next
// tick starts it); else the first run time still to come today, or else tomorrow's first. None while it is off.
export function nextRun(settings: Settings, last: string, now: Date, running = false): { day: "now" | "today" | "tomorrow"; time: string } | null {
  if (!settings.automation.enabled) return null;
  if (running || isDue(settings, last, now)) return { day: "now", time: localTime(now) };
  const times = [...settings.automation.runTimes].sort();
  const later = times.find((t) => t > localTime(now));
  return later ? { day: "today", time: later } : { day: "tomorrow", time: times[0] };
}

// What the day's scheduled runs have left of its jobs: they share maxPerDay. A run started by hand isn't counted.
export function leftToday(settings: Settings, runs: Run[], now: Date) {
  const drafted = runs.filter((r) => r.trigger === "schedule" && localDate(new Date(r.started)) === localDate(now)).reduce((n, r) => n + r.drafted.length, 0);
  return settings.automation.maxPerDay - drafted;
}

function mailBody(run: Run, details: string[], words: (typeof WORDS)["he" | "en"]) {
  const failed = run.steps.filter((s) => !s.ok).map((s) => `- ${words.steps[s.step]}${s.company ? ` ${s.company}` : ""}: ${s.note ?? words.unfinished}`);
  return [
    run.drafted.length ? words.drafted(run.drafted.length) : words.none,
    ...details,
    failed.length ? `\n${words.failed}\n${failed.join("\n")}` : "",
    `\n${words.footer}`,
  ].filter(Boolean).join("\n");
}

export function createAutomation(deps: Deps) {
  const root = deps.root ?? REPO;
  const stateFile = deps.stateFile ?? STATE_FILE;
  const now = deps.now ?? (() => new Date());
  let running = false;

  const read = (): State => {
    try { return { lastRunDate: "", tried: [], runs: [], ...JSON.parse(readFileSync(stateFile, "utf8")) }; }
    catch { return { lastRunDate: "", tried: [], runs: [] }; }
  };
  const write = (state: State) => {
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
  };
  const saveRun = (run: Run, change: Partial<State> = {}) => {
    const state = read();
    write({ ...state, ...change, runs: [run, ...state.runs.filter((r) => r.started !== run.started)].slice(0, KEPT_RUNS) });
  };

  async function run(trigger: Run["trigger"]) {
    if (running) return;
    running = true;
    const settings = deps.loadSettings();
    const words = mailWords(settings);
    const before = read().runs;
    const entry: Run = { started: now().toISOString(), trigger, steps: [], drafted: [], mail: null };
    saveRun(entry, { lastRunDate: localDate(now()), lastSlot: slotOf(settings, now()) });
    const step = async (name: RunStep["step"], title: string, prompt: string, timeout: number, company?: string) => {
      const result = await deps.runSession(prompt, title, timeout);
      entry.steps.push({ step: name, company, session: result.id, ok: result.ok, note: result.ok ? undefined : result.text.slice(0, 200) });
      saveRun(entry);
      return result;
    };
    try {
      await step("search", words.title.search, SEARCH_PROMPT, STEP_TIMEOUT);
      if (deps.scanPortals) {
        const result = await deps.scanPortals(words.title.portals, PORTALS_TIMEOUT);
        entry.steps.push({ step: "portals", session: result.id, ok: result.ok, note: result.ok ? undefined : result.text.slice(0, 200) });
        saveRun(entry);
      }
      await step("rank", words.title.rank, RANK_PROMPT, STEP_TIMEOUT);
      const { applications, jobs } = deps.loadState(settings);
      const limit = trigger === "schedule" ? leftToday(settings, before, now()) : settings.automation.maxPerDay;
      const picks = pickJobs(jobs, applications, read().tried, settings, limit);
      const details: string[] = [];
      const attachments: Mail["attachments"] = [];
      for (const job of picks) {
        const result = await step("apply", `${words.title.apply}${job.company}`, applyPrompt(job.url), APPLY_TIMEOUT, job.company);
        saveRun(entry, { tried: [job.url, ...read().tried].slice(0, KEPT_TRIED) });
        const row = deps.loadState(settings).applications.find((a) => same(a.source, job.url) && !applications.includes(a));
        const name = inUserFolder(row?.cv_file).match(/^user\/cv\/main_([a-z0-9_]+)\.\w+$/)?.[1];
        // Named after the user, as build.py saves it (user.ts).
        const cvName = cvFileName(path.join(root, "user"));
        const pdf = name ? path.join(root, "user", "documents", "applications", name, cvName) : "";
        const heading = `\n${job.company}: ${job.title}\n${job.url}`;
        if (!name || !existsSync(pdf)) {
          details.push(`${heading}\n${words.noCv} ${result.text.slice(0, 600)}`);
          continue;
        }
        entry.drafted.push(`${job.company}: ${job.title}`);
        attachments.push({ path: pdf, name: cvName });
        const ats = readAts(`user/cv/main_${name}.tex`, root);
        const card = readCard(`user/cv/main_${name}.tex`, root);
        const scores = card ? `\n${words.card}: ${cardLine(card, settings.language)}` : "";
        details.push(`${heading}\n${words.ats}: ${ats?.score ?? words.noScore}${scores}\n${result.text.slice(0, 1500)}`);
      }
      // The day's first run always emails, so the candidate hears even of a day with nothing new; a later run
      // emails only when it drafted something.
      const firstToday = !before.some((r) => localDate(new Date(r.started)) === localDate(now()));
      if (entry.drafted.length || firstToday) {
        const to = settings.automation.email || readMailAccount()?.user;
        entry.mail = to
          ? await deps.sendMail({ to, subject: words.subject(entry.drafted.length), body: mailBody(entry, details, words), attachments })
          : { status: "no_address" };
      }
    } catch (err) {
      entry.steps.push({ step: "stopped", ok: false, note: String((err as Error)?.message ?? err).slice(0, 200) });
    } finally {
      entry.finished = now().toISOString();
      saveRun(entry);
      running = false;
    }
  }

  return {
    run,
    isRunning: () => running,
    runs: () => read().runs,
    next: () => {
      const state = read();
      return nextRun(deps.loadSettings(), state.lastSlot ?? state.lastRunDate, now(), running);
    },
    tick: () => {
      const settings = deps.loadSettings();
      const state = read();
      if (running || !isDue(settings, state.lastSlot ?? state.lastRunDate, now())) return;
      // When the day's earlier runs used up its jobs, this one is marked done without a search that would spend
      // Claude's quota on CVs no run may draft today.
      if (leftToday(settings, state.runs, now()) <= 0) {
        write({ ...state, lastSlot: slotOf(settings, now()) });
        return;
      }
      return run("schedule");
    },
  };
}

// The password is sealed in the file (vault.ts) and opened here; one saved before sealing is sealed now.
export function readMailAccount(file = MAIL_FILE): { user: string; password: string } | null {
  let saved: { user?: string; password?: string };
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!saved.user || !saved.password) return null;
  if (canSeal && !isSealed(saved.password)) writeMail(file, saved.user, seal(saved.password));
  return { user: saved.user, password: unseal(saved.password) };
}

function writeMail(file: string, user: string, password: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ user, password }));
  try { chmodSync(file, 0o600); } catch { /* Windows keeps it in the user's own folder */ }
}

export function saveMailAccount(user: string, password: string, file = MAIL_FILE) {
  writeMail(file, user, seal(password));
}

// The password goes through stdin, never an argument.
export async function sendMail(mail: Mail, account = readMailAccount(), root = REPO): Promise<MailResult> {
  if (!account) return { status: "no_account" };
  const proc = Bun.spawn([process.platform === "win32" ? "python" : "python3", "web/send_mail.py"], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(JSON.stringify({ ...account, ...mail }));
  proc.stdin.end();
  const output = await new Response(proc.stdout).text();
  return (await proc.exited) === 0 ? { status: "sent", detail: mail.to } : { status: "failed", detail: output.trim() };
}
