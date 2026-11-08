import { describe, expect, test } from "bun:test";
import { employersToRead, INDUSTRY_IDS, portalOn, PORTALS, webPortals } from "./portals";
import { EMPTY_SETTINGS } from "./settings";

const picks = (over: Partial<{ industries: string[]; lowTech: boolean; off: string[] }> = {}) => ({
  industries: over.industries ?? [], lowTech: over.lowTech ?? true, portals: { off: over.off ?? [], mine: [] },
});

describe("the portals", () => {
  test("each has its own id, a known industry and a web address; each read one says where, each web one its site", () => {
    expect(new Set(PORTALS.map((p) => p.id)).size).toBe(PORTALS.length);
    for (const p of PORTALS) {
      expect(INDUSTRY_IDS).toContain(p.industry);
      expect(p.url).toMatch(/^https:\/\/[^\s]+$/);
      if (p.how === "read") expect(p.read).toBeTruthy();
      if (p.how === "web") expect(p.site).toMatch(/^[a-z0-9.-]+(\/[\w.\/-]+)?$/);
    }
  });

  test("an employer outside high-tech is read only while low-tech is on, and only in the industries chosen", () => {
    const clalit = PORTALS.find((p) => p.id === "clalit")!;
    const rafael = PORTALS.find((p) => p.id === "rafael")!;
    expect(portalOn(clalit, picks())).toBe(true);
    expect(portalOn(clalit, picks({ lowTech: false }))).toBe(false);
    expect(portalOn(rafael, picks({ lowTech: false }))).toBe(true);
    expect(portalOn(clalit, picks({ industries: ["insurance"] }))).toBe(false);
    expect(portalOn(clalit, picks({ off: ["clalit"] }))).toBe(false);
    // A board isn't an employer, so the industries leave it alone.
    expect(portalOn(PORTALS.find((p) => p.id === "alljobs")!, picks({ industries: ["insurance"] }))).toBe(true);
    // Where it's read doesn't change what an employer is: on Comeet, a bank is still outside high-tech and DRS RADA
    // still defense; on AllJobs, a software house is still high-tech.
    const on = (id: string) => portalOn(PORTALS.find((p) => p.id === id)!, picks({ lowTech: false }));
    expect([on("discount"), on("drs-rada"), on("malam-team")]).toEqual([false, true, true]);
  });

  test("what gets read and what the agent searches follow the settings", () => {
    const all = employersToRead(picks());
    expect(all.length).toBeGreaterThan(80);
    const highTech = employersToRead(picks({ lowTech: false }));
    expect(highTech.every((p) => p.industry === "defense" || p.industry === "hightech")).toBe(true);
    expect(highTech.map((p) => p.id)).toContain("matrix");
    expect(employersToRead(picks({ industries: ["health"] })).every((p) => p.industry === "health")).toBe(true);
    expect(webPortals(picks()).map((p) => p.site)).toContain("hiremetech.com");
    expect(webPortals(picks({ off: ["hireme"] })).map((p) => p.id)).not.toContain("hireme");
    // The recruiting platforms are searched like the job sites, and the page opens the same search for Israel.
    const platforms = webPortals(picks({ industries: ["health"] })).filter((p) => p.kind === "platform");
    expect(platforms.map((p) => p.site)).toEqual(["comeet.com/jobs", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com", "apply.workable.com", "myworkdayjobs.com", "careers.hibob.com"]);
    expect(platforms[0].url).toBe("https://www.google.com/search?q=site%3Acomeet.com%2Fjobs%20Israel");
  });

  test("new settings start with employers outside high-tech on", () => {
    expect(EMPTY_SETTINGS.lowTech).toBe(true);
    expect(employersToRead(EMPTY_SETTINGS).length).toBe(employersToRead(picks()).length);
  });
});
