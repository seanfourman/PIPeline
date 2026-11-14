// Updates signed. An installed Pip takes a new version from its site on its own (launcher.cs on Windows, the update.sh
// install-mac.sh writes on a Mac), and a SHA-256 the same site gives proves nothing about who built the download: whoever
// controlled the site could hand every installed copy a program of their own. So the site's version.json carries a
// signature for each system, made at deploy (site/deploy.ts) with a private key that never leaves the computer Pip is
// built on, and an installed Pip takes an update only when the signature checks out against the public key it was
// built with (update-key.pem, written into launcher.cs and install-mac.sh).
//
// What is signed is the version offered and the SHA-256 of what that system downloads to take it: Windows' installer
// (setup), or a Mac's install.sh (script), which holds the hash of the program's files it brings in. RSA, PKCS#1 v1.5,
// SHA-256, which the .NET Framework and macOS's openssl both check without anything added.
//
// Run once, on the computer Pip is built on: bun installer/signing.ts. It makes the key pair when there is none (the
// private key in ~/.pip-release, or PIP_UPDATE_KEY), writes the public key here, and prints the lines that carry it
// into launcher.cs and install-mac.sh. Keep a copy of the private key somewhere safe: without it no installed Pip
// takes an update again, short of being installed anew.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const PUBLIC_KEY_FILE = path.join(import.meta.dir, "update-key.pem");
export const privateKeyFile = () => process.env.PIP_UPDATE_KEY || path.join(os.homedir(), ".pip-release", "update-signing-key.pem");

type Offer = { windows?: string; mac?: string; setup?: string; script?: string };
// The words each system checks, in the same form launcher.cs and update.sh write them.
export const signedText = {
  windows: (v: Offer) => `pip-update windows ${v.windows} ${v.setup}`,
  mac: (v: Offer) => `pip-update mac ${v.mac} ${v.script}`,
};

// The site's version with a signature for each system it has a download for.
export function signVersion<T extends Offer>(version: T, privatePem: string): T & { windowsSig?: string; macSig?: string } {
  const key = createPrivateKey(privatePem);
  const sig = (text: string) => sign("sha256", Buffer.from(text, "utf8"), key).toString("base64");
  return {
    ...version,
    ...(version.windows && version.setup ? { windowsSig: sig(signedText.windows(version)) } : {}),
    ...(version.mac && version.script ? { macSig: sig(signedText.mac(version)) } : {}),
  };
}

export function signatureHolds(text: string, signature: string, publicPem: string) {
  try {
    return verify("sha256", Buffer.from(text, "utf8"), createPublicKey(publicPem), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// The public key as the .NET Framework takes it (launcher.cs): its modulus and exponent, each in base64.
export function launcherKey(publicPem: string) {
  const jwk = createPublicKey(publicPem).export({ format: "jwk" }) as { n: string; e: string };
  const plain = (b64url: string) => Buffer.from(b64url, "base64url").toString("base64");
  return { modulus: plain(jwk.n), exponent: plain(jwk.e) };
}

// The private key, checked against the public one installed copies were built with.
export function loadPrivateKey(file = privateKeyFile(), publicFile = PUBLIC_KEY_FILE) {
  if (!existsSync(file)) throw new Error(`No update signing key at ${file}. Run bun installer/signing.ts on the computer Pip is built on, or set PIP_UPDATE_KEY to the key's file.`);
  const privatePem = readFileSync(file, "utf8");
  const derived = createPublicKey(createPrivateKey(privatePem)).export({ type: "spki", format: "pem" }).toString();
  if (derived.trim() !== readFileSync(publicFile, "utf8").trim()) throw new Error(`The signing key at ${file} isn't the one installed copies check against (${publicFile}).`);
  return privatePem;
}

if (import.meta.main) {
  const file = privateKeyFile();
  if (existsSync(file)) {
    console.log(`A signing key is there already: ${file}`);
  } else {
    if (existsSync(PUBLIC_KEY_FILE)) throw new Error(`${PUBLIC_KEY_FILE} exists but its private key isn't at ${file}: put the key back (or set PIP_UPDATE_KEY) rather than make a new one, which no installed Pip would accept.`);
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    writeFileSync(PUBLIC_KEY_FILE, publicKey.export({ type: "spki", format: "pem" }));
    console.log(`Made a signing key: ${file}\nKeep a copy of it somewhere safe. The public key is in ${PUBLIC_KEY_FILE}.`);
  }
  const pem = readFileSync(PUBLIC_KEY_FILE, "utf8");
  const { modulus, exponent } = launcherKey(pem);
  console.log(`\nlauncher.cs:\n    const string UpdateKeyModulus = "${modulus}";\n    const string UpdateKeyExponent = "${exponent}";`);
  console.log(`\ninstall-mac.sh, between UPDATE_KEY lines:\n${pem.trim()}`);
}
