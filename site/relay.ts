// The connections from the computers, and the requests passed along them. Each computer keeps one WebSocket open
// to the site (web/remote.ts); a request from its owner's phone goes down it as a head and its body in pieces, and
// the answer comes back the same way, streamed, so a conversation's live events (server-sent events) arrive as they
// happen. A phone that leaves mid-answer cancels it on the computer.
import type { ServerWebSocket } from "bun";

export type Link = { name: string };
export type Forwarded = { method: string; path: string; headers: Record<string, string>; body?: Uint8Array };
type Waiting = { ws: ServerWebSocket<Link>; head: (h: { status: number; headers: [string, string][] }) => void; fail: (e: Error) => void; stream?: ReadableStreamDefaultController<Uint8Array> };

// Pieces small enough for any WebSocket's message limit once in base64.
export const PIECE = 256 * 1024;
const HEAD_MS = 120_000;

export class Offline extends Error {}

export function createRelay() {
  const computers = new Map<string, ServerWebSocket<Link>>();
  const waiting = new Map<string, Waiting>();
  const key = (name: string) => name.toLowerCase();
  const send = (ws: ServerWebSocket<Link>, msg: unknown) => { try { ws.send(JSON.stringify(msg)); } catch { /* gone */ } };
  const finish = (id: string, err?: Error) => {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    if (err) { w.fail(err); try { w.stream?.error(err); } catch { /* closed */ } } else { try { w.stream?.close(); } catch { /* closed */ } }
  };

  return {
    // A computer's new connection replaces its old one.
    attach(ws: ServerWebSocket<Link>) {
      const old = computers.get(key(ws.data.name));
      computers.set(key(ws.data.name), ws);
      if (old && old !== ws) old.close(4000, "replaced");
    },
    detach(ws: ServerWebSocket<Link>) {
      if (computers.get(key(ws.data.name)) === ws) computers.delete(key(ws.data.name));
      for (const [id, w] of waiting) if (w.ws === ws) finish(id, new Offline("disconnected"));
    },
    // Closes a computer's connection, as when it is unlinked.
    drop(name: string) { computers.get(key(name))?.close(4001, "unlinked"); },
    online: (name: string) => computers.has(key(name)),
    message(ws: ServerWebSocket<Link>, raw: string | Buffer) {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      const w = waiting.get(String(msg?.id ?? ""));
      if (!w || w.ws !== ws) return;
      if (msg.t === "head") w.head({ status: Number(msg.status) || 502, headers: Array.isArray(msg.headers) ? msg.headers : [] });
      else if (msg.t === "chunk") { try { w.stream?.enqueue(Buffer.from(String(msg.data ?? ""), "base64")); } catch { /* the phone left */ } }
      else if (msg.t === "end") finish(msg.id);
      else if (msg.t === "error") finish(msg.id, new Error(String(msg.message ?? "failed")));
    },
    // Passes a request to the named computer and gives back its answer as it comes.
    async forward(name: string, req: Forwarded, signal?: AbortSignal): Promise<Response> {
      const ws = computers.get(key(name));
      if (!ws) throw new Offline("offline");
      const id = crypto.randomUUID();
      const body = req.body ?? new Uint8Array();
      let stream!: ReadableStreamDefaultController<Uint8Array>;
      const readable = new ReadableStream<Uint8Array>({
        start(c) { stream = c; },
        cancel() { if (waiting.has(id)) { send(ws, { t: "cancel", id }); waiting.delete(id); } },
      });
      const head = new Promise<{ status: number; headers: [string, string][] }>((resolve, reject) => {
        waiting.set(id, { ws, head: resolve, fail: reject, stream });
      });
      const timer = setTimeout(() => finish(id, new Error("timeout")), HEAD_MS);
      signal?.addEventListener("abort", () => { if (waiting.has(id)) { send(ws, { t: "cancel", id }); finish(id, new Error("aborted")); } });
      send(ws, { t: "req", id, method: req.method, path: req.path, headers: req.headers, pieces: Math.ceil(body.length / PIECE) });
      for (let at = 0; at < body.length; at += PIECE) send(ws, { t: "body", id, data: Buffer.from(body.subarray(at, at + PIECE)).toString("base64") });
      try {
        const h = await head;
        const headers = new Headers();
        for (const [k, v] of h.headers) headers.append(k, v);
        return new Response([101, 204, 205, 304].includes(h.status) ? null : readable, { status: h.status, headers });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
