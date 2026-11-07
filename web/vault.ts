// Secrets kept on this computer (the mail password, the AI keys), sealed for this user: with Windows' own DPAPI, or on
// a Mac with a key of Pip's own kept in the user's keychain. An agent's command may read files without asking (Codex
// runs plain reads on its own), so a read of the file shows only ciphertext; opening it takes a call to Windows or to
// the keychain that an agent's command would have to ask for, and the approval shows it. Elsewhere a secret stays as
// it is, in a file only the user can read. The secret goes to PowerShell through stdin, never an argument, and an
// opened one is kept in this process's memory only.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "dpapi:";
const MAC_PREFIX = "keychain:";
const SEAL = "Add-Type -AssemblyName System.Security; $b = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))";
const OPEN = "Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser')))";
// The keychain item holding a Mac's key: made by the security tool, which reads it back without asking.
const KEYCHAIN_ITEM = ["-a", "pip", "-s", "Pip secrets"];
const opened = new Map<string, string>();

export const canSeal = process.platform === "win32" || process.platform === "darwin";
export const isSealed = (value: string) => value.startsWith(PREFIX) || value.startsWith(MAC_PREFIX);

function powershell(script: string, input: string) {
  const r = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], { stdin: Buffer.from(input, "utf8"), stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`DPAPI failed: ${r.stderr.toString().trim().slice(0, 200)}`);
  return r.stdout.toString("utf8").trim();
}

// A Mac's key, made the first time and kept in the login keychain from then on.
let macKey: Buffer | null = null;
function keychainKey() {
  if (macKey) return macKey;
  const found = Bun.spawnSync(["security", "find-generic-password", ...KEYCHAIN_ITEM, "-w"], { stdout: "pipe", stderr: "pipe" });
  let hex = found.exitCode === 0 ? found.stdout.toString().trim() : "";
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    hex = randomBytes(32).toString("hex");
    const made = Bun.spawnSync(["security", "add-generic-password", ...KEYCHAIN_ITEM, "-w", hex, "-U"], { stdout: "pipe", stderr: "pipe" });
    if (made.exitCode !== 0) throw new Error(`Keychain failed: ${made.stderr.toString().trim().slice(0, 200)}`);
  }
  return (macKey = Buffer.from(hex, "hex"));
}

// AES-GCM under that key: the nonce, the tag and the ciphertext, together in base64.
function macSeal(secret: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keychainKey(), nonce);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return MAC_PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64");
}
function macOpen(value: string) {
  const all = Buffer.from(value.slice(MAC_PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", keychainKey(), all.subarray(0, 12));
  decipher.setAuthTag(all.subarray(12, 28));
  return Buffer.concat([decipher.update(all.subarray(28)), decipher.final()]).toString("utf8");
}

export function seal(secret: string) {
  if (!canSeal || !secret) return secret;
  const sealed = process.platform === "darwin" ? macSeal(secret) : PREFIX + powershell(SEAL, secret);
  opened.set(sealed, secret);
  return sealed;
}

// A sealed secret opened, or one saved before sealing, as it is.
export function unseal(value: string) {
  if (!isSealed(value)) return value;
  const known = opened.get(value);
  if (known !== undefined) return known;
  const secret = value.startsWith(MAC_PREFIX) ? macOpen(value) : powershell(OPEN, value.slice(PREFIX.length));
  opened.set(value, secret);
  return secret;
}
