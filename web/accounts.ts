// The accounts on this computer. The open one is user/, as everything in the project expects (the agent's instructions
// name its files so); the others wait in users/<id>/, each a whole user folder of its own, by the id its account.json
// has, which is the same on all the account's computers (sync.ts). Opening another swaps the two while Pip starts again,
// since files in user/ are in use while it runs: the server writes which one to open (users/switch.json) and stops,
// and starting again, before anything reads user/ (switching.ts), it moves the open one out to users/<its id>/ and
// the other in. users/ holds the computer's own files too, which no account has: its link to the site and its id.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO } from "./policy";
import { newSalt } from "./synckey";
import { USER_DIR } from "./user";

export const USERS_DIR = path.join(REPO, "users");
const ID = /^[0-9a-f]{16,32}$/;

export type AccountFile = { user: string; hash: string; id?: string; salt?: string };
export type LocalAccount = { id: string; name: string; dir: string; open: boolean };

export const accountFile = (dir: string) => path.join(dir, "app", "account.json");
export function readAccount(dir: string): AccountFile | null {
  try {
    const a = JSON.parse(readFileSync(accountFile(dir), "utf8"));
    return typeof a?.user === "string" && typeof a?.hash === "string" ? a : null;
  } catch {
    return null;
  }
}

// An account made before there could be several has no id or salt yet: given them, once, kept with it from then on.
export function ensureIds(dir = USER_DIR): AccountFile | null {
  const account = readAccount(dir);
  if (!account || (account.id && account.salt)) return account;
  const done = { ...account, id: account.id ?? crypto.randomUUID().replaceAll("-", "").slice(0, 16), salt: account.salt ?? newSalt() };
  writeFileSync(accountFile(dir), JSON.stringify(done));
  return done;
}

// The open account first, then the others, each by its name.
export function localAccounts(users = USERS_DIR, user = USER_DIR): LocalAccount[] {
  const list: LocalAccount[] = [];
  const open = readAccount(user);
  if (open) list.push({ id: open.id ?? "", name: open.user, dir: user, open: true });
  for (const id of existsSync(users) ? readdirSync(users) : []) {
    const dir = path.join(users, id);
    const account = ID.test(id) && statSync(dir).isDirectory() ? readAccount(dir) : null;
    if (account && account.id === id) list.push({ id, name: account.user, dir, open: false });
  }
  return list;
}

export const findLocal = (name: string, users = USERS_DIR, user = USER_DIR) =>
  localAccounts(users, user).find((a) => a.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

export function requestSwitch(id: string, users = USERS_DIR) {
  mkdirSync(users, { recursive: true });
  writeFileSync(path.join(users, "switch.json"), JSON.stringify({ to: id }));
}

// A folder moved, tried for a few seconds while something still has a file in it open.
function move(from: string, to: string) {
  for (let i = 0; i < 20; i++) {
    try { renameSync(from, to); return true; } catch { Bun.sleepSync(250); }
  }
  return false;
}

// At start, the swap asked for, if any: "switched", "failed" (all left as it was), or "none". A stop halfway is mended
// at the next start: the open folder out and the other not in yet, or both moved and the note still there.
export function applySwitch(users = USERS_DIR, user = USER_DIR): "none" | "switched" | "failed" {
  const note = path.join(users, "switch.json");
  let to = "";
  try { to = String(JSON.parse(readFileSync(note, "utf8"))?.to ?? ""); } catch { return "none"; }
  const done = (result: "switched" | "failed") => { rmSync(note, { force: true }); return result; };
  if (!ID.test(to)) return done("failed");
  const open = readAccount(user);
  if (open?.id === to) return done("switched");
  const target = path.join(users, to);
  if (!existsSync(target)) return done("failed");
  // Out under its id; a folder that isn't an account (a new computer's starting files) goes aside, kept all the same.
  let away = "";
  if (existsSync(user)) {
    away = path.join(users, open?.id ?? `unused-${Date.now()}`);
    if (existsSync(away) || !move(user, away)) return done("failed");
  }
  if (move(target, user)) return done("switched");
  if (away) move(away, user);
  return done("failed");
}

// The computer's id, made the first time: the computer that runs the daily run is named by it (automation.ts).
export function computerId(users = USERS_DIR) {
  const file = path.join(users, "computer.json");
  try {
    const id = String(JSON.parse(readFileSync(file, "utf8"))?.id ?? "");
    if (ID.test(id)) return id;
  } catch { /* made below */ }
  const id = crypto.randomUUID().replaceAll("-", "");
  mkdirSync(users, { recursive: true });
  writeFileSync(file, JSON.stringify({ id }));
  return id;
}

// The computer's link to its site, kept in the open account's folder before there could be several accounts here.
export const REMOTE_FILE = path.join(USERS_DIR, "remote.json");
export function moveComputerFiles(users = USERS_DIR, user = USER_DIR) {
  const old = path.join(user, "app", "remote.json");
  const now = path.join(users, "remote.json");
  if (!existsSync(old) || existsSync(now)) return;
  mkdirSync(users, { recursive: true });
  renameSync(old, now);
}
