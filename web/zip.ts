// Reading a zip with no library: its list of files, each unpacked only when asked for and within a size, so a file
// built to swell when unpacked cannot. For Office files (office.ts) and zips attached in the chat (uploads.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

export const MAX_PART = 40 * 1024 * 1024;

export type ZipEntry = { name: string; size: number; folder: boolean; read: () => Buffer };

// The files in a zip, in its own order. Throws on anything that isn't a zip.
export function readZip(zip: Buffer): ZipEntry[] {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("not a zip");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("bad zip");
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    entries.push({
      name, size, folder: name.endsWith("/"),
      read: () => {
        if (flags & 1) throw new Error("locked with a password");
        if (size > MAX_PART || zip.readUInt32LE(local) !== 0x04034b50) throw new Error("too big");
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        const data = zip.subarray(start, start + packed);
        if (method === 0) return data;
        if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART });
        throw new Error("packed in a way not read here");
      },
    });
  }
  return entries;
}

// How much one zip may unpack to, in files and in bytes.
export const UNPACK_FILES = 5000;
export const UNPACK_BYTES = 300 * 1024 * 1024;

// A part of a path inside the zip as a name Windows takes: no marks it refuses, no dots or spaces at the end, none
// of its reserved device names.
const cleanPart = (part: string) => {
  const clean = part.replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "_");
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean) ? `_${clean}` : clean;
};

// A zip's files written out into a folder, each only inside it (a name climbing out with .. or starting at a drive
// is left out), up to UNPACK_FILES files and UNPACK_BYTES in all. What it holds, and what was left out and why.
export function unpackZip(zip: Buffer, into: string) {
  const root = path.resolve(into);
  mkdirSync(root, { recursive: true });
  const kept: { name: string; size: number; file: string }[] = [];
  const left: { name: string; why: string }[] = [];
  let bytes = 0;
  for (const entry of readZip(zip)) {
    const parts = entry.name.replaceAll("\\", "/").split("/").filter((p) => p && p !== ".");
    if (!parts.length || parts.includes("..") || /^[a-z]:/i.test(parts[0])) { left.push({ name: entry.name, why: "its name leads outside the zip" }); continue; }
    const target = path.join(root, ...parts.map(cleanPart));
    if (!target.startsWith(root + path.sep)) { left.push({ name: entry.name, why: "its name leads outside the zip" }); continue; }
    try {
      if (entry.folder) { mkdirSync(target, { recursive: true }); continue; }
      if (kept.length >= UNPACK_FILES) { left.push({ name: entry.name, why: "too many files" }); continue; }
      if (bytes + entry.size > UNPACK_BYTES) { left.push({ name: entry.name, why: "too much in all" }); continue; }
      const data = entry.read();
      bytes += data.length;
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data);
      kept.push({ name: parts.join("/"), size: data.length, file: target });
    } catch (err) {
      left.push({ name: entry.name, why: String((err as Error).message ?? err) });
    }
  }
  return { kept, left };
}
