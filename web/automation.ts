// The daily run: find jobs, read their postings with no AI so each has its automatic score (match.ts), draft a CV for
// the best few, and email them to the candidate, at each of the run times the settings give, up to one an hour. It
// ranks nothing with the AI: a job's AI score comes only when the user asks for it. It never contacts an employer.
// The candidate reads each CV and sends it.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cardLine, inUserFolder, readAts, readCard } from "./data";
import { agentWords, chip, jobCard, mailPage, para, warnBox } from "./mail-html";
import { REPO } from "./policy";
import type { Settings } from "./settings";
import { APP_DIR, cvFileName } from "./user";
import { canSeal, isSealed, seal, unseal } from "./vault";
import type { TgMessage, TgResult } from "./telegram-bot";

const STATE_FILE = path.join(APP_DIR, "automation.json");
// Outside the project, so a session's free reads of the project cannot reach the password.
const MAIL_FILE = path.join(os.homedir(), ".ai-job-search", "mail.json");
const STEP_TIMEOUT = 30 * 60 * 1000;
// Reading the new jobs' postings goes slowly, a few seconds between two pages of a site.
const READ_TIMEOUT = 30 * 60 * 1000;
const APPLY_TIMEOUT = 40 * 60 * 1000;
// The portals check reads a few hundred employers' pages, from AllJobs one at a time.
const PORTALS_TIMEOUT = 60 * 60 * 1000;
const KEPT_RUNS = 20;
const KEPT_TRIED = 500;

const UNATTENDED = "This is an unattended daily run, and nobody is watching. Nobody can answer a question or approve anything, so a tool call that needs approval is refused: do not retry it or work around it. Skip that step and say so in your final message. Never send anything to an employer.";
export const SEARCH_PROMPT = `${UNATTENDED}\n\nUse the job-scraper skill to search for new jobs under Search settings in user/CLAUDE.md, and save the results. Where it asks for a choice, use the defaults.`;
export const applyPrompt = (url: string) => `${UNATTENDED}\n\nRead .claude/commands/apply.md and follow it, with this as $ARGUMENTS: ${url}\n\nWhere it asks the candidate something, decide like this:\n- Continue to drafting only for a Strong Fit or Good Fit with no failed hard requirement. Otherwise stop, record nothing in the tracker, and say why.\n- Stop if the posting guard flags the posting.\n- Write a cover letter only if the posting asks for one.\n\nEnd with what was added beyond the profile, as user/CV_RULES.md requires, and any step you had to skip.`;

export type MailResult = { status: "sent" | "no_address" | "no_account" | "failed"; detail?: string };
// "rank" is an older run's AI ranking, kept in its history.
export type RunStep = { step: "search" | "portals" | "read" | "rank" | "apply" | "stopped"; company?: string; session?: string; ok: boolean; note?: string };
// telegram: how its messages went (telegram-bot.ts), when the run sent any there.
export type Run = { started: string; finished?: string; trigger: "schedule" | "manual"; steps: RunStep[]; drafted: string[]; mail: MailResult | null; telegram?: TgResult | null };
// lastSlot is the run time the last run stood for, "2026-11-05 13:00"; an older file has only lastRunDate.
type State = { lastRunDate: string; lastSlot?: string; tried: string[]; runs: Run[] };
// score is the AI's, when the user asked for one; auto the automatic one, by the job's posting or its title alone (autoBasis).
type Job = { title: string; company: string; url: string; status: string; score: number | null; auto?: number | null; autoBasis?: string; tier: string; veto?: boolean };
type Application = Record<string, any>;
// html: the same as a page, which a mail program shows in place of body when it can (mail-html.ts).
type Mail = { to: string; subject: string; body: string; html?: string; attachments: { path: string; name: string }[] };

export type Deps = {
  loadSettings: () => Settings;
  loadState: (settings: Settings) => { applications: Application[]; jobs: Job[] };
  runSession: (prompt: string, title: string, timeoutMs: number) => Promise<{ id: string; ok: boolean; text: string }>;
  // The search, done by the server with no AI (scraper.ts searchDaily): LinkedIn, freehire and the Telegram channels.
  // Without it, the search is the job-scraper skill run by an agent (SEARCH_PROMPT), at the cost of a model's run.
  search?: (title: string, timeoutMs: number) => Promise<{ id: string; ok: boolean; text: string }>;
  // The portals check (scraper.ts scanPortals), done by the server after the search: the Israeli boards and the
  // employers on the portals page, which the search's agent doesn't cover.
  scanPortals?: (title: string, timeoutMs: number) => Promise<{ id: string; ok: boolean; text: string }>;
  // The new jobs' postings read with no AI (postings.ts crawl), done by the server after the portals check, so each has
  // its automatic score to be picked by.
  readJobs?: (title: string, timeoutMs: number) => Promise<{ id: string; ok: boolean; text: string }>;
  // Applying for one job, done by the server with a few calls to the AI (applier.ts), strict as nobody is watching:
  // a CV only for a strong or good fit. Without it, each job is /apply as an agent (applyPrompt), at many times the cost.
  applyJob?: (url: string, title: string, timeoutMs: number) => Promise<{ id: string; ok: boolean; text: string }>;
  sendMail: (mail: Mail) => Promise<MailResult>;
  // The user's Telegram bot (telegram-bot.ts), ready once it knows their chat. The settings' delivery says where the
  // run's messages go.
  telegram?: { ready: () => boolean; send: (message: TgMessage, lang: "he" | "en") => Promise<TgResult> };
  stateFile?: string;
  root?: string;
  now?: () => Date;
  // This computer's id: the run waits for the computer the settings name, when they name another of the account's.
  computer?: string;
};

// The email and the conversation titles follow the interface language.
const WORDS = {
  he: {
    title: { search: "הריצה היומית: חיפוש", portals: "הריצה היומית: פורטלים", read: "הריצה היומית: קריאת המשרות", apply: "הריצה היומית: " },
    jobSubject: (company: string, title: string) => `קורות חיים: ${company}, ${title}`,
    jobLead: "הקובץ מצורף, בשם שאפשר לשלוח למעסיק כמו שהוא. כדאי לעבור עליו ולהגיש בעצמך.",
    restSubject: "חיפוש עבודה: סיכום הריצה",
    restHeading: "סיכום הריצה",
    restLead: (n: number) => (n === 1 ? "קורות החיים נשלחו במייל נפרד. כאן מה שלא הסתדר." : "קורות החיים נשלחו במיילים נפרדים, מייל לכל משרה. כאן מה שלא הסתדר."),
    none: "הריצה הסתיימה בלי קורות חיים חדשים.",
    noCv: "לא נוצרו קורות חיים.",
    ats: "ציון ATS",
    card: "ציון לפי מה שכל חברה מפרסמת",
    noScore: "אין",
    failed: "שלבים שלא הושלמו:",
    noCvFor: "בלי קורות חיים:",
    unfinished: "לא הסתיים",
    footer: "הפרטים המלאים בשיחות, באתר המקומי.",
    subject: (n: number) => `חיפוש עבודה: ${n} קורות חיים חדשים`,
    steps: { search: "חיפוש", portals: "פורטלים", read: "קריאת המשרות", rank: "דירוג", apply: "הגשה", stopped: "הריצה נעצרה" },
    testSubject: "חיפוש עבודה: מייל בדיקה",
    testBody: "אם הגיע אליך המייל הזה, הריצה היומית תוכל לשלוח לך קורות חיים.",
    kind: "הריצה היומית",
    heading: "קורות חיים חדשים מחכים לך",
    headingNone: "היום בלי קורות חיים חדשים",
    leadNone: "מה שקרה בכל שלב מופיע בשיחות, באתר המקומי.",
    open: "פתיחת המשרה",
    attached: "קורות החיים מצורפים",
    overall: "ציון כללי",
    testTitle: "המייל מגיע",
  },
  en: {
    title: { search: "Daily run: search", portals: "Daily run: portals", read: "Daily run: reading the jobs", apply: "Daily run: " },
    jobSubject: (company: string, title: string) => `CV: ${company}, ${title}`,
    jobLead: "The file is attached, named to send to the employer as it is. Go through it and apply yourself.",
    restSubject: "Job search: the run's summary",
    restHeading: "The run's summary",
    restLead: (n: number) => (n === 1 ? "The CV came in an email of its own. Here is what did not work out." : "The CVs came in emails of their own, one for each job. Here is what did not work out."),
    none: "The run finished with no new CVs.",
    noCv: "No CV came out.",
    ats: "ATS score",
    card: "By what each company publishes",
    noScore: "none",
    failed: "Steps that did not finish:",
    noCvFor: "No CV for:",
    unfinished: "did not finish",
    footer: "The full details are in the conversations on the local site.",
    subject: (n: number) => `Job search: ${n} new CV${n === 1 ? "" : "s"}`,
    steps: { search: "Search", portals: "Portals", read: "Reading the jobs", rank: "Ranking", apply: "Application", stopped: "The run stopped" },
    testSubject: "Job search: test email",
    testBody: "If this email reached you, the daily run can send you CVs.",
    kind: "Daily run",
    heading: "A new CV is waiting for you",
    headingNone: "No new CVs today",
    leadNone: "What happened at each step is in the conversations on the local site.",
    open: "Open the job",
    attached: "CV attached",
    overall: "Overall score",
    testTitle: "Email works",
  },
};
export const mailWords = (settings: Settings) => WORDS[settings.language];

const localDate = (d: Date) => d.toLocaleDateString("en-CA");
const localTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

// A job's score to be picked by: the AI's, when the user asked for one, else its automatic one, but only once its
// posting is read, since a title alone is too little to draft a CV for.
export const pickScore = (j: Job) => j.score ?? (j.autoBasis === "posting" && typeof j.auto === "number" ? j.auto : null);

// The settings' lowest score is on the AI's scale (the framework's bands: 60 a good fit). The automatic score is a
// keyword match, and runs higher: a junior posting in the roles searched for, in a near area and asking no more years
// than the level, has most of its score before a single skill counts, so most of the jobs the search keeps clear 60.
// A job picked by its automatic score needs AUTO_LIFT more, and /apply's own evaluation still stops a poor fit before
// any CV. The picks are ordered by how far each clears its own bar, so neither scale crowds out the other.
export const AUTO_LIFT = 15;
export const pickBar = (j: Job, minScore: number) => (j.score != null ? minScore : Math.min(100, minScore + AUTO_LIFT));

// The best open jobs that have not been tried, by their scores, up to limit.
export function pickJobs(jobs: Job[], applications: Application[], tried: string[], settings: Settings, limit = settings.automation.maxPerDay) {
  const { minScore } = settings.automation;
  const margin = (j: Job) => (pickScore(j) ?? -1) - pickBar(j, minScore);
  return jobs
    .filter((j) => (j.status === "ranked" || j.status === "new") && j.url && pickScore(j) !== null && margin(j) >= 0 && j.tier !== "far" && !j.veto && !tried.includes(j.url))
    .filter((j) => !applications.some((a) => same(a.source, j.url) || (same(a.company, j.company) && same(a.role, j.title))))
    .sort((a, b) => margin(b) - margin(a))
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

// A job the run tried, for the email's page: its CV's scores and what the agent said, or why no CV came out.
type Tried = { company: string; title: string; url: string; cv: boolean; ats?: number | null; overall?: number | null; text: string };

type Words = (typeof WORDS)["he" | "en"];

// A job the run tried as a card on an email's page (mail-html.ts): its CV's scores and the agent's words, or why no
// CV came out.
const triedCard = (j: Tried, words: Words, lang: "he" | "en") => jobCard({
  title: j.title, company: j.company, url: j.url, lang, action: words.open,
  chips: j.cv
    ? [chip(words.attached, "green"), chip(`${words.ats}: ${j.ats ?? words.noScore}`), ...(j.overall != null ? [chip(`${words.overall}: ${j.overall}`)] : [])]
    : [chip(words.noCv.replace(/\.$/, ""), "amber")],
  note: j.text.trim() ? agentWords(j.text) : undefined,
});

const failedSteps = (run: Run, words: Words) => run.steps.filter((s) => !s.ok).map((s) => `${words.steps[s.step]}${s.company ? ` ${s.company}` : ""}: ${s.note ?? words.unfinished}`);

// Each CV comes in an email of its own (Sean, 2026-11-23: all of them came in one email under the same name, and
// nothing told which was which job's): the subject names the job, the page is its card, and its CV alone is
// attached, under the name it goes to the employer by.
function jobMail(to: string, j: Tried, detail: string, cv: { path: string; name: string }, words: Words, lang: "he" | "en"): Mail {
  return {
    to, subject: words.jobSubject(j.company, j.title), attachments: [cv],
    body: [words.jobLead, detail, `\n${words.footer}`].join("\n"),
    html: mailPage({ lang, kind: words.kind, title: words.heading, lead: words.jobLead, preheader: `${j.company}: ${j.title}`, parts: [triedCard(j, words, lang)], footer: words.footer }),
  };
}

// The rest of the run as one line, for Telegram, short enough to read on a phone.
function restLine(run: Run, rest: Tried[], words: Words) {
  const failed = failedSteps(run, words).map((l) => l.replace(/[.\s]+$/, "").slice(0, 90));
  return [
    rest.length ? `${words.noCvFor} ${rest.map((j) => `${j.company} (${j.title})`).join(", ")}.` : "",
    failed.length ? `${words.failed} ${failed.join(", ")}.` : "",
  ].filter(Boolean).join(" ") || words.none;
}

// The rest of the run, with nothing attached: the jobs that got no CV and the steps that did not finish, or, on a
// day with neither and no CV, that nothing came.
function restMail(to: string, run: Run, rest: Tried[], details: string[], words: Words, lang: "he" | "en"): Mail {
  const failed = failedSteps(run, words);
  const drafted = run.drafted.length;
  const lead = drafted ? words.restLead(drafted) : words.leadNone;
  const parts = rest.map((j) => triedCard(j, words, lang));
  if (failed.length) parts.push(warnBox(words.failed.replace(/:$/, ""), failed, lang));
  if (!rest.length && !failed.length) parts.push(para(words.none, lang, { muted: true, top: 16 }));
  return {
    to, subject: drafted ? words.restSubject : words.subject(0), attachments: [],
    body: [drafted ? words.restLead(drafted) : words.none, ...details, failed.length ? `\n${words.failed}\n${failed.map((l) => `- ${l}`).join("\n")}` : "", `\n${words.footer}`].filter(Boolean).join("\n"),
    html: mailPage({ lang, kind: words.kind, title: drafted ? words.restHeading : words.headingNone, lead, parts, footer: words.footer }),
  };
}

// A test email's page: the same frame, saying it came.
export function testMailHtml(title: string, text: string, kind: string, lang: "he" | "en", footer = "") {
  return mailPage({ lang, kind, title, lead: text, footer });
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
    const kept = (name: RunStep["step"], result: { id: string; ok: boolean; text: string }, company?: string) => {
      entry.steps.push({ step: name, company, session: result.id, ok: result.ok, note: result.ok ? undefined : result.text.slice(0, 200) });
      saveRun(entry);
      return result;
    };
    const step = async (name: RunStep["step"], title: string, prompt: string, timeout: number, company?: string) => kept(name, await deps.runSession(prompt, title, timeout), company);
    try {
      if (deps.search) kept("search", await deps.search(words.title.search, STEP_TIMEOUT));
      else await step("search", words.title.search, SEARCH_PROMPT, STEP_TIMEOUT);
      if (deps.scanPortals) {
        const result = await deps.scanPortals(words.title.portals, PORTALS_TIMEOUT);
        entry.steps.push({ step: "portals", session: result.id, ok: result.ok, note: result.ok ? undefined : result.text.slice(0, 200) });
        saveRun(entry);
      }
      if (deps.readJobs) {
        const result = await deps.readJobs(words.title.read, READ_TIMEOUT);
        entry.steps.push({ step: "read", session: result.id, ok: result.ok, note: result.ok ? undefined : result.text.slice(0, 200) });
        saveRun(entry);
      }
      const { applications, jobs } = deps.loadState(settings);
      const limit = trigger === "schedule" ? leftToday(settings, before, now()) : settings.automation.maxPerDay;
      const picks = pickJobs(jobs, applications, read().tried, settings, limit);
      // The CVs that came out, each for its own email, and the jobs that got none, for the rest's.
      const cvs: { job: Tried; detail: string; pdf: string }[] = [];
      const rest: Tried[] = [];
      const details: string[] = [];
      // Named after the user, as build.py saves it (user.ts).
      const cvName = cvFileName(path.join(root, "user"));
      for (const job of picks) {
        const title = `${words.title.apply}${job.company}`;
        const result = deps.applyJob
          ? kept("apply", await deps.applyJob(job.url, title, APPLY_TIMEOUT), job.company)
          : await step("apply", title, applyPrompt(job.url), APPLY_TIMEOUT, job.company);
        saveRun(entry, { tried: [job.url, ...read().tried].slice(0, KEPT_TRIED) });
        const row = deps.loadState(settings).applications.find((a) => same(a.source, job.url) && !applications.includes(a));
        const name = inUserFolder(row?.cv_file).match(/^user\/cv\/main_([a-z0-9_]+)\.\w+$/)?.[1];
        const pdf = name ? path.join(root, "user", "documents", "applications", name, cvName) : "";
        const heading = `\n${job.company}: ${job.title}\n${job.url}`;
        if (!name || !existsSync(pdf)) {
          details.push(`${heading}\n${words.noCv} ${result.text.slice(0, 600)}`);
          rest.push({ company: job.company, title: job.title, url: job.url, cv: false, text: result.text.slice(0, 600) });
          continue;
        }
        entry.drafted.push(`${job.company}: ${job.title}`);
        const ats = readAts(`user/cv/main_${name}.tex`, root);
        const card = readCard(`user/cv/main_${name}.tex`, root);
        const scores = card ? `\n${words.card}: ${cardLine(card, settings.language)}` : "";
        cvs.push({
          job: { company: job.company, title: job.title, url: job.url, cv: true, ats: ats?.score ?? null, overall: card?.overall ?? null, text: result.text.slice(0, 1500) },
          detail: `${heading}\n${words.ats}: ${ats?.score ?? words.noScore}${scores}\n${result.text.slice(0, 1500)}`,
          pdf,
        });
      }
      // The day's first run always emails, so the candidate hears even of a day with nothing new; a later run
      // emails only when it drafted something.
      const firstToday = !before.some((r) => localDate(new Date(r.started)) === localDate(now()));
      if (entry.drafted.length || firstToday) {
        const to = settings.automation.email || readMailAccount()?.user || "";
        const lang = settings.language;
        const { delivery } = settings.automation;
        const bot = delivery !== "email" && deps.telegram?.ready() ? deps.telegram : null;
        const mailed: MailResult[] = [];
        const messaged: TgResult[] = [];
        // Each message to Telegram, and by email too when the settings say both, or instead when Telegram didn't
        // take it or isn't set up, so no CV is lost.
        const deliver = async (mail: Mail, message: TgMessage) => {
          const viaBot = bot ? await bot.send(message, lang) : null;
          if (viaBot) messaged.push(viaBot);
          if (delivery !== "telegram" || viaBot?.status !== "sent") mailed.push(to ? await deps.sendMail(mail) : { status: "no_address" });
        };
        // The rest goes first, only when it has something to say, so the CVs' own messages end up on top.
        const quiet = cvs.length && !rest.length && entry.steps.every((s) => s.ok);
        if (!quiet) await deliver(restMail(to, entry, rest, details, words, lang), { kind: "run", text: restLine(entry, rest, words) });
        for (const c of cvs) {
          const file = { path: c.pdf, name: cvName };
          await deliver(jobMail(to, c.job, c.detail, file, words, lang), { kind: "cv", file, role: c.job.title, company: c.job.company, url: c.job.url });
        }
        entry.mail = mailed.find((r) => r.status !== "sent") ?? mailed[0] ?? null;
        entry.telegram = messaged.find((r) => r.status !== "sent") ?? messaged[0] ?? null;
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
      const elsewhere = Boolean(settings.automation.computer && deps.computer && settings.automation.computer !== deps.computer);
      if (running || elsewhere || !isDue(settings, state.lastSlot ?? state.lastRunDate, now())) return;
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
