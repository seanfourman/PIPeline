import { describe, expect, test } from "bun:test";
import { askInOrder, engineOrder, type Ask, type Engine } from "./ai";
import { ChatbotError } from "./chatbots";

const never = new AbortController().signal;

describe("ai", () => {
  test("puts the primary first and leaves ChatGPT out while it isn't connected; Claude needs nothing", () => {
    expect(engineOrder("openai", { openai: true })).toEqual(["openai", "claude"]);
    expect(engineOrder("claude", { openai: true })).toEqual(["claude", "openai"]);
    expect(engineOrder("openai", {})).toEqual(["claude"]);
    expect(engineOrder("nonsense", { openai: true })).toEqual(["claude", "openai"]);
  });

  test("goes to the next when one fails, says so, and drops the one that failed from the order", async () => {
    const asked: Engine[] = [];
    const ask: Ask = async (engine) => {
      asked.push(engine);
      if (engine === "openai") throw new ChatbotError("ai_quota", "out of credit");
      return `answer from ${engine}`;
    };
    const order: Engine[] = ["openai", "claude"];
    const switches: string[] = [];
    const r = await askInOrder(order, "system", [{ role: "user", text: "hi" }], { signal: never, ask, onSwitch: (from, to, err) => switches.push(`${from}>${to}:${err.code}`) });
    expect(r).toEqual({ engine: "claude", text: "answer from claude" });
    expect(switches).toEqual(["openai>claude:ai_quota"]);
    expect(order).toEqual(["claude"]);
    await askInOrder(order, "system", [], { signal: never, ask });
    expect(asked).toEqual(["openai", "claude", "claude"]);
  });

  test("two steps failing together drop the same one once", async () => {
    const order: Engine[] = ["openai", "claude"];
    const switches: string[] = [];
    let fail = 0;
    const ask: Ask = async (engine) => {
      if (engine === "openai") { fail++; await Bun.sleep(5); throw new ChatbotError("ai_key_bad"); }
      return engine;
    };
    const both = await Promise.all([1, 2].map(() => askInOrder(order, "s", [], { signal: never, ask, onSwitch: (f, t) => switches.push(`${f}>${t}`) })));
    expect(both.map((r) => r.engine)).toEqual(["claude", "claude"]);
    expect(fail).toBe(2);
    expect(switches).toEqual(["openai>claude"]);
    expect(order).toEqual(["claude"]);
  });

  test("with every one failing, it throws the last failure", async () => {
    const ask: Ask = async (engine) => { throw new ChatbotError(engine === "claude" ? "ai_failed" : "ai_key_bad"); };
    await expect(askInOrder(["openai", "claude"], "s", [], { signal: never, ask })).rejects.toMatchObject({ code: "ai_failed" });
    await expect(askInOrder([], "s", [], { signal: never, ask })).rejects.toMatchObject({ code: "ai_none" });
  });
});
