// The list that grows by itself: companies whose jobs Pip came upon on a recruiting platform (the job list's links,
// most of them from the daily run's web search of the platforms' job pages, settings.ts) and that the portals page
// doesn't have. The portals check (scraper.ts) reads each new board once, a few a day: one with a job in Israel joins
// the employers it reads from then on, under the name its board gives; one without is tried again after a month.
// Kept in the user's folder, so a company found stays found.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ISRAEL, readBoard, type Fetch } from "./boards";
import { PORTALS, type Portal, type Read } from "./portals";
import { APP_DIR, USER_DIR } from "./user";

export type FoundEmployer = { id: string; name: string; read: Read; url: string; added: string; israel: number };
type Kept = { found: FoundEmployer[]; tried: Record<string, string> };

const FILE = path.join(APP_DIR, "found-employers.json");
const SEEN = path.join(USER_DIR, "job_scraper", "seen_jobs.json");
// New boards read in one check, and how long one without a job in Israel waits to be read again.
const PER_CHECK = 8;
const RETRY_DAYS = 30;

const COMEET_ID = /^[0-9A-F]{2}\.[0-9A-F]{3}$/i;

// The board a job's link is on, on one of the platforms Pip reads, or null. Greenhouse's European boards have an API
// of their own, which Pip doesn't read.
export function boardOf(link: string): Read | null {
  let url: URL;
  let parts: string[];
  try {
    url = new URL(link);
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const [a, b, c] = parts;
  switch (url.hostname) {
    case "www.comeet.com": case "comeet.com": return a === "jobs" && b && c && COMEET_ID.test(c) ? { comeet: `${b}/${c}` } : null;
    case "job-boards.greenhouse.io": case "boards.greenhouse.io": return a && b === "jobs" ? { greenhouse: a } : null;
    case "jobs.lever.co": return a && b ? { lever: a } : null;
    case "jobs.ashbyhq.com": return a && b ? { ashby: a } : null;
    case "apply.workable.com": return a && a !== "j" && b === "j" ? { workable: a } : null;
    default: return null;
  }
}

// One key for a board, whatever the case its name is written in.
const keyOf = (read: Read) => Object.entries(read).map(([kind, name]) => `${kind}:${String(name).toLowerCase()}`)[0];
const idOf = (read: Read) => `found-${keyOf(read).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)}`;
// The board's own page, which the portals page opens.
const pageOf = (read: Read) =>
  "greenhouse" in read ? `https://job-boards.greenhouse.io/${read.greenhouse}`
  : "lever" in read ? `https://jobs.lever.co/${read.lever}`
  : "ashby" in read ? `https://jobs.ashbyhq.com/${encodeURIComponent(read.ashby)}`
  : "workable" in read ? `https://apply.workable.com/${read.workable}/`
  : "comeet" in read ? `https://www.comeet.com/jobs/${read.comeet}`
  : "";
const ON_LIST = new Set(PORTALS.flatMap((p) => (p.read ? [keyOf(p.read)] : [])));

export function readFound(file = FILE): Kept {
  try {
    const kept = JSON.parse(readFileSync(file, "utf8"));
    return { found: Array.isArray(kept?.found) ? kept.found : [], tried: kept?.tried && typeof kept.tried === "object" ? kept.tried : {} };
  } catch {
    return { found: [], tried: {} };
  }
}

// The companies found, as employers on the portals page; one the list has since taken in, only there.
export const foundPortals = (kept = readFound()): Portal[] => kept.found.filter((f) => !ON_LIST.has(keyOf(f.read)))
  .map((f) => ({ id: f.id, kind: "employer", how: "read", he: f.name, en: f.name, industry: "hightech", read: f.read, url: f.url }));

// The job list's boards that are neither on the list nor found already, and weren't tried this past month, the
// newest first, each read once, up to PER_CHECK. Returns the companies found this time.
export async function discoverEmployers(o: { fetch: Fetch; today: string; signal?: AbortSignal; file?: string; seen?: string; limit?: number }): Promise<FoundEmployer[]> {
  const file = o.file ?? FILE;
  const kept = readFound(file);
  const have = new Set([...ON_LIST, ...kept.found.map((f) => keyOf(f.read))]);
  let seen: Record<string, { url?: unknown; first_seen?: unknown }> = {};
  try { seen = JSON.parse(readFileSync(o.seen ?? SEEN, "utf8"))?.seen ?? {}; } catch { /* no list yet */ }
  const fresh = (key: string) => !kept.tried[key] || Date.parse(o.today) - Date.parse(kept.tried[key]) >= RETRY_DAYS * 86_400_000;
  const boards = new Map<string, Read>();
  const newest = Object.values(seen).sort((x, y) => String(y?.first_seen ?? "").localeCompare(String(x?.first_seen ?? "")));
  for (const job of newest) {
    const read = boardOf(String(job?.url ?? ""));
    const key = read && keyOf(read);
    if (read && key && !have.has(key) && !boards.has(key) && fresh(key)) boards.set(key, read);
  }
  const added: FoundEmployer[] = [];
  for (const [key, read] of [...boards].slice(0, o.limit ?? PER_CHECK)) {
    if (o.signal?.aborted) break;
    try {
      const { name, postings } = await readBoard(read, o);
      kept.tried[key] = o.today;
      const israel = postings.filter((p) => ISRAEL.test(p.location)).length;
      if (!israel) continue;
      const found: FoundEmployer = { id: idOf(read), name: name.replace(/\s+/g, " ").trim().slice(0, 60) || Object.values(read)[0], read, url: pageOf(read), added: o.today, israel };
      kept.found.push(found);
      added.push(found);
    } catch {
      // Out of reach today, or not a board after all: tried again in a month.
      kept.tried[key] = o.today;
    }
  }
  if (boards.size) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(kept, null, 2));
  }
  return added;
}
