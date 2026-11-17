// Reads the workspace's files for the UI, and runs the portal CLIs for live search.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { BOARDS, pageFetcher, searchBoard, type Board, type Fetch } from "./boards";
import { REPO } from "./policy";
import { boardOn, ownName } from "./portals";
import { levelGate } from "./experience";
import { jobGroup } from "./groups";
import type { createAutoScores } from "./match";
import { boardQueries } from "./roles";
import { inEnglish, linkedinPlace, REMOTE, type Area, type Market, type Settings } from "./settings";
import { asksForTranscript, TRANSCRIPT } from "./transcript";
import { profileReady } from "./user";

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const clean = text.replace(/^﻿/, "");
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

const readJson = (file: string) => {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A place matches from the start of a word, so "lod" does not match "Melody"; a Hebrew one, from the Israeli boards,
// by its English name too (inEnglish).
// Exclusions are checked first, so an excluded "Kiryat Gat" beats a wider acceptable area. A hyphen is a space, in the
// place and in the words alike (any dash, the Hebrew maqaf too), so the "Israel, Kiryat-Gat" of Intel's site is Kiryat Gat.
const spaced = (s: string) => s.toLowerCase().replace(/[\p{Pd}_]+/gu, " ");
export function classifyLocation(location: string, areas: Area[]): Area["tier"] | "unknown" {
  const text = spaced(`${location ?? ""} ${inEnglish(location ?? "")}`);
  for (const tier of ["far", "edge", "near", "ok"] as const) {
    const places = areas.filter((a) => a.tier === tier).flatMap((a) => a.places);
    if (places.some((p) => new RegExp(`(^|[^\\p{L}])${escapeRegex(spaced(p))}`, "u").test(text))) return tier;
  }
  return "unknown";
}

const httpUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");

// The list's automatic scores (match.ts), from the postings kept on this computer.
export type AutoScores = ReturnType<typeof createAutoScores>;

// A job the list has twice, from a job site and from the company's own site (a company read on its own site since,
// portals.ts), shows once: the same title from the same employer (the portal it was read for, or else the same company
// name). The company's own copy shows, unless the job site's copy carries a word on the job, dismissed, left out or
// ranked by the AI, which then stays as it is, and the own copy goes. Display only: the list's file keeps both.
const JOB_SITES = /(^|\.)(alljobs|drushim|jobmaster)\.co\.il$/i;
const DECIDED = new Set(["skipped", "filtered", "ranked"]);
const plainWords = (s: unknown) => String(s ?? "").toLowerCase().replace(/\/[תה](?=[^\p{L}]|$)/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
const onJobSite = (url: string) => { try { return JOB_SITES.test(new URL(url).hostname); } catch { return false; } };
export function withoutJobSiteCopies<T extends { url: string; title: string; company: string; status?: string; portalId?: string }>(jobs: T[]): T[] {
  const own = new Map<string, T[]>();
  for (const j of jobs) {
    if (onJobSite(j.url)) continue;
    const title = plainWords(j.title);
    for (const key of [j.portalId ? `p:${j.portalId}|${title}` : "", `c:${plainWords(j.company)}|${title}`]) {
      if (key) own.set(key, [...(own.get(key) ?? []), j]);
    }
  }
  const gone = new Set<T>();
  for (const j of jobs) {
    if (!onJobSite(j.url)) continue;
    const twins = own.get(j.portalId ? `p:${j.portalId}|${plainWords(j.title)}` : `c:${plainWords(j.company)}|${plainWords(j.title)}`);
    if (!twins?.length) continue;
    if (DECIDED.has(String(j.status ?? ""))) twins.forEach((t) => gone.add(t));
    else gone.add(j);
  }
  return jobs.filter((j) => !gone.has(j));
}

function seenJobs(settings: Settings, auto?: AutoScores) {
  const { areas, seniority } = settings;
  const seen: Record<string, any> = readJson(path.join(REPO, "user", "job_scraper", "seen_jobs.json"))?.seen ?? {};
  const scoreOf = auto?.scorer(settings);
  return withoutJobSiteCopies(Object.entries(seen).map(([key, j]) => {
    // Above the level searched for: left out before scoring for the years its posting asks or its senior title
    // (rank_state.py's "filtered", written as it was read), or a senior title seen here, for a junior search.
    const level = j.status === "filtered" ? { verdict: "FAIL", why: j.filter_reason === "senior" ? "senior" : "years", years: j.experience_min } : levelGate({ title: String(j.title ?? ""), years: null, seniority });
    const levelOut = level.verdict === "FAIL";
    const tier = classifyLocation(String(j.location ?? ""), areas);
    // Its automatic score, from its posting's words with no AI, or its title's while its posting isn't read; the AI's
    // (score), when the user asked for one, stands over it. None for a job skipped or closed.
    const mine = scoreOf && j.status !== "skipped" && j.status !== "expired" ? scoreOf({ url: String(j.url ?? ""), title: String(j.title ?? ""), tier }) : null;
    return {
    key,
    title: String(j.title ?? ""),
    company: ownName(String(j.company ?? "")),
    location: String(j.location ?? ""),
    tier,
    url: httpUrl(j.url),
    date: j.posted_date ?? j.first_seen ?? "",
    deadline: j.deadline ?? "",
    status: String(j.status ?? ""),
    score: typeof j.rank_score === "number" ? j.rank_score : null,
    verdict: String(j.rank_verdict ?? ""),
    auto: mine?.score ?? null,
    autoBasis: mine?.basis ?? "",
    veto: j.location_verdict === "FAIL" || j.language_gate === "FAIL" || levelOut,
    // Which check left it out: its place, its language, the years it asks, or its senior title; years how many.
    gate: j.location_verdict === "FAIL" ? "location" : j.language_gate === "FAIL" ? "language" : levelOut ? level.why ?? "years" : "",
    years: levelOut && typeof level.years === "number" ? level.years : null,
    fit: String(j.fit ?? ""),
    // Where it was found: a job site's search, an employer's own page (careers-page), or another; and the employer on
    // the portals page it was read for, when it was.
    portal: String(j.portal ?? ""),
    portalId: String(j.portal_id ?? "") || undefined,
    // A high-tech company's or a known employer's, or another's (groups.ts), for the list's filter.
    group: jobGroup({ portalId: String(j.portal_id ?? ""), company: String(j.company ?? ""), url: String(j.url ?? "") }),
    };
  }));
}

function listFiles() {
  const out: { path: string; name: string; modified: number }[] = [];
  for (const dir of ["user/cv", "user/cover_letters", "user/reports"]) {
    const abs = path.join(REPO, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (!/\.(pdf|html)$/i.test(name)) continue;
      out.push({ path: `${dir}/${name}`, name, modified: statSync(path.join(abs, name)).mtimeMs });
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}

export type AtsResult = { score: number | null; missing: string[]; problems: string[] };

// A path an older tracker row or message gives without the user's folder (cv/main_x.tex) is the same file in user/.
export const inUserFolder = (rel: string) => {
  const clean = String(rel ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  return /^(cv|cover_letters|reports|documents)\//.test(clean) ? `user/${clean}` : clean;
};

// A file in a CV's application folder, found through the tracker row's CV file: a JSON file ats.py saved there, or
// the posting /apply archived there as text.
function applicationFile(cvFile: string, file: string, root: string, asText = false) {
  const name = inUserFolder(cvFile).match(/^user\/cv\/main_([a-z0-9_]+)\.\w+$/)?.[1];
  if (!name) return null;
  try {
    const text = readFileSync(path.join(root, "user", "documents", "applications", name, file), "utf8");
    return asText ? text : JSON.parse(text);
  } catch {
    return null;
  }
}

// Whether the job's posting asks for a grade sheet, which the applications page then offers (transcript.ts).
export function postingAsksTranscript(cvFile: string, root = REPO) {
  const posting = applicationFile(cvFile, "job_posting.md", root, true);
  return typeof posting === "string" && asksForTranscript(posting);
}

// The score ats.py saved beside the CV.
export function readAts(cvFile: string, root = REPO): AtsResult | null {
  const saved = applicationFile(cvFile, "ats.json", root);
  return saved ? { score: typeof saved.score === "number" ? saved.score : null, missing: saved.missing ?? [], problems: saved.problems ?? [] } : null;
}

export type CardLens = { id: string; score: number | null; grade: string | null; checks: { id: string; ok: boolean; value?: number }[]; missing: string[] };
export type ScoreCard = { overall: number | null; lenses: CardLens[] };
const number = (v: unknown) => (typeof v === "number" ? v : null);

// The scorecard ats.py saved beside the CV (scorecard.py): the CV scored by what each large employer publishes.
export function readCard(cvFile: string, root = REPO): ScoreCard | null {
  const saved = applicationFile(cvFile, "scorecard.json", root);
  if (!Array.isArray(saved?.lenses)) return null;
  const lenses = saved.lenses.filter((l: any) => typeof l?.id === "string").map((l: any): CardLens => ({
    id: l.id, score: number(l.score), grade: typeof l.grade === "string" ? l.grade : null,
    checks: (Array.isArray(l.checks) ? l.checks : []).filter((c: any) => typeof c?.id === "string")
      .map((c: any) => ({ id: c.id, ok: c.ok === true, ...(typeof c.value === "number" ? { value: c.value } : {}) })),
    missing: Array.isArray(l.missing) ? l.missing.map(String) : [],
  }));
  return { overall: number(saved.overall), lenses };
}

// The scorecard in one line, for the report after a CV is written and for the daily email.
export function cardLine(card: ScoreCard, lang: "he" | "en") {
  const names: Record<string, string> = {
    google: "Google", amazon: "Amazon", meta: "Meta", microsoft: "Microsoft", nvidia: "Nvidia", ibm: "IBM", deloitte: "Deloitte", workday: "Workday",
    systems: lang === "he" ? "מערכות הגיוס" : "Hiring systems", ats: "ATS", pip: lang === "he" ? "פיפ" : "Pip",
  };
  const lenses = card.lenses.filter((l) => l.score !== null).map((l) => `${names[l.id] ?? l.id} ${l.grade ? `${l.grade} (${l.score})` : l.score}`);
  return [...lenses, `${lang === "he" ? "כללי" : "Overall"} ${card.overall ?? "–"}`].join(", ");
}

export function loadState(settings: Settings, auto?: AutoScores) {
  const trackerFile = path.join(REPO, "user", "job_search_tracker.csv");
  const applications = (existsSync(trackerFile) ? parseCsv(readFileSync(trackerFile, "utf8")) : [])
    .map((row) => ({ ...row, ats: readAts(row.cv_file), card: readCard(row.cv_file), asksTranscript: postingAsksTranscript(row.cv_file) }));
  return { applications, jobs: seenJobs(settings, auto), files: listFiles(), profileReady: profileReady() };
}

// Only finished documents from the output folders are ever served.
export function resolveDocument(requested: string): string | null {
  const rel = requested.replaceAll("\\", "/");
  // The workflow's documents: CVs, letters and reports, and the final CV saved in an application's folder; and the
  // grade sheet kept from the settings.
  if (!/^user\/(cv|cover_letters|reports)\/[^/]+\.(pdf|html)$/i.test(rel) && !/^user\/documents\/applications\/[A-Za-z0-9_-]+\/[^/]+\.pdf$/i.test(rel) && rel !== TRANSCRIPT) return null;
  const abs = path.join(REPO, rel);
  return existsSync(abs) ? abs : null;
}

// Paths of documents named in some text, a command or a message, relative to the project: in the shapes
// resolveDocument serves, after anything before them (an absolute path to the project, a quote). One an older
// conversation named without the user's folder is the same file in user/.
const DOCUMENT_PATH = /(?:user\/)?(?:(?:cv|cover_letters|reports)\/[^\s"'`)\]/]+\.(?:pdf|html|tex)|documents\/applications\/[A-Za-z0-9_-]+\/[^\n"'`)\]/]+?\.pdf)/gi;
export const documentPaths = (text: string) => (text.replaceAll("\\", "/").match(DOCUMENT_PATH) ?? []).map(inUserFolder);

// The documents a conversation made or changed that are there now, newest first: those its tools wrote or a
// command of its named, and those Pip's messages name; a CV's or letter's .tex stands for its PDF. Tool results
// are left out, since a listing or a search names files the conversation only looked at.
export function conversationFiles(events: Record<string, unknown>[]): { path: string; name: string; modified: number }[] {
  const named = events.flatMap((e) => [
    ...(Array.isArray(e.files) ? e.files.map(String) : []),
    ...(e.t === "text" ? documentPaths(String(e.text ?? "")) : []),
  ]);
  const found = new Map<string, { path: string; name: string; modified: number }>();
  for (const raw of named) {
    const rel = inUserFolder(raw).replace(/\.tex$/i, ".pdf");
    const abs = resolveDocument(rel);
    if (abs && !found.has(rel)) found.set(rel, { path: rel, name: path.basename(rel), modified: statSync(abs).mtimeMs });
  }
  return [...found.values()].sort((a, b) => b.modified - a.modified);
}

type SearchOptions = { days: string; market: Market; workMode: Settings["workMode"]; seniority: Settings["seniority"] };

// LinkedIn gives one page of ten, by relevance unless asked otherwise. A search one day back (the live alerts') asks
// for the newest first: by relevance, its ten were as often yesterday's as the last hour's (checked 2026-11-15).
export function portalArgs(source: "linkedin" | "freehire", q: string, o: SearchOptions): string[] {
  const remote = o.market.code === REMOTE ? "remote" : o.workMode === "any" ? "" : o.workMode;
  const mode = remote ? ["--remote", remote] : [];
  if (source === "linkedin") {
    const sort = o.days === "1" ? ["--sort", "recent"] : [];
    return ["search", "--location", linkedinPlace(o.market), "-q", q, "--jobage", o.days, ...mode, ...sort, "--limit", "25", "--format", "json"];
  }
  return [
    "search", "-q", q, "--jobage", o.days, "--no-description", "--limit", "25", "--format", "json", ...mode,
    ...(o.market.code === REMOTE ? [] : ["--country", o.market.code]),
    ...(o.market.city ? ["--city", o.market.city] : []),
    ...(o.seniority === "any" ? [] : ["--seniority", o.seniority]),
  ];
}

// A search's result, from a portal tool or an Israeli board.
type Result = { id: string; title: string; company: string; location: string; tier: Area["tier"] | "unknown"; date: string; url: string; source: string };

// Stopped (signal), the tool is killed at once rather than left to finish.
async function runPortal(source: "linkedin" | "freehire", q: string, o: SearchOptions, areas: Area[], signal?: AbortSignal): Promise<Result[]> {
  if (signal?.aborted) throw new Error("stopped");
  const proc = Bun.spawn([process.execPath, "run", `.agents/skills/${source}-search/cli/src/cli.ts`, ...portalArgs(source, q, o)], {
    cwd: REPO, stdout: "pipe", stderr: "ignore",
  });
  const kill = () => proc.kill();
  signal?.addEventListener("abort", kill);
  const timer = setTimeout(kill, 60_000);
  const text = await new Response(proc.stdout).text();
  clearTimeout(timer);
  signal?.removeEventListener("abort", kill);
  if ((await proc.exited) !== 0) throw new Error(`${source} ${o.market.label}`);
  return (JSON.parse(text).results ?? []).map((r: any) => ({
    id: String(r.id ?? r.url),
    title: String(r.title ?? ""),
    company: String(r.company ?? ""),
    location: String(r.location ?? ""),
    tier: classifyLocation(String(r.location ?? ""), areas),
    date: String(r.date ?? ""),
    url: httpUrl(r.url),
    source,
  }));
}

const GENERIC_WORDS = new Set(["junior", "graduate", "entry", "level", "engineer", "developer", "student", "and", "or"]);

// freehire matches loosely, so "Junior QA Engineer" also returns "Junior Treasury Assistant".
export function matchesQuery(title: string, query: string) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter((w) => w && !GENERIC_WORDS.has(w));
  if (!words.length) return true;
  const lower = title.toLowerCase();
  return words.some((w) => lower.includes(w));
}

const boardFetch: Fetch = pageFetcher();

// An Israeli board's postings for one search, in the shape the portal tools' results have. The boards match loosely
// too ("אנליסט נתונים" also finds a credit risk manager), so a title needs one of the search's words.
async function runBoard(board: Board, q: string, days: number, areas: Area[], signal?: AbortSignal): Promise<Result[]> {
  const today = new Date().toLocaleDateString("en-CA");
  return (await searchBoard(board, q, days, { fetch: boardFetch, today, signal })).filter((p) => matchesQuery(p.title, q)).map((p) => ({
    id: p.url, title: p.title, company: p.company, location: p.location, tier: classifyLocation(p.location, areas), date: p.date, url: p.url, source: board,
  }));
}

// sources "boards" leaves LinkedIn and freehire out, for the daily run, whose agent searches those itself. The
// Israeli boards are searched for a market in Israel, with the role's Hebrew name as well as its title; any site
// switched off on the portals page is left out. Stopped (signal), what is still running is killed.
// sources: everything, the Israeli boards alone (the portals check), or the portals' tools alone, LinkedIn and
// freehire (the daily run's search, whose boards are the portals check's).
export async function searchJobs(q: string, days: string, marketCode: string, workMode: string, settings: Settings, sources: "all" | "boards" | "tools" = "all", signal?: AbortSignal) {
  const query = q.trim().slice(0, 120);
  if (!query || query.startsWith("-")) throw new Error("bad query");
  const age = ["1", "7", "14", "30"].includes(days) ? days : "14";
  const markets = marketCode && marketCode !== "all"
    ? settings.markets.filter((m) => m.code === marketCode)
    : settings.markets;
  if (!markets.length) throw new Error("no market");
  const mode = (["any", "remote", "hybrid", "onsite"] as const).find((m) => m === workMode) ?? settings.workMode;
  const tools = sources === "boards" ? [] : (["linkedin", "freehire"] as const).filter((s) => boardOn(s, settings));
  const runs: { label: string; run: Promise<Result[]> }[] = markets.flatMap((market) => tools.map((source) => {
    const options = { days: age, market, workMode: mode, seniority: settings.seniority };
    return { label: `${source} ${market.label}`, run: runPortal(source, query, options, settings.areas, signal) };
  }));
  if (sources !== "tools" && markets.some((m) => m.code === "IL")) {
    const role = settings.roles.find((r) => r.query.toLowerCase() === query.toLowerCase());
    for (const board of BOARDS.filter((b) => boardOn(b, settings))) {
      for (const search of role ? boardQueries(role) : [query]) runs.push({ label: board, run: runBoard(board, search, Number(age), settings.areas, signal) });
    }
  }
  const settled = await Promise.allSettled(runs.map((r) => r.run));
  const seen = new Set<string>();
  const results = settled
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((j) => j.source !== "freehire" || matchesQuery(j.title, query))
    .filter((j) => {
      const key = `${j.company}|${j.title}|${j.location}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const failed = runs.filter((_, i) => settled[i].status === "rejected").map((r) => r.label);
  return { results, failed };
}
