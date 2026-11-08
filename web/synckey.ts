// The account's own key, for what its computers send each other through the site (sync.ts): made from the account's
// password and a salt of its own (account.json, the same on all its computers) by scrypt, so every computer that knows
// the password makes the same key, and the site, which keeps no password, can't open what it passes along. A computer
// keeps it, sealed for its user (vault.ts), from when the password was typed on it: the account made, a login, or
// another computer joining the account through it. Sealing with it is AES-256-GCM: a fresh nonce, the tag, the data.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seal, unseal } from "./vault";

export const newSalt = () => randomBytes(16).toString("hex");

export const deriveKey = (password: string, salt: string) =>
  scryptSync(password, Buffer.from(salt, "hex"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export function sealWith(key: Buffer, data: Buffer | string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(typeof data === "string" ? Buffer.from(data) : data), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}

// Throws on anything not sealed with this very key, or changed on the way.
export function openWith(key: Buffer, box: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, box.subarray(0, 12));
  decipher.setAuthTag(box.subarray(12, 28));
  return Buffer.concat([decipher.update(box.subarray(28)), decipher.final()]);
}

// Kept in the account's folder, as one of the files that stay on the computer (sync.ts).
const keyFile = (accountDir: string) => path.join(accountDir, "app", "sync-key.json");
const opened = new Map<string, Buffer>();

export function saveKey(accountDir: string, key: Buffer) {
  mkdirSync(path.dirname(keyFile(accountDir)), { recursive: true });
  writeFileSync(keyFile(accountDir), JSON.stringify({ key: seal(key.toString("base64")) }));
  opened.set(accountDir, key);
}

export function loadKey(accountDir: string): Buffer | null {
  const known = opened.get(accountDir);
  if (known) return known;
  try {
    const key = Buffer.from(unseal(JSON.parse(readFileSync(keyFile(accountDir), "utf8")).key), "base64");
    if (key.length !== 32) return null;
    opened.set(accountDir, key);
    return key;
  } catch {
    return null;
  }
}
