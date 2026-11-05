// Files attached in the chat: images, PDFs and text, each saved in a folder of its own under user/app/uploads,
// which git ignores, for the chat to show and the agent to read. A file is taken only when its first bytes are
// what its name says, so a page or a script cannot come in dressed as an image.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO } from "./policy";
import { APP_DIR } from "./user";

export const UPLOADS = path.join(APP_DIR, "uploads");
// Images go to Claude as they are, within the API's size for one; the rest it reads from the folder.
export const MAX_IMAGE = 5 * 1024 * 1024;
export const MAX_FILE = 20 * 1024 * 1024;

type Kind = "image" | "pdf" | "text";
export type Upload = { id: string; name: string; type: string; kind: Kind; size: number };

const TYPES: Record<string, { type: string; kind: Kind; starts?: (b: Uint8Array) => boolean }> = {
  png: { type: "image/png", kind: "image", starts: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  jpg: { type: "image/jpeg", kind: "image", starts: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { type: "image/jpeg", kind: "image", starts: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  gif: { type: "image/gif", kind: "image", starts: (b) => String.fromCharCode(...b.slice(0, 4)) === "GIF8" },
  webp: { type: "image/webp", kind: "image", starts: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
  pdf: { type: "application/pdf", kind: "pdf", starts: (b) => String.fromCharCode(...b.slice(0, 5)) === "%PDF-" },
  txt: { type: "text/plain; charset=utf-8", kind: "text" },
  md: { type: "text/plain; charset=utf-8", kind: "text" },
  csv: { type: "text/plain; charset=utf-8", kind: "text" },
  json: { type: "text/plain; charset=utf-8", kind: "text" },
  tex: { type: "text/plain; charset=utf-8", kind: "text" },
};
export const UPLOAD_EXTENSIONS = Object.keys(TYPES);

export class UploadError extends Error {}

// A name safe to save and to show: the last part of the path, letters of any language, digits, spaces and a few
// marks, cut short, with its extension kept.
function safeName(name: string, ext: string) {
  const base = path.basename(name.replaceAll("\\", "/")).replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} ._()-]+/gu, "_").replace(/^[ .]+/, "").slice(0, 80);
  return `${base || "file"}.${ext}`;
}

export function saveUpload(name: string, data: string, dir = UPLOADS): Upload {
  const ext = path.extname(String(name)).slice(1).toLowerCase();
  const known = TYPES[ext];
  if (!known) throw new UploadError("type");
  const bytes = Buffer.from(String(data), "base64");
  if (!bytes.length) throw new UploadError("empty");
  if (bytes.length > (known.kind === "image" ? MAX_IMAGE : MAX_FILE)) throw new UploadError("size");
  if (known.starts && !known.starts(bytes)) throw new UploadError("type");
  if (known.kind === "text" && (bytes.includes(0) || !isUtf8(bytes))) throw new UploadError("type");
  const upload: Upload = { id: crypto.randomUUID(), name: safeName(String(name), ext), type: known.type, kind: known.kind, size: bytes.length };
  const folder = path.join(dir, upload.id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, upload.name), bytes);
  writeFileSync(path.join(folder, "upload.json"), JSON.stringify(upload));
  return upload;
}

const isUtf8 = (bytes: Uint8Array) => { try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; } };

// An upload by its id, with where its file is; an id is only ever a UUID, so it cannot reach another folder.
export function getUpload(id: string, dir = UPLOADS): (Upload & { file: string }) | null {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const meta = path.join(dir, id, "upload.json");
  if (!existsSync(meta)) return null;
  const upload = JSON.parse(readFileSync(meta, "utf8")) as Upload;
  const file = path.join(dir, id, upload.name);
  return existsSync(file) ? { ...upload, file } : null;
}

// What a message with attachments says to Claude: each image as an image it sees at once, and for a PDF or a
// text file a line with where it is in the project, for it to read.
export function attachmentContent(text: string, uploads: (Upload & { file: string })[]) {
  const images = uploads.filter((u) => u.kind === "image");
  const others = uploads.filter((u) => u.kind !== "image");
  const notes = others.map((u) => `Attached file (${u.name}): ${path.relative(REPO, u.file).replaceAll("\\", "/")}`);
  const said = [text, ...(notes.length ? ["", ...notes] : [])].join("\n").trim() || "(see the attached image)";
  if (!images.length) return said;
  return [
    ...images.map((u) => ({ type: "image" as const, source: { type: "base64" as const, media_type: u.type as "image/png", data: readFileSync(u.file).toString("base64") } })),
    { type: "text" as const, text: said },
  ];
}
