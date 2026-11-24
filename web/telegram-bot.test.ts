import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectBot, readTgAccount, sendTelegram, tgSaved, type TgAccount } from "./telegram-bot";

const TOKEN = "123456789:AAEexampleexampleexampleexample_123";
const account: TgAccount = { token: TOKEN, chatId: "555", bot: "my_pip_bot" };

// The Bot API: each method's answer, and every call kept.
function botApi(answers: Record<string, unknown>) {
  const calls: { method: string; url: string; init: RequestInit; json: any }[] = [];
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const method = url.split("/").at(-1)!;
    calls.push({ method, url, init, json: typeof init.body === "string" ? JSON.parse(init.body) : null });
    const answer = answers[method] ?? { ok: false, error_code: 404, description: "Not Found" };
    return new Response(JSON.stringify(answer), { status: (answer as any).ok ? 200 : 400 });
  };
  return { calls, fetcher };
}

const tempFile = () => path.join(mkdtempSync(path.join(os.tmpdir(), "tg-bot-")), "sub", "telegram.json");

describe("connecting the bot", () => {
  test("checks the token, then finds the user's chat once they pressed Start, never showing the token", async () => {
    const file = tempFile();
    const before = botApi({ getMe: { ok: true, result: { username: "my_pip_bot" } }, getUpdates: { ok: true, result: [] } });
    expect(await connectBot(TOKEN, file, before.fetcher)).toEqual({ token: true, bot: "my_pip_bot", chat: false, user: "" });
    expect(readTgAccount(file)).toBeNull();
    const after = botApi({ getUpdates: { ok: true, result: [
      { update_id: 1, message: { chat: { id: -100, type: "group", title: "x" } } },
      { update_id: 2, message: { chat: { id: 555, type: "private", first_name: "Dana" }, text: "/start" } },
    ] } });
    expect(await connectBot("", file, after.fetcher)).toEqual({ token: true, bot: "my_pip_bot", chat: true, user: "Dana" });
    expect(readTgAccount(file)).toEqual({ token: TOKEN, chatId: "555", bot: "my_pip_bot" });
    expect(JSON.stringify(tgSaved(file))).not.toContain(TOKEN);
  });

  test("a token Telegram doesn't know, or one not shaped like a token, is refused and not saved", async () => {
    const file = tempFile();
    const api = botApi({ getMe: { ok: false, error_code: 401, description: "Unauthorized" } });
    await expect(connectBot(TOKEN, file, api.fetcher)).rejects.toThrow("telegram_token");
    await expect(connectBot("not a token", file, api.fetcher)).rejects.toThrow("telegram_token");
    expect(tgSaved(file).token).toBe(false);
  });
});

describe("a message", () => {
  test("a CV goes as its file, named as it goes to the employer, the job in its caption", async () => {
    const pdf = path.join(mkdtempSync(path.join(os.tmpdir(), "tg-cv-")), "Dana Cohen - Resume.pdf");
    writeFileSync(pdf, "pdf");
    const { calls, fetcher } = botApi({ sendDocument: { ok: true, result: { message_id: 1 } } });
    const result = await sendTelegram({ kind: "cv", file: { path: pdf, name: "Dana Cohen - Resume.pdf" }, role: "Backend Developer", company: "Acme", url: "https://x.co/1" }, "he", account, fetcher);
    expect(result).toEqual({ status: "sent", detail: "@my_pip_bot" });
    const form = calls[0].init.body as FormData;
    expect(form.get("chat_id")).toBe("555");
    expect((form.get("document") as File).name).toBe("Dana Cohen - Resume.pdf");
    expect(String(form.get("caption"))).toContain("תפקיד: Backend Developer\nחברה: Acme\nמשרה: https://x.co/1");
  });

  test("the run's summary is framed as one, a test goes as it is, and a failure says why without the token", async () => {
    const { calls, fetcher } = botApi({ sendMessage: { ok: true, result: {} } });
    await sendTelegram({ kind: "run", text: "בלי קורות חיים: Acme (Dev)." }, "he", account, fetcher);
    await sendTelegram({ kind: "text", text: "בדיקה" }, "he", account, fetcher);
    expect(calls.map((c) => c.json.text)).toEqual(["סיכום הריצה היומית: בלי קורות חיים: Acme (Dev).\n\nהפרטים המלאים בשיחות, באתר המקומי.", "בדיקה"]);
    const blocked = botApi({ sendMessage: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } });
    expect(await sendTelegram({ kind: "text", text: "x" }, "he", account, blocked.fetcher)).toEqual({ status: "failed", detail: "403: Forbidden: bot was blocked by the user" });
    const down = async (url: string) => { throw new Error(`fetch failed: ${url}`); };
    const failed = await sendTelegram({ kind: "text", text: "x" }, "he", account, down);
    expect(failed.detail).not.toContain(TOKEN);
  });

  test("with no bot, nothing is sent", async () => {
    expect(await sendTelegram({ kind: "text", text: "x" }, "he", null)).toEqual({ status: "no_account" });
  });
});
