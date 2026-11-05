// What the interface changes directly, without a Claude session.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readAts } from "./data";
import { REPO } from "./policy";
import { clean } from "./settings";

// The code names the problem, and the interface words it in the reader's language.
export class EditError extends Error {
  constructor(readonly code: string, readonly status = 400, readonly params: Record<string, string | number> = {}) { super(code); }
}

const MAX_TEXT = 300_000;
const TEMPLATE = "templates/cv/one-page-clean";
const PYTHON = process.platform === "win32" ? "python" : "python3";
const versionOf = (text: string) => Bun.hash(text).toString(36);

// A session may have changed the file since the page loaded it, and saving would silently undo that.
function checkText(text: unknown, base: unknown, current: string): asserts text is string {
  if (typeof text !== "string" || !text.trim()) throw new EditError("empty_text");
  if (text.length > MAX_TEXT) throw new EditError("text_too_long");
  if (base !== versionOf(current)) throw new EditError("changed_since_opened", 409);
}

// A text box always uses \n, so the file keeps the line endings it had.
function writeText(file: string, text: string, previous: string) {
  const normal = text.replace(/\r\n/g, "\n");
  writeFileSync(file, previous.includes("\r\n") ? normal.replace(/\n/g, "\r\n") : normal);
}

// The user's own rules and profile, in user/ (user.ts).
const DOCUMENTS = { rules: "user/CV_RULES.md", profile: "user/profile/01-candidate-profile.md" };
export type DocumentKind = keyof typeof DOCUMENTS;
const FRONTMATTER = /^---[\s\S]*?---\s*/;

export function readDocument(kind: DocumentKind, root = REPO) {
  const raw = readFileSync(path.join(root, DOCUMENTS[kind]), "utf8");
  const text = raw.replace(FRONTMATTER, "");
  return { text, version: versionOf(raw), markdown: text.replace(/<!--[\s\S]*?-->\s*/g, "") };
}

export function saveDocument(kind: DocumentKind, text: unknown, base: unknown, root = REPO) {
  const file = path.join(root, DOCUMENTS[kind]);
  const raw = readFileSync(file, "utf8");
  checkText(text, base, raw);
  writeText(file, (raw.match(FRONTMATTER)?.[0] ?? "") + text, raw);
  return readDocument(kind, root);
}

const LIMITS: Record<string, [number, number]> = { summaryLines: [1, 8], summaryFill: [0, 100], skillLines: [1, 10], skillItems: [1, 40] };

// The user's limits and banned wording (user/cv_checks.json), or the template's neutral ones until they have their own.
const CHECKS = "user/cv_checks.json";
export const readChecks = (root = REPO) =>
  JSON.parse(readFileSync(path.join(root, existsSync(path.join(root, CHECKS)) ? CHECKS : `${TEMPLATE}/cv_checks.json`), "utf8"));

export function saveChecks(input: any, root = REPO) {
  const limits = Object.fromEntries(Object.entries(LIMITS).map(([name, [min, max]]) => {
    const value = Number(input?.limits?.[name]);
    if (!Number.isInteger(value) || value < min || value > max) throw new EditError("limit_range", 400, { name, min, max });
    return [name, value];
  }));
  const banned = (Array.isArray(input?.banned) ? input.banned : []).slice(0, 12).map((group: any) => {
    const phrases = (Array.isArray(group?.phrases) ? group.phrases : []).map((p: unknown) => clean(p, 60).toLowerCase()).filter(Boolean);
    // A phrase of only # and * would match ordinary dates and numbers, and every build would stop.
    const bad = phrases.find((p: string) => !/\p{L}{2}/u.test(p));
    if (bad) throw new EditError("phrase_needs_word", 400, { phrase: bad });
    return { reason: clean(group?.reason, 160), phrases: [...new Set(phrases)].slice(0, 80) };
  }).filter((group: { reason: string }) => group.reason);
  const checks = { limits, banned };
  mkdirSync(path.join(root, "user"), { recursive: true });
  writeFileSync(path.join(root, CHECKS), `${JSON.stringify(checks, null, 2)}\n`);
  return checks;
}

// The tracker has no ids and many writers, so a change finds its cells in the raw text and touches nothing else.
function cellSpans(text: string) {
  const records: [number, number][][] = [];
  let cells: [number, number][] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') i++; else quoted = false; }
    } else if (c === '"') quoted = true;
    else if (c === ",") { cells.push([start, i]); start = i + 1; }
    else if (c === "\n" || i === text.length) {
      cells.push([start, text[i - 1] === "\r" ? i - 1 : i]);
      records.push(cells);
      cells = [];
      start = i + 1;
    }
  }
  return records;
}

const cellValue = (raw: string) => (raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw);
export const STATUSES = ["drafted", "applied", "interview", "offer", "hired", "rejected", "no_response", "offer_declined", "withdrawn"];

export function setApplicationStatus(input: any, root = REPO, today = new Date().toLocaleDateString("en-CA")) {
  const status = String(input?.status ?? "");
  if (!STATUSES.includes(status)) throw new EditError("unknown_status");
  const file = path.join(root, "user", "job_search_tracker.csv");
  if (!existsSync(file)) throw new EditError("no_tracker", 404);
  const text = readFileSync(file, "utf8");
  const records = cellSpans(text);
  const value = (span?: [number, number]) => (span ? cellValue(text.slice(span[0], span[1])) : "");
  const columns = (records[0] ?? []).map((span) => value(span).replace(/^﻿/, "").trim());
  const column = (name: string) => columns.indexOf(name);
  const row = records.slice(1).find((cells) =>
    ["date", "company", "role"].every((name) => value(cells[column(name)]) === String(input?.[name] ?? "")));
  const [statusCell, notesCell, dateCell] = ["status", "notes", "date"].map((name) => row?.[column(name)]);
  if (!statusCell || !notesCell || !dateCell) throw new EditError("application_not_found", 404);
  const previous = value(statusCell).toLowerCase().replace(" ", "_");
  if (previous === status) return;

  // The same steps /outcome takes: a dated note, and the real send date on a row leaving drafted.
  const note = `${status} ${today}`;
  const quotedNotes = text[notesCell[0]] === '"';
  const notesEnd = quotedNotes ? notesCell[1] - 1 : notesCell[1];
  const changes: [number, number, string][] = [
    [statusCell[0], statusCell[1], status],
    [notesEnd, notesEnd, value(notesCell).trim() ? `; ${note}` : note],
  ];
  if (previous === "drafted") changes.push([dateCell[0], dateCell[1], today]);
  const next = changes.sort((a, b) => b[0] - a[0])
    .reduce((out, [from, to, added]) => out.slice(0, from) + added + out.slice(to), text);
  writeFileSync(file, next);
}

const TRACKER_HEADER = "date,company,sector,role,role_type,channel,status,contact_person,fit_rating,notes,cv_file,cover_letter_file,source,deadline";
// Statuses after which an application is over; a new draft for the same role gets a row of its own beside it.
const FINAL_STATUSES = ["hired", "rejected", "no_response", "offer_declined", "withdrawn"];
const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

export type Draft = {
  company: string; role: string; fit_rating: number; cv_file: string;
  sector?: string; role_type?: string; channel?: string; contact_person?: string; source?: string; deadline?: string;
};

// A drafted application in the tracker, as /apply's Step 6b records one: a new row, unless the same company and role
// has an open one, which is refreshed and never moved backwards (its status stays; its date moves to today only
// while it is a draft; "redrafted" joins its notes). A header without the deadline column gets it, and nothing else
// in the file changes.
export function recordDraft(draft: Draft, root = REPO, today = new Date().toLocaleDateString("en-CA")): "added" | "updated" {
  const file = path.join(root, "user", "job_search_tracker.csv");
  let text = existsSync(file) ? readFileSync(file, "utf8") : `${TRACKER_HEADER}\n`;
  const crlf = /\r\n/.test(text);
  const headerEnd = text.search(/\r?\n/);
  const header = headerEnd < 0 ? text : text.slice(0, headerEnd);
  if (!header.trim().endsWith(",deadline")) text = `${header.replace(/\s+$/, "")},deadline${text.slice(header.length)}`;
  const records = cellSpans(text);
  const value = (span?: [number, number]) => (span ? cellValue(text.slice(span[0], span[1])) : "");
  const columns = (records[0] ?? []).map((span) => value(span).replace(/^﻿/, "").trim());
  const at = (name: string) => columns.indexOf(name);
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const open = records.slice(1).find((cells) => same(value(cells[at("company")]), draft.company) && same(value(cells[at("role")]), draft.role)
    && !FINAL_STATUSES.includes(value(cells[at("status")]).trim().toLowerCase().replace(" ", "_")));
  if (!open) {
    const cells: Record<string, string> = {
      date: today, company: draft.company, sector: draft.sector ?? "", role: draft.role, role_type: draft.role_type ?? "", channel: draft.channel ?? "",
      status: "drafted", contact_person: draft.contact_person ?? "", fit_rating: String(draft.fit_rating), notes: "", cv_file: draft.cv_file,
      cover_letter_file: "", source: draft.source ?? "", deadline: draft.deadline ?? "",
    };
    const line = columns.map((name) => csvCell(cells[name] ?? "")).join(",");
    const eol = crlf ? "\r\n" : "\n";
    writeFileSync(file, `${text.replace(/[\r\n]*$/, "")}${eol}${line}${eol}`);
    return "added";
  }
  const notes = value(open[at("notes")]).trim();
  const updates: [string, string][] = [
    ["cv_file", draft.cv_file], ["fit_rating", String(draft.fit_rating)],
    ...(draft.source ? [["source", draft.source] as [string, string]] : []),
    // Absence is not a correction: a deadline stays unless this draft found one.
    ...(draft.deadline ? [["deadline", draft.deadline] as [string, string]] : []),
    ["notes", notes ? `${notes}; redrafted` : "redrafted"],
    ...(same(value(open[at("status")]), "drafted") ? [["date", today] as [string, string]] : []),
  ];
  const changes = updates.flatMap(([name, v]) => (open[at(name)] ? [[open[at(name)][0], open[at(name)][1], csvCell(v)] as [number, number, string]] : []));
  writeFileSync(file, changes.sort((a, b) => b[0] - a[0]).reduce((out, [from, to, added]) => out.slice(0, from) + added + out.slice(to), text));
  return "updated";
}

// A CV or a cover letter, each with its own folder and file prefix.
const SOURCES = { cv: { dir: "user/cv", prefix: "main_" }, letter: { dir: "user/cover_letters", prefix: "cover_" } };
export type SourceKind = keyof typeof SOURCES;
export const isSourceKind = (kind: string): kind is SourceKind => kind in SOURCES;

function sourceFile(kind: SourceKind, name: string, root: string) {
  const { dir, prefix } = SOURCES[kind];
  const file = path.join(root, dir, `${prefix}${name}.tex`);
  if (!/^[a-z0-9_]+$/i.test(name) || !existsSync(file)) throw new EditError("document_not_found", 404);
  return file;
}

export function readSource(kind: SourceKind, name: string, root = REPO) {
  const { dir, prefix } = SOURCES[kind];
  const source = readFileSync(sourceFile(kind, name, root), "utf8");
  const pdf = `${dir}/${prefix}${name}.pdf`;
  return { kind, name, source, version: versionOf(source), pdf: existsSync(path.join(root, pdf)) ? pdf : null, ats: kind === "cv" ? readAts(`user/cv/main_${name}.tex`, root) : null };
}

export function saveSource(kind: SourceKind, name: string, source: unknown, base: unknown, root = REPO) {
  const file = sourceFile(kind, name, root);
  const current = readFileSync(file, "utf8");
  checkText(source, base, current);
  writeText(file, source, current);
}

// Every CV and letter that has a source, including those with no row in the tracker.
export function listSources(root = REPO) {
  return (Object.keys(SOURCES) as SourceKind[]).flatMap((kind) => {
    const { dir, prefix } = SOURCES[kind];
    const abs = path.join(root, dir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs).flatMap((file) => {
      const name = file.match(new RegExp(`^${prefix}([a-z0-9_]+)\\.tex$`, "i"))?.[1];
      if (!name) return [];
      const pdf = `${dir}/${prefix}${name}.pdf`;
      return [{ kind, name, pdf: existsSync(path.join(root, pdf)) ? pdf : null, modified: statSync(path.join(abs, file)).mtimeMs }];
    });
  }).sort((a, b) => b.modified - a.modified);
}

async function run(command: string[], cwd: string, timeout: number) {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeout);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { ok: code === 0, output: `${out}${err}`.trim() };
}

let building = false;

// A CV goes through every rule in build.py. A letter is only compiled, with the engine cover.cls needs.
export async function buildSource(kind: SourceKind, name: string, root = REPO) {
  sourceFile(kind, name, root);
  if (building) throw new EditError("build_busy", 409);
  building = true;
  try {
    if (kind === "cv") return await run([PYTHON, `${TEMPLATE}/build.py`, name], root, 360_000);
    const folder = path.join(root, "user", "cover_letters");
    const result = await run(["xelatex", "-interaction=nonstopmode", "-halt-on-error", `cover_${name}.tex`], folder, 180_000);
    for (const extension of ["aux", "log", "out"]) rmSync(path.join(folder, `cover_${name}.${extension}`), { force: true });
    const errors = result.output.split("\n").filter((line) => line.startsWith("!"));
    return { ok: result.ok, output: result.ok ? "" : errors.join("\n") || result.output.slice(-800) };
  } finally {
    building = false;
  }
}

// Files a person may edit here. Permissions, the safety tools and this interface's own code stay
// readable only: changing those changes what a session may do, so they keep the approval in a conversation.
// The user's own files (user/) come first, the profile's 01 aside: it has a screen of its own.
const FILE_GROUPS: { title: string; dir?: string; match?: RegExp; files?: string[]; readOnly?: boolean }[] = [
  { title: "general", files: ["user/CLAUDE.md"] },
  { title: "commands", dir: ".claude/commands", match: /\.md$/ },
  { title: "agents", dir: ".claude/agents", match: /\.md$/ },
  { title: "knowledge", dir: "user/profile", match: /^(?!01-).*\.md$/ },
  { title: "knowledge", dir: ".claude/skills/job-application-assistant", match: /\.md$/ },
  { title: "search", files: [".claude/skills/job-scraper/SKILL.md", "user/search-queries.md"] },
  { title: "upskill", files: [".claude/skills/upskill/SKILL.md"] },
  { title: "template", files: [`${TEMPLATE}/TEMPLATE.md`, `${TEMPLATE}/template.tex`, `${TEMPLATE}/onepage.sty`, `${TEMPLATE}/build.py`, `${TEMPLATE}/ats.py`, "cover_letters/cover.cls"] },
  { title: "permissions", files: [".claude/settings.json", "web/policy.ts"], readOnly: true },
];

// Groups with the same title, as the knowledge files in user/profile/ and in the skill's folder, show as one.
export function listEditableFiles(root = REPO) {
  const groups: { title: string; readOnly: boolean; files: string[] }[] = [];
  for (const { title, dir, match, files, readOnly } of FILE_GROUPS) {
    const paths = (dir && existsSync(path.join(root, dir))
      ? readdirSync(path.join(root, dir)).filter((name) => match?.test(name)).map((name) => `${dir}/${name}`)
      : files ?? []).filter((p) => existsSync(path.join(root, p)));
    const same = groups.find((g) => g.title === title);
    if (same) same.files.push(...paths);
    else groups.push({ title, readOnly: Boolean(readOnly), files: paths });
  }
  return groups.filter((group) => group.files.length);
}

// The path must come from the list, so nothing a request sends can reach another file.
function listedFile(requested: unknown, root: string) {
  const group = listEditableFiles(root).find((g) => g.files.includes(String(requested)));
  if (!group) throw new EditError("file_not_listed", 404);
  return { file: path.join(root, String(requested)), readOnly: group.readOnly };
}

export function readEditableFile(requested: unknown, root = REPO) {
  const { file, readOnly } = listedFile(requested, root);
  const text = readFileSync(file, "utf8");
  return { path: String(requested), text, version: versionOf(text), readOnly };
}

export function saveEditableFile(requested: unknown, text: unknown, base: unknown, root = REPO) {
  const { file, readOnly } = listedFile(requested, root);
  if (readOnly) throw new EditError("file_read_only", 403);
  const current = readFileSync(file, "utf8");
  checkText(text, base, current);
  writeText(file, text, current);
  return readEditableFile(requested, root);
}

export async function atsTerms(root = REPO): Promise<string[]> {
  const { ok, output } = await run([PYTHON, `${TEMPLATE}/ats.py`, "--terms"], root, 30_000);
  if (!ok) throw new EditError("terms_failed", 500);
  return JSON.parse(output);
}
