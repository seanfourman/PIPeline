// Puts the site on Railway. Its own files and a fresh build of the app's interface (web/public with its bundle, which
// the site shows a phone until it reaches its computer) are gathered in a folder of their own, outside the
// repository, and uploaded from there: nothing else leaves the computer, but for the installers, once built (bun
// installer/build.ts), which go along for the download on a computer: Windows' PipSetup.exe, and a Mac's install.sh
// with the program's staged files beside it as pip-app.tar.gz, its hash written into the script. With them goes
// version.json: the build's version (installer/version.ts) and the SHA-256 of each download, which an installed Pip
// asks for to update itself.
//
// Run: bun site/deploy.ts, with this folder linked to the project (railway link). RAILWAY names the CLI when it isn't
// on the PATH, and anything after the script goes to `railway up` too. --stage-only gathers the folder and prints
// where it is, without uploading. PIP_SITE is the site's address for the Mac's script, the one on Railway if not set.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { siteVersion, VERSION_FILE } from "../installer/version";
import { buildInterface } from "../web/build";

const SITE = import.meta.dir;
const ADDRESS = process.env.PIP_SITE ?? "https://pip-site-production-8fff.up.railway.app";
const PUBLIC = path.join(SITE, "..", "web", "public");
const BUILT = path.join(PUBLIC, "build");
const INSTALLER = path.join(SITE, "..", "installer");
const SETUP = path.join(INSTALLER, "out", "PipSetup.exe");
const STAGED = path.join(INSTALLER, "stage");
const STAGE = path.join(os.tmpdir(), "pip-site-stage");
// Railway's own settings for the site (the Dockerfile, the health check) live on its service, set from .railway/railway.ts
// with `railway config apply`, so they don't go with the upload.
const FILES = ["Dockerfile", "server.ts", "relay.ts", "store.ts"];

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const file of FILES) cpSync(path.join(SITE, file), path.join(STAGE, file));
// The bundle is built afresh rather than taken from public/build, which is only as new as the app's last start.
cpSync(PUBLIC, path.join(STAGE, "app"), { recursive: true, filter: (src) => src !== BUILT && !src.startsWith(BUILT + path.sep) });
await buildInterface(path.join(STAGE, "app", "build"));
// Beside the page, where server.ts finds them and offers them.
if (existsSync(SETUP)) cpSync(SETUP, path.join(STAGE, "app", "PipSetup.exe"));
console.log(existsSync(SETUP) ? "with the Windows installer" : "no Windows installer built: its download says it is coming");
if (existsSync(path.join(STAGED, "app"))) {
  const tarball = path.join(STAGE, "app", "pip-app.tar.gz");
  const tar = Bun.spawnSync(["tar", "-czf", tarball, "-C", path.join(STAGED, "app"), "."], { stdout: "pipe", stderr: "pipe" });
  if (tar.exitCode !== 0) throw new Error(`tar: ${tar.stderr.toString()}`);
  const hash = new Bun.CryptoHasher("sha256").update(readFileSync(tarball)).digest("hex");
  // Unix line ends whatever git checked it out with, or bash would read each line's \r as part of it.
  const script = readFileSync(path.join(INSTALLER, "install-mac.sh"), "utf8").replaceAll("\r\n", "\n").replaceAll("@SITE@", ADDRESS).replaceAll("@APP_SHA256@", hash);
  writeFileSync(path.join(STAGE, "app", "install.sh"), script);
  console.log("with the Mac's install");
  const stamp = path.join(STAGED, "app", VERSION_FILE);
  if (existsSync(stamp)) {
    const version = siteVersion(JSON.parse(readFileSync(stamp, "utf8")), { setup: existsSync(SETUP) ? readFileSync(SETUP) : undefined, script, tarball: readFileSync(tarball) });
    writeFileSync(path.join(STAGE, "app", "version.json"), JSON.stringify(version));
    console.log(`with version.json: ${version.windows.slice(0, 12)} (Windows), ${version.mac.slice(0, 12)} (Mac)`);
  } else console.log("no version in the staged program: installed copies won't update to this one");
} else console.log("no staged program: no Mac install");

const extra = process.argv.slice(2).filter((a) => a !== "--stage-only");
if (process.argv.includes("--stage-only")) {
  console.log(STAGE);
} else {
  const up = Bun.spawnSync([process.env.RAILWAY ?? "railway", "up", STAGE, "--path-as-root", "--detach", ...extra], { cwd: SITE, stdout: "inherit", stderr: "inherit" });
  process.exit(up.exitCode ?? 1);
}
