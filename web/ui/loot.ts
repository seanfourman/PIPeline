// Pip's treasure over the list of his finds (views/loot.tsx): his vault's three rooms, the gold (the few jobs he
// thinks are worth the most right now, the first of them his pick), high-tech and outside high-tech; and the kinds of
// job worth a second look, each a pile of its own, to narrow a room or the list by. Worked out in the browser from the
// list as the server sends it (data.ts), so nothing here is saved, and a pile is only as good as what the list knows:
// a job counts only with a firm score (the AI's, or the automatic one from its posting).
import type { Room } from "./vault";

export const LOOT = ["gold", "gems", "hightech", "lowtech", "fresh", "closing", "home", "ai", "grads", "big", "defense"] as const;
export type Loot = (typeof LOOT)[number];

export type LootJob = {
  key: string; url: string; title: string; company: string; location?: string; tier?: string; date?: string; deadline?: string;
  veto?: boolean; status?: string; portal?: string; industry?: string; home?: boolean;
};

// How many gold jobs there are at most, and how far back one may have been posted.
export const GOLD_MAX = 10;
const GOLD_DAYS = 21;
// The score a job needs: for gold, for a hidden one, for the piles, and for one closing soon, which is worth a look
// at a fair fit too.
const GOLD_FROM = 80;
const GEM_FROM = 70;
const PILE_FROM = 60;
const CLOSING_FROM = 45;
// How many places down a room puts a company's next job.
const SPREAD = 6;

// Where a job was found: on LinkedIn; on another of the big boards; on its employer's own site; in a Telegram
// channel; or on a site few read, a community's or one the daily run's web search came across.
export type Where = "linkedin" | "board" | "own" | "channel" | "web";
const BOARDS = new Set(["freehire-search", "alljobs-search", "drushim-search", "jobmaster-search"]);
export function whereFound(portal = ""): Where {
  if (portal === "linkedin-search") return "linkedin";
  if (!portal || BOARDS.has(portal)) return "board";
  if (portal === "careers-page") return "own";
  if (/^telegram/.test(portal)) return "channel";
  return "web";
}

// Words in a title or a company's name that put a job on a pile.
const STUDENT = /\b(students?|interns?|internship|co-?op)\b|סטודנט|מתמחה|התמחות/i;
const TEMPORARY = /maternity|temporary|replacement|החלפה|חל["״]ד|זמני/i;
const GRADS = /\b(graduates?|grads?|entry[- ]level)\b|בוגר|בוגרת|בוגרי|הכשרה|מסלול/i;
const AI = /\b(ai|ml|nlp|llms?|genai|computer vision|machine learning|deep learning|data scien\w*|algorithms?)\b|בינה מלאכותית|למידת מכונה|ראיי?ה ממוחשבת|אלגוריתמ/i;
const BIG = /\b(nvidia|google|microsoft|amazon|aws|apple|meta|intel|mobileye|wix|monday|check ?point|cyberark|palo alto|sentinel ?one|wiz|amdocs|nice|playtika|fiverr|lemonade|riskified|payoneer|taboola|outbrain|similarweb|jfrog|armis|snyk|salesforce|ibm|oracle|cisco|qualcomm|broadcom|marvell|applied materials|kla|sap|siemens|philips|samsung|unity|booking|paypal|ebay|gong|moovit|waze|dell|hp|hpe|elbit|rafael)\b|אינטל|גוגל|מיקרוסופט|אמזון|מובילאיי|צ'ק פוינט|אלביט|רפאל|התעשייה האווירית/i;
const DEFENSE = /\b(elbit|rafael|israel aerospace|iai|elta)\b|אלביט|רפאל|התעשייה האווירית|תעשייה אווירית|אלתא/i;

const plain = (s = "") => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
// The same job twice, from two places: the same title at the same company.
const twinOf = (j: LootJob) => `${plain(j.company)}|${plain(j.title)}`;
// Outside high-tech: a health fund, a bank, an insurer, a ministry, a university and the like, by the employer's
// industry on the portals page (portals.ts), or, for one not there, by the words in its name.
const LOW_NAME = /\b(bank|insurance|hospital|medical cent(er|re)|university|college|municipality|ministry)\b|ביטוח|בנק|קופת חולים|בית חולים|מרכז רפואי|אוניברסיט|מכללה|הטכניון|עיריי|משרד ה/i;
export const lowTech = (j: LootJob) =>
  j.industry ? j.industry !== "hightech" && j.industry !== "defense" : LOW_NAME.test(j.company);

// Whole days from a date given as YYYY-MM-DD to now, or null without one.
function daysFrom(date: string | undefined, now: Date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - new Date(+m[1], +m[2] - 1, +m[3]).getTime()) / 86_400_000);
}

// Why a job is on Pip's treasure, in the order the gold pick says it.
export type Why =
  | { kind: "score"; n: number }
  | { kind: "posted"; days: number }
  | { kind: "closes"; days: number }
  | { kind: "home" }
  | { kind: "industry"; id: string }
  | { kind: "where"; where: "channel" | "web" | "own" }
  | { kind: "grads" };

export type Treasure<J extends LootJob> = {
  piles: Record<Loot, J[]>;
  // The vault's rooms: the gold, and high-tech and outside it, each in score order with a company's next jobs put
  // further down, so the top of a room isn't one company's.
  rooms: Record<Room, J[]>;
  // The piles a job is on that its row shows: gold, and hidden (gems).
  marks: Map<string, Loot[]>;
  why: (j: J) => Why[];
};

// The treasure in a list of Pip's finds. A job counts once (the same job from two places, the better scored or the
// one off LinkedIn), only while still open, wanted and not ruled out, and only with a firm score (score). Each pile
// is in score order but the gold, which goes by worth: the score, with a little more for a job new, closing soon,
// near home or found where few look, and less for a temporary one or one in a borderline area; and one a company.
// studentJobs: the setting; unless student jobs are as welcome as others, none is gold and they come last on a pile.
export function treasure<J extends LootJob>(jobs: J[], score: (j: J) => number | null, o: { studentJobs?: string; now?: Date } = {}): Treasure<J> {
  const now = o.now ?? new Date();
  const onLinkedIn = new Set(jobs.filter((j) => whereFound(j.portal) === "linkedin").map(twinOf));
  const scored = new Map<J, number>();
  for (const j of jobs) {
    const s = score(j);
    if (s === null || j.veto || j.tier === "far" || j.status === "skipped" || j.status === "expired") continue;
    scored.set(j, s);
  }
  const seen = new Set<string>();
  const live = [...scored.keys()]
    .sort((a, b) => scored.get(b)! - scored.get(a)! || Number(whereFound(a.portal) === "linkedin") - Number(whereFound(b.portal) === "linkedin") || String(b.date).localeCompare(String(a.date)))
    .filter((j) => !seen.has(twinOf(j)) && Boolean(seen.add(twinOf(j))));
  const s = (j: J) => scored.get(j)!;
  const age = (j: J) => daysFrom(j.date, now);
  const closesIn = (j: J) => {
    const d = daysFrom(j.deadline, now);
    return d === null ? null : -d;
  };
  const closing = (j: J) => { const d = closesIn(j); return d !== null && d >= 0 && d <= 7; };
  // Found where few look: a Telegram channel, a site few read, or the own site of an employer outside high-tech;
  // and not on LinkedIn as well.
  const hidden = (j: J) => {
    const where = whereFound(j.portal);
    return !onLinkedIn.has(twinOf(j)) && (where === "channel" || where === "web" || (where === "own" && lowTech(j)));
  };
  const isDefense = (j: J) => j.industry === "defense" || DEFENSE.test(j.company);
  // Student jobs last on a pile, unless they are as welcome as others.
  const studentsWelcome = !o.studentJobs || o.studentJobs === "normal";
  const from = (least: number, test: (j: J) => boolean) => {
    const pile = live.filter((j) => s(j) >= least && test(j));
    return studentsWelcome ? pile : [...pile.filter((j) => !STUDENT.test(j.title)), ...pile.filter((j) => STUDENT.test(j.title))];
  };

  const worth = (j: J) => {
    const days = age(j) ?? GOLD_DAYS;
    return s(j) + (days <= 2 ? 4 : days <= 7 ? 2 : 0) + (hidden(j) ? 3 : 0) + (closing(j) ? 2 : 0) + (j.home ? 2 : 0)
      - (TEMPORARY.test(j.title) ? 6 : 0) - (j.tier === "edge" ? 4 : 0);
  };
  const companies = new Set<string>();
  const gold = from(GOLD_FROM, (j) => { const days = age(j); return days !== null && days >= 0 && days <= GOLD_DAYS && (studentsWelcome || !STUDENT.test(j.title)); })
    .sort((a, b) => worth(b) - worth(a))
    .filter((j) => {
      const c = plain(j.company);
      if (!c) return true;
      if (companies.has(c)) return false;
      companies.add(c);
      return true;
    })
    .slice(0, GOLD_MAX);

  const piles: Record<Loot, J[]> = {
    gold,
    gems: from(GEM_FROM, hidden),
    hightech: from(PILE_FROM, (j) => !lowTech(j)),
    lowtech: from(PILE_FROM, lowTech),
    fresh: from(PILE_FROM, (j) => { const days = age(j); return days !== null && days >= 0 && days <= 1; }),
    closing: from(CLOSING_FROM, closing),
    home: from(PILE_FROM, (j) => Boolean(j.home)),
    ai: from(PILE_FROM, (j) => AI.test(j.title)),
    grads: from(PILE_FROM, (j) => GRADS.test(j.title) && !STUDENT.test(j.title)),
    big: from(PILE_FROM, (j) => BIG.test(j.company)),
    defense: from(PILE_FROM, isDefense),
  };
  // A company's second job goes a few places down, its third twice as far, and so on.
  const spread = (list: J[]) => {
    const nth = new Map<string, number>();
    return list
      .map((j, i) => { const c = plain(j.company) || j.key; const n = nth.get(c) ?? 0; nth.set(c, n + 1); return { j, at: i + n * SPREAD }; })
      .sort((a, b) => a.at - b.at)
      .map((e) => e.j);
  };
  const rooms: Record<Room, J[]> = { gold, tech: spread(piles.hightech), low: spread(piles.lowtech) };
  const marks = new Map<string, Loot[]>();
  for (const pile of ["gold", "gems"] as const) for (const j of piles[pile]) marks.set(j.key, [...(marks.get(j.key) ?? []), pile]);

  const why = (j: J): Why[] => {
    const out: Why[] = [];
    if (scored.has(j)) out.push({ kind: "score", n: s(j) });
    const days = age(j);
    if (days !== null && days >= 0 && days <= 7) out.push({ kind: "posted", days });
    const closes = closesIn(j);
    if (closes !== null && closes >= 0 && closes <= 7) out.push({ kind: "closes", days: closes });
    if (j.home) out.push({ kind: "home" });
    if (j.industry && lowTech(j)) out.push({ kind: "industry", id: j.industry });
    const where = whereFound(j.portal);
    if (scored.has(j) && hidden(j) && where !== "linkedin" && where !== "board") out.push({ kind: "where", where });
    if (GRADS.test(j.title) && !STUDENT.test(j.title)) out.push({ kind: "grads" });
    return out;
  };
  return { piles, rooms, marks, why };
}
