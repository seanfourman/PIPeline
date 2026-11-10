// Builds installer/out/PipSetup.exe from pip.iss. It stages the program's files into installer/stage/app as git sees
// them, tracked or new and not ignored (so nothing in user/, and no keys, PDFs or packages), less what is personal or
// only for working on the program: links/ (chats), tests/, site/ (the phone site, which runs elsewhere), .github/,
// assets/ and media/ (the READMEs' pictures), docs/ and this folder. With them go the lockfiles git ignores, so a computer installing it
// gets the very versions of the packages tried here. Beside them goes the build's version (version.ts), which an
// installed Pip updates itself by. Then it draws the installer's pictures (art.ts), builds the launcher (launcher.cs)
// and runs Inno Setup's compiler. Run from the repository: bun installer/build.ts (Inno Setup 6, or its ISCC.exe as
// ISCC).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drawArt } from "./art";
import { VERSION_FILE, versions } from "./version";

const ROOT = path.resolve(import.meta.dir, "..");
const STAGE = path.join(import.meta.dir, "stage");
const LEFT_OUT = ["links/", "tests/", "site/", ".github/", "assets/", "media/", "docs/", "installer/", ".pytest_cache/", ".cz.toml"];

const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" });
if (listed.status !== 0) throw new Error(`git ls-files: ${listed.stderr}`);
const files = listed.stdout.split("\0").filter((f) => f && !LEFT_OUT.some((out) => f.startsWith(out)) && existsSync(path.join(ROOT, f)));
const locks = ["web/bun.lock", ...new Bun.Glob(".agents/skills/*/cli/bun.lock").scanSync({ cwd: ROOT, dot: true })].filter((f) => existsSync(path.join(ROOT, f)));

rmSync(STAGE, { recursive: true, force: true });
for (const f of [...files, ...locks]) {
  const to = path.join(STAGE, "app", f);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(path.join(ROOT, f), to);
}
const stamp = versions(path.join(STAGE, "app"));
writeFileSync(path.join(STAGE, "app", VERSION_FILE), JSON.stringify(stamp));
drawArt(STAGE);
console.log(`staged ${files.length} files and ${locks.length} lockfiles, version ${stamp.windows.slice(0, 12)} (Windows), ${stamp.mac.slice(0, 12)} (Mac)`);

// The launcher, Pip.exe (launcher.cs), with Pip's icon, by the C# compiler of the .NET Framework every Windows has; UI
// Automation, which it picks Pip's tab in a browser with, is in the Framework's WPF folder.
const framework = path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");
const launcher = spawnSync(path.join(framework, "csc.exe"), ["/nologo", "/target:winexe", "/optimize+", "/codepage:65001",
  `/win32icon:${path.join(STAGE, "pip.ico")}`, `/lib:${path.join(framework, "WPF")}`, "/r:UIAutomationClient.dll", "/r:UIAutomationTypes.dll",
  "/r:WindowsBase.dll", `/out:${path.join(STAGE, "Pip.exe")}`, path.join(import.meta.dir, "launcher.cs")], { encoding: "utf8" });
if (launcher.status !== 0) throw new Error(`csc: ${launcher.stdout}${launcher.stderr}`);

const iscc = [
  process.env.ISCC,
  path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
  path.join(process.env["ProgramFiles(x86)"] ?? "", "Inno Setup 6", "ISCC.exe"),
  path.join(process.env.ProgramFiles ?? "", "Inno Setup 6", "ISCC.exe"),
].find((p) => p && existsSync(p));
if (!iscc) {
  console.error("Inno Setup 6 isn't installed: https://jrsoftware.org/isdl.php (or set ISCC to its ISCC.exe)");
  process.exit(1);
}
const compiled = spawnSync(iscc, ["/Qp", path.join(import.meta.dir, "pip.iss")], { stdio: "inherit" });
process.exit(compiled.status ?? 1);
