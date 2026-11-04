// Which AI does the work: the one picked as primary in the settings, then the other when it is connected, each
// taking over when the one before fails (a quota, a lost login, an outage). Claude is connected through this
// computer's Claude Code login; ChatGPT the same way, through Codex signed in with the user's account (clis.ts), or
// else through an API key in the settings (chatbots.ts). This is for the work the server does with a model: the
// ranking, the smart search, applying and plain chat; the conversations' agents are agent.ts's and codex.ts's.
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { ChatbotError, readKeys, streamReply, type Turn } from "./chatbots";
import { askCli, cliSignedIn } from "./clis";

export type Engine = "claude" | "openai";
export const ENGINES: Engine[] = ["claude", "openai"];
export const ENGINE_NAMES: Record<Engine, string> = { claude: "Claude", openai: "ChatGPT" };
// The model ChatGPT answers with on a key: OpenAI's strongest (its list, November 2026). Claude takes its default.
export const ENGINE_MODELS: Record<Exclude<Engine, "claude">, string> = { openai: "gpt-6-astra" };

// Whether ChatGPT can answer: signed in with the account, or with a key saved.
export const connectedEngines = (keys = readKeys(), logins = cliSignedIn()) => ({ openai: Boolean(logins.openai || keys.openai) });

// The primary first, then the rest in their fixed order, leaving out those not connected.
export function engineOrder(primary: string, has: Partial<Record<Engine, unknown>> = connectedEngines()): Engine[] {
  const first = ENGINES.includes(primary as Engine) ? (primary as Engine) : "claude";
  return [first, ...ENGINES.filter((e) => e !== first)].filter((e) => e === "claude" || Boolean(has[e]));
}

export type Ask = (engine: Engine, system: string, turns: Turn[], signal: AbortSignal, onText: (text: string) => void) => Promise<string>;

// Claude with no tools at all, nothing from the project's settings and no session kept: only the instructions and
// the conversation, the earlier turns as a transcript and the last one as it is, with its pictures and PDFs.
async function askClaude(system: string, turns: Turn[], signal: AbortSignal, onText: (text: string) => void) {
  const last = turns[turns.length - 1];
  const earlier = turns.slice(0, -1).map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`).join("\n\n");
  const files = (last?.uploads ?? []).flatMap((u) => {
    const data = readFileSync(u.file);
    if (u.kind === "image") return [{ type: "image", source: { type: "base64", media_type: u.type, data: data.toString("base64") } }];
    if (u.kind === "pdf") return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") } }];
    return [{ type: "text", text: `Attached file ${u.name}:\n${data.toString("utf8").slice(0, 200_000)}` }];
  });
  const text = [earlier && `The conversation so far:\n\n${earlier}\n\nThe user's new message:`, last?.text || "(see the attachment)"].filter(Boolean).join("\n\n");
  const content = [...files, { type: "text", text }] as SDKUserMessage["message"]["content"];
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" };
  }
  const stop = new AbortController();
  const abort = () => stop.abort();
  signal.addEventListener("abort", abort);
  let answer = "";
  try {
    for await (const m of query({
      prompt: prompt(),
      options: {
        systemPrompt: system, tools: [], maxTurns: 1, settingSources: [], persistSession: false, includePartialMessages: true, abortController: stop,
        canUseTool: async () => ({ behavior: "deny", message: "There are no tools here." }),
      },
    })) {
      if (m.type === "stream_event") {
        const e = m.event as { type: string; delta?: { type: string; text?: string } };
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) onText(e.delta.text);
      } else if (m.type === "result") {
        if (m.subtype !== "success" || m.is_error) throw new ChatbotError("ai_failed", String(m.subtype === "success" ? m.result : m.errors?.join(" ") ?? m.subtype).slice(0, 300));
        answer = m.result;
      }
    }
  } catch (err) {
    if (signal.aborted) return answer;
    throw err instanceof ChatbotError ? err : new ChatbotError("ai_failed", String((err as Error)?.message ?? err).slice(0, 300));
  } finally {
    signal.removeEventListener("abort", abort);
  }
  if (!answer.trim()) throw new ChatbotError("ai_empty");
  return answer;
}

// The account's own login first, as Claude's; the key when there is none. A whole answer arrives at once there.
export const askEngine: Ask = async (engine, system, turns, signal, onText) => {
  if (engine === "claude") return askClaude(system, turns, signal, onText);
  if (cliSignedIn()[engine]) {
    const text = await askCli(engine, system, turns, signal);
    if (text) onText(text);
    return text;
  }
  const key = readKeys()[engine];
  if (!key) throw new ChatbotError("ai_no_key");
  return streamReply({ model: ENGINE_MODELS[engine], key, system, turns, signal, onText });
};

// The answer from the first in the order that gives one. Each that fails is reported (onSwitch) and dropped from
// the order it was given, so work of many steps, as the ranking, doesn't try it again on every step.
export async function askInOrder(order: Engine[], system: string, turns: Turn[], options: {
  signal: AbortSignal; onText?: (text: string) => void; onSwitch?: (from: Engine, to: Engine, err: ChatbotError) => void; ask?: Ask;
}) {
  const { signal, onText = () => {}, onSwitch, ask = askEngine } = options;
  let last: ChatbotError | undefined;
  while (order.length) {
    const engine = order[0];
    if (!engine) break;
    try {
      return { engine, text: await ask(engine, system, turns, signal, onText) };
    } catch (err) {
      if (signal.aborted) return { engine, text: "" };
      last = err instanceof ChatbotError ? err : new ChatbotError("ai_failed", String((err as Error)?.message ?? err));
      // Steps running side by side share the order, so only the one that drops it says so.
      const at = order.indexOf(engine);
      if (at >= 0) {
        order.splice(at, 1);
        if (order.length) onSwitch?.(engine, order[0], last);
      }
    }
  }
  throw last ?? new ChatbotError("ai_none");
}
