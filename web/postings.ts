// A job's own page: its posting read once and kept on this computer (user/job_scraper/postings/<id>.json, one file
// a job, so the accounts' sync sends only what changed), whether it is above the level searched for, how it fits the
// candidate, and whether they applied. A job is read with no AI, as a crawler would (ranker.ts fetchPosting): its
// words, its facts from the page's own data and from its words (the years it asks, experience.ts; how and where it is
// worked, posting-words.ts), and the skills it names. The AI reads it only when the user asks (analyze): one ranking
// answer, which scores it as /rank does and lays its posting out for the page. A job on Pip's list that a junior
// search shouldn't see (three years or more asked, or a senior title) is left out of the list once read
// (rank_state.py's "filtered"). For a junior search, the listed jobs not read yet are read in the background, one at
// a time and slowly (crawl), so the list knows each one's years. Nothing here starts a conversation.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChatbotError } from "./chatbots";
import { levelGate, requiredYears, type Years } from "./experience";
import type { Facts } from "./posting-read";
import { factsIn, skillsIn } from "./posting-words";
import { fetchPosting, parseScore, postingLines, PYTHON, scoringPrompt, scoringSystem, type Fetched, type Run, type Tidy } from "./ranker";
import { jobId, plainUrl } from "./ui/jobid";

export type Basics = { url: string; title: string; company: string; location: string; date?: string };
// What the AI's answer gave a job that isn't on Pip's list, kept here as rank_state.py keeps a listed job's.
type Match = { score: number; verdict: string; location_verdict: string; language_gate: string; language_note?: string; strengths: string[]; gaps: string[]; at: string; by?: string };
export type Posting = Basics & {
  id: string;
  read?: { at: string; status: "read" | "unreachable" | "expired"; error?: string; source?: string; guard?: string; lines?: string[]; facts?: Facts; years?: Years | null };
  tidy?: Tidy & { at: string; by?: string };
  match?: Match;
  ai?: { error: string; at: string };
};
export type Stage = "page" | "ai";
// Why a job is read: opened (read if it needs to be), read again by the page's button, read and then given to the AI
// (the user asked), or read in the background for the list.
type Why = "open" | "again" | "ai" | "crawl";
type Score = ReturnType<typeof parseScore>;

// The framework's weights and bands (tools/rank_state.py's), for a job kept here rather than on the list.
const WEIGHTS: Record<string, number> = { technical: 0.3, experience: 0.25, behavioral: 0.15, career: 0.3 };
const band = (n: number) => (n >= 75 ? "Strong Fit" : n >= 60 ? "Good Fit" : n >= 45 ? "Moderate Fit" : n >= 30 ? "Weak Fit" : "Poor Fit");
const overall = (scores: Record<string, number>) => Math.round(Object.entries(WEIGHTS).reduce((sum, [dim, w]) => sum + (scores[dim] ?? 0) * w, 0));
// A page that wouldn't open is tried again when the job is opened a day later.
const READ_AGAIN_MS = 24 * 3600_000;
// Jobs read at once; more opened meanwhile wait their turn.
const AT_ONCE = 2;
// The background reading's pace: a pause after each job, and at least this long between two pages of one site.
// LinkedIn isn't read in the background at all: it turns away a reader that comes too often.
const CRAWL_PAUSE_MS = 1500;
const SAME_SITE_MS = 5000;
const NOT_CRAWLED = /(^|\.)linkedin\.com$/i;

// A company or a role compared without case, marks or spaces, and without Hebrew's "/ת" ending ("מפתח/ת").
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\/[תה](?=[^\p{L}]|$)/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
const ID = /^[0-9a-z]{1,12}$/;
const today = () => new Date().toISOString();
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
const sleep = (ms: number) => new Promise((go) => setTimeout(go, ms));

export type Deps = {
  dir: string;
  run: Run;
  // The settings' AI, in their order; it throws a ChatbotError when none is there to answer.
  ask: (system: string, prompt: string, signal: AbortSignal) => Promise<{ text: string; by: string }>;
  lang: () => "he" | "en";
  // The level searched for (the settings' seniority), and the profile's text, for the skills it shows.
  seniority: () => string;
  profile: () => string;
  // Pip's list (seen_jobs.json's "seen") and the applications (the tracker's rows).
  seen: () => Record<string, Record<string, any>>;
  tracker: () => Record<string, string>[];
  // Writes listed jobs' scores through rank_state.py, or holds them while a run over the list is writing it.
  apply: (rows: Record<string, unknown>[]) => void;
  system?: (lang: "he" | "en") => string;
  // The background reading's pace, in milliseconds (tests make it quick).
  pace?: { pause: number; sameSite: number };
};

export function createPostings(d: Deps) {
  const file = (id: string) => {
    if (!ID.test(id)) throw new Error("not a job's id");
    return path.join(d.dir, `${id}.json`);
  };
  const load = (id: string): Posting | null => {
    try { return JSON.parse(readFileSync(file(id), "utf8")); } catch { return null; }
  };
  const save = (p: Posting) => {
    mkdirSync(d.dir, { recursive: true });
    const tmp = `${file(p.id)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(p));
    renameSync(tmp, file(p.id));
  };
  // The listed job a link is, by its plain link; the links are made plain once for each list read.
  const keys = new WeakMap<object, Map<string, string>>();
  const listed = (url: string) => {
    const seen = d.seen();
    let byLink = keys.get(seen);
    if (!byLink) {
      byLink = new Map(Object.entries(seen).map(([key, entry]) => [plainUrl(String(entry?.url ?? "")), key]));
      keys.set(seen, byLink);
    }
    const key = byLink.get(plainUrl(url));
    return key ? { key, entry: seen[key] } : null;
  };
  const reading = new Map<string, Stage>();
  const queue: (() => void)[] = [];
  let busy = 0;
  const turn = () => new Promise<void>((go) => { if (busy < AT_ONCE) { busy++; go(); } else queue.push(() => { busy++; go(); }); });
  const done = () => { busy--; queue.shift()?.(); };

  // What the read gave, kept: the lines as the AI would number them and the years they ask, or why there are none.
  const keepRead = (p: Posting, got: Fetched) => {
    p.read = "status" in got
      ? { at: today(), status: got.status, error: got.fetch_error || undefined }
      : { at: today(), status: "read", source: got.source, guard: got.guard, lines: postingLines(got.text), facts: got.facts, years: requiredYears(got.text) };
  };
  // Whether the job is above the level searched for, by its title and the years its posting asks.
  const levelOf = (p: Posting) => levelGate({ title: p.title, years: p.read?.years?.min ?? null, seniority: d.seniority() });
  // A listed job above it, left out of the list, whatever stood there (a score included); one already left out, or
  // skipped or closed, stays as it is.
  const filterListed = (p: Posting, found: ReturnType<typeof listed>) => {
    if (!found || !["new", "unreachable", "ranked"].includes(String(found.entry?.status ?? ""))) return;
    const level = levelOf(p);
    if (level.verdict === "FAIL") d.apply([{ key: found.key, status: "filtered", reason: level.why, ...(level.why === "years" ? { years: level.years } : {}) }]);
  };
  const keepScore = (p: Posting, score: Score, by: string, key?: string, guard?: string) => {
    if (score.status !== "scored") {
      p.read = { ...(p.read ?? { at: today() }), status: score.status, error: (score as { fetch_error?: string }).fetch_error || undefined, lines: p.read?.lines };
      if (key) d.apply([{ key, ...score }]);
      return;
    }
    const { posting, ...row } = score as Score & { posting?: Tidy; scores: Record<string, number>; strengths: string[]; gaps: string[]; location_verdict: string; language_gate: string; language_note?: string };
    if (posting) p.tidy = { ...posting, at: today(), by: by || undefined };
    // Kept here too for a listed job, so its page has it while a run over the list holds the write (server.ts).
    const n = overall(row.scores);
    p.match = { score: n, verdict: band(n), location_verdict: row.location_verdict, language_gate: row.language_gate, language_note: row.language_note, strengths: row.strengths, gaps: row.gaps, at: today(), by: by || undefined };
    if (key) d.apply([{ key, ...row, guard }]);
    delete p.ai;
  };

  // The posting read, then (asked for) the AI's answer, each kept as it comes; one read at a time per job, which a
  // second ask joins.
  // A read for the AI asked while one without it is going waits for it, then asks.
  const inflight = new Map<string, { read: Promise<void>; why: Why }>();
  function readJob(id: string, why: Why = "open"): Promise<void> {
    const going = inflight.get(id);
    if (going) return why === "ai" && going.why !== "ai" ? going.read.then(() => readJob(id, "ai")) : going.read;
    const read = doRead(id, why).finally(() => inflight.delete(id));
    inflight.set(id, { read, why });
    return read;
  }
  async function doRead(id: string, why: Why) {
    if (!reading.has(id)) reading.set(id, "page");
    await turn();
    let scratch = "";
    try {
      scratch = mkdtempSync(path.join(os.tmpdir(), "ai-job-search-job-"));
      const p = load(id);
      if (!p) return;
      const found = listed(p.url);
      const job = { key: found?.key ?? "", title: p.title, company: p.company, url: p.url, portal: String(found?.entry?.portal ?? "") };
      const stale = p.read && p.read.status !== "read" && Date.now() - Date.parse(p.read.at) > READ_AGAIN_MS;
      if (!p.read || stale || (why === "again" && p.read.status !== "read") || (why === "ai" && p.read.status !== "read")) {
        reading.set(id, "page");
        keepRead(p, await fetchPosting(job, d.run, AbortSignal.timeout(180_000), scratch));
        // A listed job found closed leaves the list; one that wouldn't open counts a try, but only when the user
        // opened it: a site turning away the background reading says nothing of the job.
        if (found && (p.read!.status === "expired" || (p.read!.status === "unreachable" && why !== "crawl"))) {
          d.apply([{ key: found.key, status: p.read!.status, fetch_error: p.read!.error ?? "" }]);
        }
        save(p);
      }
      if (p.read?.status === "read") filterListed(p, found);
      if (why !== "ai" || p.read?.status !== "read" || !p.read.lines?.length) return;
      reading.set(id, "ai");
      try {
        const lang = d.lang();
        const system = d.system ? d.system(lang) : scoringSystem(lang, undefined, undefined, true);
        const answer = await d.ask(system, scoringPrompt(job, p.read.lines.join("\n")), AbortSignal.timeout(240_000));
        keepScore(p, parseScore(answer.text), answer.by, found?.key, p.read.guard);
      } catch (err) {
        p.ai = { error: err instanceof ChatbotError ? err.code : "ai_failed", at: today() };
      }
      save(p);
    } catch (err) {
      console.error("A job's page was not read:", err);
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      reading.delete(id);
      done();
    }
  }

  // A job's basics kept (a search's or a saved job's have nowhere else), over what its file already holds.
  const keepBasics = (basics: Basics) => {
    const id = jobId(basics.url);
    if (!id) return null;
    const p: Posting = { ...(load(id) ?? {}), id, url: basics.url, title: String(basics.title ?? "").slice(0, 300), company: String(basics.company ?? "").slice(0, 200), location: String(basics.location ?? "").slice(0, 200), date: basics.date ? String(basics.date).slice(0, 40) : undefined };
    save(p);
    return p;
  };
  const needsRead = (p: Posting | null) => !p?.read || (p.read.status !== "read" && Date.now() - Date.parse(p.read.at) > READ_AGAIN_MS);

  // A job opened: kept, and read when it needs to be. No AI.
  function open(basics: Basics) {
    const p = keepBasics(basics);
    if (!p) return null;
    if (needsRead(p)) {
      // Marked as being read before the answer goes, so the page shows it from the start.
      if (!reading.has(p.id)) reading.set(p.id, "page");
      void readJob(p.id, "open");
    }
    return view(p.id);
  }

  // Read again by the page's button: a page that wouldn't open.
  function again(id: string) {
    if (!load(id)) return null;
    if (!reading.has(id)) reading.set(id, "page");
    void readJob(id, "again");
    return view(id);
  }

  // The AI asked to read the job, by the page's button: it scores it and lays its posting out.
  function analyze(id: string) {
    const p = load(id);
    if (!p) return null;
    if (!reading.has(id)) reading.set(id, p.read?.status === "read" ? "ai" : "page");
    void readJob(id, "ai");
    return view(id);
  }

  // What the page shows of a job.
  function view(id: string) {
    const p = load(id);
    if (!p) return null;
    const found = listed(p.url);
    const e = found?.entry ?? {};
    const match = typeof e.rank_score === "number"
      ? { score: e.rank_score, verdict: String(e.rank_verdict ?? ""), location: String(e.location_verdict ?? "PASS"), language: String(e.language_gate ?? "PASS"), languageNote: e.language_note ?? "", strengths: e.strengths ?? [], gaps: e.gaps ?? [], at: String(e.rank_date ?? "") }
      : p.match ? { score: p.match.score, verdict: p.match.verdict, location: p.match.location_verdict, language: p.match.language_gate, languageNote: p.match.language_note ?? "", strengths: p.match.strengths, gaps: p.match.gaps, at: p.match.at.slice(0, 10) } : null;
    const lines = p.read?.lines ?? [];
    const sections = (p.tidy?.sections ?? []).filter((s) => s.from < lines.length).map((s) => ({ ...s, to: Math.min(s.to, lines.length - 1) }));
    // The page's own data first, then the AI's when it was asked, then what the words say.
    const page = p.read?.facts ?? {};
    const ai = p.tidy?.facts ?? {};
    const words = lines.length ? factsIn(lines.join("\n")) : {};
    const years = p.read?.years;
    const facts = {
      employment: page.employment ?? ai.employment ?? words.employment, workMode: page.workMode ?? ai.workMode ?? words.workMode,
      officeDays: ai.officeDays ?? words.officeDays, experience: ai.experience ?? (years ? [years.min, years.max] as [number, number | null] : undefined), level: page.level ?? ai.level,
      posted: page.posted ?? (String(e.posted_date ?? p.date ?? "").slice(0, 10) || undefined), deadline: page.deadline ?? (e.deadline || undefined), salary: page.salary, jobNumber: page.jobNumber,
    };
    const level = p.read?.status === "read" ? levelOf(p) : levelGate({ title: p.title, years: null, seniority: d.seniority() });
    return {
      id, reading: reading.get(id) ?? null,
      job: { url: p.url, title: e.title || p.title, company: e.company || p.company, location: e.location || p.location, key: found?.key ?? "", portal: String(e.portal ?? ""), status: String(e.status ?? "") },
      match,
      level,
      posting: { status: p.read?.status ?? null, error: p.read?.error ?? "", source: p.read?.source ?? "", guard: p.read?.guard ?? "", at: p.read?.at ?? "", lines, sections, skills: p.tidy?.skills ?? skillsIn(lines, d.profile()), facts },
      applied: appliedTo(p, d.tracker()),
      aiError: p.ai?.error ?? "",
    };
  }

  // A ranking run's job, kept for its page as it was read (ranker.ts keep), and as it was scored when it was.
  function keepRanked(job: { key: string; title?: string; company?: string; url?: string }, got: Fetched, score: Score | null, by: string) {
    const id = jobId(String(job.url ?? ""));
    if (!id) return;
    const p: Posting = load(id) ?? { id, url: String(job.url), title: String(job.title ?? ""), company: String(job.company ?? ""), location: "" };
    keepRead(p, got);
    if (score?.status === "scored" && (score as { posting?: Tidy }).posting) p.tidy = { ...(score as { posting: Tidy }).posting, at: today(), by: by || undefined };
    save(p);
  }

  // The background reading, for a junior search: each listed job waiting (new, or ranked before its posting was kept)
  // whose posting isn't read yet, the newest first, one at a time and slowly; a junior search's job asking for three
  // years or more leaves the list as it is read. It stops when the list is being written by a run (stop), or there is
  // nothing left; a job opened meanwhile is read before the next.
  let crawling = false;
  async function crawl(stop: () => boolean = () => false) {
    if (crawling || d.seniority() !== "junior") return 0;
    crawling = true;
    let read = 0;
    try {
      const lastAt = new Map<string, number>();
      const waiting = Object.values(d.seen())
        .filter((e) => (e.status === "new" || e.status === "ranked") && /^https?:\/\//i.test(String(e.url ?? "")) && !NOT_CRAWLED.test(hostOf(String(e.url))))
        .map((e) => ({ e, id: jobId(String(e.url)) }))
        .filter((x): x is { e: Record<string, any>; id: string } => Boolean(x.id) && needsRead(load(x.id!)))
        .sort((a, b) => String(b.e.posted_date || b.e.first_seen || "").localeCompare(String(a.e.posted_date || a.e.first_seen || "")));
      for (const { e, id } of waiting) {
        if (stop() || d.seniority() !== "junior") break;
        const host = hostOf(String(e.url));
        const wait = (lastAt.get(host) ?? 0) + (d.pace?.sameSite ?? SAME_SITE_MS) - Date.now();
        if (wait > 0) await sleep(wait);
        if (!needsRead(load(id))) continue;
        keepBasics({ url: String(e.url), title: String(e.title ?? ""), company: String(e.company ?? ""), location: String(e.location ?? ""), date: String(e.posted_date ?? "") || undefined });
        await readJob(id, "crawl");
        lastAt.set(host, Date.now());
        read++;
        await sleep(d.pace?.pause ?? CRAWL_PAUSE_MS);
      }
    } catch (err) {
      console.error("The background reading of the list stopped:", err);
    } finally {
      crawling = false;
    }
    return read;
  }

  return { open, again, analyze, view, keepRanked, readJob, crawl, load, save };
}
export type JobView = NonNullable<ReturnType<ReturnType<typeof createPostings>["view"]>>;

// Whether the user applied to the job, by the tracker: its link when the row kept one, else the same company and role.
export function appliedTo(job: Pick<Basics, "url" | "title" | "company">, rows: Record<string, string>[]) {
  const plain = plainUrl(job.url);
  const company = norm(job.company);
  const title = norm(job.title);
  const row = rows.find((r) => (plain && plainUrl(r.source ?? "") === plain) || (company && title && norm(r.company) === company && norm(r.role) === title));
  return row ? { status: String(row.status ?? ""), date: String(row.date ?? "").slice(0, 10) } : null;
}

// Listed jobs' scores written through the same tool a ranking run uses (rank_state.py apply).
export async function applyThroughTool(rows: Record<string, unknown>[], run: Run) {
  if (!rows.length) return;
  const results = path.join(os.tmpdir(), `ai-job-search-job-${crypto.randomUUID()}.json`);
  writeFileSync(results, JSON.stringify(rows));
  try {
    const done = await run([PYTHON, "tools/rank_state.py", "apply", "--results", results]);
    if (done.code !== 0) console.error("A job's score was not written:", (done.err || done.out).slice(0, 300));
  } finally {
    rmSync(results, { force: true });
  }
}

// Pip's list as rank_state.py keeps it, read again only when it changed.
export function seenReader(file: string) {
  let at = -1;
  let seen: Record<string, Record<string, any>> = {};
  return () => {
    try {
      const m = existsSync(file) ? statSync(file).mtimeMs : 0;
      if (m !== at) { seen = m ? JSON.parse(readFileSync(file, "utf8"))?.seen ?? {} : {}; at = m; }
    } catch { /* the last good one stays */ }
    return seen;
  };
}
