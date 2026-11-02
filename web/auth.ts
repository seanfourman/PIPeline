// The login. For now there is one account, admin with the password admin, as Sean asked.
// Sessions live in memory, so starting the server again asks for the login again.
import { timingSafeEqual } from "node:crypto";

const ACCOUNT = { user: "admin", password: "admin" };
export const SESSION_COOKIE = "job_session";

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const sessionOf = (cookieHeader: string | null) =>
  (cookieHeader ?? "").split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? "";

export function createAuth(account = ACCOUNT) {
  const sessions = new Set<string>();
  return {
    // Returns a new session id, or null when the name or password is wrong.
    login(user: unknown, password: unknown): string | null {
      const userOk = same(String(user ?? ""), account.user);
      const passwordOk = same(String(password ?? ""), account.password);
      if (!userOk || !passwordOk) return null;
      const id = crypto.randomUUID().replaceAll("-", "");
      sessions.add(id);
      return id;
    },
    check: (cookieHeader: string | null) => sessions.has(sessionOf(cookieHeader)),
    logout: (cookieHeader: string | null) => { sessions.delete(sessionOf(cookieHeader)); },
  };
}

export const sessionCookie = (id: string) => `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/`;
export const clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
