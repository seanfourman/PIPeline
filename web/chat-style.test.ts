import { describe, expect, test } from "bun:test";
import { chatStyle } from "./chat-style";

describe("chat style", () => {
  // A conversation a quick application began was answered in English from its first question on (2026-11-23).
  test("names the language to write in, whatever language the rest is in", () => {
    expect(chatStyle("he")).toContain("Write every message to the user in Hebrew");
    expect(chatStyle("en")).toContain("Write every message to the user in English");
    expect(chatStyle("he")).toContain("asks about an English word");
  });
});
