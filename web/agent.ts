// Runs Claude sessions in the project and turns their messages into events for the browser.
import { query, type PermissionResult, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { documentPaths } from "./data";
import { ACCESS, createPolicy, REPO, type Access } from "./policy";
import { attachmentContent, type Upload } from "./uploads";

const DATA = path.join(import.meta.dir, "data", "sessions");
const IDLE_CLOSE_MS = 15 * 60 * 1000;
mkdirSync(DATA, { recursive: true });

const decide = createPolicy();
export const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

type Pending = { resolve: (r: PermissionResult) => void; tool?: string; input: Record<string, unknown>; rememberKey?: string };
type Status = "running" | "waiting" | "idle" | "error";
export type AgentEvent = Record<string, unknown> & { t: string };

class Session {
  events: AgentEvent[] = [];
  status: Status = "idle";
  claudeId?: string;
  cost = 0;
  private subscribers = new Set<(e: AgentEvent) => void>();
  private pending = new Map<string, Pending>();
  private remembered = new Set<string>();
  private inbox: SDKUserMessage["message"]["content"][] = [];
  private wake?: () => void;
  private handle?: Query;
  private closed = true;
  private idleTimer?: Timer;
  private saveTimer?: Timer;

  constructor(public id: string, public title: string, public model: string | undefined, public createdAt: number, private unattended = false, public access: Access = "ask") {}

  summary() {
    return { id: this.id, title: this.title, status: this.status, createdAt: this.createdAt, cost: this.cost, model: this.model, access: this.access };
  }

  // A new access for what comes next; a request already waiting that it now allows goes ahead at once.
  setAccess(access: Access) {
    this.access = access;
    for (const [requestId, request] of this.pending) {
      if (!request.tool || decide(request.tool, request.input, this.remembered, access).decision !== "allow") continue;
      this.pending.delete(requestId);
      request.resolve({ behavior: "allow", updatedInput: request.input });
      this.emit({ t: "resolved", requestId, code: "allowed" });
    }
    if (this.status === "waiting" && this.pending.size === 0) this.setStatus("running");
    this.scheduleSave();
  }

  subscribe(fn: (e: AgentEvent) => void) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private emit(event: AgentEvent, keep = true) {
    if (keep) { this.events.push(event); this.scheduleSave(); }
    for (const fn of this.subscribers) fn(event);
  }

  private setStatus(status: Status) {
    this.status = status;
    this.emit({ t: "status", status }, false);
    this.scheduleSave();
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 250);
  }

  save() {
    writeFileSync(path.join(DATA, `${this.id}.json`), JSON.stringify({ ...this.summary(), claudeId: this.claudeId, events: this.events }));
  }

  // A message, with the files attached to it, if any: the chat keeps what they were, Claude gets them (uploads.ts).
  send(text: string, uploads: (Upload & { file: string })[] = []) {
    this.emit({ t: "user", text, ...(uploads.length ? { files: uploads.map(({ id, name, kind, size }) => ({ id, name, kind, size })) } : {}) });
    this.inbox.push(uploads.length ? attachmentContent(text, uploads) : text);
    clearTimeout(this.idleTimer);
    this.setStatus("running");
    if (this.closed) this.start();
    this.wake?.();
  }

  private async *input(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      const content = this.inbox.shift();
      if (content === undefined) {
        await new Promise<void>((resolve) => { this.wake = resolve; });
        continue;
      }
      yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: this.claudeId ?? "" };
    }
  }

  private start() {
    this.closed = false;
    this.handle = query({
      prompt: this.input(),
      options: {
        cwd: REPO,
        model: this.model,
        resume: this.claudeId,
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        permissionMode: "default",
        disallowedTools: ["PowerShell"],
        includePartialMessages: true,
        canUseTool: (tool, input, { signal }) => this.authorize(tool, input, signal),
      },
    });
    this.consume().catch((err) => {
      this.emit({ t: "error", text: String(err?.message ?? err) });
      this.setStatus("error");
    }).finally(() => { this.closed = true; this.wake?.(); });
  }

  private authorize(tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    const requestId = crypto.randomUUID();
    if (tool !== "AskUserQuestion") {
      // An unattended run is always judged as one that asks, whatever was picked.
      const verdict = decide(tool, input, this.remembered, this.unattended ? "ask" : this.access);
      if (verdict.decision === "allow") return Promise.resolve({ behavior: "allow", updatedInput: input });
      if (this.unattended) return Promise.resolve(this.refuse(`${tool}: ${describeInput(tool, input).slice(0, 300)}`));
      this.emit({ t: "permission", requestId, tool, input: describeInput(tool, input), canRemember: Boolean(verdict.rememberKey) });
      return this.park(requestId, input, signal, verdict.rememberKey, tool);
    }
    if (this.unattended) return Promise.resolve(this.refuse(""));
    this.emit({ t: "question", requestId, questions: input.questions });
    return this.park(requestId, input, signal);
  }

  // Nobody is there to approve, and an automatic run must never have more rights than a watched one.
  private refuse(what: string): PermissionResult {
    this.emit({ t: "error", code: what ? "unattended_denied" : "unattended_question", text: what });
    return { behavior: "deny", message: "This is an unattended run, so nobody can approve this or answer. Do not retry it or work around it. Skip this step and say so in your final message." };
  }

  private park(requestId: string, input: Record<string, unknown>, signal: AbortSignal, rememberKey?: string, tool?: string) {
    this.setStatus("waiting");
    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(requestId, { resolve, tool, input, rememberKey });
      signal.addEventListener("abort", () => {
        if (this.pending.delete(requestId)) {
          this.emit({ t: "resolved", requestId, code: "cancelled" });
          resolve({ behavior: "deny", message: "Cancelled" });
        }
      });
    });
  }

  respond(requestId: string, body: { allow?: boolean; remember?: boolean; answers?: Record<string, string> }) {
    const request = this.pending.get(requestId);
    if (!request) return false;
    this.pending.delete(requestId);
    if (body.answers) {
      request.resolve({ behavior: "allow", updatedInput: { ...request.input, answers: body.answers } });
      this.emit({ t: "resolved", requestId, answer: Object.values(body.answers).join(" · ") });
    } else if (body.allow) {
      if (body.remember && request.rememberKey) this.remembered.add(request.rememberKey);
      request.resolve({ behavior: "allow", updatedInput: request.input });
      this.emit({ t: "resolved", requestId, code: "allowed" });
    } else {
      request.resolve({ behavior: "deny", message: "The user declined this action." });
      this.emit({ t: "resolved", requestId, code: "denied" });
    }
    if (this.pending.size === 0) this.setStatus("running");
    return true;
  }

  async interrupt() {
    for (const [id, request] of this.pending) {
      request.resolve({ behavior: "deny", message: "The user stopped this run.", interrupt: true });
      this.emit({ t: "resolved", requestId: id, code: "stopped" });
    }
    this.pending.clear();
    await this.handle?.interrupt().catch(() => {});
  }

  private async consume() {
    for await (const message of this.handle!) {
      if (message.session_id) this.claudeId = message.session_id;
      const parent = (message as { parent_tool_use_id?: string | null }).parent_tool_use_id ?? null;

      if (message.type === "stream_event" && !parent) {
        const event = message.event as { type: string; delta?: { type: string; text?: string } };
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          this.emit({ t: "delta", text: event.delta.text }, false);
        }
      } else if (message.type === "assistant") {
        for (const block of message.message.content as any[]) {
          if (block.type === "text" && !parent && block.text.trim()) this.emit({ t: "text", text: block.text });
          if (block.type === "tool_use") this.emit({ t: "tool", id: block.id, name: block.name, target: toolTarget(block.name, block.input), nested: Boolean(parent), files: toolFiles(block.name, block.input) });
        }
      } else if (message.type === "user") {
        const content = (message.message as { content: unknown }).content;
        for (const block of Array.isArray(content) ? (content as any[]) : []) {
          if (block.type === "tool_result") this.emit({ t: "tool_result", id: block.tool_use_id, isError: Boolean(block.is_error), preview: resultPreview(block.content) });
        }
      } else if (message.type === "result") {
        this.cost += message.total_cost_usd ?? 0;
        this.emit({ t: "result", ok: message.subtype === "success", cost: message.total_cost_usd, durationMs: message.duration_ms });
        this.setStatus(message.subtype === "success" ? "idle" : "error");
        this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
      }
    }
  }

  close() {
    this.closed = true;
    this.handle?.close();
    this.wake?.();
  }
}

function describeInput(tool: string, input: Record<string, unknown>) {
  if (tool === "Bash") return String(input.command ?? "");
  if (tool === "Write" || tool === "Edit") {
    const change = tool === "Write" ? input.content : `- ${input.old_string}\n+ ${input.new_string}`;
    return `${input.file_path}\n\n${String(change ?? "").slice(0, 3000)}`;
  }
  return JSON.stringify(input, null, 2).slice(0, 3000);
}

// What a tool call acts on. The interface words the action in the reader's language.
function toolTarget(name: string, input: any): string {
  const file = (p?: string) => String(p ?? "").replaceAll("\\", "/").split("/").slice(-2).join("/");
  switch (name) {
    case "Read": case "Write": case "Edit": return file(input.file_path);
    case "Glob": case "Grep": return String(input.pattern ?? "");
    case "Bash": return String(input.description || String(input.command ?? "").slice(0, 90));
    case "WebSearch": return String(input.query ?? "");
    case "WebFetch": return String(input.url ?? "");
    case "Agent": case "Task": return String(input.description ?? "");
    case "Skill": return String(input.skill ?? "");
    default: return "";
  }
}

// The project files a tool call writes, relative to the project, for the chat to offer once they exist: a file
// written or edited, and the documents a command names. Nothing here is trusted; the server only serves the ones
// in its document folders (resolveDocument in data.ts).
function toolFiles(name: string, input: any): string[] {
  const rel = (p: string) => (path.isAbsolute(p) ? path.relative(REPO, p) : p).replaceAll("\\", "/");
  if (name === "Write" || name === "Edit" || name === "NotebookEdit") return input.file_path || input.notebook_path ? [rel(String(input.file_path ?? input.notebook_path))] : [];
  if (name === "Bash") return documentPaths(String(input.command ?? ""));
  return [];
}

function resultPreview(content: unknown): string {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content) ? content.map((c: any) => c.text ?? "").join("\n") : "";
  return text.slice(0, 1500);
}

const sessions = new Map<string, Session>();

// Restore finished conversations. A process that was running when the server stopped is gone.
for (const name of readdirSync(DATA)) {
  if (!name.endsWith(".json")) continue;
  try {
    const saved = JSON.parse(readFileSync(path.join(DATA, name), "utf8"));
    const session = new Session(saved.id, saved.title, saved.model, saved.createdAt, false, ACCESS.includes(saved.access) ? saved.access : "ask");
    session.events = saved.events ?? [];
    session.claudeId = saved.claudeId;
    session.cost = saved.cost ?? 0;
    session.status = saved.status === "running" || saved.status === "waiting" ? "error" : saved.status;
    const settled = new Set(session.events.filter((e) => e.t === "resolved").map((e) => e.requestId));
    for (const e of [...session.events]) {
      if ((e.t === "permission" || e.t === "question") && !settled.has(e.requestId)) {
        session.events.push({ t: "resolved", requestId: e.requestId, code: "expired" });
      }
    }
    sessions.set(saved.id, session);
  } catch (err) {
    console.error(`Skipping unreadable session ${name}:`, err);
  }
}

export const isAccess = (a: unknown): a is Access => ACCESS.includes(a as Access);

export function createSession(prompt: string, model?: string, options: { title?: string; unattended?: boolean; access?: Access; uploads?: (Upload & { file: string })[] } = {}) {
  const title = (options.title ?? (prompt || options.uploads?.map((u) => u.name).join(", ") || "")).replace(/\s+/g, " ").trim().slice(0, 70);
  const access = options.unattended ? "ask" : options.access ?? "ask";
  const session = new Session(crypto.randomUUID(), title, MODELS.includes(model ?? "") ? model : undefined, Date.now(), options.unattended, access);
  sessions.set(session.id, session);
  session.send(prompt, options.uploads);
  return session;
}

// Runs a session with nobody watching, until it finishes or runs out of time.
export async function runUnattended(prompt: string, title: string, timeoutMs: number) {
  const session = createSession(prompt, undefined, { title, unattended: true });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { session.interrupt(); finish(); }, timeoutMs);
    const unsubscribe = session.subscribe((e) => { if (e.t === "status" && (e.status === "idle" || e.status === "error")) finish(); });
    const finish = () => { clearTimeout(timer); unsubscribe(); resolve(); };
  });
  const lastText = [...session.events].reverse().find((e) => e.t === "text")?.text;
  return { id: session.id, ok: session.status === "idle", text: String(lastText ?? "") };
}

export const getSession = (id: string) => sessions.get(id);
export const listSessions = () => [...sessions.values()].map((s) => s.summary()).sort((a, b) => b.createdAt - a.createdAt);
export const sessionFileExists = (id: string) => existsSync(path.join(DATA, `${id}.json`));
