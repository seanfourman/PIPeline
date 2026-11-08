// Keeping an account alike on its computers: each one asks the others that are on, through the site (remote.ts), for
// their list of the account's files, each with when it last changed and a hash of it, and takes from them each file
// that is newer there, and each deletion that is; the others do the same, so a change on any of them reaches all. All
// of it goes sealed with the account's key (synckey.ts). A file taken replaces one that was here only after a copy of
// that one is put aside for a week (app/sync-backup/), as is one a deletion takes. The computer's own files stay its
// own: its logins, its key, its token, its logs, the sync's own notes; and a file over 40 MB isn't sent.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openWith, sealWith } from "./synckey";

export type Entry = { m: number; s: number; h: string };
export type Manifest = { files: Record<string, Entry>; deleted: Record<string, number> };
// The account's other computers, and asking one of them (remote.ts's peers and peer).
export type Peers = {
  peers: (account: string) => Promise<{ id: string; online: boolean }[]>;
  peer: (account: string, to: string, what: "manifest" | "file", rel?: string) => Promise<Response | null>;
};

const OWN = /^(app\/(sessions\.json(\.new)?|token|server\.log|update\.json|sync-key\.json|sync-state\.json|remote\.json|sync-backup\/.*)|_backup[^/]*\/.*|.*\.sync-new)$/;
const MAX_FILE = 40 * 1024 * 1024;
const KEEP_DAYS = 7;
const DELETIONS_DAYS = 30;
const DAY = 86_400_000;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

// A path another computer names, kept to the account's folder: relative, with no way out of it, and not one of the
// computer's own files.
export function safeRel(rel: unknown): rel is string {
  if (typeof rel !== "string" || !rel || rel.length > 400 || rel.includes("\\") || rel.includes("\0") || /^[a-zA-Z]:/.test(rel) || rel.startsWith("/")) return false;
  return rel.split("/").every((part) => part && part !== "." && part !== "..") && !OWN.test(rel);
}

type State = { hashes: Record<string, Entry>; deleted: Record<string, number> };
const stateFile = (dir: string) => path.join(dir, "app", "sync-state.json");
function readState(dir: string): State {
  try {
    const s = JSON.parse(readFileSync(stateFile(dir), "utf8"));
    return { hashes: s?.hashes ?? {}, deleted: s?.deleted ?? {} };
  } catch {
    return { hashes: {}, deleted: {} };
  }
}

// The account's files as they are now: each one's last change, size and hash (a hash kept from the last time while
// the file hasn't changed), and the files gone since then, with when they were found gone, for a month.
export function manifest(dir: string, now = Date.now()): Manifest {
  const state = readState(dir);
  const files: Record<string, Entry> = {};
  const walk = (at: string) => {
    for (const name of existsSync(at) ? readdirSync(at) : []) {
      const abs = path.join(at, name);
      const rel = path.relative(dir, abs).replaceAll("\\", "/");
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) { if (!OWN.test(`${rel}/x`)) walk(abs); continue; }
      if (!st.isFile() || st.size > MAX_FILE || OWN.test(rel)) continue;
      const was = state.hashes[rel];
      const m = Math.round(st.mtimeMs);
      files[rel] = was && was.m === m && was.s === st.size ? was : { m, s: st.size, h: sha256(readFileSync(abs)) };
    }
  };
  walk(dir);
  const deleted: Record<string, number> = {};
  for (const [rel, at] of Object.entries(state.deleted)) if (!files[rel] && now - at < DELETIONS_DAYS * DAY) deleted[rel] = at;
  for (const rel of Object.keys(state.hashes)) if (!files[rel] && !deleted[rel]) deleted[rel] = now;
  mkdirSync(path.dirname(stateFile(dir)), { recursive: true });
  writeFileSync(stateFile(dir), JSON.stringify({ hashes: files, deleted }));
  return { files, deleted };
}

// A copy of a file put aside before it is replaced or deleted, under the day; older days are let go.
function putAside(dir: string, rel: string, now: number) {
  const root = path.join(dir, "app", "sync-backup");
  const today = new Date(now).toISOString().slice(0, 10);
  for (const day of existsSync(root) ? readdirSync(root) : []) {
    if (now - Date.parse(day) > KEEP_DAYS * DAY) rmSync(path.join(root, day), { recursive: true, force: true });
  }
  const to = path.join(root, today, rel);
  mkdirSync(path.dirname(to), { recursive: true });
  renameSync(path.join(dir, rel), to);
}

// What this computer answers another of the account's: its list, or one file, sealed with the account's key.
export const answerManifest = (dir: string, key: Buffer) => sealWith(key, JSON.stringify(manifest(dir)));
export function answerFile(dir: string, key: Buffer, rel: unknown): Buffer | null {
  if (!safeRel(rel)) return null;
  const abs = path.join(dir, rel);
  try {
    const st = statSync(abs);
    return st.isFile() && st.size <= MAX_FILE ? sealWith(key, readFileSync(abs)) : null;
  } catch {
    return null;
  }
}

// Takes from each of the account's other computers that is on what is newer there. all takes every file it has that
// differs, newer or not: a computer that has just joined the account, whose folder has nothing of its own yet.
export async function syncAccount(o: { dir: string; account: string; key: Buffer; peers: Peers; all?: boolean; now?: number }) {
  const now = o.now ?? Date.now();
  let pulled = 0, removed = 0, reached = 0;
  for (const p of (await o.peers.peers(o.account)).filter((x) => x.online)) {
    const res = await o.peers.peer(o.account, p.id, "manifest");
    if (!res?.ok) continue;
    let theirs: Manifest;
    try { theirs = JSON.parse(openWith(o.key, Buffer.from(await res.arrayBuffer())).toString("utf8")); } catch { continue; }
    reached++;
    const mine = manifest(o.dir, now);
    for (const [rel, e] of Object.entries(theirs.files ?? {})) {
      const have = mine.files[rel];
      if (!safeRel(rel) || typeof e?.h !== "string" || have?.h === e.h) continue;
      if (!o.all && ((have && have.m >= e.m) || (mine.deleted[rel] ?? 0) > e.m)) continue;
      const file = await o.peers.peer(o.account, p.id, "file", rel);
      if (!file?.ok) continue;
      let bytes: Buffer;
      try { bytes = openWith(o.key, Buffer.from(await file.arrayBuffer())); } catch { continue; }
      if (sha256(bytes) !== e.h) continue;
      const abs = path.join(o.dir, rel);
      if (have) putAside(o.dir, rel, now);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(`${abs}.sync-new`, bytes);
      renameSync(`${abs}.sync-new`, abs);
      utimesSync(abs, new Date(e.m), new Date(e.m));
      pulled++;
    }
    for (const [rel, at] of Object.entries(theirs.deleted ?? {})) {
      const have = mine.files[rel];
      if (!safeRel(rel) || !have || have.m >= Number(at)) continue;
      putAside(o.dir, rel, now);
      removed++;
    }
    manifest(o.dir, now);
  }
  return { pulled, removed, reached };
}
