// The automatic score: how well a job fits, from words alone, with no AI, as a hiring system's keyword match would.
// Four parts, each from 0 to 1: the skills its posting names that the profile shows too (a required one counting
// twice an advantage), the years it asks against the level searched for, its title against the roles searched for,
// and its area. Every job on Pip's list has one. A job whose posting isn't read yet, or won't open, has its title's
// and its area's alone (basis "title"), which counts its skills as not shown, so it never looks better than it may
// be; reading its posting makes it whole. The AI's score, when the user asks for one, stands over it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { juniorTitle, seniorTitle } from "./experience";
import { namedSkills, profileSkills, type Named } from "./posting-words";
import { listedRole, titleMatches, titleWords, type Role } from "./roles";
import { jobId } from "./ui/jobid";

export type PostingPart = { skills: Named[]; years: number | null };
export type RoleWords = { id?: string; label: string; alts: string[][] };
export type Auto = {
  score: number;
  basis: "posting" | "title";
  parts: { skills: number; years: number; role: number; place: number };
  // How many of the skills its posting names the profile shows, of all and of the required; null when it names none.
  skills: { have: number; of: number; mustHave: number; mustOf: number } | null;
  // The years it asks, when its posting says.
  years: number | null;
  // The role its title fits best, as the settings name it, when it fits one at all.
  role: { id?: string; label: string } | null;
  tier: string;
};

const WEIGHTS = { skills: 0.45, role: 0.25, years: 0.2, place: 0.1 };
// A required skill counts twice an advantage. A posting naming only a few says little, so its share leans toward
// PRIOR, what naming none gives, as if it named one more required skill matched that much.
const MUST = 2;
const PLUS = 1;
const PRIOR = 0.3;
const PRIOR_WEIGHT = 2;
// A title that has the roles' field's words but none of a role's own still counts a little; and what every engineer's
// title has counts half, so "QA Automation Engineer" is no near fit for a backend developer.
const FIELD_FIT = 0.4;
const GENERIC = new Set(["developer"]);
const weightOf = (w: string) => (GENERIC.has(w) ? 0.5 : 1);
const PLACE: Record<string, number> = { near: 1, ok: 1, edge: 0.6, far: 0 };
const PLACE_UNKNOWN = 0.8;

// The usual names of a role brought to one, in English or Hebrew: "full stack", "Full-Stack" and "פול סטאק" are all
// "fullstack", and an engineer, a developer and a programmer, in either language, are all "developer".
const SAME: [RegExp, string][] = [
  [/full[\s-]?stack|פול[\s-]?סטא?ק/g, "fullstack"],
  [/back[\s-]?end|צד[\s-]שרת/g, "backend"],
  [/front[\s-]?end|צד[\s-]לקוח/g, "frontend"],
  [/machine[\s-]learning|למידת[\s-]מכונה/g, "ml"],
  [/artificial[\s-]intelligence|בינה[\s-]מלאכותית/g, "ai"],
  [/computer[\s-]vision|ראיי?ה[\s-]ממוחשבת/g, "vision"],
  [/data[\s-]scien(?:ce|tist)s?|דאטה[\s-]סיינט\S*/g, "datascience"],
  [/quality[\s-]assurance|בדיקות[\s-]תוכנה|בודק\S*[\s-]תוכנה/g, "qa"],
  [/\b(?:engineer|developer|programmer|dev)s?\b|מפתח\S*|מתכנת\S*|מהנדס\S*/g, "developer"],
  [/\balgorithms?\b|אלגוריתמ\S*/g, "algorithms"],
  [/תוכנה/g, "software"],
  [/דאטה|נתונים/g, "data"],
  [/אנליסט\S*/g, "analyst"],
  [/בודק\S*|בדיקות/g, "qa"],
  [/אוטומציה/g, "automation"],
  [/מובייל/g, "mobile"],
  [/חומרה/g, "hardware"],
  [/וריפיקציה/g, "verification"],
  [/ולידציה/g, "validation"],
  [/תשתיות/g, "infrastructure"],
  [/ענן/g, "cloud"],
  [/סייבר|אבטחת[\s-]מידע/g, "security"],
  [/מוצר/g, "product"],
];
// Words that say a role's level, or nothing at all.
const NOISE = new Set([
  "junior", "senior", "jr", "sr", "graduate", "graduates", "student", "students", "entry", "level", "intern", "internship", "trainee",
  "the", "and", "or", "of", "for", "with", "in", "at", "to", "an", "ii", "iii", "iv", "new", "grad",
  "ג'וניור", "ג׳וניור", "גוניור", "בכיר", "בכירה", "סטודנט", "סטודנטים", "לסטודנטים", "מתמחה", "התמחות", "בוגר", "בוגרי", "בוגרים",
  "ללא", "ניסיון", "משרת", "משרה", "חלקית", "מלאה", "דרוש", "דרושה", "דרושים", "דרושות",
]);

// A title's or a role's words, each written one way.
export function words(text: string) {
  let s = ` ${String(text ?? "").toLowerCase().replace(/\/(?:ית|ת|ה)(?=[^\p{L}]|$)/gu, "")} `;
  for (const [re, to] of SAME) s = s.replace(re, ` ${to} `);
  return s.split(/[^\p{L}\p{N}+#.']+/u).map((w) => w.replace(/\.+$/, "")).filter((w) => w.length > 1 && !NOISE.has(w));
}

// The roles' words, ready to be matched: each role's title, and its Hebrew name when the list gives one.
export function roleWords(roles: Role[]): RoleWords[] {
  return roles.map((r) => ({ id: r.id, label: r.label || r.query, alts: [r.query, listedRole(r.id)?.hebrew].filter((q): q is string => Boolean(q)).map(words).filter((w) => w.length > 0) }));
}

// How well a title fits the roles: the share of a role's words it has, the best of them; a title in the roles' field
// but fitting none of them better, a little, with no role named; with no roles set, it isn't counted against.
export function roleFit(title: string, roles: RoleWords[], field: string[]): { fit: number; role: RoleWords | null } {
  if (!roles.length) return { fit: 0.7, role: null };
  const has = new Set(words(title));
  let best = { fit: 0, role: null as RoleWords | null };
  for (const role of roles) {
    for (const alt of role.alts) {
      const total = alt.reduce((n, w) => n + weightOf(w), 0);
      const fit = alt.reduce((n, w) => n + (has.has(w) ? weightOf(w) : 0), 0) / total;
      if (fit > best.fit) best = { fit, role };
    }
  }
  if (best.fit < FIELD_FIT && field.length && titleMatches(title, field)) return { fit: FIELD_FIT, role: null };
  return best;
}

// The years asked, against the level searched for. A posting that names none mostly doesn't mind; a title alone says
// nothing, unless it names its level.
export function yearsFit(years: number | null, seniority: string, title: string, read: boolean) {
  if (seniority !== "junior" && seniority !== "middle" && seniority !== "senior") return 1;
  if (years === null) {
    const junior = juniorTitle(title);
    const senior = seniorTitle(title);
    if (seniority === "junior") return junior ? 1 : senior ? 0.1 : read ? 0.85 : 0.5;
    if (seniority === "middle") return junior ? 0.6 : senior ? 0.7 : read ? 0.85 : 0.5;
    return senior ? 1 : junior ? 0.2 : read ? 0.85 : 0.5;
  }
  if (seniority === "junior") return years <= 1 ? 1 : years === 2 ? 0.6 : 0.1;
  if (seniority === "middle") return years <= 1 ? 0.7 : years <= 5 ? 1 : 0.4;
  return years >= 5 ? 1 : years >= 3 ? 0.85 : 0.5;
}

// The share of the skills its posting names that the profile shows, a required one counting twice.
export function skillsFit(skills: Named[], have: Set<string>) {
  let had = 0;
  let of = 0;
  for (const s of skills) {
    const weight = s.must ? MUST : PLUS;
    of += weight;
    if (have.has(s.name)) had += weight;
  }
  return (had + PRIOR * PRIOR_WEIGHT) / (of + PRIOR_WEIGHT);
}

// fit is the title's fit when it is known already (createAutoScores keeps each title's).
export type AutoInput = { title: string; tier: string; posting: PostingPart | null; have: Set<string>; roles: RoleWords[]; field: string[]; seniority: string; fit?: ReturnType<typeof roleFit> };

export function autoScore(o: AutoInput): Auto {
  const named = o.posting?.skills ?? [];
  const role = o.fit ?? roleFit(o.title, o.roles, o.field);
  const parts = {
    skills: skillsFit(named, o.have),
    years: yearsFit(o.posting?.years ?? null, o.seniority, o.title, Boolean(o.posting)),
    role: role.fit,
    place: PLACE[o.tier] ?? PLACE_UNKNOWN,
  };
  const sum = parts.skills * WEIGHTS.skills + parts.years * WEIGHTS.years + parts.role * WEIGHTS.role + parts.place * WEIGHTS.place;
  const must = named.filter((s) => s.must);
  return {
    score: Math.round(sum * 100),
    basis: o.posting ? "posting" : "title",
    parts,
    skills: named.length ? { have: named.filter((s) => o.have.has(s.name)).length, of: named.length, mustHave: must.filter((s) => o.have.has(s.name)).length, mustOf: must.length } : null,
    years: o.posting?.years ?? null,
    role: role.role && role.fit > 0 ? { id: role.role.id, label: role.role.label } : null,
    tier: o.tier,
  };
}

// What a kept posting (postings.ts) gives the score: the skills it names, its title among them, and the years it asks.
type Kept = { title?: string; read?: { status?: string; lines?: string[]; years?: { min: number } | null } };
export const postingPart = (p: Kept | null | undefined): PostingPart | null =>
  p?.read?.status === "read" && p.read.lines?.length
    ? { skills: namedSkills([String(p.title ?? ""), ...p.read.lines]), years: typeof p.read.years?.min === "number" ? p.read.years.min : null }
    : null;

// The list's automatic scores, from the postings kept in dir and the profile: each posting read once and kept until
// its file changes (the folder's time says when one did, as a posting is saved through a rename; and it is looked
// at in full now and then, for a file changed in place). A time read within a moment of itself isn't trusted: the
// clock that stamps files moves in steps (about 15ms on Windows), so a second change in the same step keeps the time.
const LOOK_AGAIN_MS = 60_000;
const SAME_STEP_MS = 2_000;
export function createAutoScores(o: { dir: string; profile: () => string }) {
  const kept = new Map<string, { at: number; read: number; part: PostingPart | null }>();
  // Each title's fit to the roles, until the roles change.
  const fits = new Map<string, ReturnType<typeof roleFit>>();
  let dirAt = -1;
  let lookedAt = 0;
  let profile: string | null = null;
  let have = new Set<string>();
  let rolesSign = "";
  let roles: RoleWords[] = [];
  let field: string[] = [];

  const look = () => {
    let at = 0;
    try { at = statSync(o.dir).mtimeMs; } catch { kept.clear(); dirAt = -1; return; }
    const now = Date.now();
    if (at === dirAt && now - lookedAt < LOOK_AGAIN_MS && lookedAt - dirAt > SAME_STEP_MS) return;
    dirAt = at;
    lookedAt = now;
    const there = new Set<string>();
    for (const name of readdirSync(o.dir)) {
      const m = /^([0-9a-z]{1,12})\.json$/.exec(name);
      if (!m) continue;
      there.add(m[1]);
      const file = path.join(o.dir, name);
      let changed = 0;
      try { changed = statSync(file).mtimeMs; } catch { continue; }
      const was = kept.get(m[1]);
      if (was?.at === changed && was.read - changed > SAME_STEP_MS) continue;
      let part: PostingPart | null = null;
      try { part = postingPart(JSON.parse(readFileSync(file, "utf8"))); } catch { /* a file half written is read next time */ }
      kept.set(m[1], { at: changed, read: now, part });
    }
    for (const id of kept.keys()) if (!there.has(id)) kept.delete(id);
  };
  const ready = (settings: { roles: Role[]; seniority: string }) => {
    const text = o.profile();
    if (text !== profile) { profile = text; have = profileSkills(text); }
    const sign = JSON.stringify(settings.roles);
    if (sign !== rolesSign) { rolesSign = sign; roles = roleWords(settings.roles); field = settings.roles.length ? titleWords(settings.roles) : []; fits.clear(); }
  };
  const fitOf = (title: string) => {
    let fit = fits.get(title);
    if (!fit) {
      if (fits.size > 20_000) fits.clear();
      fits.set(title, fit = roleFit(title, roles, field));
    }
    return fit;
  };

  return {
    // Scores the list's jobs by the settings as they stand: each by its posting when one is kept and read.
    scorer(settings: { roles: Role[]; seniority: string }) {
      look();
      ready(settings);
      return (job: { url: string; title: string; tier: string }) => {
        const id = jobId(job.url);
        return autoScore({ title: job.title, tier: job.tier, posting: (id && kept.get(id)?.part) || null, have, roles, field, seniority: settings.seniority, fit: fitOf(job.title) });
      };
    },
    // One job's, from its posting as the page has it.
    of(p: Kept & { title: string }, tier: string, settings: { roles: Role[]; seniority: string }) {
      ready(settings);
      return autoScore({ title: p.title, tier, posting: postingPart(p), have, roles, field, seniority: settings.seniority });
    },
  };
}
