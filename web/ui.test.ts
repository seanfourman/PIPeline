import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildInterface } from "./build";
import { DICTS, translate } from "./ui/i18n";
import { tabIcon } from "./icon";
import { foxPixels, ICON, ICON_COLORS, Pip } from "./ui/pip";

const paths = (value: unknown, prefix = ""): string[] =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, v]) => paths(v, prefix ? `${prefix}.${key}` : key))
    : [`${prefix}:${Array.isArray(value) ? `list${value.length}` : typeof value}`];

// The keys an object in this source names twice, as "line: key". Strings and comments are skipped and braces
// counted; a key is a name, or a quoted one, followed by a colon right after "{" or ",".
function duplicateKeys(src: string) {
  const found: string[] = [];
  const objects: Set<string>[] = [];
  let line = 1;
  let keyNext = false;
  const add = (key: string) => {
    const keys = objects[objects.length - 1];
    if (!keys) return;
    if (keys.has(key)) found.push(`${line}: ${key}`);
    keys.add(key);
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\n") { line++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; i--; continue; }
    if (c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); line += src.slice(i, end).split("\n").length - 1; i = end + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let text = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") { text += src[j + 1]; j += 2; continue; }
        if (src[j] === "\n") line++;
        text += src[j];
        j++;
      }
      if (keyNext && c !== "`" && /^\s*:/.test(src.slice(j + 1, j + 40))) add(text);
      i = j;
      keyNext = false;
      continue;
    }
    if (c === "{") { objects.push(new Set()); keyNext = true; continue; }
    if (c === "}") { objects.pop(); keyNext = false; continue; }
    if (c === ",") { keyNext = true; continue; }
    if (/\s/.test(c)) continue;
    if (keyNext && /[A-Za-z_$]/.test(c)) {
      const m = src.slice(i, i + 80).match(/^([A-Za-z_$][\w$]*)\s*:(?!:)/);
      if (m) { add(m[1]); i += m[0].length - 1; }
    }
    keyNext = false;
  }
  return found;
}

describe("the two languages", () => {
  test("have the same keys, and the same kind of value under each", () => {
    expect(paths(DICTS.en)).toEqual(paths(DICTS.he));
  });

  // A name twice in one object keeps only the last, without a word: the remote market's label once lost to the
  // phone access section of the same name, in both languages alike, and showing it broke the page.
  test("never name the same key twice in one object", () => {
    expect(duplicateKeys(readFileSync(path.join(import.meta.dir, "ui", "i18n.ts"), "utf8"))).toEqual([]);
    expect(duplicateKeys('const a = { x: "1", y: { x: 2 }, "x": 3 };')).toEqual(["1: x"]);
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

  // What Pip says from behind the sidebar breaks only where its words do (\n), each line short enough for one line of
  // his bubble, a long company name too, so no sentence is cut in the middle and its end carried over.
  test("give Pip's status lines lines short enough for his bubble", () => {
    const groups = translate("he", "pip.status") as Record<string, string[]>;
    expect(Object.keys(groups).length).toBeGreaterThan(5);
    for (const [key, lines] of Object.entries(groups)) {
      expect(lines.length).toBeGreaterThan(1);
      lines.forEach((_, i) => {
        const said = translate("he", `pip.status.${key}.${i}`, { company: "Company1" }) as string;
        for (const line of said.split("\n")) expect(line.length).toBeLessThanOrEqual(32);
      });
    }
  });

  // Voice typing's notes are Pip's too (ui/voice.tsx says them from his peek), in both languages.
  test("give Pip's voice typing notes lines short enough for his bubble", () => {
    for (const lang of ["he", "en"] as const) {
      for (const key of ["unsupported", "micDenied", "noMic", "network", "langUnsupported", "failed"]) {
        const said = translate(lang, `voice.${key}`, { detail: "not-allowed" }) as string;
        expect(said).not.toBe(`voice.${key}`);
        for (const line of said.split("\n")) expect(line.length).toBeLessThanOrEqual(32);
      }
    }
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

  test("shows the same Pip on the loading screen as in the app", () => {
    const html = readFileSync(path.join(import.meta.dir, "public", "index.html"), "utf8");
    expect(html).toContain(renderToStaticMarkup(createElement(Pip, { mood: "happy", className: "boot-pip" })));
  });

  test("has the fox the page shows as its icon, in the tab too", () => {
    // Every pixel of the fox as the page shows him (a later one drawn over an earlier) in the colour of its block in
    // the icon, so no detail of his falls between blocks.
    const shown = new Map(foxPixels("front").map(([x, y, color]) => [`${x},${y}`, color]));
    const at = [...shown.keys()].map((key) => key.split(",").map(Number));
    const left = Math.min(...at.map(([x]) => x));
    const top = Math.min(...at.map(([, y]) => y));
    for (const [x, y] of at) expect(ICON_COLORS[ICON[(y - top) >> 1][(x - left) >> 1]]).toBe(shown.get(`${x},${y}`));
    expect(readFileSync(path.join(import.meta.dir, "public", "icon.ico")).equals(tabIcon())).toBe(true);
  });

  test("takes the stylesheet's images from the site's own files, which the page's security policy allows", () => {
    const css = readFileSync(path.join(import.meta.dir, "public", "styles.css"), "utf8");
    expect(css).not.toMatch(/url\(\s*["']?data:/);
    for (const [, file] of css.matchAll(/url\(\s*["']?\/([\w.-]+)["']?\s*\)/g)) expect(existsSync(path.join(import.meta.dir, "public", file))).toBe(true);
  });

  test("never puts text in as HTML, because postings and agent replies are untrusted", () => {
    const glob = new Bun.Glob("ui/**/*.tsx");
    for (const file of glob.scanSync(import.meta.dir)) {
      expect(readFileSync(path.join(import.meta.dir, file), "utf8")).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });
});
