// The connections from the computers, and the requests passed along them. Each computer keeps one WebSocket open
// to the site (web/remote.ts), known by its id (store.ts); a request from its owner's browser goes down it as a head
// and its body in pieces, and the answer comes back the same way, streamed, so a conversation's live events
// (server-sent events) arrive as they happen. A browser that leaves mid-answer cancels it on the computer.
import type { ServerWebSocket } from "bun";

export type Link = { id: string };
export type Forwarded = { method: string; path: string; headers: Record<string, string>; body?: Uint8Array };
type Waiting = { ws: ServerWebSocket<Link>; head: (h: { status: number; headers: [string, string][] }) => void; fail: (e: Error) => void; stream?: ReadableStreamDefaultController<Uint8Array> };

// Pieces small enough for any WebSocket's message limit once in base64.
export const PIECE = 256 * 1024;
const HEAD_MS = 120_000;

export class Offline extends Error {}

export function createRelay() {
  const computers = new Map<string, ServerWebSocket<Link>>();
  // The account open on each computer, as it says when it connects and when another is opened (web/remote.ts).
  const open = new Map<string, string>();
  const waiting = new Map<string, Waiting>();
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
      const old = computers.get(ws.data.id);
      computers.set(ws.data.id, ws);
      if (old && old !== ws) old.close(4000, "replaced");
    },
    detach(ws: ServerWebSocket<Link>) {
      if (computers.get(ws.data.id) === ws) { computers.delete(ws.data.id); open.delete(ws.data.id); }
      for (const [id, w] of waiting) if (w.ws === ws) finish(id, new Offline("disconnected"));
    },
    // Closes a computer's connection, as when it is unlinked.
    drop(computer: string) { computers.get(computer)?.close(4001, "unlinked"); },
    online: (computer: string) => computers.has(computer),
    openOn: (computer: string) => open.get(computer) ?? "",
    message(ws: ServerWebSocket<Link>, raw: string | Buffer) {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg?.t === "open" && computers.get(ws.data.id) === ws) { open.set(ws.data.id, String(msg.name ?? "").slice(0, 40)); return; }
      const w = waiting.get(String(msg?.id ?? ""));
      if (!w || w.ws !== ws) return;
      if (msg.t === "head") w.head({ status: Number(msg.status) || 502, headers: Array.isArray(msg.headers) ? msg.headers : [] });
      else if (msg.t === "chunk") { try { w.stream?.enqueue(Buffer.from(String(msg.data ?? ""), "base64")); } catch { /* the phone left */ } }
      else if (msg.t === "end") finish(msg.id);
      else if (msg.t === "error") finish(msg.id, new Error(String(msg.message ?? "failed")));
    },
    // Passes a request to the computer and gives back its answer as it comes.
    async forward(computer: string, req: Forwarded, signal?: AbortSignal): Promise<Response> {
      const ws = computers.get(computer);
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
