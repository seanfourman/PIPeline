import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cardLine, classifyLocation, documentPaths, matchesQuery, parseCsv, portalArgs, readAts, readCard, resolveDocument } from "./data";
import { REGION_PRESETS, type Area, type Tier } from "./settings";

const israel = (tiers: Tier[]): Area[] => REGION_PRESETS.IL.map((a, i) => ({ ...a, tier: tiers[i] }));

describe("readAts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ats-"));
  mkdirSync(path.join(root, "user", "documents", "applications", "acme_dev"), { recursive: true });
  writeFileSync(path.join(root, "user", "documents", "applications", "acme_dev", "ats.json"), JSON.stringify({ score: 82, missing: ["Agile"], problems: [] }));

  test("finds the score through the tracker's CV file", () => {
    expect(readAts("user/cv/main_acme_dev.tex", root)).toEqual({ score: 82, missing: ["Agile"], problems: [] });
    expect(readAts("user\\cv\\main_acme_dev.tex", root)?.score).toBe(82);
    // A row an older version wrote names the CV without the user's folder.
    expect(readAts("cv/main_acme_dev.tex", root)?.score).toBe(82);
  });

  test("shows nothing when there is no score, or the path is not a CV", () => {
    expect(readAts("user/cv/main_other.tex", root)).toBeNull();
    expect(readAts("user/cv/main_../../secret.tex", root)).toBeNull();
    expect(readAts("", root)).toBeNull();
  });
});

describe("readCard", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "card-"));
  const folder = path.join(root, "user", "documents", "applications", "acme_dev");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "scorecard.json"), JSON.stringify({ overall: 83, lenses: [
    { id: "google", score: 80, checks: [{ id: "measured", ok: false, value: 40 }, { id: "title", ok: true }, { ok: false }] },
    { id: "workday", score: 85, grade: "A", checks: [], missing: ["Tableau"] },
    { id: "ats", score: null, checks: [] },
    { id: 7, score: 1 },
  ] }));

  test("reads the scorecard beside the CV, keeping only what is well formed", () => {
    const card = readCard("user/cv/main_acme_dev.tex", root)!;
    expect(card.overall).toBe(83);
    expect(card.lenses.map((l) => l.id)).toEqual(["google", "workday", "ats"]);
    expect(card.lenses[0].checks).toEqual([{ id: "measured", ok: false, value: 40 }, { id: "title", ok: true }]);
    expect(card.lenses[1]).toMatchObject({ grade: "A", missing: ["Tableau"] });
    expect(readCard("user/cv/main_other.tex", root)).toBeNull();
  });

  test("one line for the report and the email, in the user's language, without the lenses that couldn't score", () => {
    const card = readCard("user/cv/main_acme_dev.tex", root)!;
    expect(cardLine(card, "en")).toBe("Google 80, Workday A (85), Overall 83");
    expect(cardLine(card, "he")).toBe("Google 80, Workday A (85), כללי 83");
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

  test("sorts the Israeli boards' Hebrew places with the same areas", () => {
    expect(tier("נתניה")).toBe("near");
    expect(tier("פתח תקוה")).toBe("ok");
    expect(tier("תל אביב יפו, רמת גן")).toBe("ok");
    expect(tier("קריית גת")).toBe("far");
    expect(tier("ללא מיקום")).toBe("unknown");
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
      ".claude/settings.json", "user/documents/cv/resume.pdf", "user/cv/../documents/cv/a.pdf", "user/cv/sub/a.pdf", "user/cv/a.tex", "../secret.pdf",
      "user/app/token", "user/profile.json", "user/../cv/a.pdf",
      "user/documents/applications/../../secret.pdf", "user/documents/applications/a/b/c.pdf", "user/documents/applications/a/notes.md", "user/documents/postings/a/p.pdf",
      // Where an older version kept them: those files are in user/ now.
      "cv/main_a.pdf", "documents/applications/a/Resume.pdf",
    ]) {
      expect(resolveDocument(bad)).toBeNull();
    }
  });
});

describe("documentPaths", () => {
  test("finds the documents a command or a message names, from the project", () => {
    expect(documentPaths('mkdir -p user/documents/applications/acme_dev && cp user/cv/main_acme_dev.pdf "user/documents/applications/acme_dev/Dana Cohen - Resume.pdf"'))
      .toEqual(["user/cv/main_acme_dev.pdf", "user/documents/applications/acme_dev/Dana Cohen - Resume.pdf"]);
    expect(documentPaths("Saved C:\\Users\\someone\\Desktop\\bismillah\\ai-job-search\\user\\cv\\main_acme_dev.tex and `user/cover_letters/acme.pdf`."))
      .toEqual(["user/cv/main_acme_dev.tex", "user/cover_letters/acme.pdf"]);
    // An older conversation named its files without the user's folder; they are the same files there now.
    expect(documentPaths("Saved `cv/main_acme_dev.pdf` and documents/applications/acme_dev/Resume.pdf"))
      .toEqual(["user/cv/main_acme_dev.pdf", "user/documents/applications/acme_dev/Resume.pdf"]);
    expect(documentPaths("nothing here, not even CV_RULES.md")).toEqual([]);
  });
});
