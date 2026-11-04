// Secrets kept on this computer (the mail password, the AI keys), sealed with Windows' own DPAPI for this user.
// An agent's command may read files without asking (Codex runs plain reads on its own), so a read of the file
// shows only ciphertext; opening it takes a call to Windows that an agent's command would have to ask for, and
// the approval shows it. Elsewhere a secret stays as it is, in a file only the user can read. The secret goes
// to PowerShell through stdin, never an argument, and an opened one is kept in this process's memory only.
const PREFIX = "dpapi:";
const SEAL = "Add-Type -AssemblyName System.Security; $b = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))";
const OPEN = "Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser')))";
const opened = new Map<string, string>();

export const canSeal = process.platform === "win32";
export const isSealed = (value: string) => value.startsWith(PREFIX);

function powershell(script: string, input: string) {
  const r = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], { stdin: Buffer.from(input, "utf8"), stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`DPAPI failed: ${r.stderr.toString().trim().slice(0, 200)}`);
  return r.stdout.toString("utf8").trim();
}

export function seal(secret: string) {
  if (!canSeal || !secret) return secret;
  const sealed = PREFIX + powershell(SEAL, secret);
  opened.set(sealed, secret);
  return sealed;
}

// A sealed secret opened, or one saved before sealing, as it is.
export function unseal(value: string) {
  if (!isSealed(value)) return value;
  const known = opened.get(value);
  if (known !== undefined) return known;
  const secret = powershell(OPEN, value.slice(PREFIX.length));
  opened.set(value, secret);
  return secret;
}
