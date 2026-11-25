// Files attached in the chat, of any kind, each saved in a folder of its own under user/app/uploads, which git
// ignores, for the chat to show and the agent to read. What a file is comes from its bytes, never from its name
// alone: an image is shown as one only when its first bytes are an image's, a PDF a PDF's, and anything else that
// isn't text is kept as a plain file, served only to be saved, so a page or a script cannot come in dressed as an
// image. An Office file's words are saved beside it as text (office.ts), and a zip is unpacked into a folder beside
// it (zip.ts) with a list of what it holds, so the agent reads either without opening it itself.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { officeText } from "./office";
import { REPO } from "./policy";
import { APP_DIR } from "./user";
import { unpackZip } from "./zip";

export const UPLOADS = path.join(APP_DIR, "uploads");
// Images go to Claude as they are, within the API's size for one; a bigger one is kept as a file it reads from the
// folder, as is everything else, up to MAX_FILE.
export const MAX_IMAGE = 5 * 1024 * 1024;
export const MAX_FILE = 50 * 1024 * 1024;
// How much of a zip's text files its list carries, for an assistant that only gets words.
const ZIP_TEXT_CHARS = 200_000;

type Kind = "image" | "pdf" | "office" | "zip" | "text" | "file";
export type Upload = { id: string; name: string; type: string; kind: Kind; size: number };
// Where an upload is; for an Office file where its words are, for a zip its list and the folder it was unpacked into.
export type Kept = Upload & { file: string; text?: string; folder?: string };

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const OFFICE = "application/vnd.openxmlformats-officedocument";
const TEXT = "text/plain; charset=utf-8";
const IMAGES: Record<string, { type: string; starts: (b: Uint8Array) => boolean }> = {
  png: { type: "image/png", starts: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  jpg: { type: "image/jpeg", starts: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { type: "image/jpeg", starts: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  gif: { type: "image/gif", starts: (b) => String.fromCharCode(...b.slice(0, 4)) === "GIF8" },
  webp: { type: "image/webp", starts: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
};
const OFFICE_TYPES: Record<string, string> = {
  docx: `${OFFICE}.wordprocessingml.document`, xlsx: `${OFFICE}.spreadsheetml.sheet`, pptx: `${OFFICE}.presentationml.presentation`,
};

export class UploadError extends Error {}

// A name safe to save and to show: the last part of the path, letters of any language, digits, spaces and a few
// marks, cut short, with its extension kept; never the folder's own upload.json.
function safeName(name: string, ext: string) {
  const base = path.basename(name.replaceAll("\\", "/")).replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} ._()-]+/gu, "_").replace(/^[ .]+/, "").slice(0, 80) || "file";
  const named = ext ? `${base}.${ext}` : base;
  return named.toLowerCase() === "upload.json" ? `${base}_.${ext}` : named;
}

const isUtf8 = (bytes: Uint8Array) => { try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; } };
const isText = (bytes: Uint8Array) => !bytes.includes(0) && isUtf8(bytes);

// What a file is, by its bytes: an image or a PDF only when it starts as one, an Office file or a zip only when it
// opens as one, text when it reads as text, and otherwise a plain file.
function kindOf(ext: string, bytes: Buffer): { kind: Kind; type: string; words?: string } {
  const image = IMAGES[ext];
  if (image?.starts(bytes) && bytes.length <= MAX_IMAGE) return { kind: "image", type: image.type };
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", type: "application/pdf" };
  if (OFFICE_TYPES[ext] && isZip(bytes)) {
    try { return { kind: "office", type: OFFICE_TYPES[ext], words: officeText(bytes, ext) }; } catch { /* not one after all */ }
  }
  if (isZip(bytes)) return { kind: "zip", type: "application/zip" };
  if (isText(bytes)) return { kind: "text", type: TEXT };
  return { kind: "file", type: "application/octet-stream" };
}

// A zip's list: each file it holds and its size, those left out and why, then the words of its text files, as many
// as fit.
function zipList(name: string, kept: { name: string; size: number; file: string }[], left: { name: string; why: string }[]) {
  const lines = [`${name} holds ${kept.length} file${kept.length === 1 ? "" : "s"}:`, ...kept.map((f) => `  ${f.name} (${f.size} bytes)`)];
  if (left.length) lines.push("", "Left out:", ...left.map((f) => `  ${f.name}: ${f.why}`));
  let room = ZIP_TEXT_CHARS - lines.join("\n").length;
  for (const f of kept) {
    if (room <= 0) break;
    const bytes = readFileSync(f.file);
    if (!bytes.length || !isText(bytes)) continue;
    const piece = `\n\n--- ${f.name} ---\n${bytes.toString("utf8")}`.slice(0, room);
    lines.push(piece);
    room -= piece.length;
  }
  return lines.join("\n");
}

export function saveUpload(name: string, data: string, dir = UPLOADS): Upload {
  const ext = path.extname(String(name)).slice(1).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 12);
  const bytes = Buffer.from(String(data), "base64");
  if (!bytes.length) throw new UploadError("empty");
  if (bytes.length > MAX_FILE) throw new UploadError("size");
  const what = kindOf(ext, bytes);
  const upload: Upload = { id: crypto.randomUUID(), name: safeName(String(name), ext), type: what.type, kind: what.kind, size: bytes.length };
  const folder = path.join(dir, upload.id);
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, upload.name);
  writeFileSync(file, bytes);
  if (what.kind === "office") writeFileSync(`${file}.txt`, what.words ?? "");
  if (what.kind === "zip") {
    try {
      const { kept, left } = unpackZip(bytes, `${file}.files`);
      writeFileSync(`${file}.txt`, zipList(upload.name, kept, left));
    } catch {
      // Not a zip that opens: kept as a plain file.
      rmSync(`${file}.files`, { recursive: true, force: true });
      upload.kind = "file";
      upload.type = "application/octet-stream";
    }
  }
  writeFileSync(path.join(folder, "upload.json"), JSON.stringify(upload));
  return upload;
}

// An upload by its id, with where its file is; an id is only ever a UUID, so it cannot reach another folder.
export function getUpload(id: string, dir = UPLOADS): Kept | null {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const meta = path.join(dir, id, "upload.json");
  if (!existsSync(meta)) return null;
  const upload = JSON.parse(readFileSync(meta, "utf8")) as Upload;
  const file = path.join(dir, id, upload.name);
  if (!existsSync(file)) return null;
  const kept: Kept = { ...upload, file };
  if ((upload.kind === "office" || upload.kind === "zip") && existsSync(`${file}.txt`)) kept.text = `${file}.txt`;
  if (upload.kind === "zip" && existsSync(`${file}.files`)) kept.folder = `${file}.files`;
  return kept;
}

// The words of an attachment, for an assistant that is given them inline: a text file's own, an Office file's, a
// zip's list with its text files; for any other file, what it is.
export const uploadText = (u: Kept) => {
  if (u.text) return readFileSync(u.text, "utf8");
  if (u.kind === "text") return readFileSync(u.file, "utf8");
  return `(${u.name}: a file of ${u.size} bytes that isn't text)`;
};
// The line that tells an agent where an attached file is in the project: for an Office file also where its words
// are, for a zip the folder it was unpacked into and its list.
export const uploadNote = (u: Kept) => {
  const at = (file: string) => path.relative(REPO, file).replaceAll("\\", "/");
  if (u.folder) return `Attached zip (${u.name}): ${at(u.file)}, unpacked into ${at(u.folder)}/ (what it holds: ${at(u.text ?? u.file)})`;
  return `Attached file (${u.name}): ${at(u.file)}${u.text ? `, its words as text: ${at(u.text)}` : ""}`;
};

// A temporary conversation's attachments: a folder of their own that the sync between computers leaves out (sync.ts
// OWN), emptied whenever the server starts (an attachment never sent is in no conversation to take it along).
export const TEMP_UPLOADS = path.join(APP_DIR, "uploads-temporary");
export const clearTemporaryUploads = () => rmSync(TEMP_UPLOADS, { recursive: true, force: true });
// An upload by its id, wherever it was kept.
export const findUpload = (id: string) => getUpload(id) ?? getUpload(id, TEMP_UPLOADS);

// An upload removed, its folder and all (a temporary conversation's, as it goes), from either place: only ever a UUID's
// folder right inside one of them, checked once resolved, before anything is removed.
export function removeUpload(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  for (const dir of [UPLOADS, TEMP_UPLOADS]) {
    const folder = path.resolve(dir, id);
    if (path.dirname(folder) === path.resolve(dir) && existsSync(path.join(folder, "upload.json"))) rmSync(folder, { recursive: true, force: true });
  }
}

// What a message with attachments says to Claude: each image as an image it sees at once, and for any other file a
// line with where it is in the project, for it to read.
export function attachmentContent(text: string, uploads: Kept[]) {
  const images = uploads.filter((u) => u.kind === "image");
  const others = uploads.filter((u) => u.kind !== "image");
  const notes = others.map(uploadNote);
  const said = [text, ...(notes.length ? ["", ...notes] : [])].join("\n").trim() || "(see the attached image)";
  if (!images.length) return said;
  return [
    ...images.map((u) => ({ type: "image" as const, source: { type: "base64" as const, media_type: u.type as "image/png", data: readFileSync(u.file).toString("base64") } })),
    { type: "text" as const, text: said },
  ];
}
