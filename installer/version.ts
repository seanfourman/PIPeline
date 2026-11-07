// A build's version, for updates: a fingerprint of the program's staged files (app), and of each system's installer
// with them: Windows' (its launcher, the installer's script, the code of its pictures) and a Mac's (its install
// script). build.ts writes them into the staged program as VERSION.json; deploy.ts puts them on the site as
// version.json, with the SHA-256 of each download; an installed Pip compares the two and updates itself when they
// differ (launcher.cs on Windows, the update.sh install-mac.sh writes on a Mac).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const VERSION_FILE = "VERSION.json";
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

// Every file under dir, by its path from there with forward slashes, in order.
function filesUnder(dir: string, from = ""): string[] {
  return readdirSync(path.join(dir, from), { withFileTypes: true })
    .flatMap((entry) => {
      const rel = from ? `${from}/${entry.name}` : entry.name;
      return entry.isDirectory() ? filesUnder(dir, rel) : [rel];
    })
    .sort();
}

// The program's files, each by its path and its bytes, but the version file itself.
export function appFingerprint(dir: string) {
  const hash = createHash("sha256");
  for (const rel of filesUnder(dir)) {
    if (rel === VERSION_FILE) continue;
    hash.update(`${rel}\0`);
    hash.update(readFileSync(path.join(dir, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function versions(appDir: string, installerDir = import.meta.dir) {
  const app = appFingerprint(appDir);
  const withFiles = (...names: string[]) => sha256(app + names.map((name) => sha256(readFileSync(path.join(installerDir, name)))).join(""));
  return { app, windows: withFiles("launcher.cs", "pip.iss", "art.ts"), mac: withFiles("install-mac.sh") };
}

// What the site says of the newest build: its versions, and the SHA-256 of what each system downloads to take it
// (setup, Windows' installer; script, a Mac's install.sh, which brings in the program's files as tarball).
export function siteVersion(stamp: ReturnType<typeof versions>, downloads: { setup?: Buffer; script?: string; tarball?: Buffer }) {
  return {
    ...stamp,
    ...(downloads.setup ? { setup: sha256(downloads.setup) } : {}),
    ...(downloads.script !== undefined ? { script: sha256(downloads.script) } : {}),
    ...(downloads.tarball ? { tarball: sha256(downloads.tarball) } : {}),
  };
}
