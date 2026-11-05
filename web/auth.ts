// The login: one account on this computer, made on the first visit (the user picks the name and the password) and
// kept in the user's folder as the name and a hash of the password, never the password itself. Sessions live in
// memory, so starting the server again asks for the login again. Forgetting the password: deleting
// user/app/account.json lets the next visit make the account again, with nothing else lost.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { APP_DIR } from "./user";

export const SESSION_COOKIE = "job_session";
const ACCOUNT_FILE = path.join(APP_DIR, "account.json");
export const NAME_MAX = 40;
export const PASSWORD_MIN = 6;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const sessionOf = (cookieHeader: string | null) =>
  (cookieHeader ?? "").split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? "";

export class AccountError extends Error {}

export function createAuth(file = ACCOUNT_FILE) {
  const sessions = new Set<string>();
  const read = (): { user: string; hash: string } | null => {
    try {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      return typeof saved?.user === "string" && typeof saved?.hash === "string" ? saved : null;
    } catch {
      return null;
    }
  };
  const open = () => {
    const id = crypto.randomUUID().replaceAll("-", "");
    sessions.add(id);
    return id;
  };
  return {
    // No account yet: the first visit makes one.
    needsAccount: () => !read(),
    user: () => read()?.user ?? "",
    // Makes the account, once, and logs it in: returns the new session id.
    async create(user: unknown, password: unknown): Promise<string> {
      if (read()) throw new AccountError("account_exists");
      const name = String(user ?? "").trim();
      const secret = String(password ?? "");
      if (!name || name.length > NAME_MAX || /[\u0000-\u001f]/.test(name)) throw new AccountError("account_name");
      if (secret.length < PASSWORD_MIN) throw new AccountError("account_password");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ user: name, hash: await Bun.password.hash(secret) }));
      return open();
    },
    // Returns a new session id, or null when the name or password is wrong.
    async login(user: unknown, password: unknown): Promise<string | null> {
      const account = read();
      if (!account) return null;
      const userOk = same(String(user ?? "").trim(), account.user);
      const passwordOk = await Bun.password.verify(String(password ?? ""), account.hash).catch(() => false);
      return userOk && passwordOk ? open() : null;
    },
    check: (cookieHeader: string | null) => sessions.has(sessionOf(cookieHeader)),
    logout: (cookieHeader: string | null) => { sessions.delete(sessionOf(cookieHeader)); },
  };
}

export const sessionCookie = (id: string) => `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/`;
export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
