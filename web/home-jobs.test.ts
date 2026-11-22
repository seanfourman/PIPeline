import { describe, expect, test } from "bun:test";
import { homeJobs, homeJobsFrom, HOME_JOBS, placeShort } from "./ui/home-jobs";

const now = new Date(2026, 10, 20, 15, 0);
const job = (url: string, date: string, s: number | null, more: Record<string, unknown> = {}) => ({ url: `https://jobs.example.com/${url}`, date, s, status: "new", tier: "near", veto: false, ...more });
const score = (j: { s: number | null }) => j.s;
const titles = (r: { shown: { url: string }[] }) => r.shown.map((j) => j.url.split("/").pop());

describe("the home page's jobs", () => {
  const jobs = [
    job("today", "2026-11-20", 70), job("yesterday", "2026-11-19", 90), job("three", "2026-11-17", 95),
    job("old", "2026-11-10", 99), job("noscore", "2026-11-20", null), job("far", "2026-11-20", 98, { tier: "far" }),
    job("veto", "2026-11-20", 97, { veto: true }), job("skipped", "2026-11-20", 96, { status: "skipped" }),
    job("applied", "2026-11-20", 94),
  ];
  const applications = [{ source: "https://jobs.example.com/applied/?utm_source=x" }];

  test("the best of the last days, a job's date being a day, so 24 hours reach back into yesterday", () => {
    expect(titles(homeJobs(jobs, applications, { days: 1, count: 10, order: "score" }, score, now))).toEqual(["yesterday", "today"]);
    expect(titles(homeJobs(jobs, applications, { days: 3, count: 10, order: "score" }, score, now))).toEqual(["three", "yesterday", "today"]);
    expect(titles(homeJobs(jobs, applications, { days: 0, count: 10, order: "score" }, score, now))).toEqual(["old", "three", "yesterday", "today"]);
  });

  test("at most count of them, the newest first when asked, and how many fit in all", () => {
    const r = homeJobs(jobs, applications, { days: 7, count: 5, order: "new" }, score, now);
    expect(titles(r)).toEqual(["today", "yesterday", "three"]);
    const two = homeJobs(jobs, applications, { days: 0, count: 5, order: "score" }, score, now);
    expect(two.total).toBe(4);
    expect(homeJobs(jobs, applications, { days: 0, count: 5, order: "score" }, score, now).shown.length).toBe(4);
  });

  test("a place short enough for a square: no country, no district beside a city", () => {
    expect(placeShort("Tel Aviv District, Israel")).toBe("Tel Aviv");
    expect(placeShort("Yokneam Illit, North District, Israel")).toBe("Yokneam Illit");
    expect(placeShort("Ra'anana; Israel, Yokneam")).toBe("Ra'anana, Yokneam");
    expect(placeShort("Central Region, Israel, Lod")).toBe("Lod");
    expect(placeShort("חיפה")).toBe("חיפה");
    expect(placeShort("Israel")).toBe("Israel");
  });

  test("a missing or strange choice takes the default", () => {
    expect(homeJobsFrom(undefined)).toEqual(HOME_JOBS);
    expect(homeJobsFrom({ days: "1", count: 20, order: "new" })).toEqual({ days: 1, count: 20, order: "new" });
    expect(homeJobsFrom({ days: 2, count: 1000, order: "x" })).toEqual(HOME_JOBS);
  });
});
