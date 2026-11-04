import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyLocation, documentPaths, matchesQuery, parseCsv, portalArgs, readAts, resolveDocument } from "./data";
import { REGION_PRESETS, type Area, type Tier } from "./settings";

const israel = (tiers: Tier[]): Area[] => REGION_PRESETS.IL.map((a, i) => ({ ...a, tier: tiers[i] }));

describe("readAts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ats-"));
  mkdirSync(path.join(root, "documents", "applications", "acme_dev"), { recursive: true });
  writeFileSync(path.join(root, "documents", "applications", "acme_dev", "ats.json"), JSON.stringify({ score: 82, missing: ["Agile"], problems: [] }));

  test("finds the score through the tracker's CV file", () => {
    expect(readAts("cv/main_acme_dev.tex", root)).toEqual({ score: 82, missing: ["Agile"], problems: [] });
    expect(readAts("cv\\main_acme_dev.tex", root)?.score).toBe(82);
  });

  test("shows nothing when there is no score, or the path is not a CV", () => {
    expect(readAts("cv/main_other.tex", root)).toBeNull();
    expect(readAts("cv/main_../../secret.tex", root)).toBeNull();
    expect(readAts("", root)).toBeNull();
  });
});

describe("classifyLocation", () => {
  const areas = israel(["near", "ok", "ok", "edge", "far", "far"]);
  const tier = (location: string) => classifyLocation(location, areas);

  test("sorts Israeli locations with the ready-made areas", () => {
    expect(tier("Netanya, Center District, Israel")).toBe("near");
    expect(tier("Ramat Hasharon")).toBe("near");
    expect(tier("Ra'anana, Ha'sharon")).toBe("near");
    expect(tier("Tel Aviv-Yafo, Tel Aviv District")).toBe("ok");
    expect(tier("Haifa, Haifa District, Israel")).toBe("ok");
    expect(tier("Beit Shean, North District")).toBe("ok");
    expect(tier("Modi'in-Maccabim-Re'ut")).toBe("edge");
    expect(tier("Jerusalem District, Israel")).toBe("far");
    expect(tier("Be'er Sheva, South District")).toBe("far");
    expect(tier("Kiryat Gat")).toBe("far");
    expect(tier("Kiryat Bialik, Haifa District")).toBe("ok");
    expect(tier("Israel")).toBe("unknown");
    expect(tier("")).toBe("unknown");
  });

  test("follows the user's choice when the tiers change", () => {
    const flipped = israel(["far", "far", "far", "far", "near", "ok"]);
    expect(classifyLocation("Jerusalem", flipped)).toBe("near");
    expect(classifyLocation("Kiryat Gat", flipped)).toBe("ok");
    expect(classifyLocation("Tel Aviv", flipped)).toBe("far");
  });

  test("works for any country, with places the user typed", () => {
    const germany: Area[] = [
      { name: "Berlin", places: ["berlin"], tier: "near" },
      { name: "Bavaria", places: ["bavaria"], tier: "far" },
    ];
    expect(classifyLocation("Berlin, Berlin, Germany", germany)).toBe("near");
    expect(classifyLocation("Munich, Bavaria, Germany", germany)).toBe("far");
    expect(classifyLocation("Hamburg, Germany", germany)).toBe("unknown");
    expect(classifyLocation("Anywhere", [])).toBe("unknown");
  });

  test("matches from the start of a word, and handles special characters", () => {
    const areas: Area[] = [{ name: "Lod", places: ["lod"], tier: "ok" }, { name: "St", places: ["st. louis (mo)"], tier: "near" }];
    expect(classifyLocation("Melody Hills", areas)).toBe("unknown");
    expect(classifyLocation("Lod, Israel", areas)).toBe("ok");
    expect(classifyLocation("St. Louis (MO), USA", areas)).toBe("near");
  });
});

describe("portalArgs", () => {
  const germany = { code: "DE", country: "Germany", city: "", label: "Germany" };
  const base = { days: "7", market: germany, workMode: "any", seniority: "any" } as const;

  test("searches the chosen country", () => {
    expect(portalArgs("linkedin", "QA", base)).toContain("Germany");
    const free = portalArgs("freehire", "QA", base);
    expect(free[free.indexOf("--country") + 1]).toBe("DE");
    expect(free).not.toContain("--remote");
    expect(free).not.toContain("--seniority");
  });

  test("passes the city, work mode and seniority", () => {
    const options = { ...base, market: { ...germany, city: "Berlin" }, workMode: "hybrid", seniority: "junior" } as const;
    const linkedin = portalArgs("linkedin", "QA", options);
    expect(linkedin[linkedin.indexOf("--location") + 1]).toBe("Berlin, Germany");
    expect(linkedin[linkedin.indexOf("--remote") + 1]).toBe("hybrid");
    const free = portalArgs("freehire", "QA", options);
    expect(free[free.indexOf("--city") + 1]).toBe("Berlin");
    expect(free[free.indexOf("--seniority") + 1]).toBe("junior");
  });

  test("remote from anywhere has no country", () => {
    const options = { ...base, market: { code: "REMOTE", country: "", city: "", label: "" } };
    const linkedin = portalArgs("linkedin", "QA", options);
    expect(linkedin[linkedin.indexOf("--location") + 1]).toBe("Remote");
    expect(linkedin[linkedin.indexOf("--remote") + 1]).toBe("remote");
    expect(portalArgs("freehire", "QA", options)).not.toContain("--country");
  });
});

describe("matchesQuery", () => {
  test("drops titles that share only generic words", () => {
    expect(matchesQuery("Junior Treasury Assistant", "Junior QA Engineer")).toBe(false);
    expect(matchesQuery("Junior Advertising Manager", "Junior QA Engineer")).toBe(false);
  });
  test("keeps real matches, in any language", () => {
    expect(matchesQuery("בודק.ת QA", "Junior QA Engineer")).toBe(true);
    expect(matchesQuery("Graduate Full Stack Software Engineer", "Graduate Software Engineer")).toBe(true);
  });
  test("keeps everything for a generic query", () => {
    expect(matchesQuery("Anything", "Junior Engineer")).toBe(true);
  });
});

describe("parseCsv", () => {
  test("handles quotes, commas, newlines and a BOM", () => {
    const rows = parseCsv('﻿company,notes\r\n"Demo, Inc","said ""hi""\nthen left"\r\nAcme,\r\n');
    expect(rows).toEqual([
      { company: "Demo, Inc", notes: 'said "hi"\nthen left' },
      { company: "Acme", notes: "" },
    ]);
  });
});

describe("resolveDocument", () => {
  test("refuses anything outside the output folders", () => {
    for (const bad of [
      ".claude/settings.json", "documents/cv/resume.pdf", "cv/../documents/cv/a.pdf", "cv/sub/a.pdf", "cv/a.tex", "../secret.pdf", "web/data/token",
      "documents/applications/../../secret.pdf", "documents/applications/a/b/c.pdf", "documents/applications/a/notes.md", "documents/postings/a/p.pdf",
    ]) {
      expect(resolveDocument(bad)).toBeNull();
    }
  });
});

describe("documentPaths", () => {
  test("finds the documents a command or a message names, from the project", () => {
    expect(documentPaths('mkdir -p documents/applications/acme_dev && cp cv/main_acme_dev.pdf "documents/applications/acme_dev/Sean Fourman - Resume.pdf"'))
      .toEqual(["cv/main_acme_dev.pdf", "documents/applications/acme_dev/Sean Fourman - Resume.pdf"]);
    expect(documentPaths("Saved C:\\Users\\Sean-PC\\Desktop\\bismillah\\ai-job-search\\cv\\main_acme_dev.tex and `cover_letters/acme.pdf`."))
      .toEqual(["cv/main_acme_dev.tex", "cover_letters/acme.pdf"]);
    expect(documentPaths("nothing here, not even CV_RULES.md")).toEqual([]);
  });
});
