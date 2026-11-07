// The login: one account on this computer, made on the first visit (the user picks the name and the password, by the
// rules in ui/account-rules.ts) and kept in the user's folder as the name and a hash of the password, never the
// password itself. The name is the same name in any case, as on the site. Forgetting the password: deleting
// user/app/account.json lets the next visit make the account again, with nothing else lost.
// A login outlasts the server: kept in user/app/sessions.json by a hash of its id (the id itself is only in the
// browser's cookie), with when it was last used, for SESSION_MS. So Pip starting again, as it does when it updates
// itself, doesn't ask for the login again. Logins belong to the account they were made for: an account made again
// starts with none.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
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

const sessionOf = (cookieHeader: string | null) =>
  (cookieHeader ?? "").split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? "";

export class AccountError extends Error {}

export function createAuth(file = ACCOUNT_FILE) {
  const sessionsFile = path.join(path.dirname(file), "sessions.json");
  const read = (): { user: string; hash: string } | null => {
    try {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      return typeof saved?.user === "string" && typeof saved?.hash === "string" ? saved : null;
    } catch {
      return null;
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
  // Throws the first thing wrong with a new account's name or password.
  const validate = (name: string, secret: string) => {
    if (read()) throw new AccountError("account_exists");
    if (nameProblem(name).problem) throw new AccountError("account_name");
    const wrong = passwordError(secret, name, commonOnes());
    if (wrong) throw new AccountError(wrong);
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
      writeFileSync(file, JSON.stringify({ user: name, hash: await Bun.password.hash(secret) }));
      sessions.clear();
      return open();
    },
    // Returns a new session id, or null when the name or password is wrong.
    async login(user: unknown, password: unknown): Promise<string | null> {
      const account = read();
      if (!account) return null;
      const userOk = same(String(user ?? "").trim().toLowerCase(), account.user.toLowerCase());
      const passwordOk = await Bun.password.verify(String(password ?? ""), account.hash).catch(() => false);
      return userOk && passwordOk ? open() : null;
    },
    // Whether the cookie carries a login, still in use: its last use written down once an hour at most.
    check(cookieHeader: string | null) {
      const id = sessionOf(cookieHeader);
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
    },
    logout(cookieHeader: string | null) {
      const id = sessionOf(cookieHeader);
      if (id && sessions.delete(sha256(id))) save();
    },
  };
}

export const sessionCookie = (id: string) => `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/`;
export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
