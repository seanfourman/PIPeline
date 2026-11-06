// The user's own folder, user/ at the project's root: everything that belongs to one person (profile, rules, CVs,
// letters, applications, job list, tracker, research, reports, and this interface's conversations and settings),
// never committed, so nothing personal is written into the code. The introduction fills it in for a new user.
// These are the few facts about the user the server itself needs.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ENGLISH_NAME } from "./names";
import { REPO } from "./policy";

export const USER_DIR = path.join(REPO, "user");
// This interface's own data: conversations, uploads, settings, the daily run's state and the access token.
export const APP_DIR = path.join(USER_DIR, "app");
const STARTING = path.join(REPO, "templates", "user");

// Where an older version kept the user's files, and the folder in user/ each goes to. A filter picks the user's
// files out of a folder the project ships files in too.
const OLD_PLACES: { from: string; to: string; only?: RegExp }[] = [
  { from: "web/data", to: "app" },
  { from: "cv", to: "cv", only: /^(main_[^/]+|[^/]+\.txt)$/ },
  { from: "cover_letters", to: "cover_letters", only: /^[Cc]over_(?!example\.tex$)[^/]+$/ },
  { from: "documents", to: "documents", only: /^(?!README\.md$)(.+\/)?(?!\.gitkeep$)[^/]+$/ },
  { from: "job_search_tracker.csv", to: "job_search_tracker.csv" },
  { from: "job_scraper", to: "job_scraper", only: /^(?!\.gitkeep$)[^/]+$/ },
  { from: ".claude/skills/job-scraper/job_scraper", to: "job_scraper" },
  { from: "company_research", to: "company_research", only: /^(?!\.gitkeep$)[^/]+$/ },
  { from: "reports", to: "reports" },
  { from: "upskill", to: "upskill", only: /^(?!\.gitkeep$)[^/]+\.md$/ },
  { from: ".claude/skills/upskill/upskill", to: "upskill", only: /^report-[^/]+\.md$/ },
  { from: "gmail_sync", to: "gmail_sync" },
];

// A CV or letter source moved into user/ loads the template two folders up, as the starting files do.
function pointAtTemplate(file: string) {
  if (!file.endsWith(".tex")) return;
  const text = readFileSync(file, "utf8");
  const next = text
    .replaceAll("\\usepackage{../templates/", "\\usepackage{../../templates/")
    .replace(/\\documentclass(\[[^\]]*\])?\{cover\}/, "\\documentclass$1{../../cover_letters/cover}")
    .replaceAll("Path = OpenFonts/fonts/", "Path = \\coverfonts ");
  if (next !== text) writeFileSync(file, next);
}

// Moves the user's files from where an older version kept them into user/, once, before anything reads them. A file
// user/ already has is left where it is, never overwritten, and listed as kept. Folders left empty are removed.
export function moveToUserFolder(root = REPO) {
  const moved: string[] = [];
  const kept: string[] = [];
  const user = path.join(root, "user");
  const move = (from: string, to: string) => {
    const rel = path.relative(root, from).replaceAll("\\", "/");
    if (existsSync(to)) { kept.push(rel); return; }
    mkdirSync(path.dirname(to), { recursive: true });
    renameSync(from, to);
    pointAtTemplate(to);
    moved.push(rel);
  };
  const walk = (dir: string, base: string, place: (typeof OLD_PLACES)[number]) => {
    for (const name of readdirSync(dir)) {
      const from = path.join(dir, name);
      const rel = path.relative(base, from).replaceAll("\\", "/");
      if (statSync(from).isDirectory()) {
        walk(from, base, place);
        try { rmdirSync(from); } catch { /* not empty: something stayed */ }
      } else if (!place.only || place.only.test(rel)) {
        move(from, path.join(user, place.to, rel));
      }
    }
  };
  for (const place of OLD_PLACES) {
    const from = path.join(root, place.from);
    if (!existsSync(from)) continue;
    if (!statSync(from).isDirectory()) { move(from, path.join(user, place.to)); continue; }
    walk(from, from, place);
    try { rmdirSync(from); } catch { /* not empty: the project's own files, or one user/ already had */ }
  }
  return { moved, kept };
}

// The user's own files, relative to the project (the instruction files name them the same way).
export const USER_FILES = {
  claude: "user/CLAUDE.md", rules: "user/CV_RULES.md", checks: "user/cv_checks.json", queries: "user/search-queries.md",
  profile: "user/profile/01-candidate-profile.md", evaluation: "user/profile/04-job-evaluation.md",
};

// A new user's folder, from the starting files in templates/user/: each one that isn't there yet, never over one
// that is (as tools/init_user.py does). Returns the ones it added.
export function ensureUserFolder(user = USER_DIR, starting = STARTING) {
  const added: string[] = [];
  const walk = (dir: string) => {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      const from = path.join(dir, name);
      if (statSync(from).isDirectory()) { walk(from); continue; }
      const to = path.join(user, path.relative(starting, from));
      if (existsSync(to)) continue;
      mkdirSync(path.dirname(to), { recursive: true });
      copyFileSync(from, to);
      added.push(path.relative(user, to).replaceAll("\\", "/"));
    }
  };
  walk(starting);
  return added;
}

// Whether the user's profile has been filled in: their CLAUDE.md is there and no longer has the starting placeholders.
export function profileReady(user = USER_DIR) {
  try { return !readFileSync(path.join(user, "CLAUDE.md"), "utf8").includes("[YOUR_NAME]"); } catch { return false; }
}

export function userProfile(root = USER_DIR): { name?: string } {
  try {
    const data = JSON.parse(readFileSync(path.join(root, "profile.json"), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

// The name the CV sent to employers carries, as build.py saves it (tools/user_profile.py): "<the user's name> -
// Resume.pdf", or "Resume.pdf" with no name set; the grade sheet's, and the two joined, likewise (what).
const fileSafe = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim().slice(0, 60);
export function cvFileName(root = USER_DIR, what = "Resume") {
  const name = fileSafe(String(userProfile(root).name ?? ""));
  return name ? `${name} - ${what}.pdf` : `${what}.pdf`;
}

export class UserFileError extends Error {}

// The name as employers see it, in English letters, the CV's file named after it; what else profile.json holds stays.
export function saveUserName(input: unknown, root = USER_DIR) {
  const name = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!fileSafe(name) || name.length > 60) throw new UserFileError("name_invalid");
  if (!ENGLISH_NAME.test(name)) throw new UserFileError("name_english");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "profile.json"), JSON.stringify({ ...userProfile(root), name }, null, 2));
  return name;
}

// The documents the introduction takes, each into the folder /setup reads it from (user/documents/README.md): the
// CV, and a LinkedIn profile saved as a PDF. The bytes come as base64, like the chat's uploads (uploads.ts).
const DOCUMENT_KINDS = { cv: "cv", linkedin: "linkedin" } as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;
const DOCUMENT_EXT = ["pdf", "docx", "doc", "txt", "md", "tex", "rtf"];
const DOCUMENT_MAX = 20 * 1024 * 1024;

export function listUserDocuments(root = USER_DIR): Record<DocumentKind, string[]> {
  const list = (kind: DocumentKind) => {
    const dir = path.join(root, "documents", DOCUMENT_KINDS[kind]);
    return existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")).sort() : [];
  };
  return { cv: list("cv"), linkedin: list("linkedin") };
}

export function saveUserDocument(kind: unknown, name: unknown, data: unknown, root = USER_DIR) {
  if (!(String(kind) in DOCUMENT_KINDS)) throw new UserFileError("document_kind");
  const given = path.basename(String(name ?? "").replaceAll("\\", "/"));
  const ext = given.includes(".") ? given.split(".").pop()!.toLowerCase() : "";
  const base = given.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} ._-]+/gu, "_").replace(/^[.\s]+/, "").trim().slice(0, 80);
  if (!base || !DOCUMENT_EXT.includes(ext)) throw new UserFileError("document_type");
  const bytes = Buffer.from(String(data ?? ""), "base64");
  if (!bytes.length) throw new UserFileError("document_empty");
  if (bytes.length > DOCUMENT_MAX) throw new UserFileError("document_size");
  const dir = path.join(root, "documents", DOCUMENT_KINDS[kind as DocumentKind]);
  mkdirSync(dir, { recursive: true });
  // A second file by the same name gets a number, so nothing the user put here is replaced.
  let file = `${base}.${ext}`;
  for (let n = 2; existsSync(path.join(dir, file)); n++) file = `${base} (${n}).${ext}`;
  writeFileSync(path.join(dir, file), bytes);
  return file;
}
