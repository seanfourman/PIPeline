// Runs Claude sessions in the project and turns their messages into events for the browser. A plain conversation
// is a session too, with the same events: chat only, answered by the AI first in the settings' order, the next
// taking over when one fails (ai.ts). So is work the server does itself with that AI, as the ranking.
import { query, type PermissionResult, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { askInOrder, ENGINE_NAMES, engineOrder, type Engine } from "./ai";
import { CHAT_SYSTEM, ChatbotError, providerOf, type Turn } from "./chatbots";
import { cliSignedIn } from "./clis";
import { CodexAgent } from "./codex";
import { documentPaths } from "./data";
import { ACCESS, createPolicy, REPO, type Access } from "./policy";
import { loadSettings } from "./settings";
import { attachmentContent, getUpload, type Upload } from "./uploads";
import { APP_DIR } from "./user";

export type TaskSteps = {
  start: (id: string, target: string, name?: string) => void; done: (id: string, ok: boolean, preview: string) => void;
  switched: (from: string, to: string, code: string) => void;
};

const DATA = path.join(APP_DIR, "sessions");
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
  private replying?: AbortController;
  // In a plain conversation, the name of the AI that answered last.
  engine?: string;
  // A conversation ChatGPT works in as an agent, through Codex (codex.ts), and its thread there.
  agentThreadId?: string;
  private external?: CodexAgent;

  constructor(public id: string, public title: string, public model: string | undefined, public createdAt: number, private unattended = false, public access: Access = "ask", public plain = false, public agent: "claude" | "codex" = "claude") {}

  summary() {
    const engine = this.agent === "codex" ? ENGINE_NAMES.openai : this.engine;
    return { id: this.id, title: this.title, status: this.status, createdAt: this.createdAt, cost: this.cost, model: this.model, access: this.access, plain: this.plain, engine, agent: this.agent };
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
    writeFileSync(path.join(DATA, `${this.id}.json`), JSON.stringify({ ...this.summary(), claudeId: this.claudeId, agentThreadId: this.agentThreadId, events: this.events }));
  }

  // ChatGPT's turn in a conversation it works in as an agent: what was attached goes in as pictures it sees, or as a
  // line with where the file is, as Claude gets it (uploads.ts); its requests come to authorize, like Claude's.
  private sendToAgent(text: string, uploads: (Upload & { file: string })[]) {
    const hooks = {
      emit: (e: AgentEvent, keep?: boolean) => this.emit(e, keep),
      authorize: (tool: string, input: Record<string, unknown>, signal: AbortSignal) => this.authorize(tool, input, signal),
      thread: (threadId: string) => { this.agentThreadId = threadId; this.scheduleSave(); },
      done: (ok: boolean, error?: string) => {
        if (error && !ok) this.emit({ t: "error", text: error.slice(0, 300) });
        this.emit({ t: "result", ok });
        this.setStatus(ok ? "idle" : "error");
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
      },
    };
    this.external ??= new CodexAgent(hooks, this.agentThreadId);
    const images = uploads.filter((u) => u.kind === "image");
    const others = uploads.filter((u) => u.kind !== "image");
    const said = [text, ...others.map((u) => `Attached file (${u.name}): ${path.relative(REPO, u.file).replaceAll("\\", "/")}`)].join("\n").trim() || "(see the attached image)";
    clearTimeout(this.idleTimer);
    this.setStatus("running");
    this.external.send(said, images.map((u) => u.file)).catch((err) => {
      this.emit({ t: "error", code: "codex_failed", text: String(err?.message ?? err).slice(0, 300) });
      this.setStatus("error");
    });
  }

  // A message, with the files attached to it, if any: the chat keeps what they were, Claude gets them (uploads.ts).
  send(text: string, uploads: (Upload & { file: string })[] = []) {
    this.emit({ t: "user", text, ...(uploads.length ? { files: uploads.map(({ id, name, kind, size }) => ({ id, name, kind, size })) } : {}) });
    if (this.plain) { if (!this.replying) this.answer(); return; }
    if (this.agent !== "claude") return this.sendToAgent(text, uploads);
    this.inbox.push(uploads.length ? attachmentContent(text, uploads) : text);
    clearTimeout(this.idleTimer);
    this.setStatus("running");
    if (this.closed) this.start();
    this.wake?.();
  }

  // A plain answer to the whole conversation so far, streamed like Claude's, from the first AI in the settings'
  // order that gives one; each switch to the next is a line in the conversation. A message sent while it is being
  // written is answered next, with the rest. skip leaves one out, as Claude when it has just failed.
  private async answer(skip?: Engine) {
    this.setStatus("running");
    const stop = this.replying = new AbortController();
    const asked = this.events.length;
    let failed = false;
    try {
      const order = engineOrder(loadSettings().aiPrimary).filter((e) => e !== skip);
      const { engine, text } = await askInOrder(order, CHAT_SYSTEM, this.turns(), {
        signal: stop.signal,
        onText: (part) => this.emit({ t: "delta", text: part }, false),
        onSwitch: (from, to, err) => this.emit({ t: "switched", from: ENGINE_NAMES[from], to: ENGINE_NAMES[to], code: err.code }),
      });
      this.engine = ENGINE_NAMES[engine];
      if (text.trim()) this.emit({ t: "text", text, by: this.engine });
    } catch (err) {
      failed = true;
      const e = err instanceof ChatbotError ? err : new ChatbotError("ai_failed", String((err as Error)?.message ?? err));
      this.emit({ t: "error", code: e.code, text: e.detail });
    }
    this.replying = undefined;
    if (!failed && !stop.signal.aborted && this.events.slice(asked).some((e) => e.t === "user")) return this.answer();
    this.emit({ t: "result", ok: !failed });
    this.setStatus(failed ? "error" : "idle");
  }

  // Work the server does itself under this conversation, as the ranking (ranker.ts): what was asked as the first
  // message, each step as a tool line, a switch to the next AI as a line, its report as the answer. A message
  // written meanwhile is answered after it, as in any plain conversation.
  async task(asked: string, work: (steps: TaskSteps, signal: AbortSignal) => Promise<string>) {
    this.emit({ t: "user", text: asked });
    this.setStatus("running");
    const stop = this.replying = new AbortController();
    const from = this.events.length;
    let failed = false;
    try {
      const text = await work({
        start: (id, target, name = "RankJob") => this.emit({ t: "tool", id, name, target, nested: false, files: [] }),
        done: (id, ok, preview) => this.emit({ t: "tool_result", id, isError: !ok, preview }),
        switched: (from, to, code) => this.emit({ t: "switched", from, to, code }),
      }, stop.signal);
      if (text.trim()) this.emit({ t: "text", text });
    } catch (err) {
      failed = true;
      const e = err instanceof ChatbotError ? err : new ChatbotError("ai_failed", String((err as Error)?.message ?? err));
      this.emit({ t: "error", code: e.code, text: e.detail });
    }
    this.replying = undefined;
    if (!failed && !stop.signal.aborted && this.events.slice(from).some((e) => e.t === "user")) return this.answer();
    this.emit({ t: "result", ok: !failed });
    this.setStatus(failed ? "error" : "idle");
  }

  // The conversation as turns: what was written, with what was attached while it is still there, and the answers.
  private turns(): Turn[] {
    return this.events.flatMap((e): Turn[] => {
      if (e.t === "text") return [{ role: "assistant", text: String(e.text) }];
      if (e.t !== "user") return [];
      const uploads = ((e.files ?? []) as { id: string }[]).map((f) => getUpload(f.id)).filter((u) => u !== null);
      return [{ role: "user", text: String(e.text ?? ""), uploads }];
    });
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
      if (this.handOver()) return;
      this.emit({ t: "error", text: String(err?.message ?? err) });
      this.setStatus("error");
    }).finally(() => { this.closed = true; this.wake?.(); });
  }

  // When Claude fails on a plain message (its quota, say), and another AI is connected, the conversation goes on as
  // a plain one with the next in the order, which answers the message Claude didn't. Not for a command, which
  // needs Claude's tools, not once a tool has run since the message, and never in an unattended run.
  private handOver() {
    const lastUser = this.events.findLastIndex((e) => e.t === "user");
    const asked = String(this.events[lastUser]?.text ?? "");
    const next = engineOrder(loadSettings().aiPrimary).find((e) => e !== "claude");
    if (this.unattended || !next || asked.trim().startsWith("/") || this.events.slice(lastUser).some((e) => e.t === "tool")) return false;
    this.plain = true;
    this.close();
    this.emit({ t: "switched", from: ENGINE_NAMES.claude, to: ENGINE_NAMES[next], code: "ai_failed" });
    this.answer("claude");
    return true;
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
      this.emit({ t: "resolved", requestId, answer: Object.values(body.answers).join(", ") });
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
    this.replying?.abort();
    await this.external?.interrupt();
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
        const ok = message.subtype === "success" && !message.is_error;
        if (!ok && this.handOver()) return;
        this.emit({ t: "result", ok, cost: message.total_cost_usd, durationMs: message.duration_ms });
        this.setStatus(ok ? "idle" : "error");
        this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
      }
    }
  }

  close() {
    this.closed = true;
    this.handle?.close();
    this.external?.close();
    this.external = undefined;
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
    // A conversation saved before plain ones were marked was one by the ChatGPT model it named.
    const plain = saved.plain === true || Boolean(providerOf(saved.model));
    const session = new Session(saved.id, saved.title, saved.model, saved.createdAt, false, ACCESS.includes(saved.access) ? saved.access : "ask", plain, saved.agent === "codex" ? "codex" : "claude");
    session.engine = typeof saved.engine === "string" ? saved.engine : undefined;
    session.events = saved.events ?? [];
    session.claudeId = saved.claudeId;
    session.agentThreadId = typeof saved.agentThreadId === "string" ? saved.agentThreadId : undefined;
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

// A new conversation, by the settings' first connected AI: Claude's agent; ChatGPT's as a whole agent too, through
// Codex, when its account is signed in; otherwise, on a key alone, a plain one, with a command still going to
// Claude, which needs the tools. An unattended run is always Claude's.
export function createSession(prompt: string, model?: string, options: { title?: string; unattended?: boolean; access?: Access; uploads?: (Upload & { file: string })[] } = {}) {
  const title = (options.title ?? (prompt || options.uploads?.map((u) => u.name).join(", ") || "")).replace(/\s+/g, " ").trim().slice(0, 70);
  const access = options.unattended ? "ask" : options.access ?? "ask";
  const first = options.unattended ? "claude" : engineOrder(loadSettings().aiPrimary)[0];
  const agent = first === "openai" && cliSignedIn().openai ? "codex" : "claude";
  const plain = agent === "claude" && first !== "claude" && !prompt.trim().startsWith("/");
  const session = new Session(crypto.randomUUID(), title, !plain && agent === "claude" && MODELS.includes(model ?? "") ? model : undefined, Date.now(), options.unattended, access, plain, agent);
  sessions.set(session.id, session);
  session.send(prompt, options.uploads);
  return session;
}

// A conversation for work the server does itself with the settings' AI (Session.task).
export function createTaskSession(asked: string, work: Parameters<Session["task"]>[1]) {
  const session = new Session(crypto.randomUUID(), asked, undefined, Date.now(), false, "ask", true);
  sessions.set(session.id, session);
  session.task(asked, work);
  return session;
}

// Waits for a session to finish, or interrupts it once it runs out of time.
async function finished(session: Session, timeoutMs: number) {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { session.interrupt(); finish(); }, timeoutMs);
    const unsubscribe = session.subscribe((e) => { if (e.t === "status" && (e.status === "idle" || e.status === "error")) finish(); });
    const finish = () => { clearTimeout(timer); unsubscribe(); resolve(); };
  });
  const lastText = [...session.events].reverse().find((e) => e.t === "text")?.text;
  return { id: session.id, ok: session.status === "idle", text: String(lastText ?? "") };
}

// Runs a session with nobody watching, until it finishes or runs out of time.
export const runUnattended = (prompt: string, title: string, timeoutMs: number) =>
  finished(createSession(prompt, undefined, { title, unattended: true }), timeoutMs);

// The same for a task the server does itself (createTaskSession), like the daily run's portals check.
export const runTask = (title: string, work: Parameters<Session["task"]>[1], timeoutMs: number) =>
  finished(createTaskSession(title, work), timeoutMs);

export const getSession = (id: string) => sessions.get(id);
export const listSessions = () => [...sessions.values()].map((s) => s.summary()).sort((a, b) => b.createdAt - a.createdAt);
export const sessionFileExists = (id: string) => existsSync(path.join(DATA, `${id}.json`));
