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
import { commandWords, friendlyTitle } from "./ui/app";
import { langDir, Markdown } from "./ui/kit";

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

  // The tab's title is the page's name (app.tsx), so a page an address can open with no name showed its key instead.
  test("name every page an address can open, for the tab's title", () => {
    const src = readFileSync(path.join(import.meta.dir, "ui", "app.tsx"), "utf8");
    const nav = [...(src.match(/const NAV\b[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/\["(\w+)",/g)].map((m) => m[1]);
    const more = [...(src.match(/const PAGES = .*/)?.[0] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(nav.length).toBeGreaterThan(5);
    expect(more).toContain("job");
    for (const page of [...nav, ...more]) {
      const key = `nav.${page === "dash" ? "home" : page}`;
      for (const lang of ["he", "en"] as const) expect(translate(lang, key)).not.toBe(key);
    }
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

describe("Pip's answers", () => {
  test("a list keeps one side, its items' most common language, and an item in the other is set apart in its own", () => {
    expect(langDir("מהנדס פול סטאק, Wix Code")).toBe("rtl");
    expect(langDir("KickstartX 2026")).toBe("ltr");
    expect(langDir("[המשרות של Wix](https://www.wix.com/jobs/locations/tel-aviv)")).toBe("rtl");
    expect(langDir("2026")).toBeUndefined();
    const html = renderToStaticMarkup(createElement(Markdown, { src: "מקורות:\n- המשרות הפתוחות של וויקס\n- מהנדס פול סטאק, Wix Code\n- KickstartX 2026" }));
    expect(html).toContain('<ul dir="rtl">');
    expect(html).toContain("<li>מהנדס פול סטאק, Wix Code</li>");
    expect(html).toContain('<li><bdi dir="ltr">KickstartX 2026</bdi></li>');
    const english = renderToStaticMarkup(createElement(Markdown, { src: "- FastAPI\n- PostgreSQL\n- פייתון" }));
    expect(english).toContain('<ul dir="ltr">');
    expect(english).toContain('<li><bdi dir="rtl">פייתון</bdi></li>');
  });

  test("a Hebrew answer keeps a list of sources that start with links on the right", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { dir: "rtl", src: "- [acme.com/careers](https://acme.com/careers): דף המשרות\n- Python, FastAPI\n\nDiorama היא הצנרת." }));
    expect(html).toContain('<ul dir="rtl">');
    expect(html).toContain("</a>: דף המשרות</li>");
    expect(html).toContain('<li><bdi dir="ltr">Python, FastAPI</bdi></li>');
    expect(html).toContain('<p dir="rtl">Diorama');
  });

  test("a message that is a command shows as the command's name, without its options", () => {
    const t = (key: string, vars?: Record<string, string | number>) => translate("he", key, vars);
    expect(commandWords("/setup --from-documents", t)).toBe("עדכון הפרופיל");
    expect(commandWords("/apply https://acme.com/jobs/1", t)).toBe("הגשה למשרה: https://acme.com/jobs/1");
    expect(commandWords("שלום", t)).toBeNull();
    expect(commandWords("/nothing-like-it x", t)).toBeNull();
    expect(friendlyTitle("/setup --section search", t)).toBe("עדכון הפרופיל: search");
  });

  test("draws what the chat's answers write that it once showed as typed", () => {
    const md = (src: string, chat = true) => renderToStaticMarkup(createElement(Markdown, { src, dir: "rtl", chat })).replaceAll(' target="_blank" rel="noopener noreferrer"', "");
    // A sub-list under its item, and a numbered list that goes on after a heading from its own number.
    expect(md("- עבודה:\n  - בדיקות\n  - ענן\n- פרויקטים")).toContain("<li>עבודה:<ul><li>בדיקות</li><li>ענן</li></ul></li><li>פרויקטים</li>");
    expect(md("**טובה**\n\n1. א\n\n**בינונית**\n\n2. ב")).toContain('<ol dir="rtl" start="2"><li>ב</li></ol>');
    // Boxes as marks, five hashes as a heading.
    expect(md("- [x] אתר\n- [ ] לינקדאין")).toContain('<span class="md-box done"');
    expect(md("- [x] אתר\n- [ ] לינקדאין")).not.toContain("[x]");
    expect(md("##### כותרת")).toBe('<div class="md" dir="rtl"><h4 dir="rtl">כותרת</h4></div>');
    // A file here: a document opens by its name, anything else is its label or its name, never its path.
    expect(md("[ההוראות](C:/Users/x/.claude/skills/a/SKILL.md)")).toContain("<span>ההוראות</span>");
    expect(md("`user/documents/applications/acme_dev/Dana Levi - Resume.pdf`")).toContain('<a class="md-file" href="/file?path=user%2Fdocuments%2Fapplications%2Facme_dev%2FDana%20Levi%20-%20Resume.pdf" dir="auto">Dana Levi - Resume.pdf</a>');
    expect(md("`user/company_research/acme.json`")).toContain('<code dir="ltr">acme.json</code>');
    expect(md("`python tools/x.py a`")).toContain('<code dir="ltr">python tools/x.py a</code>');
    // No maqaf and no dash between words in a chat answer; elsewhere, the text as it is.
    expect(md("ב\u05BEBIScience \u2014 וזהו, 1\u20132")).toContain("ב BIScience, וזהו, 1\u20132");
    expect(md("`user/cv/a.pdf` \u2014 x", false)).toContain("user/cv/a.pdf</code> \u2014 x");
  });
});
