import { describe, expect, test } from "bun:test";
import { answerParts, docKind, docOrigin, docOwner, docPath, docSlug, placeDocs, turnItems, writingKind } from "./ui/answer-parts";

describe("answer parts", () => {
  test("turns a run of questions that each say how to answer them into cards, and leaves the words around them", () => {
    const src = [
      "שלוש שאלות שכדאי להתכונן אליהן:",
      "",
      "1. **איך בונים API שעומד באלפי בקשות?**",
      "   להתחיל מה-cache ומהאינדקסים.",
      "   - ולספר על BlueBird",
      "2. **למה דווקא Wix?** המוצר עצמו, ו-Python בקנה מידה גדול.",
      "",
      "רוצה לתרגל אותן עכשיו?",
    ].join("\n");
    expect(answerParts(src)).toEqual([
      { md: "שלוש שאלות שכדאי להתכונן אליהן:\n" },
      { cards: [
        { q: "איך בונים API שעומד באלפי בקשות?", a: "להתחיל מה-cache ומהאינדקסים.\n- ולספר על BlueBird" },
        { q: "למה דווקא Wix?", a: "המוצר עצמו, ו-Python בקנה מידה גדול." },
      ] },
      { md: "\nרוצה לתרגל אותן עכשיו?" },
    ]);
  });

  test("keeps as words a list whose questions don't all say how to answer, one question alone, or bold that isn't a question", () => {
    const ask = "Questions to ask:\n1. **What does a first month look like?**\n2. **Who reviews the code?**";
    expect(answerParts(ask)).toEqual([{ md: ask }]);
    const one = "1. **Why Wix?** Because of the product.";
    expect(answerParts(one)).toEqual([{ md: one }]);
    const skills = "1. **FastAPI**: used at BlueBird\n2. **Docker**: in CI";
    expect(answerParts(skills)).toEqual([{ md: skills }]);
    const mixed = "1. **Why Wix?**\n2. **Why now?** Timing.\n3. **Why you?** The stack.";
    expect(answerParts(mixed)).toEqual([{ md: mixed }]);
  });

  test("blank lines between the questions keep them one run", () => {
    const src = "- **Why Wix?**\n  The product.\n\n- **Why backend?**\n  I like systems.";
    expect(answerParts(src)).toEqual([{ cards: [{ q: "Why Wix?", a: "The product." }, { q: "Why backend?", a: "I like systems." }] }]);
  });
});

describe("documents in the conversation", () => {
  const cv = { path: "user/documents/applications/wix_backend/Dana Levi - Resume.pdf", name: "Dana Levi - Resume.pdf" };
  const letter = { path: "user/cover_letters/cover_wix_backend.pdf", name: "cover_wix_backend.pdf" };

  test("says what a document is and whose, and finds its application", () => {
    expect(docKind(cv.path)).toBe("cv");
    expect(docKind(letter.path)).toBe("letter");
    expect(docKind("user/cv/main_wix_backend.pdf")).toBe("cv");
    expect(docKind("user/reports/report.html")).toBe("report");
    expect(docKind("user/documents/applications/x/Dana Levi - Cover Letter.pdf")).toBe("letter");
    expect(docKind("user/documents/applications/x/grades.pdf")).toBe("doc");
    expect(docOwner(cv.name)).toBe("Dana Levi");
    expect(docOwner("notes.pdf")).toBe("");
    expect(docSlug(cv.path)).toBe("wix_backend");
    expect(docSlug("user/cv/main_wix_backend.pdf")).toBe("wix_backend");
    expect(docPath("cv\\main_wix.tex")).toBe("user/cv/main_wix.pdf");
  });

  test("shows each after the answer that brought it, and one still being made at the end", () => {
    const events = [
      { t: "user", text: "CV for Wix" },
      { t: "tool", id: "a", name: "Bash", files: ["user/documents/applications/wix_backend/Dana Levi - Resume.pdf"] },
      { t: "tool_result", id: "a" },
      { t: "text", text: "Ready." },
      { t: "user", text: "And a letter?" },
      { t: "tool", id: "b", name: "Write", files: ["cover_letters/cover_wix_backend.tex"] },
    ];
    expect(docOrigin(events, cv)).toBe(1);
    expect(docOrigin(events, letter)).toBe(5);
    const placed = placeDocs(events, [letter, cv]);
    expect(placed.after.get(3)).toEqual([cv]);
    expect(placed.end).toEqual([letter]);
    expect(placeDocs([{ t: "text", text: `Saved to ${cv.path.replace("user/", "")}` }], [cv]).after.get(0)).toEqual([cv]);
  });

  test("puts each turn's steps in one block at its top, under the message, with its words after it in order", () => {
    const shape = (events: { t: string; id?: string }[]) =>
      turnItems(events).map((x) => (x.kind === "tools" ? `${x.key}:${x.tools.map((s) => s.id).join(",")}` : x.ev.t));
    const turn = [
      { t: "user" }, { t: "text" }, { t: "tool", id: "a" }, { t: "tool_result", id: "a" }, { t: "text" },
      { t: "tool", id: "b" }, { t: "permission" }, { t: "resolved" }, { t: "tool_result", id: "b" }, { t: "text" }, { t: "result" },
    ];
    expect(shape(turn)).toEqual(["user", "tools-2:a,b", "text", "text", "permission", "text", "result"]);
    // A new message starts a new block; steps before any message (a scheduled run) lead the conversation.
    expect(shape([{ t: "tool", id: "a" }, { t: "text" }, { t: "user" }, { t: "text" }, { t: "tool", id: "b" }]))
      .toEqual(["tools-0:a", "text", "user", "tools-4:b", "text"]);
    // A turn with no steps has no block, and a block keeps its key as steps come in.
    expect(shape([{ t: "user" }, { t: "text" }, { t: "result" }])).toEqual(["user", "text", "result"]);
    expect(shape([...turn, { t: "user" }, { t: "tool", id: "c" }]).slice(-2)).toEqual(["user", "tools-12:c"]);
  });

  test("knows a CV is being written from the step under way", () => {
    const done = (id: string) => id === "a";
    expect(writingKind([{ t: "tool", id: "a", name: "FetchPosting" }, { t: "tool", id: "b", name: "DraftCv" }], done)).toBe("cv");
    expect(writingKind([{ t: "tool", id: "b", name: "Write", files: ["cover_letters/cover_x.tex"] }], done)).toBe("letter");
    expect(writingKind([{ t: "tool", id: "b", name: "WebFetch" }], done)).toBeNull();
    expect(writingKind([{ t: "tool", id: "a", name: "DraftCv" }], done)).toBeNull();
  });
});
