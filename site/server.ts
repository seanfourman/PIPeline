// The site: where a phone reaches its owner's computer. A computer links once under its account's name and then
// keeps a connection open to here (web/remote.ts), so nothing at home is opened to the internet. On a phone the
// owner signs in with that account's name and password; the site passes the sign-in to the computer, which checks
// it, and from then on passes every request of that phone to it (relay.ts). The site keeps no password and none of
// the owner's files: only each computer's name and a hash of the key it connects with (store.ts).
//
// Run: bun site/server.ts. PORT (4180) and DATA_DIR (site/data) set where it listens and keeps its records. Behind
// HTTPS, as it must be when on the internet, the cookies are marked Secure.
import path from "node:path";
import type { Server } from "bun";
import { offlinePage, signInPage } from "./pages";
import { createRelay, Offline, type Link } from "./relay";
import { NAME_RULE, openStore } from "./store";

const USER_COOKIE = "pip_user";
const BODY_MAX = 40 * 1024 * 1024;
// Sign-ins that failed, per name and per address, within WINDOW_MS; past the limit the site stops passing them on.
// Links from one address are limited the same way.
const WINDOW_MS = 15 * 60 * 1000;
const NAME_TRIES = 10;
const ADDRESS_TRIES = 30;
const LINKS = 10;
// What a phone's request takes along to the computer: its type, and the computer's own session cookie, nothing else.
const PASSED_HEADERS = ["content-type", "accept", "range"];

// same-origin, not no-referrer: with no referrer at all, a browser sends a form's Origin as "null" (sameSite below).
const SECURITY = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Cache-Control": "no-store", "X-Frame-Options": "DENY" };
const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...SECURITY, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'", ...headers } });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...SECURITY, "Content-Type": "application/json" } });

const cookieOf = (req: Request, name: string) =>
  (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";

export function startSite({ port = 4180, dataFile = path.join(import.meta.dir, "data", "site.db") }: { port?: number; dataFile?: string } = {}) {
  const store = openStore(dataFile);
  const relay = createRelay();
  const failures = new Map<string, number[]>();
  const tries = (key: string) => (failures.get(key) ?? []).filter((t) => Date.now() - t < WINDOW_MS);
  const failed = (...keys: string[]) => { for (const k of keys) failures.set(k, [...tries(k), Date.now()]); };

  const secure = (req: Request) => req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
  const userCookie = (req: Request, name: string, age = 365 * 86400) =>
    `${USER_COOKIE}=${encodeURIComponent(name)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure(req) ? "; Secure" : ""}`;
  const address = (req: Request, server: Server) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || server.requestIP(req)?.address || "";
  // A write from a phone must come from this site's own pages: its Origin is this site, or, where a page's referrer
  // policy left the Origin out, the browser says the request is from this site.
  const sameSite = (req: Request) => {
    const origin = req.headers.get("origin");
    if (!origin || origin === "null") return req.headers.get("sec-fetch-site") === "same-origin";
    try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
  };

  // The computer's answer for the phone: its cookies kept to this site, and Secure behind HTTPS.
  const toPhone = (req: Request, res: Response) => {
    const headers = new Headers(res.headers);
    if (secure(req)) {
      headers.delete("set-cookie");
      for (const c of res.headers.getSetCookie()) headers.append("set-cookie", /;\s*secure/i.test(c) ? c : `${c}; Secure`);
    }
    return new Response(res.body, { status: res.status, headers });
  };

  async function signIn(req: Request, server: Server) {
    const form = await req.formData().catch(() => null);
    const typed = String(form?.get("name") ?? "").trim();
    const password = String(form?.get("password") ?? "");
    const ip = address(req, server);
    const name = store.named(typed);
    if (tries(`ip:${ip}`).length >= ADDRESS_TRIES || (name && tries(`name:${name.toLowerCase()}`).length >= NAME_TRIES)) {
      return html(signInPage({ name: typed, error: "יותר מדי ניסיונות. אפשר לנסות שוב בעוד רבע שעה." }), 429);
    }
    if (!name) {
      failed(`ip:${ip}`);
      return html(signInPage({ name: typed, error: "שם המשתמש או הסיסמה לא נכונים." }), 401);
    }
    if (!relay.online(name)) return html(offlinePage(name), 503);
    const res = await relay.forward(name, {
      method: "POST", path: "/api/login", headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(JSON.stringify({ user: name, password })),
    }).catch(() => null);
    if (!res?.ok) {
      failed(`ip:${ip}`, `name:${name.toLowerCase()}`);
      return html(signInPage({ name: typed, error: res ? "שם המשתמש או הסיסמה לא נכונים." : "המחשב לא ענה. כדאי לנסות שוב." }), res ? 401 : 503);
    }
    await res.body?.cancel().catch(() => {});
    const headers = new Headers({ ...SECURITY, Location: "/" });
    for (const c of res.headers.getSetCookie()) headers.append("set-cookie", secure(req) && !/;\s*secure/i.test(c) ? `${c}; Secure` : c);
    headers.append("set-cookie", userCookie(req, name));
    return new Response(null, { status: 303, headers });
  }

  const server = Bun.serve<Link, {}>({
    port,
    idleTimeout: 0,
    websocket: {
      open: (ws) => { relay.attach(ws); store.seen(ws.data.name); },
      message: (ws, msg) => relay.message(ws, msg),
      close: (ws) => relay.detach(ws),
      maxPayloadLength: 4 * 1024 * 1024,
      idleTimeout: 120,
      sendPings: true,
    },
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/health") return new Response("ok");

      // A computer: linking takes its account's name, and the key that comes back opens its connection.
      if (url.pathname === "/connect") {
        const name = store.byKey((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
        if (!name) return new Response("Unauthorized", { status: 401 });
        return server.upgrade(req, { data: { name } }) ? undefined : new Response("Upgrade needed", { status: 426 });
      }
      if (url.pathname === "/api/site/link" && req.method === "POST") {
        const ip = address(req, server);
        if (tries(`link:${ip}`).length >= LINKS) return json({ error: "remote_busy" }, 429);
        failed(`link:${ip}`);
        const name = String((await req.json().catch(() => ({})) as any)?.name ?? "").trim();
        if (!NAME_RULE.test(name)) return json({ error: "remote_name" }, 400);
        const key = store.link(name);
        return key ? json({ name, key }) : json({ error: "remote_name_taken" }, 409);
      }
      if (url.pathname === "/api/site/unlink" && req.method === "POST") {
        const name = store.unlink((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
        if (name) relay.drop(name);
        return json({ ok: Boolean(name) });
      }

      // A phone.
      if (url.pathname === "/login") {
        if (req.method === "POST") return sameSite(req) ? signIn(req, server) : new Response("Forbidden", { status: 403 });
        return html(signInPage());
      }
      if (url.pathname === "/logout") {
        return new Response(null, { status: 303, headers: { ...SECURITY, Location: "/login", "Set-Cookie": userCookie(req, "", 0) } });
      }
      const name = store.named(decodeURIComponent(cookieOf(req, USER_COOKIE)));
      const api = url.pathname.startsWith("/api/") || url.pathname === "/file";
      if (!name) return api ? json({ error: "login_required" }, 401) : new Response(null, { status: 303, headers: { ...SECURITY, Location: "/login" } });
      if (!relay.online(name)) return api ? json({ error: "pc_offline" }, 503) : html(offlinePage(name), 503);
      if (req.method !== "GET" && req.method !== "HEAD" && !sameSite(req)) return new Response("Forbidden", { status: 403 });
      if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX) return json({ error: "too_large" }, 413);

      const headers: Record<string, string> = {};
      for (const h of PASSED_HEADERS) { const v = req.headers.get(h); if (v) headers[h] = v; }
      const session = cookieOf(req, "job_session");
      if (session) headers.cookie = `job_session=${session}`;
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(await req.arrayBuffer());
      try {
        return toPhone(req, await relay.forward(name, { method: req.method, path: url.pathname + url.search, headers, body }, req.signal));
      } catch (err) {
        if (err instanceof Offline) return api ? json({ error: "pc_offline" }, 503) : html(offlinePage(name), 503);
        return api ? json({ error: "pc_no_answer" }, 504) : html(offlinePage(name), 504);
      }
    },
  });
  return { server, store, relay, stop: () => { server.stop(true); store.close(); } };
}

if (import.meta.main) {
  const site = startSite({ port: Number(process.env.PORT ?? 4180), dataFile: process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "site.db") : undefined });
  console.log(`Pip site: http://127.0.0.1:${site.server.port}`);
}
