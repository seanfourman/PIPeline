import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkKey, keyStatus, openaiRequest, providerOf, readKeys, saveKey, streamReply, type Turn } from "./chatbots";
import { getUpload, saveUpload } from "./uploads";

const dir = mkdtempSync(path.join(os.tmpdir(), "chatbots-"));
const b64 = (bytes: number[] | string) => Buffer.from(typeof bytes === "string" ? bytes : Uint8Array.from(bytes)).toString("base64");
const upload = (name: string, data: string) => getUpload(saveUpload(name, data, dir).id, dir)!;

// A fetch that answers with these server-sent events, or with an error status, and keeps what it was asked.
function fakeFetch(answer: { status?: number; events?: unknown[]; error?: string }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (answer.status && answer.status !== 200) return new Response(JSON.stringify({ error: { message: answer.error ?? "no" } }), { status: answer.status });
    const body = (answer.events ?? []).map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
    // Cut in the middle of an event, as a network would.
    const half = Math.floor(body.length / 2);
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body.slice(0, half))); c.enqueue(new TextEncoder().encode(body.slice(half))); c.close(); } }));
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("chatbots", () => {
  test("knows whose each model is, and only those offered", () => {
    expect(providerOf("gpt-6-astra")).toBe("openai");
    expect(providerOf("gemini-3.8-flash")).toBeNull();
    expect(providerOf("claude-opus-5-5")).toBeNull();
    expect(providerOf(undefined)).toBeNull();
  });

  test("keeps the key in its own file, says only whether it is there, and forgets one emptied", () => {
    const file = path.join(dir, "keys", "ai-keys.json");
    expect(keyStatus(file)).toEqual({ openai: false });
    saveKey("openai", "sk-one-secret", file);
    expect(keyStatus(file)).toEqual({ openai: true });
    expect(readKeys(file).openai).toBe("sk-one-secret");
    // Sealed on Windows: the file never holds the key itself.
    if (process.platform === "win32") expect(readFileSync(file, "utf8")).not.toContain("sk-one-secret");
    saveKey("openai", "", file);
    expect(keyStatus(file)).toEqual({ openai: false });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
    // A key saved before sealing still reads, and is sealed in place.
    if (process.platform === "win32") {
      writeFileSync(file, JSON.stringify({ openai: "sk-old-plain" }));
      expect(readKeys(file).openai).toBe("sk-old-plain");
      expect(readFileSync(file, "utf8")).not.toContain("sk-old-plain");
    }
  });

  test("sends the whole conversation to OpenAI, keeping nothing there, with pictures, PDFs and text files", () => {
    const image = upload("shot.png", b64([0x89, 0x50, 0x4e, 0x47, 1]));
    const pdf = upload("cv.pdf", b64("%PDF-1.7 x"));
    const notes = upload("notes.md", b64("# שלום"));
    const turns: Turn[] = [
      { role: "user", text: "first", uploads: [image] },
      { role: "user", text: "sent while it answered", uploads: [pdf, notes] },
      { role: "assistant", text: "an answer" },
      { role: "user", text: "next" },
    ];
    const body = openaiRequest("gpt-6-luna", turns) as any;
    expect(body).toMatchObject({ model: "gpt-6-luna", stream: true, store: false });
    expect(body.instructions).toContain("Pip");
    expect(body.input).toHaveLength(3);
    expect(body.input[0].content.map((c: any) => c.type)).toEqual(["input_image", "input_file", "input_text", "input_text"]);
    expect(body.input[0].content[0].image_url).toStartWith("data:image/png;base64,");
    expect(body.input[0].content[1]).toMatchObject({ filename: "cv.pdf" });
    expect(body.input[0].content[1].file_data).toStartWith("data:application/pdf;base64,");
    expect(body.input[0].content[2].text).toContain("# שלום");
    expect(body.input[0].content[3].text).toBe("first\n\nsent while it answered");
    expect(body.input[1]).toEqual({ role: "assistant", content: "an answer" });
  });

  test("streams OpenAI's words as they come, with the key only in its header", async () => {
    const { fetcher, calls } = fakeFetch({ events: [{ type: "response.created" }, { type: "response.output_text.delta", delta: "שלום " }, { type: "response.output_text.delta", delta: "there" }, { type: "response.completed" }] });
    const parts: string[] = [];
    const text = await streamReply({ model: "gpt-6-astra", turns: [{ role: "user", text: "hi" }], key: "sk-secret", onText: (p) => parts.push(p), fetcher });
    expect(text).toBe("שלום there");
    expect(parts).toEqual(["שלום ", "there"]);
    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret");
    expect(String(calls[0].init.body)).not.toContain("sk-secret");
  });

  test("words what went wrong: the key, the quota, the model, a failure on the way, or no answer", async () => {
    const reply = (answer: Parameters<typeof fakeFetch>[0], model = "gpt-6-astra") =>
      streamReply({ model, turns: [{ role: "user", text: "hi" }], key: "k", onText: () => {}, fetcher: fakeFetch(answer).fetcher });
    await expect(reply({ status: 401 })).rejects.toMatchObject({ code: "ai_key_bad" });
    await expect(reply({ status: 429, error: "quota" })).rejects.toMatchObject({ code: "ai_quota", detail: "quota" });
    await expect(reply({ status: 404 })).rejects.toMatchObject({ code: "ai_model" });
    await expect(reply({ events: [{ type: "response.failed", response: { error: { message: "server" } } }] })).rejects.toMatchObject({ code: "ai_failed", detail: "server" });
    await expect(reply({ events: [{ type: "response.completed" }] })).rejects.toMatchObject({ code: "ai_empty" });
    await expect(reply({}, "gemini-3.8-flash")).rejects.toMatchObject({ code: "ai_model" });
  });

  test("stopped, it returns what came until then", async () => {
    const stop = new AbortController();
    const fetcher = (async (_url: string, init: RequestInit) => new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}\n\n`));
        init.signal!.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      },
    }))) as unknown as typeof fetch;
    const text = await streamReply({ model: "gpt-6-luna", turns: [{ role: "user", text: "hi" }], key: "k", signal: stop.signal, fetcher, onText: () => stop.abort() });
    expect(text).toBe("partial");
  });

  test("checks a key against OpenAI's list of models", async () => {
    await expect(checkKey("openai", "good", fakeFetch({ events: [] }).fetcher)).resolves.toBeUndefined();
    await expect(checkKey("openai", "bad", fakeFetch({ status: 401 }).fetcher)).rejects.toMatchObject({ code: "ai_key_bad" });
    await expect(checkKey("openai", "k", fakeFetch({ status: 503 }).fetcher)).rejects.toMatchObject({ code: "ai_key_unreachable" });
    const offline = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await expect(checkKey("openai", "k", offline)).rejects.toMatchObject({ code: "ai_key_unreachable" });
  });
});
