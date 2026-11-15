import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Fetch } from "./boards";
import { boardOf, discoverEmployers, foundPortals, learnFromLinks, readFound } from "./discover";

const today = "2026-11-08";
const temp = () => mkdtempSync(path.join(os.tmpdir(), "discover-"));

describe("the list that grows by itself", () => {
  test("a job's link names its board, on each platform Pip reads", () => {
    expect(boardOf("https://www.comeet.com/jobs/morphisec/65.00C/junior-backendfull-stack-engineer/A5.B24")).toEqual({ comeet: "morphisec/65.00C" });
    expect(boardOf("https://job-boards.greenhouse.io/asteralabs/jobs/4640055005")).toEqual({ greenhouse: "asteralabs" });
    expect(boardOf("https://boards.greenhouse.io/acme/jobs/1")).toEqual({ greenhouse: "acme" });
    expect(boardOf("https://jobs.lever.co/traildsoftware/5dcaa6dd-47eb-4da2-b4f2-fadb1bd5af68")).toEqual({ lever: "traildsoftware" });
    expect(boardOf("https://jobs.ashbyhq.com/Snappy/f93cad08-184e-48f5-919d-858223056a7a")).toEqual({ ashby: "Snappy" });
    expect(boardOf("https://apply.workable.com/humanz/j/9BF20B35DE")).toEqual({ workable: "humanz" });
    // A board's own page, Workable's link with no account, Greenhouse's European boards, another site: none.
    for (const link of ["https://jobs.lever.co/walkme?location=Tel+Aviv", "https://apply.workable.com/j/6E14365724", "https://job-boards.eu.greenhouse.io/x/jobs/1",
      "https://boards.greenhouse.io/embed/job_app?for=x", "https://www.linkedin.com/jobs/view/1", "not a link"]) expect(boardOf(link)).toBeNull();
  });

  test("a new board with a job in Israel joins the list once, under its name; one without waits a month", async () => {
    const dir = temp();
    const seen = path.join(dir, "seen_jobs.json");
    const file = path.join(dir, "found-employers.json");
    writeFileSync(seen, JSON.stringify({ seen: {
      a: { url: "https://job-boards.greenhouse.io/acme/jobs/11", first_seen: "2026-11-07" },
      b: { url: "https://job-boards.greenhouse.io/ACME/jobs/12", first_seen: "2026-11-06" },
      c: { url: "https://www.comeet.com/jobs/faraway/12.345/engineer/AB.CDE", first_seen: "2026-11-05" },
      // Wiz is on the list already.
      d: { url: "https://job-boards.greenhouse.io/wizinc/jobs/13", first_seen: "2026-11-04" },
    } }));
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      if (url === "https://boards-api.greenhouse.io/v1/boards/acme/jobs") return JSON.stringify({ jobs: [{ id: 1, title: "Data Analyst", location: { name: "Tel Aviv, Israel" } }] });
      if (url === "https://boards-api.greenhouse.io/v1/boards/acme") return JSON.stringify({ name: "Acme Labs" });
      if (url === "https://www.comeet.com/jobs/faraway/12.345") return `<title>Jobs at Faraway - Careers - Comeet</title><script>COMPANY_POSITIONS_DATA = [{"name":"Engineer","location":{"country":"US","city":"Austin"},"url_comeet_hosted_page":"https://www.comeet.com/jobs/faraway/12.345/engineer/AB.CDE"}];</script>`;
      return null;
    };
    const found = await discoverEmployers({ fetch, today, seen, file });
    expect(found.map((f) => [f.id, f.name, f.url, f.israel])).toEqual([["found-greenhouse-acme", "Acme Labs", "https://job-boards.greenhouse.io/acme", 1]]);
    expect(asked).not.toContain("https://boards-api.greenhouse.io/v1/boards/wizinc/jobs");
    expect(Object.keys(readFound(file).tried).sort()).toEqual(["comeet:faraway/12.345", "greenhouse:acme"]);
    expect(foundPortals(readFound(file))).toEqual([{ id: "found-greenhouse-acme", kind: "employer", how: "read", he: "Acme Labs", en: "Acme Labs", industry: "hightech", read: { greenhouse: "acme" }, url: "https://job-boards.greenhouse.io/acme" }]);

    // The same day again: nothing new to read. A month on, the one without a job in Israel is read again.
    asked.length = 0;
    expect(await discoverEmployers({ fetch, today, seen, file })).toEqual([]);
    expect(asked).toEqual([]);
    await discoverEmployers({ fetch, today: "2026-12-09", seen, file });
    expect(asked).toEqual(["https://www.comeet.com/jobs/faraway/12.345"]);
    expect(JSON.parse(readFileSync(file, "utf8")).found).toHaveLength(1);
  });

  // As Comeet's board pages are since it became Spark Hire Recruit: the title is the platform's, the name in the data.
  const DEALHUB = `<title>Spark Hire Recruit Jobs | Spark Hire Recruit - Collaborative Recruiting</title><meta property="og:title" content="Job opportunities at DealHub" />`
    + `<script>COMPANY_DATA = {"company_name": "DealHub"}; COMPANY_POSITIONS_DATA = [{"name":"PMO","location":{"country":"IL","city":"Tel Aviv"},"url_comeet_hosted_page":"https://www.comeet.com/jobs/dealhub/86.005/pmo/7A.47C"}];</script>`;

  test("a company kept under its board's address gets its name in the next check, once a day at most", async () => {
    const dir = temp();
    const file = path.join(dir, "found-employers.json");
    const seen = path.join(dir, "seen_jobs.json");
    writeFileSync(seen, JSON.stringify({ seen: {} }));
    const read = { comeet: "dealhub/86.005" };
    writeFileSync(file, JSON.stringify({ found: [{ id: "found-comeet-dealhub-86-005", name: "dealhub/86.005", read, url: "https://www.comeet.com/jobs/dealhub/86.005", added: "2026-11-01", israel: 3 }], tried: {} }));
    let asked = 0;
    const fetch: Fetch = async (url) => { asked++; return url === "https://www.comeet.com/jobs/dealhub/86.005" ? DEALHUB.replace(/<script>COMPANY_DATA[^;]*;/, "<script>") : null; };
    expect(await discoverEmployers({ fetch, today, seen, file })).toEqual([]);
    expect(readFound(file).found.map((f) => f.name)).toEqual(["DealHub"]);
    // Named now: not read again.
    asked = 0;
    await discoverEmployers({ fetch, today: "2026-11-09", seen, file });
    expect(asked).toBe(0);
  });

  test("a job's link sent in the chat adds its company at once, even one a check tried this month", async () => {
    const file = path.join(temp(), "found-employers.json");
    writeFileSync(file, JSON.stringify({ found: [], tried: { "comeet:dealhub/86.005": "2026-11-01" } }));
    const asked: string[] = [];
    const fetch: Fetch = async (url) => { asked.push(url); return url === "https://www.comeet.com/jobs/dealhub/86.005" ? DEALHUB : null; };
    const found = await learnFromLinks("מה דעתך? https://www.comeet.com/jobs/dealhub/86.005/pmo/7A.47C.", { fetch, today, file });
    expect(found.map((f) => [f.id, f.name, f.url, f.israel])).toEqual([["found-comeet-dealhub-86-005", "DealHub", "https://www.comeet.com/jobs/dealhub/86.005", 1]]);
    expect(readFound(file).tried["comeet:dealhub/86.005"]).toBe(today);

    // Sent again, or a link to a company on the list or to another site: nothing read.
    asked.length = 0;
    expect(await learnFromLinks("/apply https://www.comeet.com/jobs/dealhub/86.005/other/7A.48D", { fetch, today, file })).toEqual([]);
    expect(await learnFromLinks("https://job-boards.greenhouse.io/wizinc/jobs/13 https://www.linkedin.com/jobs/view/1", { fetch, today, file })).toEqual([]);
    expect(asked).toEqual([]);
  });

  test("a company one reader adds survives the other writing what it read at the same time", async () => {
    const dir = temp();
    const seen = path.join(dir, "seen_jobs.json");
    const file = path.join(dir, "found-employers.json");
    writeFileSync(seen, JSON.stringify({ seen: { a: { url: "https://job-boards.greenhouse.io/acme/jobs/11", first_seen: "2026-11-07" } } }));
    let release = () => {};
    const held = new Promise<void>((r) => { release = r; });
    const fetch: Fetch = async (url) => {
      if (url.startsWith("https://boards-api.greenhouse.io/v1/boards/acme")) {
        await held;
        return url.endsWith("/jobs") ? JSON.stringify({ jobs: [{ id: 1, title: "Data Analyst", location: { name: "Tel Aviv, Israel" } }] }) : JSON.stringify({ name: "Acme Labs" });
      }
      return url === "https://www.comeet.com/jobs/dealhub/86.005" ? DEALHUB : null;
    };
    const check = discoverEmployers({ fetch, today, seen, file });
    await learnFromLinks("https://www.comeet.com/jobs/dealhub/86.005/pmo/7A.47C", { fetch, today, file });
    release();
    await check;
    expect(readFound(file).found.map((f) => f.name).sort()).toEqual(["Acme Labs", "DealHub"]);
  });
});
