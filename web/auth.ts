// The login: one account on this computer, made on the first visit (the user picks the name and the password, by the
// rules in ui/account-rules.ts) and kept in the user's folder as the name and a hash of the password, never the
// password itself. The name is the same name in any case, as on the site. Forgetting the password: deleting
// user/app/account.json lets the next visit make the account again, with nothing else lost.
// A login outlasts the server: kept in user/app/sessions.json by a hash of its id (the id itself is only in the
// browser's cookie), with when it was last used, for SESSION_MS. So Pip starting again, as it does when it updates
// itself, doesn't ask for the login again. Logins belong to the account they were made for: an account made again
// starts with none. The account also has an id and a salt (accounts.ts), and wherever its password is typed, the key
// its computers seal what they send each other with is made from them and kept (synckey.ts).
// The browser keeps its logins to this computer's other accounts too, in a cookie of their own (rememberedOf), as on a
// social site: opening one of them again takes no password while its login lasts.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { deriveKey, loadKey, newSalt, saveKey } from "./synckey";
import { commonPasswords, nameProblem, passwordError } from "./ui/account-rules";
import { APP_DIR } from "./user";

export const SESSION_COOKIE = "job_session";
const ACCOUNT_FILE = path.join(APP_DIR, "account.json");
// How long a login lasts unused, and how often its last use is written down.
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_MS = 60 * 60 * 1000;
// The most common passwords, the list the board checks too, read once; without it the other rules still hold.
const COMMON_FILE = path.join(import.meta.dir, "public", "common-passwords.txt");
let common: Set<string> | null = null;
const commonOnes = () => {
  try { common ??= commonPasswords(readFileSync(COMMON_FILE, "utf8")); } catch { common = new Set(); }
  return common;
};

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export const sessionOf = (cookieHeader: string | null) =>
  (cookieHeader ?? "").split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? "";

export class AccountError extends Error {}

export function createAuth(file = ACCOUNT_FILE) {
  const sessionsFile = path.join(path.dirname(file), "sessions.json");
  // The account's folder, which its key is kept in: the folder app/ is in.
  const accountDir = path.dirname(path.dirname(file));
  const read = (): { user: string; hash: string; id?: string; salt?: string } | null => {
    try {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      return typeof saved?.user === "string" && typeof saved?.hash === "string" ? saved : null;
    } catch {
      return null;
    }
  };
  // The account's key, made from the password just typed, unless this computer has it already.
  const keep = (password: string) => {
    const salt = read()?.salt;
    if (salt && !loadKey(accountDir)) {
      try { saveKey(accountDir, deriveKey(password, salt)); } catch { /* kept the next time the password is typed */ }
    }
  };
  // Which account the logins written down are for.
  const accountTag = () => {
    const account = read();
    return account ? sha256(`${account.user}\0${account.hash}`) : "";
  };
  // The logins written down for this account, by the hash of each id, with when each was last used.
  const sessions = (() => {
    try {
      const kept = JSON.parse(readFileSync(sessionsFile, "utf8"));
      if (!kept?.account || kept.account !== accountTag()) return new Map<string, number>();
      return new Map(Object.entries(kept.sessions ?? {}).filter(([, at]) => typeof at === "number" && Date.now() - at < SESSION_MS) as [string, number][]);
    } catch {
      return new Map<string, number>();
    }
  })();
  // Written whole and then put in place, so a stop halfway leaves the last list as it was; one that can't be written
  // keeps its logins for this run.
  const save = () => {
    try {
      mkdirSync(path.dirname(sessionsFile), { recursive: true });
      writeFileSync(`${sessionsFile}.new`, JSON.stringify({ account: accountTag(), sessions: Object.fromEntries(sessions) }));
      renameSync(`${sessionsFile}.new`, sessionsFile);
    } catch { /* kept in memory still */ }
  };
  const open = () => {
    const id = crypto.randomUUID().replaceAll("-", "");
    sessions.set(sha256(id), Date.now());
    save();
    return id;
  };
  // Whether the name and password are the account's, without logging in (another computer joining it).
  const verify = async (user: unknown, password: unknown) => {
    const account = read();
    if (!account) return false;
    const userOk = same(String(user ?? "").trim().toLowerCase(), account.user.toLowerCase());
    const passwordOk = await Bun.password.verify(String(password ?? ""), account.hash).catch(() => false);
    if (userOk && passwordOk) keep(String(password));
    return userOk && passwordOk;
  };
  // Throws the first thing wrong with a new account's name or password.
  const validate = (name: string, secret: string) => {
    if (read()) throw new AccountError("account_exists");
    if (nameProblem(name).problem) throw new AccountError("account_name");
    const wrong = passwordError(secret, name, commonOnes());
    if (wrong) throw new AccountError(wrong);
  };
  // Whether a login's id is one of the account's, still in use: its last use written down once an hour at most.
  const holds = (id: string) => {
    const key = id ? sha256(id) : "";
    const at = sessions.get(key);
    if (at === undefined) return false;
    if (Date.now() - at >= SESSION_MS) {
      sessions.delete(key);
      save();
      return false;
    }
    if (Date.now() - at >= TOUCH_MS) {
      sessions.set(key, Date.now());
      save();
    }
    return true;
  };
  return {
    // No account yet: the first visit makes one.
    needsAccount: () => !read(),
    user: () => read()?.user ?? "",
    // Whether an account could be made so, before anything else is done for it (its name taken on the site).
    validate: (user: unknown, password: unknown) => validate(String(user ?? "").trim(), String(password ?? "")),
    // Makes the account, once, and logs it in: returns the new session id.
    async create(user: unknown, password: unknown): Promise<string> {
      const name = String(user ?? "").trim();
      const secret = String(password ?? "");
      validate(name, secret);
      mkdirSync(path.dirname(file), { recursive: true });
      const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
      writeFileSync(file, JSON.stringify({ user: name, hash: await Bun.password.hash(secret), id, salt: newSalt() }));
      keep(secret);
      sessions.clear();
      return open();
    },
    verify,
    // Returns a new session id, or null when the name or password is wrong.
    login: async (user: unknown, password: unknown): Promise<string | null> => ((await verify(user, password)) ? open() : null),
    // Whether the cookie carries a login of the account's, still in use.
    check: (cookieHeader: string | null) => holds(sessionOf(cookieHeader)),
    // The same for a login's id itself: one the browser remembers for this account while another is open.
    holds,
    logout(cookieHeader: string | null) {
      const id = sessionOf(cookieHeader);
      if (id && sessions.delete(sha256(id))) save();
    },
  };
}

export const sessionCookie = (id: string) => `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/`;
export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

// A page of Pip asked for by the person at the browser, not by another site: its address typed, a bookmark, or a link
// opened from another program such as a mail app (all Sec-Fetch-Site: none), or a click on Pip's own page
// (same-origin, with the user's click: Sec-Fetch-User). The browser sets these itself and no page can fake them.
// Another site's link, a page on another of this computer's ports (same-site: a site ignores the port), a script's
// request, a frame, or a program that sends none of these (curl) never pass. Such a browser is let past the start
// link's cookie (server.ts), on to the login, where the account's password is still asked for. Sean chose this on
// 2026-11-09, so that Pip opens in Edge or Chrome as well as in the browser its shortcut opens.
export function openedByHand(headers: Headers): boolean {
  if (headers.get("sec-fetch-mode") !== "navigate" || headers.get("sec-fetch-dest") !== "document") return false;
  const site = headers.get("sec-fetch-site");
  return site === "none" || (site === "same-origin" && headers.get("sec-fetch-user") === "?1");
}

// The browser's logins to this computer's other accounts, each by the account's id (accounts.ts) and the login's id,
// as "<account>.<login>" joined by "_". Kept as long as the login's own cookie is, and never passed on by the site
// (remote.ts), so it opens nothing from the phone.
export const REMEMBERED_COOKIE = "job_accounts";
const REMEMBERED = /^([0-9a-f]{16,32})\.([0-9a-f]{32})$/;
const REMEMBERED_MAX = 20;
export function rememberedOf(cookieHeader: string | null) {
  const value = (cookieHeader ?? "").split(/;\s*/).find((c) => c.startsWith(`${REMEMBERED_COOKIE}=`))?.slice(REMEMBERED_COOKIE.length + 1) ?? "";
  const kept = new Map<string, string>();
  for (const one of value.split("_").slice(0, REMEMBERED_MAX)) {
    const m = one.match(REMEMBERED);
    if (m) kept.set(m[1], m[2]);
  }
  return kept;
}
export const rememberedCookie = (kept: Map<string, string>) => kept.size
  ? `${REMEMBERED_COOKIE}=${[...kept].slice(0, REMEMBERED_MAX).map(([account, login]) => `${account}.${login}`).join("_")}; HttpOnly; SameSite=Strict; Path=/`
  : `${REMEMBERED_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
