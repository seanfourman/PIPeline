// The daily run's CVs on Telegram (automation.ts): a bot of the user's own, made in a chat with @BotFather, sends each
// CV as a file with the role, the company and the job's link in its caption; the live alerts' new jobs come on it too
// (server.ts tellAlerts). Sean asked for WhatsApp (2026-11-23), but
// Meta's WhatsApp Cloud API would not let a new account send a thing until it had a payment method and a verified
// business, and he didn't want to pay; Telegram's Bot API is free, needs no review, and says at once whether a message
// went. The bot learns the user's chat from their first message to it (getUpdates), as a bot can't write first.
// The token is sealed like the mail password (vault.ts), in a file outside the project, and never leaves the server.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canSeal, isSealed, seal, unseal } from "./vault";

const BOT_FILE = path.join(os.homedir(), ".ai-job-search", "telegram.json");
const API = "https://api.telegram.org";

type Lang = "he" | "en";
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type TgAccount = { token: string; chatId: string; bot: string };
export type TgResult = { status: "sent" | "no_account" | "failed"; detail?: string };
// run: the run's summary, framed as one; text: words as they are (the settings' test).
export type TgMessage =
  | { kind: "cv"; file: { path: string; name: string }; role: string; company: string; url: string }
  | { kind: "run" | "text"; text: string };

const WORDS = {
  he: {
    caption: (m: { role: string; company: string; url: string }) => `קורות חיים חדשים\n\nתפקיד: ${m.role}\nחברה: ${m.company}\nמשרה: ${m.url}\n\nהקובץ בשם שאפשר להגיש כמו שהוא.`,
    run: (text: string) => `סיכום הריצה היומית: ${text}\n\nהפרטים המלאים בשיחות, באתר המקומי.`,
    test: "זו הודעת בדיקה מפיפ. אם היא הגיעה, קורות החיים יגיעו לכאן.",
    alertTest: "זו התראת בדיקה מפיפ. אם היא הגיעה, ההתראות על משרות חדשות יגיעו לכאן.",
  },
  en: {
    caption: (m: { role: string; company: string; url: string }) => `A new CV\n\nRole: ${m.role}\nCompany: ${m.company}\nJob: ${m.url}\n\nThe file is named to send as it is.`,
    run: (text: string) => `The daily run's summary: ${text}\n\nThe full details are in the conversations on the local site.`,
    test: "This is a test message from Pip. If it reached you, the CVs will come here.",
    alertTest: "This is a test alert from Pip. If it reached you, the alerts about new jobs will come here.",
  },
};
export const tgWords = (lang: Lang) => WORDS[lang];

// token sealed; bot, the bot's username; chatId and user, the user's chat with it and their name there.
type Saved = { token?: string; bot?: string; chatId?: string; user?: string };
const readSaved = (file: string): Saved => {
  try { return JSON.parse(readFileSync(file, "utf8")) ?? {}; } catch { return {}; }
};
function writeSaved(file: string, saved: Saved) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(saved));
  try { chmodSync(file, 0o600); } catch { /* Windows keeps it in the user's own folder */ }
}

// The bot, its token opened, once the user's chat with it is known.
export function readTgAccount(file = BOT_FILE): TgAccount | null {
  const saved = readSaved(file);
  if (!saved.token || !saved.chatId) return null;
  if (canSeal && !isSealed(saved.token)) writeSaved(file, { ...saved, token: seal(saved.token) });
  return { token: unseal(saved.token), chatId: saved.chatId, bot: saved.bot ?? "" };
}

// What the settings show: whether a token is saved, the bot's name, and whom it writes to. Never the token.
export function tgSaved(file = BOT_FILE) {
  const saved = readSaved(file);
  return { token: Boolean(saved.token), bot: saved.bot ?? "", chat: Boolean(saved.chatId), user: saved.user ?? "" };
}

export class TgError extends Error {}

type Answer = { ok: boolean; result: any; error: string };

// One call to the Bot API. The token is in the address, as the API has it, so an error's words are cleaned of it.
async function call(token: string, method: string, body: FormData | object | undefined, fetcher: Fetch): Promise<Answer> {
  const init: RequestInit = { method: body ? "POST" : "GET", signal: AbortSignal.timeout(60_000) };
  if (body instanceof FormData) init.body = body;
  else if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  try {
    const res = await fetcher(`${API}/bot${token}/${method}`, init);
    const data = await res.json().catch(() => ({}));
    if (data?.ok) return { ok: true, result: data.result, error: "" };
    return { ok: false, result: null, error: `${data?.error_code ?? res.status}: ${String(data?.description ?? res.statusText).slice(0, 240)}` };
  } catch (err) {
    return { ok: false, result: null, error: String((err as Error)?.message ?? err).replaceAll(token, "[token]").slice(0, 240) };
  }
}

// Connects the bot: a new token is checked with Telegram (getMe) and saved; then the user's chat is looked for among
// the messages the bot was sent (getUpdates keeps them a day), the latest private one. Until the user writes to the
// bot, the chat stays unknown and the settings say to press Start.
export async function connectBot(token = "", file = BOT_FILE, fetcher: Fetch = fetch) {
  const given = token.trim();
  if (given) {
    if (!/^\d{5,15}:[\w-]{30,60}$/.test(given)) throw new TgError("telegram_token");
    const me = await call(given, "getMe", undefined, fetcher);
    if (!me.ok || !me.result?.username) throw new TgError("telegram_token");
    // A new bot starts with no chat: the user writes to it first.
    writeSaved(file, { token: seal(given), bot: String(me.result.username) });
  }
  const now = readSaved(file);
  if (now.token && !now.chatId) {
    const open = unseal(now.token);
    const updates = await call(open, "getUpdates", { allowed_updates: ["message"] }, fetcher);
    const chats = (Array.isArray(updates.result) ? updates.result : [])
      .map((u: any) => u?.message?.chat)
      .filter((c: any) => c?.type === "private" && c.id != null);
    const chat = chats.at(-1);
    if (chat) writeSaved(file, { ...now, chatId: String(chat.id), user: String(chat.first_name ?? chat.username ?? "") });
  }
  return tgSaved(file);
}

// Sends one message: a CV as a file with its caption, or the run's summary as words.
export async function sendTelegram(message: TgMessage, lang: Lang, account = readTgAccount(), fetcher: Fetch = fetch): Promise<TgResult> {
  if (!account) return { status: "no_account" };
  const words = WORDS[lang];
  let sent: Answer;
  if (message.kind === "cv") {
    const form = new FormData();
    form.append("chat_id", account.chatId);
    form.append("document", new Blob([readFileSync(message.file.path)], { type: "application/pdf" }), message.file.name);
    form.append("caption", words.caption(message).slice(0, 1024));
    sent = await call(account.token, "sendDocument", form, fetcher);
  } else {
    const text = message.kind === "run" ? words.run(message.text) : message.text;
    sent = await call(account.token, "sendMessage", { chat_id: account.chatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true } }, fetcher);
  }
  return sent.ok ? { status: "sent", detail: account.bot ? `@${account.bot}` : "" } : { status: "failed", detail: sent.error };
}
