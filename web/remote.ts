// The site: this computer keeps a connection open to it (site/server.ts), and the site passes along it each request a
// browser tied to this computer makes there, from this computer or a phone. This file answers them with the server's
// own handler, as if they were made here, so the browser gets the whole interface and the account's login guards it
// as it does here. Nothing on this computer is opened to the internet: the connection goes out from it.
// An installed Pip (pairWith, its site) pairs as soon as it starts, before it has an account, and opens itself on the
// site (openUrl); the account's name, once there is one, is what signing in there takes (claim). One run from the
// repository links from the settings instead, by the account's name. Either way the key the site gives is kept,
// sealed (vault.ts), with the computer's own files in users/remote.json (accounts.ts), since the link is the
// computer's, whichever account is open; turning it off from the settings leaves a note there that it is off. The site
// knows which account is open here (open), and passes along the requests the account's other computers make here
// (sync.ts), marked as theirs.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REMOTE_FILE } from "./accounts";
import { seal, unseal } from "./vault";

const FILE = REMOTE_FILE;
// Pieces small enough for the site's message limit once in base64 (site/relay.ts).
const PIECE = 256 * 1024;
const RETRY_MAX_MS = 30_000;
// What of a phone's request reaches the handler: its type, and its session with this computer, nothing else. The
// rest is what a request from this computer carries (server.ts's checks), since the site already let it through. A
// request from another computer of the account carries which one and the account, which only the site sets.
const PASSED_HEADERS = ["content-type", "accept", "range", "x-pip-peer", "x-pip-account"];
// How long asking another computer of the account may take: a file can be big.
const PEER_WAIT_MS = 5 * 60_000;

export type RemoteState = "off" | "connecting" | "on";
export type RemoteStatus = { linked: boolean; site: string; name: string; state: RemoteState; error: string };
type Saved = { site: string; name: string; key: string };

export class RemoteError extends Error {}

// The site's address as typed: https unless it is this computer (a site run here to try it has no certificate, so
// plain http is taken for it), and no path or slash at the end.
export function siteAddress(input: unknown) {
  const text = String(input ?? "").trim().replace(/\/+$/, "");
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : /^(localhost|127\.0\.0\.1)(:|$)/i.test(text) ? `http://${text}` : `https://${text}`);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !local) throw new Error("not https");
    return url.origin;
  } catch {
    throw new RemoteError("remote_address");
  }
}

// How long opening Pip waits for its site before it opens here instead.
const OPEN_WAIT_MS = 4000;
// How long the board making the account waits to hear whether a name is free.
const FREE_WAIT_MS = 5000;

export function createRemote({ handle, port, localToken, file = FILE, defaultSite = "", pairWith = "", accountName = () => "" }: {
  handle: (req: Request) => Promise<Response>; port: number; localToken: string; file?: string; defaultSite?: string;
  pairWith?: string; accountName?: () => string;
}) {
  let ws: WebSocket | null = null;
  let state: RemoteState = "off";
  let error = "";
  let retry = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let pairing: Promise<void> | null = null;
  const running = new Map<string, AbortController>();
  const arriving = new Map<string, { req: any; parts: Buffer[] }>();

  // The link as saved, its key still sealed (a paired computer's name is empty until its account has one); read opens
  // the key for when it is used.
  const saved = (): Saved | null => {
    try {
      const s = JSON.parse(readFileSync(file, "utf8"));
      return s?.site && s?.key ? { site: s.site, name: String(s.name ?? ""), key: s.key } : null;
    } catch {
      return null;
    }
  };
  const read = (): Saved | null => {
    const s = saved();
    try { return s ? { ...s, key: unseal(s.key) } : null; } catch { return null; }
  };
  const save = (link: Saved) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ site: link.site, name: link.name, key: seal(link.key) }));
  };
  // Turned off from the settings: an installed Pip then stays off its site, until linked again.
  const turnedOff = () => { try { return JSON.parse(readFileSync(file, "utf8"))?.off === true; } catch { return false; } };
  const send = (msg: unknown) => { try { ws?.send(JSON.stringify(msg)); } catch { /* reconnecting */ } };
  // Joins the site with no name yet, and connects.
  const pair = (site: string) => (pairing ??= (async () => {
    const origin = siteAddress(site);
    const res = await fetch(`${origin}/api/site/pair`, { method: "POST" }).catch(() => null);
    const data = await res?.json().catch(() => ({})) as { key?: string } | undefined;
    if (!res?.ok || !data?.key) throw new RemoteError("remote_unreachable");
    save({ site: origin, name: "", key: data.key });
    connect();
  })().finally(() => { pairing = null; }));
  // Takes the account's name on the site, for a paired computer that hasn't it there yet: none, or another one (an
  // account made again, after its password was forgotten).
  async function claim(name: string) {
    const link = read();
    if (!link || !name || link.name === name) return;
    const res = await fetch(`${link.site}/api/site/name`, {
      method: "POST", headers: { Authorization: `Bearer ${link.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!res) throw new RemoteError("remote_unreachable");
    const data = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) throw new RemoteError(data.error ?? "remote_unreachable");
    save({ ...link, name });
    send({ t: "open", name });
  }
  function start() {
    clearTimeout(timer);
    if (saved() || !pairWith || turnedOff()) return connect();
    pair(pairWith).catch(() => {
      timer = setTimeout(start, retry);
      retry = Math.min(retry * 2, RETRY_MAX_MS);
    });
  }

  // One request from the phone, answered by the handler and sent back as it comes: the head, then the body in pieces.
  async function answer(msg: any, body: Buffer) {
    const control = new AbortController();
    running.set(msg.id, control);
    // Marked as passed on from the site, so the server can tell it from a page on this computer.
    const headers = new Headers({ host: `127.0.0.1:${port}`, "x-pip-relayed": "1" });
    for (const h of PASSED_HEADERS) if (msg.headers?.[h]) headers.set(h, String(msg.headers[h]));
    const session = String(msg.headers?.cookie ?? "").match(/(?:^|;\s*)job_session=([0-9a-f]+)/)?.[1];
    headers.set("cookie", `job_token=${localToken}${session ? `; job_session=${session}` : ""}`);
    if (msg.method !== "GET" && msg.method !== "HEAD") headers.set("origin", `http://127.0.0.1:${port}`);
    try {
      const res = await handle(new Request(`http://127.0.0.1:${port}${String(msg.path).startsWith("/") ? msg.path : "/"}`, {
        method: msg.method, headers, body: body.length ? body : undefined, signal: control.signal,
      }));
      const out: [string, string][] = [...res.headers].filter(([k]) => k !== "set-cookie");
      for (const c of res.headers.getSetCookie()) out.push(["set-cookie", c]);
      send({ t: "head", id: msg.id, status: res.status, headers: out });
      if (res.body) {
        const reader = res.body.getReader();
        control.signal.addEventListener("abort", () => reader.cancel().catch(() => {}));
        for (;;) {
          const { done, value } = await reader.read();
          if (done || control.signal.aborted) break;
          for (let at = 0; at < value.length; at += PIECE) send({ t: "chunk", id: msg.id, data: Buffer.from(value.subarray(at, at + PIECE)).toString("base64") });
        }
      }
      send({ t: "end", id: msg.id });
    } catch (err) {
      if (!control.signal.aborted) send({ t: "error", id: msg.id, message: String((err as Error)?.message ?? err).slice(0, 200) });
    } finally {
      running.delete(msg.id);
    }
  }

  function receive(raw: unknown) {
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg?.t === "req") {
      if (!msg.pieces) answer(msg, Buffer.alloc(0));
      else arriving.set(msg.id, { req: msg, parts: [] });
    } else if (msg?.t === "body") {
      const a = arriving.get(msg.id);
      if (!a) return;
      a.parts.push(Buffer.from(String(msg.data ?? ""), "base64"));
      if (a.parts.length >= a.req.pieces) { arriving.delete(msg.id); answer(a.req, Buffer.concat(a.parts)); }
    } else if (msg?.t === "cancel") {
      running.get(msg.id)?.abort();
      arriving.delete(msg.id);
    }
  }

  function close() {
    clearTimeout(timer);
    clearInterval(ping);
    const old = ws;
    ws = null;
    try { old?.close(); } catch { /* closed */ }
    for (const control of running.values()) control.abort();
    running.clear();
    arriving.clear();
  }

  // Connects when linked, and again after any drop, waiting a little longer each time up to half a minute.
  function connect() {
    close();
    const link = read();
    if (!link) { state = "off"; return; }
    state = "connecting";
    const socket = new WebSocket(`${link.site.replace(/^http/, "ws")}/connect`, { headers: { Authorization: `Bearer ${link.key}` } } as any);
    ws = socket;
    socket.onopen = () => {
      state = "on";
      error = "";
      retry = 1000;
      ping = setInterval(() => send({ t: "ping" }), 25_000);
      // An account made while the site was out of reach takes its name there now; a name taken by then is said in
      // the settings, since signing in on the site doesn't work without it.
      const name = accountName();
      send({ t: "open", name });
      if (name && link.name !== name) claim(name).catch((err) => { error = err instanceof RemoteError ? err.message : "remote_unreachable"; });
    };
    socket.onmessage = (e) => receive(e.data);
    socket.onclose = (e) => {
      if (ws !== socket) return;
      clearInterval(ping);
      // The site closed it for good: the link is gone there.
      if (e.code === 4001) { rmSync(file, { force: true }); state = "off"; error = "remote_unlinked"; return; }
      state = "connecting";
      timer = setTimeout(connect, retry);
      retry = Math.min(retry * 2, RETRY_MAX_MS);
    };
    socket.onerror = () => { error = "remote_unreachable"; };
  }

  return {
    status(): RemoteStatus {
      const s = saved();
      return { linked: Boolean(s), site: s?.site ?? defaultSite, name: s?.name ?? "", state: s ? state : "off", error };
    },
    // Connects when linked; an installed Pip that isn't pairs first, and tries again while its site is out of reach.
    start,
    stop: close,
    claim,
    // Whether a name is free on the site for this computer's account (its own name is), or null when that can't be
    // told: not linked, or the site out of reach.
    async free(name: string): Promise<boolean | null> {
      const link = read();
      if (!link) return null;
      const res = await fetch(`${link.site}/api/site/free`, {
        method: "POST", headers: { Authorization: `Bearer ${link.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(FREE_WAIT_MS),
      }).catch(() => null);
      const data = await res?.json().catch(() => ({})) as { free?: unknown } | undefined;
      return res?.ok && typeof data?.free === "boolean" ? data.free : null;
    },
    // Where to open Pip in the browser: its site, by a one-time code that ties the browser to this computer, once it is
    // connected there, and whether a page of it that Pip opened here is open there still (open); or null, when it
    // isn't linked or the site doesn't answer in time, and Pip opens here.
    async openUrl(wait = OPEN_WAIT_MS): Promise<{ url: string; open: boolean } | null> {
      const by = Date.now() + wait;
      if (pairing) await Promise.race([pairing.catch(() => {}), Bun.sleep(wait)]);
      const link = read();
      if (!link) return null;
      while (state !== "on" && Date.now() < by) await Bun.sleep(100);
      if (state !== "on") return null;
      const res = await fetch(`${link.site}/api/site/code`, { method: "POST", headers: { Authorization: `Bearer ${link.key}` }, signal: AbortSignal.timeout(Math.max(500, by - Date.now())) }).catch(() => null);
      const data = await res?.json().catch(() => ({})) as { code?: string; open?: boolean } | undefined;
      return res?.ok && data?.code ? { url: `${link.site}/pair/${data.code}`, open: data.open === true } : null;
    },
    // Takes the account's name on the site and keeps the key it gives; then connects.
    async link(site: unknown, name: string) {
      const origin = siteAddress(site);
      if (!name) throw new RemoteError("remote_no_account");
      const res = await fetch(`${origin}/api/site/link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
      if (!res) throw new RemoteError("remote_unreachable");
      const data = await res.json().catch(() => ({})) as { key?: string; error?: string };
      if (!res.ok || !data.key) throw new RemoteError(data.error ?? "remote_unreachable");
      save({ site: origin, name, key: data.key });
      error = "";
      connect();
    },
    // The account's other computers, each with whether it is on; none when this computer isn't linked or the site
    // doesn't answer.
    async peers(account: string): Promise<{ id: string; online: boolean }[]> {
      const link = read();
      if (!link) return [];
      const res = await fetch(`${link.site}/api/site/peers?account=${encodeURIComponent(account)}`, { headers: { Authorization: `Bearer ${link.key}` }, signal: AbortSignal.timeout(FREE_WAIT_MS) }).catch(() => null);
      const data = await res?.json().catch(() => ({})) as { peers?: { id: string; online: boolean }[] } | undefined;
      return res?.ok && Array.isArray(data?.peers) ? data.peers : [];
    },
    // Asks another computer of the account for its list of the account's files, or one of them (sync.ts).
    async peer(account: string, to: string, what: "manifest" | "file", rel = ""): Promise<Response | null> {
      const link = read();
      if (!link) return null;
      const query = new URLSearchParams({ account, to, what, ...(what === "file" ? { p: rel } : {}) });
      return fetch(`${link.site}/api/site/peer?${query}`, { headers: { Authorization: `Bearer ${link.key}` }, signal: AbortSignal.timeout(PEER_WAIT_MS) }).catch(() => null);
    },
    // Joins an account that is on other computers: the answer of the one that checked the password, or why not
    // (no_such_account, account_offline, bad_login, remote_busy, remote_unreachable).
    async join(account: string, password: string): Promise<{ salt: string; box: string }> {
      const link = read();
      if (!link) throw new RemoteError("remote_unreachable");
      const res = await fetch(`${link.site}/api/site/join`, {
        method: "POST", headers: { Authorization: `Bearer ${link.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ account, password }),
        signal: AbortSignal.timeout(PEER_WAIT_MS),
      }).catch(() => null);
      if (!res) throw new RemoteError("remote_unreachable");
      const data = await res.json().catch(() => ({})) as { salt?: string; box?: string; error?: string };
      if (!res.ok || !data.salt || !data.box) throw new RemoteError(data.error ?? "remote_unreachable");
      return { salt: data.salt, box: data.box };
    },
    // Gives the name back on the site, so it can be taken again, and stops; Pip opens here from then on.
    async unlink() {
      const link = read();
      close();
      state = "off";
      if (link) await fetch(`${link.site}/api/site/unlink`, { method: "POST", headers: { Authorization: `Bearer ${link.key}` } }).catch(() => null);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ off: true }));
    },
  };
}
