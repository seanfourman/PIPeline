import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appFingerprint, siteVersion, VERSION_FILE, versions } from "../installer/version";

// A staged program and an installer folder of its own, with the files the versions are taken from.
function build(files: Record<string, string>, installer: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pip-version-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, "app", rel)), { recursive: true });
    writeFileSync(path.join(dir, "app", rel), text);
  }
  mkdirSync(path.join(dir, "installer"));
  for (const name of ["launcher.cs", "pip.iss", "art.ts", "install-mac.sh"]) writeFileSync(path.join(dir, "installer", name), installer[name] ?? name);
  return { app: path.join(dir, "app"), installer: path.join(dir, "installer") };
}
const PROGRAM = { "web/server.ts": "serve()", "web/ui/app.tsx": "app()", "tools/x.py": "print(1)" };

describe("a build's version", () => {
  test("is the program's files, each by its path and bytes, whatever order they were written in", () => {
    const a = build(PROGRAM);
    const b = build(Object.fromEntries(Object.entries(PROGRAM).reverse()));
    expect(appFingerprint(a.app)).toBe(appFingerprint(b.app));
    expect(appFingerprint(a.app)).toMatch(/^[0-9a-f]{64}$/);
    expect(appFingerprint(build({ ...PROGRAM, "web/ui/app.tsx": "app(2)" }).app)).not.toBe(appFingerprint(a.app));
    expect(appFingerprint(build({ ...PROGRAM, "web/ui/other.tsx": "app()" }).app)).not.toBe(appFingerprint(a.app));
    // The version file the build writes beside them doesn't count.
    expect(appFingerprint(build({ ...PROGRAM, [VERSION_FILE]: "{}" }).app)).toBe(appFingerprint(a.app));
  });

  test("changes for each system only with what that system installs", () => {
    const base = build(PROGRAM);
    const v = versions(base.app, base.installer);
    expect(Object.keys(v).sort()).toEqual(["app", "mac", "windows"]);
    const launcher = build(PROGRAM, { "launcher.cs": "a new launcher" });
    expect(versions(launcher.app, launcher.installer)).toEqual({ ...v, windows: expect.not.stringMatching(v.windows) });
    const mac = build(PROGRAM, { "install-mac.sh": "a new script" });
    expect(versions(mac.app, mac.installer)).toEqual({ ...v, mac: expect.not.stringMatching(v.mac) });
    const program = build({ ...PROGRAM, "web/server.ts": "serve(2)" });
    const changed = versions(program.app, program.installer);
    expect(changed.windows).not.toBe(v.windows);
    expect(changed.mac).not.toBe(v.mac);
  });

  test("goes on the site with the SHA-256 of each download", () => {
    const base = build(PROGRAM);
    const v = versions(base.app, base.installer);
    const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
    const setup = Buffer.from("setup bytes");
    const tarball = Buffer.from("tarball bytes");
    expect(siteVersion(v, { setup, script: "#!/bin/bash", tarball })).toEqual({ ...v, setup: sha(setup), script: sha("#!/bin/bash"), tarball: sha(tarball) });
    expect(siteVersion(v, {})).toEqual(v);
  });
});
