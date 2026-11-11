// What Pip's answers hold beyond their words (chat.tsx), read from the conversation itself, with no AI:
// - a run of questions, each saying under it how to answer it, becomes cards that turn over;
// - each document the conversation made shows after the answer that brought it, as what it is (a CV, a cover
//   letter, a report), and while one is being written, a card for it is already there.

export type Card = { q: string; a: string };
export type Part = { md: string } | { cards: Card[] };
export type DocKind = "cv" | "letter" | "report" | "doc";
type Ev = { t: string; id?: unknown; name?: unknown; files?: unknown; text?: unknown };

// A list item whose bold opening is a question, at the list's top level: "1. **Why Wix?** ..." or "- **Why Wix?**".
const QUESTION = /^ ?(?:\d+[.)]|[-*])\s+\*\*([^*\n]+?\?)\*\*[:.]?\s*(.*)$/;
const TOP_ITEM = /^ ?(?:\d+[.)]|[-*])\s+/;
const HEADING = /^ {0,3}#/;

// The answer in parts: its words as they are, but for each run of two or more questions that each say how to answer
// them, which becomes a run of cards. A question's answer is the rest of its line and the lines under it, up to the
// next item, a heading, or a blank line that the item doesn't go on after.
export function answerParts(src: string): Part[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const parts: Part[] = [];
  let words: string[] = [];
  const flush = () => {
    if (words.join("\n").trim()) parts.push({ md: words.join("\n") });
    words = [];
  };
  let i = 0;
  while (i < lines.length) {
    const run: Card[] = [];
    let j = i;
    for (let m = lines[j]?.match(QUESTION); m; m = lines[j]?.match(QUESTION)) {
      const answer = m[2] ? [m[2]] : [];
      let k = j + 1;
      while (k < lines.length) {
        const line = lines[k];
        if (!line.trim()) {
          if (k + 1 < lines.length && /^\s+\S/.test(lines[k + 1]) && !TOP_ITEM.test(lines[k + 1])) { answer.push(""); k++; continue; }
          break;
        }
        if (TOP_ITEM.test(line) || HEADING.test(line)) break;
        answer.push(line.trim());
        k++;
      }
      run.push({ q: m[1].trim(), a: answer.join("\n").trim() });
      while (k + 1 < lines.length && !lines[k].trim() && QUESTION.test(lines[k + 1])) k++;
      j = k;
    }
    if (run.length >= 2 && run.every((c) => c.a)) {
      flush();
      parts.push({ cards: run });
      i = j;
    } else {
      // Not cards: the whole list stays words, as it was written.
      const end = Math.max(j, i + 1);
      words.push(...lines.slice(i, end));
      i = end;
    }
  }
  flush();
  return parts;
}

// What a document is, by its folder and its name.
export function docKind(path: string, name = path.split("/").pop() ?? ""): DocKind {
  const p = path.toLowerCase();
  const n = name.toLowerCase();
  if (p.includes("/cover_letters/") || /cover|letter/.test(n)) return "letter";
  if (p.includes("/cv/") || /resume|(^|[^a-z])cv([^a-z]|$)/.test(n)) return "cv";
  if (p.includes("/reports/")) return "report";
  return "doc";
}

// Whose a CV or letter is, by its name ("Dana Levi - Resume.pdf").
export const docOwner = (name: string) => name.match(/^(.+?)\s+-\s+(?:resume|cv|cover letter)\b/i)?.[1] ?? "";

// The application a document belongs to: its folder under documents/applications, or a main_<name> CV.
export const docSlug = (path: string) =>
  path.match(/documents\/applications\/([A-Za-z0-9_-]+)\//)?.[1] ?? path.match(/\/cv\/main_([a-z0-9_]+)\.\w+$/i)?.[1] ?? "";

// A path as the documents list gives it (data.ts conversationFiles): in the user's folder, with / between its parts,
// a .tex standing for its PDF.
export function docPath(raw: string) {
  let p = raw.replaceAll("\\", "/").replace(/^\.\//, "");
  if (/^(cv|cover_letters|reports|documents)\//.test(p)) p = `user/${p}`;
  return p.replace(/\.tex$/i, ".pdf");
}

// Where in the conversation a document first came up: the first step that wrote it, or the first message naming it.
export function docOrigin(events: Ev[], doc: { path: string; name: string }) {
  const bare = doc.path.replace(/^user\//, "");
  return events.findIndex((e) =>
    (Array.isArray(e.files) && e.files.some((f) => docPath(String(f)) === doc.path)) ||
    (e.t === "text" && (String(e.text ?? "").includes(bare) || String(e.text ?? "").includes(doc.name))));
}

// After which message each document shows: the first answer from where it came up on. One that came up after the
// last answer (still being worked on), or nowhere, goes at the end.
export function placeDocs<D extends { path: string; name: string }>(events: Ev[], docs: D[]) {
  const after = new Map<number, D[]>();
  const end: D[] = [];
  for (const doc of docs) {
    const from = docOrigin(events, doc);
    const at = from < 0 ? -1 : events.findIndex((e, i) => i >= from && e.t === "text");
    if (at < 0) end.push(doc);
    else after.set(at, [...(after.get(at) ?? []), doc]);
  }
  return { after, end };
}

// The conversation as it reads (Sean, 2026-11-11): each of Pip's turns, from a message of yours to the next, has all
// its steps in one block at its top, under your message, even when its words come between them; its words, cards and
// requests follow in order. Steps' results and answers to requests are found from what they answer, so they aren't
// items. A block's key is its first step's place, so it stays the same as the turn goes on.
export type StepsItem<E> = { kind: "tools"; key: string; tools: E[] };
export type TurnItem<E> = StepsItem<E> | { kind: "event"; key: string; ev: E };
export function turnItems<E extends { t: string }>(events: E[]): TurnItem<E>[] {
  const out: TurnItem<E>[] = [];
  let block: StepsItem<E> | null = null;
  let top = 0;
  for (const [i, e] of events.entries()) {
    if (e.t === "tool_result" || e.t === "resolved") continue;
    if (e.t === "tool") {
      if (!block) {
        block = { kind: "tools", key: `tools-${i}`, tools: [] };
        out.splice(top, 0, block);
      }
      block.tools.push(e);
      continue;
    }
    out.push({ kind: "event", key: String(i), ev: e });
    if (e.t === "user") {
      block = null;
      top = out.length;
    }
  }
  return out;
}

// The steps that write a CV (the /apply pipeline's), and so what a document being written is, from the step under
// way: one of those, or one that writes a file in the CVs' or the letters' folder.
const WRITES_CV = new Set(["DraftCv", "ReviewCv", "BuildCv"]);
export function writingKind(tools: Ev[], done: (id: string) => boolean): DocKind | null {
  const now = [...tools].reverse().find((x) => !done(String(x.id)));
  if (!now) return null;
  if (WRITES_CV.has(String(now.name))) return "cv";
  const file = (Array.isArray(now.files) ? now.files.map((f) => docPath(String(f))) : []).find((f) => /^user\/(cv|cover_letters)\//.test(f));
  return file ? docKind(file) : null;
}
