// Which of two groups a job falls in, for the job list's filter and the live alerts (alerts.ts): a high-tech company's
// or a known employer's ("known"), or another's ("other"). Known is an employer on the portals page, by the portal it
// was read for or by its name, or one found on the recruiting platforms (discover.ts, all high-tech). A job on a
// platform tech companies hire through (Comeet, Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday,
// Teamtailor, HiBob) is high-tech too. Anything else, a board's or a search's job at a company the list doesn't know,
// is the other group.
import { foundPortals } from "./discover";
import { PORTALS, type Industry, type Portal } from "./portals";

export type Group = "known" | "other";

const PLATFORMS = /(^|\.)(comeet\.(com|co)|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|teamtailor\.com|hibob\.com)$/i;
// Words a company's name is written with or without: "Elbit Systems Ltd", "אלביט מערכות בע"מ", "Ness" for Ness
// Technologies, "Elad Software" for Elad Systems. A name of these words alone is no name.
const NOISE = new Set([
  "ltd", "inc", "llc", "corp", "co", "בעמ", "israel", "ישראל", "il",
  "software", "systems", "system", "technologies", "technology", "tech", "group", "labs", "solutions",
  "תוכנה", "מערכות", "טכנולוגיות", "קבוצת", "פתרונות",
]);
export const plainName = (name: string) => name.toLowerCase().replace(/בע["״']?מ/g, " בעמ ").replace(/["'״׳.,()\-–|/]/g, " ")
  .split(/\s+/).filter((w) => w && !NOISE.has(w)).join(" ");

// The known employers, read again every ten minutes, as the recruiting platforms' finds grow, each with its industry.
let kept: { at: number; ids: Map<string, Industry>; names: Map<string, Industry> } | null = null;
function known(found: () => Portal[]) {
  if (kept && Date.now() - kept.at < 10 * 60_000) return kept;
  let more: Portal[] = [];
  try { more = found(); } catch { /* none found yet */ }
  const employers = [...PORTALS.filter((p) => p.kind === "employer"), ...more];
  return (kept = {
    at: Date.now(),
    ids: new Map(employers.map((p) => [p.id, p.industry])),
    names: new Map(employers.flatMap((p) => [plainName(p.he), plainName(p.en)].filter((n) => n.length >= 2).map((n) => [n, p.industry] as const))),
  });
}
export const forgetKnown = () => { kept = null; };

export function jobGroup(job: { portalId?: string; company?: string; url?: string }, found: () => Portal[] = foundPortals): Group {
  const k = known(found);
  if (job.portalId && k.ids.has(job.portalId)) return "known";
  const name = plainName(job.company ?? "");
  if (name && k.names.has(name)) return "known";
  try { if (PLATFORMS.test(new URL(job.url ?? "").hostname)) return "known"; } catch { /* no address */ }
  return "other";
}

// The industry of a job's employer (portals.ts), for Pip's treasure on the list of his finds (ui/loot.ts): the
// employer it was read for, or one on the portals page by its name; a job on a recruiting platform is high-tech's.
// Empty when nothing tells.
export function jobIndustry(job: { portalId?: string; company?: string; url?: string }, found: () => Portal[] = foundPortals): Industry | "" {
  const k = known(found);
  const byId = job.portalId ? k.ids.get(job.portalId) : undefined;
  if (byId) return byId;
  const byName = k.names.get(plainName(job.company ?? ""));
  if (byName) return byName;
  try { if (PLATFORMS.test(new URL(job.url ?? "").hostname)) return "hightech"; } catch { /* no address */ }
  return "";
}
