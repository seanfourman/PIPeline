import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildInterface } from "./build";
import { DICTS, translate } from "./ui/i18n";

const paths = (value: unknown, prefix = ""): string[] =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, v]) => paths(v, prefix ? `${prefix}.${key}` : key))
    : [`${prefix}:${Array.isArray(value) ? `list${value.length}` : typeof value}`];

describe("the two languages", () => {
  test("have the same keys, and the same kind of value under each", () => {
    expect(paths(DICTS.en)).toEqual(paths(DICTS.he));
  });

  test("fill in values, and keep the same placeholders", () => {
    expect(translate("en", "home.hi", { name: "Dana" })).toBe("Hi Dana, I'm Pip.");
    expect(translate("he", "home.hi", { name: "דנה" })).toBe("היי דנה, אני פיפ.");
    const holes = (s: unknown) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of paths(DICTS.he).filter((p) => p.endsWith(":string")).map((p) => p.split(":")[0])) {
      expect(holes(translate("en", key))).toEqual(holes(translate("he", key)));
    }
  });

  test("every error the server can send has words", () => {
    const sources = ["edit.ts", "server.ts"].map((f) => readFileSync(path.join(import.meta.dir, f), "utf8")).join("\n");
    const codes = [...sources.matchAll(/new EditError\("(\w+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(10);
    for (const code of codes) expect(translate("en", `errors.${code}`)).not.toBe(`errors.${code}`);
  });
});

describe("the interface", () => {
  test("builds, with nothing the page's security policy would block", async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "job-ui-"));
    const files = await buildInterface(out);
    const js = readFileSync(files.find((f) => f.endsWith(".js"))!, "utf8");
    expect(js.length).toBeGreaterThan(1000);
    expect(js).not.toMatch(/\beval\(|new Function\(/);
  });

  test("never puts text in as HTML, because postings and agent replies are untrusted", () => {
    const glob = new Bun.Glob("ui/**/*.tsx");
    for (const file of glob.scanSync(import.meta.dir)) {
      expect(readFileSync(path.join(import.meta.dir, file), "utf8")).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });
});
