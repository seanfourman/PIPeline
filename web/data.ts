// Reads the workspace's files for the UI, and runs the portal CLIs for live search.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { REPO } from "./policy";
import { linkedinPlace, REMOTE, type Area, type Market, type Settings } from "./settings";

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

// A place matches from the start of a word, so "lod" does not match "Melody".
// Exclusions are checked first, so an excluded "Kiryat Gat" beats a wider acceptable area.
export function classifyLocation(location: string, areas: Area[]): Area["tier"] | "unknown" {
  const text = (location ?? "").toLowerCase();
  for (const tier of ["far", "edge", "near", "ok"] as const) {
    const places = areas.filter((a) => a.tier === tier).flatMap((a) => a.places);
    if (places.some((p) => new RegExp(`(^|[^\\p{L}])${escapeRegex(p)}`, "u").test(text))) return tier;
  }
  return "unknown";
}

const httpUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");

function seenJobs(areas: Area[]) {
  const files = ["job_scraper/seen_jobs.json", ".claude/skills/job-scraper/job_scraper/seen_jobs.json"];
  const seen: Record<string, any> = {};
  for (const f of files) Object.assign(seen, readJson(path.join(REPO, f))?.seen ?? {});
  return Object.entries(seen).map(([key, j]) => ({
    key,
    title: String(j.title ?? ""),
    company: String(j.company ?? ""),
    location: String(j.location ?? ""),
    tier: classifyLocation(String(j.location ?? ""), areas),
    url: httpUrl(j.url),
    date: j.posted_date ?? j.first_seen ?? "",
    deadline: j.deadline ?? "",
    status: String(j.status ?? ""),
    score: typeof j.rank_score === "number" ? j.rank_score : null,
    verdict: String(j.rank_verdict ?? ""),
    veto: j.location_verdict === "FAIL" || j.language_gate === "FAIL",
    fit: String(j.fit ?? ""),
  }));
}

function listFiles() {
  const out: { path: string; name: string; modified: number }[] = [];
  for (const dir of ["cv", "cover_letters", "reports"]) {
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

// The score ats.py saved beside the CV, found through the tracker row's CV file.
export function readAts(cvFile: string, root = REPO): AtsResult | null {
  const name = String(cvFile ?? "").trim().replaceAll("\\", "/").match(/^cv\/main_([a-z0-9_]+)\.\w+$/)?.[1];
  if (!name) return null;
  try {
    const saved = JSON.parse(readFileSync(path.join(root, "documents", "applications", name, "ats.json"), "utf8"));
    return { score: typeof saved.score === "number" ? saved.score : null, missing: saved.missing ?? [], problems: saved.problems ?? [] };
  } catch {
    return null;
  }
}

export function loadState(settings: Settings) {
  const trackerFile = path.join(REPO, "job_search_tracker.csv");
  const applications = (existsSync(trackerFile) ? parseCsv(readFileSync(trackerFile, "utf8")) : [])
    .map((row) => ({ ...row, ats: readAts(row.cv_file) }));
  const profileReady = !readFileSync(path.join(REPO, "CLAUDE.md"), "utf8").includes("[YOUR_NAME]");
  return { applications, jobs: seenJobs(settings.areas), files: listFiles(), profileReady };
}

// Only finished documents from the output folders are ever served.
export function resolveDocument(requested: string): string | null {
  const rel = requested.replaceAll("\\", "/");
  if (!/^(cv|cover_letters|reports)\/[^/]+\.(pdf|html)$/i.test(rel)) return null;
  const abs = path.join(REPO, rel);
  return existsSync(abs) ? abs : null;
}

type SearchOptions = { days: string; market: Market; workMode: Settings["workMode"]; seniority: Settings["seniority"] };

export function portalArgs(source: "linkedin" | "freehire", q: string, o: SearchOptions): string[] {
  const remote = o.market.code === REMOTE ? "remote" : o.workMode === "any" ? "" : o.workMode;
  const mode = remote ? ["--remote", remote] : [];
  if (source === "linkedin") {
    return ["search", "--location", linkedinPlace(o.market), "-q", q, "--jobage", o.days, ...mode, "--limit", "25", "--format", "json"];
  }
  return [
    "search", "-q", q, "--jobage", o.days, "--no-description", "--limit", "25", "--format", "json", ...mode,
    ...(o.market.code === REMOTE ? [] : ["--country", o.market.code]),
    ...(o.market.city ? ["--city", o.market.city] : []),
    ...(o.seniority === "any" ? [] : ["--seniority", o.seniority]),
  ];
}

async function runPortal(source: "linkedin" | "freehire", q: string, o: SearchOptions, areas: Area[]) {
  const proc = Bun.spawn([process.execPath, "run", `.agents/skills/${source}-search/cli/src/cli.ts`, ...portalArgs(source, q, o)], {
    cwd: REPO, stdout: "pipe", stderr: "ignore",
  });
  const timer = setTimeout(() => proc.kill(), 60_000);
  const text = await new Response(proc.stdout).text();
  clearTimeout(timer);
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

export async function searchJobs(q: string, days: string, marketCode: string, workMode: string, settings: Settings) {
  const query = q.trim().slice(0, 120);
  if (!query || query.startsWith("-")) throw new Error("bad query");
  const age = ["1", "7", "14", "30"].includes(days) ? days : "14";
  const markets = marketCode && marketCode !== "all"
    ? settings.markets.filter((m) => m.code === marketCode)
    : settings.markets;
  if (!markets.length) throw new Error("no market");
  const mode = (["any", "remote", "hybrid", "onsite"] as const).find((m) => m === workMode) ?? settings.workMode;
  const runs = markets.flatMap((market) => (["linkedin", "freehire"] as const).map((source) => {
    const options = { days: age, market, workMode: mode, seniority: settings.seniority };
    return { label: `${source} ${market.label}`, run: runPortal(source, query, options, settings.areas) };
  }));
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
