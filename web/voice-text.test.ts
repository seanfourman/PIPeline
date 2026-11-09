import { describe, expect, test } from "bun:test";
import { LISTEN_LANG, withSaid } from "./ui/voice-text";

describe("withSaid", () => {
  test("what is said goes into an empty box as it is, its spaces made single", () => {
    expect(withSaid("", "מה המשרות  החדשות")).toBe("מה המשרות החדשות");
    expect(withSaid("", "  what's new today ")).toBe("what's new today");
  });

  test("after words already there, with one space between", () => {
    expect(withSaid("תמצא לי", "משרות בחיפה")).toBe("תמצא לי משרות בחיפה");
    expect(withSaid("תמצא לי ", " משרות בחיפה")).toBe("תמצא לי משרות בחיפה");
    expect(withSaid("שורה ראשונה\n", "שורה שנייה")).toBe("שורה ראשונה\nשורה שנייה");
  });

  test("the browser's pieces, each with a space before it, join as one text", () => {
    const pieces = ["find me", " jobs in", " Haifa"];
    expect(pieces.reduce(withSaid, "")).toBe("find me jobs in Haifa");
  });

  test("nothing said leaves the box as it was", () => {
    expect(withSaid("/apply ", "")).toBe("/apply ");
    expect(withSaid("שלום", "   ")).toBe("שלום");
  });
});

describe("LISTEN_LANG", () => {
  test("Hebrew is heard as Israeli Hebrew, English as American English", () => {
    expect(LISTEN_LANG).toEqual({ he: "he-IL", en: "en-US" });
  });
});
