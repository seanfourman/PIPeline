// Runs Claude sessions in the project and turns their messages into events for the browser. A plain conversation
// is a session too, with the same events: chat only, answered by the AI first in the settings' order, the next
// taking over when one fails (ai.ts). So is work the server does itself with that AI, as the ranking.
import { query, type PermissionResult, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { askInOrder, ENGINE_NAMES, engineOrder, type Engine } from "./ai";
import { CHAT_SYSTEM, ChatbotError, providerOf, type Turn } from "./chatbots";
import { CODEX_LOGIN_FAILED, cliSignedIn, loginRefused } from "./clis";
import { CodexAgent } from "./codex";
import { documentPaths } from "./data";
import { ACCESS, createPolicy, REPO, type Access } from "./policy";
import { loadSettings } from "./settings";
import { matches, type Meta } from "./threads";
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
  // Whether Claude is paid for by use here: through an API key (signing in with an Anthropic Console account makes
  // one too), not a Claude plan. Only then does a run's end say what it cost: on a plan, the SDK's figure is list
  // price, not a bill. Unknown for a conversation saved before this was kept.
  metered?: boolean;
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
  // Its place in the list (threads.ts): when it was pinned to the top, whether it is archived, the project it is in.
  pinned?: number;
  archived = false;
  project?: string;
  // Deleted (forget): nothing more of it is saved, nor handed over to another AI.
  private gone = false;
  // Stopped (interrupt): the end of the run that follows is the stop, not a failure to hand over to the next AI.
  private stopped = false;

  constructor(public id: string, public title: string, public model: string | undefined, public createdAt: number, private unattended = false, public access: Access = "ask", public plain = false, public agent: "claude" | "codex" = "claude") {}

  // A /setup conversation, which may do a little more at automatic access (policy.ts, SETUP_FILES and PICK_ROLES).
  get setup() { return /^\/setup\b/.test(this.title); }

  summary() {
    const engine = this.agent === "codex" ? ENGINE_NAMES.openai : this.engine;
    return { id: this.id, title: this.title, status: this.status, createdAt: this.createdAt, cost: this.cost, model: this.model, access: this.access, plain: this.plain, engine, agent: this.agent, pinned: this.pinned, archived: this.archived, project: this.project };
  }

  // Renamed, pinned or not, archived or not, moved into a project or out of one (threads.ts metaChange).
  setMeta(meta: Meta) {
    if (meta.title !== undefined) this.title = meta.title;
    if (meta.pinned !== undefined) this.pinned = meta.pinned ?? undefined;
    if (meta.archived !== undefined) this.archived = meta.archived;
    if (meta.project !== undefined) this.project = meta.project ?? undefined;
    this.scheduleSave();
  }

  // A new access for what comes next; a request already waiting that it now allows goes ahead at once.
  setAccess(access: Access) {
    this.access = access;
    for (const [requestId, request] of this.pending) {
      if (!request.tool || decide(request.tool, request.input, this.remembered, access, this.setup).decision !== "allow") continue;
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
    if (this.gone) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 250);
  }

  save() {
    if (this.gone) return;
    writeFileSync(path.join(DATA, `${this.id}.json`), JSON.stringify({ ...this.summary(), claudeId: this.claudeId, agentThreadId: this.agentThreadId, metered: this.metered, events: this.events }));
  }

  // ChatGPT's turn in a conversation it works in as an agent: what was attached goes in as pictures it sees, or as a
  // line with where the file is, as Claude gets it (uploads.ts); its requests come to authorize, like Claude's.
  private sendToAgent(text: string, uploads: (Upload & { file: string })[]) {
    const hooks = {
      emit: (e: AgentEvent, keep?: boolean) => (e.t === "error" && !e.code ? this.codexError(String(e.text ?? "")) : this.emit(e, keep)),
      authorize: (tool: string, input: Record<string, unknown>, signal: AbortSignal) => this.authorize(tool, input, signal),
      thread: (threadId: string) => { this.agentThreadId = threadId; this.scheduleSave(); },
      done: (ok: boolean, error?: string) => {
        if (error && !ok) this.codexError(error);
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
      const text = String(err?.message ?? err);
      if (CODEX_LOGIN_FAILED.test(text)) this.codexError(text);
      else this.emit({ t: "error", code: "codex_failed", text: text.slice(0, 300) });
      this.setStatus("error");
    });
  }

  // An error from ChatGPT's agent: its sign-in refused (a login that ran out) said as what to do about it, once a
  // turn, ChatGPT then counting as signed out until signed in again (clis.ts); anything else in its own words.
  private codexError(text: string) {
    if (!CODEX_LOGIN_FAILED.test(text)) return this.emit({ t: "error", text: text.slice(0, 300) });
    loginRefused("openai");
    const lastUser = this.events.findLastIndex((e) => e.t === "user");
    if (!this.events.slice(lastUser).some((e) => e.t === "error" && e.code === "openai_login")) this.emit({ t: "error", code: "openai_login" });
  }

  // A message, with the files attached to it, if any: the chat keeps what they were, Claude gets them (uploads.ts).
  // A conversation whose AI never got to work (no sign-in that held, no_agent or claude_login) starts again from its
  // first message, with what was attached to it, on the agent that can work now (pickAgent), the new message after
  // it; with none, it says again what to sign in to.
  send(text: string, uploads: (Upload & { file: string })[] = []) {
    // A new run, not a message written while a stopped one ends.
    if (this.status !== "running" && this.status !== "waiting") this.stopped = false;
    const again = !this.plain && !this.unattended && this.events.some((e) => e.t === "user") && !this.events.some((e) => WORKED.has(e.t));
    this.emit({ t: "user", text, ...(uploads.length ? { files: uploads.map(({ id, name, kind, size }) => ({ id, name, kind, size })) } : {}) });
    if (this.plain) { if (!this.replying) this.answer(); return; }
    if (again) {
      const picked = pickAgent();
      if (!picked.usable) return this.refuseStart();
      const first: AgentEvent = this.events.find((e) => e.t === "user") ?? { t: "user" };
      const attached = ((first.files as { id: string }[] | undefined) ?? []).map((f) => getUpload(f.id)).filter((u) => u !== null);
      this.close();
      this.claudeId = undefined;
      this.agentThreadId = undefined;
      this.agent = picked.agent;
      text = [String(first.text ?? ""), text].filter(Boolean).join("\n\n");
      uploads = [...attached, ...uploads];
    }
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
        // The user's own settings come along (their skills and instructions), and with them any hooks they added for
        // Claude in their editor, such as Claude Notifier's sounds, which would sound for every one of Pip's
        // conversations. Pip has its own ways of saying it needs the user (PeekingPip), so these keep quiet: Claude
        // Notifier stays silent in a session with CLAUDE_NOTIFIER_DISABLE set, and the editor's own sessions go on as
        // before.
        // Every command starts in the project, never where the one before it moved to: the commands allowed to run on
        // their own name their scripts by a path in the project, which would otherwise be found under a folder the
        // agent may write to.
        env: { ...process.env, CLAUDE_NOTIFIER_DISABLE: "1", CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: "1" },
      },
    });
    this.consume().catch((err) => {
      if (this.handOver()) return;
      this.emit({ t: "error", text: String(err?.message ?? err) });
      this.setStatus("error");
    }).finally(() => { this.closed = true; this.wake?.(); });
  }

  // No AI here that can work as an agent (none signed in with an account, or Claude's sign-in refused): the message is
  // kept, and the conversation says what to sign in to; the next message starts it again (send).
  cannotStart(text: string, uploads: (Upload & { file: string })[] = []) {
    this.emit({ t: "user", text, ...(uploads.length ? { files: uploads.map(({ id, name, kind, size }) => ({ id, name, kind, size })) } : {}) });
    this.refuseStart();
  }
  private refuseStart() {
    this.emit({ t: "error", code: "no_agent" });
    this.emit({ t: "result", ok: false });
    this.setStatus("error");
  }

  // Claude's sign-in refused while ChatGPT's account is signed in here: the conversation goes on with ChatGPT's own
  // agent (Codex) from the message Claude never got to, commands too, with what was attached to it and a line saying
  // so. Not in an unattended run, and not once a tool has run since the message, whose steps would run again.
  private toCodex() {
    if (this.gone || this.unattended || !cliSignedIn().openai) return false;
    const lastUser = this.events.findLastIndex((e) => e.t === "user");
    if (this.events.slice(lastUser).some((e) => e.t === "tool")) return false;
    const asked = this.events[lastUser] ?? { t: "user" };
    const uploads = ((asked.files as { id: string }[] | undefined) ?? []).map((f) => getUpload(f.id)).filter((u) => u !== null);
    this.close();
    this.agent = "codex";
    this.emit({ t: "switched", from: ENGINE_NAMES.claude, to: ENGINE_NAMES.openai, code: "claude_login" });
    this.sendToAgent(String(asked.text ?? ""), uploads);
    return true;
  }

  // When Claude fails on a plain message (its quota, say), and another AI is connected, the conversation goes on as
  // a plain one with the next in the order, which answers the message Claude didn't. Not for a command, which
  // needs Claude's tools, not once a tool has run since the message, and never in an unattended run. Nor when the run
  // was stopped, or the conversation deleted.
  private handOver() {
    if (this.gone || this.stopped) return false;
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
      const verdict = decide(tool, input, this.remembered, this.unattended ? "ask" : this.access, this.setup);
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
    this.stopped = true;
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

      // Each turn starts by saying where its credential came from: "none" (once "oauth") is no API key, which here
      // is the sign-in to a Claude plan; a key is named by where it came from.
      if (message.type === "system" && message.subtype === "init") {
        const source: string | undefined = message.apiKeySource;
        this.metered = Boolean(source) && source !== "none" && source !== "oauth";
      } else if (message.type === "stream_event" && !parent) {
        const event = message.event as { type: string; delta?: { type: string; text?: string } };
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          this.emit({ t: "delta", text: event.delta.text }, false);
        }
      } else if (message.type === "assistant") {
        // Claude's sign-in refused before it could answer (a session that ran out, a sign-out elsewhere): said as what
        // to do about it rather than in its server's words, and Claude counts as signed out until signed in again.
        if (message.error === "authentication_failed" && !parent) {
          loginRefused("claude");
          if (this.toCodex()) return;
          this.emit({ t: "error", code: "claude_login" });
          continue;
        }
        for (const block of message.message.content as any[]) {
          if (block.type === "text" && !parent && block.text.trim()) this.emit({ t: "text", text: block.text });
          // A step a helper ran inside another step says which, for the chat to hang it under that step (chat.tsx stepTree).
          if (block.type === "tool_use") this.emit({ t: "tool", id: block.id, name: block.name, target: toolTarget(block.name, block.input), nested: Boolean(parent), ...(parent ? { parent } : {}), files: toolFiles(block.name, block.input) });
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
        this.stopped = false;
        this.emit({ t: "result", ok, ...(this.metered ? { cost: message.total_cost_usd } : {}), durationMs: message.duration_ms });
        this.setStatus(ok ? "idle" : "error");
        this.idleTimer = setTimeout(() => this.close(), IDLE_CLOSE_MS);
      }
    }
  }

  // Deleted (deleteSession): what it still had to save is dropped and nothing more is, nor is it handed over; its
  // timers stop, and its process ends now rather than after IDLE_CLOSE_MS.
  forget() {
    this.gone = true;
    clearTimeout(this.saveTimer);
    clearTimeout(this.idleTimer);
    this.close();
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
    session.metered = typeof saved.metered === "boolean" ? saved.metered : undefined;
    session.pinned = typeof saved.pinned === "number" ? saved.pinned : undefined;
    session.archived = saved.archived === true;
    session.project = typeof saved.project === "string" ? saved.project : undefined;
    // Saved before conversations knew how they were paid for: their ends showed the SDK's dollar figure, which on a
    // Claude plan is no bill, so it goes. On a key, that figure is all that is lost.
    if (session.metered === undefined) for (const e of session.events) if (e.t === "result") delete e.cost;
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
// What shows a conversation's AI got to work: its words, a tool, or something it asked.
const WORKED = new Set(["text", "tool", "permission", "question"]);

// The agent for a command or for work in the project, as the settings and the sign-ins here stand. ChatGPT chosen
// first: its own agent (Codex), never Claude in its place, as Claude is not who was chosen, and a sign-in Pip has
// found for it may be one left from long ago. Claude chosen: Claude, or ChatGPT's agent while Claude isn't signed in
// (never was, or its sign-in was refused) and ChatGPT's account is. usable: whether it can work now, as far as the
// sign-ins say.
function pickAgent() {
  const signed = cliSignedIn();
  if (loadSettings().aiPrimary === "openai") return { agent: "codex" as const, usable: signed.openai };
  const agent: "claude" | "codex" = !signed.claude && signed.openai ? "codex" : "claude";
  return { agent, usable: agent === "codex" || signed.claude };
}

export function createSession(prompt: string, model?: string, options: { title?: string; unattended?: boolean; access?: Access; uploads?: (Upload & { file: string })[] } = {}) {
  const title = (options.title ?? (prompt || options.uploads?.map((u) => u.name).join(", ") || "")).replace(/\s+/g, " ").trim().slice(0, 70);
  const access = options.unattended ? "ask" : options.access ?? "ask";
  const order = engineOrder(loadSettings().aiPrimary);
  const first = options.unattended ? "claude" : order[0];
  // An unattended run is Claude's. Plain: ChatGPT first with no agent of its own here (a key alone), or no agent that
  // can work at all while another AI can still answer; never a command, which needs an agent.
  const picked = options.unattended ? { agent: "claude" as const, usable: true } : pickAgent();
  const plain = !prompt.trim().startsWith("/") && picked.agent === "claude" && (first !== "claude" || (!picked.usable && order.length > 1));
  const session = new Session(crypto.randomUUID(), title, !plain && picked.agent === "claude" && MODELS.includes(model ?? "") ? model : undefined, Date.now(), options.unattended, access, plain, picked.agent);
  sessions.set(session.id, session);
  if (!plain && !picked.usable) session.cannotStart(prompt, options.uploads);
  else session.send(prompt, options.uploads);
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
// A conversation deleted: stopped first if it is working, then forgotten, so that what the stop still says is never
// saved over its deletion, and its file and its place here gone.
export async function deleteSession(id: string) {
  const session = sessions.get(id);
  if (!session) return false;
  if (session.status === "running" || session.status === "waiting") await session.interrupt().catch(() => {});
  session.forget();
  sessions.delete(id);
  rmSync(path.join(DATA, `${id}.json`), { force: true });
  return true;
}
// The conversations a search finds (threads.ts matches), the newest first.
export const searchSessions = (query: string) => [...sessions.values()].filter((s) => matches(s, query)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((s) => s.id);
// A project deleted: its conversations leave it.
export function leaveProject(project: string) {
  for (const s of sessions.values()) if (s.project === project) s.setMeta({ project: null });
}
export const listSessions = () => [...sessions.values()].map((s) => s.summary()).sort((a, b) => b.createdAt - a.createdAt);
export const sessionFileExists = (id: string) => existsSync(path.join(DATA, `${id}.json`));
