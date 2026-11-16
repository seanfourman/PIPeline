import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { launcherKey, loadPrivateKey, PUBLIC_KEY_FILE, signatureHolds, signedText, signVersion } from "../installer/signing";
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

describe("an update's signature", () => {
  const pair = () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    return { privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
  };
  const OFFER = { app: "a".repeat(64), windows: "w".repeat(64), mac: "m".repeat(64), setup: "s".repeat(64), script: "c".repeat(64), tarball: "t".repeat(64) };

  test("vouches for each system's version and download, and for nothing changed in them", () => {
    const { privatePem, publicPem } = pair();
    const signed = signVersion(OFFER, privatePem);
    expect(signatureHolds(signedText.windows(signed), signed.windowsSig!, publicPem)).toBe(true);
    expect(signatureHolds(signedText.mac(signed), signed.macSig!, publicPem)).toBe(true);
    expect(signatureHolds(signedText.windows({ ...signed, setup: "x".repeat(64) }), signed.windowsSig!, publicPem)).toBe(false);
    expect(signatureHolds(signedText.mac({ ...signed, mac: "x".repeat(64) }), signed.macSig!, publicPem)).toBe(false);
    expect(signatureHolds(signedText.windows(signed), signed.macSig!, publicPem)).toBe(false);
    expect(signatureHolds(signedText.windows(signed), signed.windowsSig!, pair().publicPem)).toBe(false);
    // A system with no download offered gets no signature.
    expect(Object.keys(signVersion({ ...OFFER, setup: undefined }, privatePem))).not.toContain("windowsSig");
  });

  test("is checked by the launcher and the Mac's update with the key in update-key.pem, over the same words", () => {
    const installer = path.join(import.meta.dir, "..", "installer");
    // Git on GitHub's Windows runners checks the key out with \r\n, and the Mac script's copy of it keeps \n.
    const publicPem = readFileSync(PUBLIC_KEY_FILE, "utf8").replaceAll("\r\n", "\n");
    const launcher = readFileSync(path.join(installer, "launcher.cs"), "utf8");
    const { modulus, exponent } = launcherKey(publicPem);
    expect(launcher).toContain(`const string UpdateKeyModulus = "${modulus}";`);
    expect(launcher).toContain(`const string UpdateKeyExponent = "${exponent}";`);
    expect(launcher).toContain(`Signed("pip-update windows " + version + " " + sha, Field(offered, "windowsSig"))`);
    expect(signedText.windows({ windows: "V", setup: "S" })).toBe("pip-update windows V S");
    const mac = readFileSync(path.join(installer, "install-mac.sh"), "utf8").replaceAll("\r\n", "\n");
    expect(mac.match(/<<'UPDATE_KEY'\n([\s\S]*?)\nUPDATE_KEY\n/)?.[1].trim()).toBe(publicPem.trim());
    expect(mac).toContain(`printf 'pip-update mac %s %s' "$NEW" "$SHA"`);
    expect(signedText.mac({ mac: "V", script: "S" })).toBe("pip-update mac V S");
  });

  test("is made only with the private key of update-key.pem", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pip-signing-"));
    const mine = pair();
    const other = pair();
    writeFileSync(path.join(dir, "public.pem"), mine.publicPem);
    writeFileSync(path.join(dir, "mine.pem"), mine.privatePem);
    writeFileSync(path.join(dir, "other.pem"), other.privatePem);
    expect(loadPrivateKey(path.join(dir, "mine.pem"), path.join(dir, "public.pem"))).toBe(mine.privatePem);
    expect(() => loadPrivateKey(path.join(dir, "other.pem"), path.join(dir, "public.pem"))).toThrow("isn't the one");
    expect(() => loadPrivateKey(path.join(dir, "none.pem"), path.join(dir, "public.pem"))).toThrow("No update signing key");
  });
});
