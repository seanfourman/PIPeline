// Puts the site on Railway. Its own files and a fresh build of the app's interface (web/public with its bundle, which
// the site shows a phone until it reaches its computer) are gathered in a folder of their own, outside the
// repository, and uploaded from there: nothing else leaves the computer, but for the installers, once built (bun
// installer/build.ts), which go along for the download on a computer: Windows' PipSetup.exe, and a Mac's install.sh
// with the program's staged files beside it as pip-app.tar.gz, its hash written into the script, and the icon the
// script makes Pip's app of.
//
// Run: bun site/deploy.ts, with this folder linked to the project (railway link). RAILWAY names the CLI when it isn't
// on the PATH, and anything after the script goes to `railway up` too. --stage-only gathers the folder and prints
// where it is, without uploading. PIP_SITE is the site's address for the Mac's script, the one on Railway if not set.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildInterface } from "../web/build";

const SITE = import.meta.dir;
const ADDRESS = process.env.PIP_SITE ?? "https://pip-site-production-8fff.up.railway.app";
const PUBLIC = path.join(SITE, "..", "web", "public");
const BUILT = path.join(PUBLIC, "build");
const INSTALLER = path.join(SITE, "..", "installer");
const SETUP = path.join(INSTALLER, "out", "PipSetup.exe");
const STAGED = path.join(INSTALLER, "stage");
const STAGE = path.join(os.tmpdir(), "pip-site-stage");
const FILES = ["Dockerfile", "railway.json", "server.ts", "relay.ts", "store.ts"];

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
  const script = readFileSync(path.join(INSTALLER, "install-mac.sh"), "utf8").replaceAll("\r\n", "\n");
  writeFileSync(path.join(STAGE, "app", "install.sh"), script.replaceAll("@SITE@", ADDRESS).replaceAll("@APP_SHA256@", hash));
  if (existsSync(path.join(STAGED, "pip.png"))) cpSync(path.join(STAGED, "pip.png"), path.join(STAGE, "app", "pip-icon.png"));
  console.log("with the Mac's install");
} else console.log("no staged program: no Mac install");

const extra = process.argv.slice(2).filter((a) => a !== "--stage-only");
if (process.argv.includes("--stage-only")) {
  console.log(STAGE);
} else {
  const up = Bun.spawnSync([process.env.RAILWAY ?? "railway", "up", STAGE, "--path-as-root", "--detach", ...extra], { cwd: SITE, stdout: "inherit", stderr: "inherit" });
  process.exit(up.exitCode ?? 1);
}
