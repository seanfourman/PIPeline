// ChatGPT through OpenAI's API, on the user's own key: plain answers, nothing more, for when its account isn't
// signed in through Codex (clis.ts, codex.ts). They see what is written and attached and nothing else, no project
// files, no web and no tools. The key is stored on this computer outside the project, sealed like the mail
// password (vault.ts), and never sent back to the page.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Upload } from "./uploads";
import { canSeal, isSealed, seal, unseal } from "./vault";

export type Provider = "openai";
export const PROVIDERS: Provider[] = ["openai"];
// ChatGPT's models on a key, the strongest and the lighter one (OpenAI's list, November 2026).
export const OTHER_MODELS: Record<string, Provider> = { "gpt-6-astra": "openai", "gpt-6-luna": "openai" };
export const providerOf = (model?: string): Provider | null => (model ? OTHER_MODELS[model] ?? null : null);

const KEYS_FILE = path.join(os.homedir(), ".ai-job-search", "ai-keys.json");
// A text file goes in as its words, up to this many characters.
const MAX_TEXT_CHARS = 200_000;

// What every plain conversation is told, whichever AI answers it (agent.ts).
export const CHAT_SYSTEM = [
  "You are Pip, a friendly fox who helps the user with their job search, inside a web app on their own computer.",
  "In this conversation you only see what the user writes and attaches here. You can't read their files, browse the web or run anything.",
  "When they ask for something that needs that, such as searching for jobs, ranking them or building a CV, say that the app's own buttons for it do it, or a message starting with the command, such as /apply with a job's link.",
  "Answer in the language the user writes in.",
].join(" ");

export class ChatbotError extends Error {
  constructor(public code: string, public detail = "") { super(code); }
}

type Keys = Partial<Record<Provider, string>>;

// The keys as the file holds them, sealed (vault.ts).
function sealedKeys(file: string): Keys {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    return Object.fromEntries(PROVIDERS.filter((p) => typeof saved[p] === "string" && saved[p]).map((p) => [p, saved[p]]));
  } catch {
    return {};
  }
}

function writeKeys(file: string, keys: Keys) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(keys));
  try { chmodSync(file, 0o600); } catch { /* Windows keeps it in the user's own folder */ }
}

// The keys, opened. One saved before keys were sealed is sealed now, in place.
export function readKeys(file = KEYS_FILE): Keys {
  const saved = sealedKeys(file);
  if (canSeal && Object.values(saved).some((v) => v && !isSealed(v))) {
    writeKeys(file, Object.fromEntries(Object.entries(saved).map(([p, v]) => [p, isSealed(v!) ? v : seal(v!)])));
  }
  return Object.fromEntries(Object.entries(saved).map(([p, v]) => [p, unseal(v!)]));
}

// Only whether each key is there leaves the server, never the key; that needs nothing opened.
export const keyStatus = (file = KEYS_FILE) => {
  const keys = sealedKeys(file);
  return Object.fromEntries(PROVIDERS.map((p) => [p, Boolean(keys[p])])) as Record<Provider, boolean>;
};

// A key to keep, sealed, or an empty one to forget the provider's.
export function saveKey(provider: Provider, key: string, file = KEYS_FILE) {
  const keys = sealedKeys(file);
  if (key) keys[provider] = seal(key); else delete keys[provider];
  writeKeys(file, keys);
}

// Whether a key works, by asking for OpenAI's list of models, which costs nothing.
export async function checkKey(_provider: Provider, key: string, fetcher: typeof fetch = fetch) {
  const res = await fetcher("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } })
    .catch(() => { throw new ChatbotError("ai_key_unreachable"); });
  if (res.ok) return;
  throw new ChatbotError(res.status === 401 || res.status === 403 ? "ai_key_bad" : "ai_key_unreachable");
}

export type Turn = { role: "user" | "assistant"; text: string; uploads?: (Upload & { file: string })[] };

const dataUrl = (u: Upload & { file: string }) => `data:${u.type.split(";")[0]};base64,${readFileSync(u.file).toString("base64")}`;
const fileText = (u: Upload & { file: string }) => `Attached file ${u.name}:\n${readFileSync(u.file, "utf8").slice(0, MAX_TEXT_CHARS)}`;

// Turns of the same side in a row, as a message sent while the last was being answered, become one.
function merged(turns: Turn[]) {
  const out: Turn[] = [];
  for (const turn of turns) {
    const last = out[out.length - 1];
    if (last?.role === turn.role) out[out.length - 1] = { role: turn.role, text: [last.text, turn.text].filter(Boolean).join("\n\n"), uploads: [...(last.uploads ?? []), ...(turn.uploads ?? [])] };
    else out.push(turn);
  }
  return out;
}

// What a conversation says to OpenAI's Responses API: the whole conversation each time, kept nowhere there. The
// instructions are Pip's for a chat, or a job's own, as the ranking's (ranker.ts).
export function openaiRequest(model: string, turns: Turn[], system = CHAT_SYSTEM) {
  return {
    model, instructions: system, stream: true, store: false,
    input: merged(turns).map((turn) => turn.role === "assistant" ? { role: "assistant", content: turn.text } : {
      role: "user",
      content: [
        ...(turn.uploads ?? []).map((u) => u.kind === "image" ? { type: "input_image", image_url: dataUrl(u) }
          : u.kind === "pdf" ? { type: "input_file", filename: u.name, file_data: dataUrl(u) }
          : { type: "input_text", text: fileText(u) }),
        ...(turn.text ? [{ type: "input_text", text: turn.text }] : []),
      ],
    }),
  };
}

// The JSON of each server-sent event, as it arrives.
async function* events(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true }).replaceAll("\r\n", "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (data && data !== "[DONE]") { try { yield JSON.parse(data); } catch { /* not JSON, skipped */ } }
    }
  }
}

// An answer that failed, worded by what went wrong: the key, the quota, the model's name, or what the API said.
async function failure(res: Response) {
  const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
  const detail = String(body.error?.message ?? res.statusText ?? "").slice(0, 300);
  if (res.status === 401 || res.status === 403) return new ChatbotError("ai_key_bad");
  if (res.status === 429) return new ChatbotError("ai_quota", detail);
  if (res.status === 404) return new ChatbotError("ai_model", detail);
  return new ChatbotError("ai_failed", detail || String(res.status));
}

// One answer to the conversation so far, its words handed to onText as they come; it returns them all. Stopped
// (signal), it returns what came until then.
export async function streamReply(options: { model: string; turns: Turn[]; key: string; onText: (text: string) => void; signal?: AbortSignal; fetcher?: typeof fetch; system?: string }) {
  const { model, turns, key, onText, signal, fetcher = fetch, system } = options;
  if (!providerOf(model)) throw new ChatbotError("ai_model", model);
  const res = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST", signal, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(openaiRequest(model, turns, system)),
  }).catch((err) => { if (signal?.aborted) return null; throw new ChatbotError("ai_failed", String(err?.message ?? err)); });
  if (!res) return "";
  if (!res.ok || !res.body) throw await failure(res);
  let text = "";
  const add = (part: unknown) => { if (typeof part === "string" && part) { text += part; onText(part); } };
  try {
    for await (const e of events(res.body)) {
      if (e.type === "response.output_text.delta") add(e.delta);
      else if (e.type === "response.failed") throw new ChatbotError("ai_failed", String(e.response?.error?.message ?? ""));
      else if (e.type === "error") throw new ChatbotError("ai_failed", String(e.message ?? e.error?.message ?? ""));
    }
  } catch (err) {
    if (signal?.aborted) return text;
    throw err instanceof ChatbotError ? err : new ChatbotError("ai_failed", String((err as Error)?.message ?? err));
  }
  if (!text && !signal?.aborted) throw new ChatbotError("ai_empty");
  return text;
}
