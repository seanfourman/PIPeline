// The jobs the home page shows (Home in views/home.tsx), as the settings choose them (Settings.homeJobs, Sean
// 2026-11-20: "להראות שם את המשרות הכי טובות מהשלושה ימים האחרונים רק או אפילו מה 24 שעות האחרונות"): a few of the
// best found or published lately, rather than every job with a score.
import { plainUrl } from "./jobid";

// days: how far back, 0 for no limit; count: how many at most; order: the best first, or the newest.
export type HomeJobs = { days: 0 | 1 | 3 | 7; count: 5 | 10 | 15 | 20; order: "score" | "new" };
export const HOME_DAYS = [1, 3, 7, 0] as const;
export const HOME_COUNTS = [5, 10, 15, 20] as const;
export const HOME_ORDERS = ["score", "new"] as const;
export const HOME_JOBS: HomeJobs = { days: 3, count: 10, order: "score" };

// The choice as saved, a missing or strange value taking the default.
export function homeJobsFrom(input: any): HomeJobs {
  const one = <T>(list: readonly T[], value: unknown, fallback: T) => list.find((x) => String(x) === String(value)) ?? fallback;
  return {
    days: one(HOME_DAYS, input?.days, HOME_JOBS.days),
    count: one(HOME_COUNTS, input?.count, HOME_JOBS.count),
    order: one(HOME_ORDERS, input?.order, HOME_JOBS.order),
  };
}

// A job's place, short enough for a square on the shelf: the country and a district or region left out when a city is
// named beside them ("Yokneam Illit, North District, Israel" is "Yokneam Illit"), and a district alone said without the
// word ("Tel Aviv District, Israel" is "Tel Aviv").
const COUNTRY = /^(israel|ישראל|il)$/i;
const AREA = /\b(district|region|area)\b|מחוז/i;
export function placeShort(location: string) {
  const parts = [...new Set(String(location ?? "").split(/[,;]/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p && !COUNTRY.test(p)))];
  const towns = parts.filter((p) => !AREA.test(p));
  const kept = towns.length ? towns : parts.map((p) => p.replace(AREA, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return kept.join(", ") || String(location ?? "").trim();
}

type Job = { url: string; date?: string; status?: string; tier?: string; veto?: boolean };
const LEFT_OUT = new Set(["skipped", "expired", "filtered"]);
const DAY_MS = 86_400_000;
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The jobs to show, and how many in all fit the choice. A job's date is the day it was published, else the day Pip
// first saw it, a day with no hour, so the last 24 hours reach back into yesterday: a job is kept from the day that
// many days before today on. Kept: those with a firm score (score, the AI's or the automatic one from the posting),
// not in an area out of reach, not left out by a check (veto), not skipped, closed or above the level, and not
// already applied to. Ties go to the newer job, or, by date, to the better one.
export function homeJobs<J extends Job>(jobs: J[], applications: { source?: string }[], choice: HomeJobs, score: (j: J) => number | null, now = new Date()) {
  const since = choice.days ? localDay(new Date(now.getTime() - choice.days * DAY_MS)) : "";
  const sent = new Set(applications.map((a) => plainUrl(String(a.source ?? ""))).filter(Boolean));
  const kept = jobs.filter((j) => score(j) !== null && j.tier !== "far" && !j.veto && !LEFT_OUT.has(String(j.status ?? ""))
    && !sent.has(plainUrl(j.url)) && (!since || String(j.date ?? "").slice(0, 10) >= since));
  const best = (a: J, b: J) => score(b)! - score(a)!;
  const newest = (a: J, b: J) => String(b.date ?? "").localeCompare(String(a.date ?? ""));
  kept.sort(choice.order === "new" ? (a, b) => newest(a, b) || best(a, b) : (a, b) => best(a, b) || newest(a, b));
  return { shown: kept.slice(0, choice.count), total: kept.length };
}
