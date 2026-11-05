// Phone access: this computer keeps a connection open to the site (site/server.ts), and the site passes along it
// each request its owner's phone makes there. This file answers them with the server's own handler, as if they were
// made here, so the phone gets the whole interface and the account's login guards it as it does here. Nothing on
// this computer is opened to the internet: the connection goes out from it. Linking takes the account's name on the
// site and keeps the key it gives, sealed (vault.ts), in user/app/remote.json.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APP_DIR } from "./user";
import { seal, unseal } from "./vault";

const FILE = path.join(APP_DIR, "remote.json");
// Pieces small enough for the site's message limit once in base64 (site/relay.ts).
const PIECE = 256 * 1024;
const RETRY_MAX_MS = 30_000;
// What of a phone's request reaches the handler: its type, and its session with this computer, nothing else. The
// rest is what a request from this computer carries (server.ts's checks), since the site already let it through.
const PASSED_HEADERS = ["content-type", "accept", "range"];

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

export function createRemote({ handle, port, localToken, file = FILE, defaultSite = "" }: {
  handle: (req: Request) => Promise<Response>; port: number; localToken: string; file?: string; defaultSite?: string;
}) {
  let ws: WebSocket | null = null;
  let state: RemoteState = "off";
  let error = "";
  let retry = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const running = new Map<string, AbortController>();
  const arriving = new Map<string, { req: any; parts: Buffer[] }>();

  // The link as saved, its key still sealed; read opens the key for when it is used.
  const saved = (): Saved | null => {
    try {
      const s = JSON.parse(readFileSync(file, "utf8"));
      return s?.site && s?.name && s?.key ? { site: s.site, name: s.name, key: s.key } : null;
    } catch {
      return null;
    }
  };
  const read = (): Saved | null => {
    const s = saved();
    try { return s ? { ...s, key: unseal(s.key) } : null; } catch { return null; }
  };
  const send = (msg: unknown) => { try { ws?.send(JSON.stringify(msg)); } catch { /* reconnecting */ } };

  // One request from the phone, answered by the handler and sent back as it comes: the head, then the body in pieces.
  async function answer(msg: any, body: Buffer) {
    const control = new AbortController();
    running.set(msg.id, control);
    const headers = new Headers({ host: `127.0.0.1:${port}` });
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
    start: connect,
    stop: close,
    // Takes the account's name on the site and keeps the key it gives; then connects.
    async link(site: unknown, name: string) {
      const origin = siteAddress(site);
      if (!name) throw new RemoteError("remote_no_account");
      const res = await fetch(`${origin}/api/site/link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
      if (!res) throw new RemoteError("remote_unreachable");
      const data = await res.json().catch(() => ({})) as { key?: string; error?: string };
      if (!res.ok || !data.key) throw new RemoteError(data.error ?? "remote_unreachable");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ site: origin, name, key: seal(data.key) }));
      error = "";
      connect();
    },
    // Gives the name back on the site, so it can be taken again, and stops.
    async unlink() {
      const link = read();
      close();
      state = "off";
      if (link) await fetch(`${link.site}/api/site/unlink`, { method: "POST", headers: { Authorization: `Bearer ${link.key}` } }).catch(() => null);
      if (existsSync(file)) rmSync(file, { force: true });
    },
  };
}
