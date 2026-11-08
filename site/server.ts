// The site: where Pip is used, from the computer it runs on and from anywhere else. Each computer keeps a connection
// open to here (web/remote.ts), so nothing at home is opened to the internet, and the site passes the requests of a
// browser tied to that computer along it (relay.ts): all the account holds comes from the computer, its login guarding
// it as it does there, and only the interface's own files come from here, the newest the site has. An installed Pip
// pairs as soon as it starts, before it has an account, and opens itself here
// by a one-time code that ties the browser it opens to it; once its owner makes the account (here), the computer takes
// the account's name, and any other browser, a phone's, signs in with that name and password, which the computer
// checks. The site keeps no password and none of the owner's files: only each computer's id and name and a hash of
// the key it connects with (store.ts).
//
// Run: bun site/server.ts. PORT (4180) and DATA_DIR (site/data) set where it listens and keeps its records. Behind
// HTTPS, as it must be when on the internet, the cookies are marked Secure.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Server } from "bun";
import { createRelay, Offline, type Link } from "./relay";
import { NAME_RULE, openStore } from "./store";

// The computer a browser is tied to, by its id; and that it was tied by Pip there, opening it on that very computer.
const COMPUTER_COOKIE = "pip_pc";
const HERE_COOKIE = "pip_here";
// How long a page of Pip on its own computer counts as open after it last asked anything: it asks every few seconds,
// but a tab out of sight for a while is let ask only once a minute.
const PAGE_SEEN_MS = 75_000;
const BODY_MAX = 40 * 1024 * 1024;
// Sign-ins that failed, per name and per address, within WINDOW_MS; past the limit the site stops passing them on.
// Links and pairings from one address are limited the same way, and the names one computer asks about.
const WINDOW_MS = 15 * 60 * 1000;
const NAME_TRIES = 10;
const ADDRESS_TRIES = 30;
const LINKS = 10;
// Whether a name is free, asked by a computer as its owner types one for the account, a few times a name.
const NAME_CHECKS = 200;
// How long a computer's one-time code ties a browser to it, unused.
const CODE_MS = 2 * 60 * 1000;
// What a browser's request takes along to the computer: its type, and the computer's own session cookie, nothing else.
const PASSED_HEADERS = ["content-type", "accept", "range"];
// The app's interface, which a browser gets from here until it reaches a computer: its sign-in, its page for a
// computer, and its screen for a computer that is off. Deployed, it is a copy beside this file (deploy.ts); run from
// the repository, the app's own.
const APP_DIRS = [path.join(import.meta.dir, "app"), path.join(import.meta.dir, "..", "web", "public")];
// The Mac's install script as text, so a browser shows what it does and curl takes it as it is.
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon", ".sh": "text/plain; charset=utf-8", ".gz": "application/gzip",
  ".txt": "text/plain; charset=utf-8", ".json": "application/json",
};

// same-origin, not no-referrer: with no referrer at all, a browser sends a write's Origin as "null" (sameSite below).
const SECURITY = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Cache-Control": "no-store", "X-Frame-Options": "DENY" };
// The interface's files under the same policy as on the computer (web/server.ts).
const PAGE_POLICY = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...SECURITY, "Content-Type": "application/json" } });

const cookieOf = (req: Request, name: string) =>
  (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
const bearer = (req: Request) => (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

// download is the installer's address, for the interface's download button on a computer: the one deploy.ts put beside
// the interface, if not given. Without either, the button says it is coming.
export function startSite({ port = 4180, dataFile = path.join(import.meta.dir, "data", "site.db"), appDir = APP_DIRS.find((d) => existsSync(d)) ?? APP_DIRS[0], download = "" }:
  { port?: number; dataFile?: string; appDir?: string; download?: string } = {}) {
  const store = openStore(dataFile);
  const relay = createRelay();
  const failures = new Map<string, number[]>();
  const tries = (key: string) => (failures.get(key) ?? []).filter((t) => Date.now() - t < WINDOW_MS);
  const failed = (...keys: string[]) => { for (const k of keys) failures.set(k, [...tries(k), Date.now()]); };
  // The computers' one-time codes, kept in memory only: one lost to a restart is just asked for again.
  const codes = new Map<string, { computer: string; until: number }>();
  // When a page that Pip opened on its own computer last asked anything, by computer, so Pip opening there again
  // knows that one is open still (its offline screen too, which goes on by itself once Pip is back).
  const seenHere = new Map<string, number>();
  const appRoot = path.resolve(appDir);
  download ||= existsSync(path.join(appRoot, "PipSetup.exe")) ? "/PipSetup.exe" : "";
  // A Mac's install, by the command that runs install.sh, once deploy.ts has put it beside the interface.
  const mac = existsSync(path.join(appRoot, "install.sh"));

  const secure = (req: Request) => req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
  const cookie = (req: Request, name: string, value: string, age = 365 * 86400) =>
    `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure(req) ? "; Secure" : ""}`;
  const address = (req: Request, server: Server) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || server.requestIP(req)?.address || "";
  // A write from a browser must come from this site's own pages: its Origin is this site, or, where a page's referrer
  // policy left the Origin out, the browser says the request is from this site.
  const sameSite = (req: Request) => {
    const origin = req.headers.get("origin");
    if (!origin || origin === "null") return req.headers.get("sec-fetch-site") === "same-origin";
    try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
  };
  // One of the interface's files, the page itself at /, or null. The browser opening an address with no file at it
  // gets the page too: the app's pages (/jobs, /chat/<id>) are addresses in it, which it shows (web/ui/app.tsx).
  const appFile = (req: Request, pathname: string) => {
    let rel: string;
    try { rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1)); } catch { return null; }
    let abs = path.join(appRoot, rel);
    if (!abs.startsWith(appRoot + path.sep)) return null;
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      if (!/\btext\/html\b/.test(req.headers.get("accept") ?? "")) return null;
      abs = path.join(appRoot, "index.html");
    }
    return new Response(Bun.file(abs), { headers: { ...SECURITY, "Content-Type": MIME[path.extname(abs)] ?? "application/octet-stream", "Content-Security-Policy": PAGE_POLICY } });
  };
  const goHome = (cookies: string[] = []) => {
    const headers = new Headers({ ...SECURITY, Location: "/" });
    for (const c of cookies) headers.append("Set-Cookie", c);
    return new Response(null, { status: 303, headers });
  };

  // The computer's answer for the browser: its cookies kept to this site, and Secure behind HTTPS.
  const toBrowser = (req: Request, res: Response) => {
    const headers = new Headers(res.headers);
    if (secure(req)) {
      headers.delete("set-cookie");
      for (const c of res.headers.getSetCookie()) headers.append("set-cookie", /;\s*secure/i.test(c) ? c : `${c}; Secure`);
    }
    return new Response(res.body, { status: res.status, headers });
  };

  // The app's sign-in, from a browser that isn't tied to a computer: the name finds the account's computers, the one
  // where it is open asked first, which checks the password (one where another account is open says so, and the next
  // is asked); its session cookie comes back to the browser with the computer's id, and from then on the browser is
  // passed along to it.
  async function signIn(req: Request, server: Server) {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const typed = String(body.user ?? "").trim();
    const password = String(body.password ?? "");
    const ip = address(req, server);
    const named = store.account(typed) ?? "";
    if (tries(`ip:${ip}`).length >= ADDRESS_TRIES || (named && tries(`name:${named.toLowerCase()}`).length >= NAME_TRIES)) return json({ error: "remote_busy" }, 429);
    if (!named) {
      failed(`ip:${ip}`);
      return json({ error: "bad_login" }, 401);
    }
    const here = (id: string) => relay.openOn(id).toLowerCase() === named.toLowerCase();
    const on = store.members(named).filter((id) => relay.online(id));
    for (const id of [...on.filter(here), ...on.filter((id) => !here(id))]) {
      const res = await relay.forward(id, {
        method: "POST", path: "/api/login", headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify({ user: named, password })),
      }).catch(() => null);
      await res?.body?.cancel().catch(() => {});
      if (!res || res.status === 409 || (!res.ok && res.status !== 401)) continue;
      if (!res.ok) {
        failed(`ip:${ip}`, `name:${named.toLowerCase()}`);
        return json({ error: "bad_login" }, 401);
      }
      const headers = new Headers({ ...SECURITY, "Content-Type": "application/json" });
      for (const c of res.headers.getSetCookie()) headers.append("set-cookie", secure(req) && !/;\s*secure/i.test(c) ? `${c}; Secure` : c);
      headers.append("set-cookie", cookie(req, COMPUTER_COOKIE, id));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }
    return json({ error: "login_no_pc" }, 503);
  }

  const server = Bun.serve<Link, {}>({
    port,
    idleTimeout: 0,
    websocket: {
      open: (ws) => { relay.attach(ws); store.seen(ws.data.id); },
      message: (ws, msg) => relay.message(ws, msg),
      close: (ws) => relay.detach(ws),
      maxPayloadLength: 4 * 1024 * 1024,
      idleTimeout: 120,
      sendPings: true,
    },
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/health") return new Response("ok");

      // A computer. Pairing (an installed Pip, before its account) or linking (from the settings, by the account's
      // name) gives the key that opens its connection; with the key it asks for one-time codes, and takes its name.
      if (url.pathname === "/connect") {
        const machine = store.byKey(bearer(req));
        if (!machine) return new Response("Unauthorized", { status: 401 });
        return server.upgrade(req, { data: { id: machine.id } }) ? undefined : new Response("Upgrade needed", { status: 426 });
      }
      if ((url.pathname === "/api/site/link" || url.pathname === "/api/site/pair") && req.method === "POST") {
        const ip = address(req, server);
        if (tries(`link:${ip}`).length >= LINKS) return json({ error: "remote_busy" }, 429);
        failed(`link:${ip}`);
        if (url.pathname === "/api/site/pair") return json({ key: store.pair().key });
        const name = String((await req.json().catch(() => ({})) as any)?.name ?? "").trim();
        if (!NAME_RULE.test(name)) return json({ error: "remote_name" }, 400);
        const made = store.link(name);
        return made ? json({ name, key: made.key }) : json({ error: "remote_name_taken" }, 409);
      }
      if (url.pathname === "/api/site/name" && req.method === "POST") {
        const name = String((await req.json().catch(() => ({})) as any)?.name ?? "").trim();
        const done = store.name(bearer(req), name);
        if (done === "unknown") return json({ error: "remote_unlinked" }, 401);
        return done === "ok" ? json({ name }) : json({ error: done }, done === "remote_name_taken" ? 409 : 400);
      }
      // Whether a name is free for the asking computer's account: no other computer has it, in any case.
      if (url.pathname === "/api/site/free" && req.method === "POST") {
        const machine = store.byKey(bearer(req));
        if (!machine) return json({ error: "remote_unlinked" }, 401);
        if (tries(`free:${machine.id}`).length >= NAME_CHECKS) return json({ error: "remote_busy" }, 429);
        failed(`free:${machine.id}`);
        const name = String((await req.json().catch(() => ({})) as any)?.name ?? "").trim();
        if (!NAME_RULE.test(name)) return json({ error: "remote_name" }, 400);
        return json({ free: store.members(name).every((id) => id === machine.id) });
      }
      if (url.pathname === "/api/site/code" && req.method === "POST") {
        const machine = store.byKey(bearer(req));
        if (!machine) return json({ error: "remote_unlinked" }, 401);
        for (const [code, c] of codes) if (c.until < Date.now()) codes.delete(code);
        const code = crypto.randomUUID().replaceAll("-", "");
        codes.set(code, { computer: machine.id, until: Date.now() + CODE_MS });
        return json({ code, open: Date.now() - (seenHere.get(machine.id) ?? 0) < PAGE_SEEN_MS });
      }
      if (url.pathname === "/api/site/unlink" && req.method === "POST") {
        const machine = store.unlink(bearer(req));
        if (machine) relay.drop(machine.id);
        return json({ ok: Boolean(machine) });
      }

      // An account's computers keeping it alike (web/sync.ts): a computer of the account asks which others it is on,
      // and asks one of them for its list of the account's files, or for one file, passed along that one's connection
      // as a request from a peer. What comes back is sealed with the account's key, which the site hasn't.
      if (url.pathname === "/api/site/peers" || url.pathname === "/api/site/peer") {
        const machine = store.byKey(bearer(req));
        if (!machine) return json({ error: "remote_unlinked" }, 401);
        const account = url.searchParams.get("account") ?? "";
        if (!store.isMember(account, machine.id)) return json({ error: "not_member" }, 403);
        if (url.pathname === "/api/site/peers") {
          return json({ peers: store.members(account).filter((id) => id !== machine.id).map((id) => ({ id, online: relay.online(id) })) });
        }
        const to = url.searchParams.get("to") ?? "";
        const what = url.searchParams.get("what") ?? "";
        if (!["manifest", "file"].includes(what) || !store.isMember(account, to)) return json({ error: "not_member" }, 403);
        const query = what === "file" ? `?p=${encodeURIComponent(url.searchParams.get("p") ?? "")}` : "";
        try {
          return await relay.forward(to, { method: "GET", path: `/api/peer/${what}${query}`, headers: { "x-pip-peer": machine.id, "x-pip-account": account } }, req.signal);
        } catch (err) {
          return json({ error: err instanceof Offline ? "peer_offline" : "peer_no_answer" }, 503);
        }
      }
      // A computer joining an account that is on other computers: one of them that is on checks the password (the one
      // where the account is open, if any), and answers with what the new one needs, sealed with the account's key; then
      // the new one is one of the account's computers.
      if (url.pathname === "/api/site/join" && req.method === "POST") {
        const machine = store.byKey(bearer(req));
        if (!machine) return json({ error: "remote_unlinked" }, 401);
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const account = store.account(String(body.account ?? "").trim()) ?? "";
        if (tries(`join:${machine.id}`).length >= NAME_TRIES || (account && tries(`name:${account.toLowerCase()}`).length >= NAME_TRIES)) return json({ error: "remote_busy" }, 429);
        const others = account ? store.members(account).filter((id) => id !== machine.id) : [];
        if (!others.length) { failed(`join:${machine.id}`); return json({ error: "no_such_account" }, 404); }
        const on = others.filter((id) => relay.online(id));
        const to = on.find((id) => relay.openOn(id).toLowerCase() === account.toLowerCase()) ?? on[0];
        if (!to) return json({ error: "account_offline" }, 503);
        const res = await relay.forward(to, {
          method: "POST", path: "/api/peer/join", headers: { "content-type": "application/json", "x-pip-peer": machine.id, "x-pip-account": account },
          body: new TextEncoder().encode(JSON.stringify({ password: String(body.password ?? "") })),
        }).catch(() => null);
        const text = await res?.text().catch(() => "") ?? "";
        if (res?.status === 401) { failed(`join:${machine.id}`, `name:${account.toLowerCase()}`); return json({ error: "bad_login" }, 401); }
        if (!res?.ok) return json({ error: "account_offline" }, 503);
        store.join(account, machine.id);
        return new Response(text, { headers: { ...SECURITY, "Content-Type": "application/json" } });
      }

      // A browser. /pair/<code> ties it to the computer that asked for the code, once, as that computer's own; /login
      // was the sign-in's address before it was the app's own; /logout unties it.
      if (url.pathname.startsWith("/pair/")) {
        const code = url.pathname.slice("/pair/".length);
        const found = codes.get(code);
        codes.delete(code);
        const machine = found && found.until > Date.now() ? store.byId(found.computer) : null;
        return goHome(machine ? [cookie(req, COMPUTER_COOKIE, machine.id), cookie(req, HERE_COOKIE, "1")] : []);
      }
      if (url.pathname === "/login") return goHome();
      if (url.pathname === "/logout") return goHome([cookie(req, COMPUTER_COOKIE, "", 0), cookie(req, HERE_COOKIE, "", 0)]);
      const machine = store.byId(cookieOf(req, COMPUTER_COOKIE));
      const api = url.pathname.startsWith("/api/") || url.pathname === "/file";
      const reading = req.method === "GET" || req.method === "HEAD";
      if (machine && cookieOf(req, HERE_COOKIE) === "1" && (url.pathname === "/api/me" || url.pathname === "/api/state")) seenHere.set(machine.id, Date.now());
      // Not tied to a computer: the app's interface from here, which asks whether it is in and signs in through signIn.
      if (!machine) {
        if (url.pathname === "/api/me") return json({ loggedIn: false, needsAccount: false, site: true, download, mac });
        if (url.pathname === "/api/login" && req.method === "POST") return sameSite(req) ? signIn(req, server) : new Response("Forbidden", { status: 403 });
        if (api) return json({ error: "login_required" }, 401);
        return (reading && appFile(req, url.pathname)) || new Response("Not found", { status: 404, headers: SECURITY });
      }
      // Tied to a computer: the interface's own files (the page, its code, styles and fonts) still from here, the newest
      // the site has, whatever the computer's copy is, so a change to them shows as soon as the site has it, without
      // Pip on the computer installed again; what the account holds (its API, its documents) from the computer.
      if (!api && reading) {
        const own = appFile(req, url.pathname);
        if (own) return own;
      }
      // Its computer off: its API says so, and the interface shows that until the computer is back.
      const away = (status: number, error: string) => json({ error }, status);
      if (!relay.online(machine.id)) return away(503, "pc_offline");
      if (!reading && !sameSite(req)) return new Response("Forbidden", { status: 403 });
      if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX) return json({ error: "too_large" }, 413);

      const headers: Record<string, string> = {};
      for (const h of PASSED_HEADERS) { const v = req.headers.get(h); if (v) headers[h] = v; }
      const session = cookieOf(req, "job_session");
      if (session) headers.cookie = `job_session=${session}`;
      const body = reading ? undefined : new Uint8Array(await req.arrayBuffer());
      try {
        return toBrowser(req, await relay.forward(machine.id, { method: req.method, path: url.pathname + url.search, headers, body }, req.signal));
      } catch (err) {
        return err instanceof Offline ? away(503, "pc_offline") : away(504, "pc_no_answer");
      }
    },
  });
  return { server, store, relay, stop: () => { server.stop(true); store.close(); } };
}

if (import.meta.main) {
  const site = startSite({
    port: Number(process.env.PORT ?? 4180), dataFile: process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "site.db") : undefined, download: process.env.PIP_DOWNLOAD,
  });
  console.log(`Pip site: http://127.0.0.1:${site.server.port}`);
}
