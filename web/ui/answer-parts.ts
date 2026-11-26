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
// next item, a heading, or a blank line that the item doesn't go on after. Questions to prepare come with talking
// points on the lines under them (/interview writes them so); questions Pip asks the user, one to a line with why he
// asks after them, stay words, as a reply is all they want (Sean 2026-11-17: "מה קשור עכשיו קלפים"). So a run is
// cards only when at least one of its answers goes on under its question.
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
    let under = false;
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
        under = true;
        k++;
      }
      run.push({ q: m[1].trim(), a: answer.join("\n").trim() });
      while (k + 1 < lines.length && !lines[k].trim() && QUESTION.test(lines[k + 1])) k++;
      j = k;
    }
    if (run.length >= 2 && run.every((c) => c.a) && under) {
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

// What a document is: by its folder first, then by its name. A name says a letter by starting cover_ or naming a
// (cover) letter, and a CV by starting main_ or naming a resume or CV; a company's name inside it says nothing, so
// a CV for a company called Cover (main_cover_...) is still a CV.
export function docKind(path: string, name = path.split("/").pop() ?? ""): DocKind {
  const p = path.toLowerCase();
  const n = name.toLowerCase();
  if (p.includes("/cover_letters/")) return "letter";
  if (p.includes("/cv/")) return "cv";
  if (/^cover[_-]|(^|[^a-z])letter([^a-z]|$)/.test(n)) return "letter";
  if (/^main[_-]|resume|(^|[^a-z])cv([^a-z]|$)/.test(n)) return "cv";
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
    // The helpers still at work in the background are said apart, at the conversation's foot (chat.tsx), not as an item.
    if (e.t === "tool_result" || e.t === "resolved" || e.t === "background") continue;
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
const WRITES_CV = new Set(["DraftCv", "ReviewCv", "WolfPack", "FixPackReasons", "BuildCv", "AddKeywords", "GateAgain"]);
export function writingKind(tools: Ev[], done: (id: string) => boolean): DocKind | null {
  const now = [...tools].reverse().find((x) => !done(String(x.id)));
  if (!now) return null;
  if (WRITES_CV.has(String(now.name))) return "cv";
  const file = (Array.isArray(now.files) ? now.files.map((f) => docPath(String(f))) : []).find((f) => /^user\/(cv|cover_letters)\//.test(f));
  return file ? docKind(file) : null;
}

// A request to allow an edit shows the change as lines: those both sides share stay as they are, the rest are taken
// out or put in, by the longest run of lines the two have in common.
export type ChangeLine = { kind: "same" | "del" | "add"; text: string };
// cut: only part of it came (the server stops at a length); allowing still allows all of it.
export type Change = { path: string; lines: ChangeLine[]; cut: boolean };
// Past this many cells the table of lines in common is too big to build while a request waits (thousands of lines a
// side, all different): what differs is then shown as its lines taken out, then those put in.
const TABLE_MOST = 1_000_000;
export function lineDiff(before: string[], after: string[]): ChangeLine[] {
  // The lines both start and end with stay as they are; only what lies between them is compared.
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  const kept = (part: string[]): ChangeLine[] => part.map((text) => ({ kind: "same", text }));
  let middle: ChangeLine[] = [];
  if (a.length * b.length > TABLE_MOST) {
    middle = [...a.map((text): ChangeLine => ({ kind: "del", text })), ...b.map((text): ChangeLine => ({ kind: "add", text }))];
  } else {
    const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { middle.push({ kind: "same", text: a[i] }); i++; j++; }
      else if (common[i + 1][j] >= common[i][j + 1]) middle.push({ kind: "del", text: a[i++] });
      else middle.push({ kind: "add", text: b[j++] });
    }
    while (i < a.length) middle.push({ kind: "del", text: a[i++] });
    while (j < b.length) middle.push({ kind: "add", text: b[j++] });
  }
  return [...kept(before.slice(0, head)), ...middle, ...kept(before.slice(before.length - tail))];
}

const lines = (text: string) => (text ? text.split("\n") : []);
// How much of an edit's words the server sends (agent.ts describeInput): words that long were likely cut there.
const WORDS_SENT = 3000;
// The change in a request (agent.ts): whole, as the file's path and its text before and after, from a server that sends
// it so; or read back from the request's words, the path, a blank line, then an edit as "- old" and "+ new" or a new
// file's content. Nothing for a request that isn't an edit or a new file.
export function readChange(ev: { tool?: string; input?: string; change?: { path?: string; before?: string; after?: string; cut?: boolean } }): Change | null {
  if (ev.change?.path) return { path: ev.change.path, lines: lineDiff(lines(ev.change.before ?? ""), lines(ev.change.after ?? "")), cut: Boolean(ev.change.cut) };
  const input = String(ev.input ?? "");
  const gap = input.indexOf("\n\n");
  if ((ev.tool !== "Edit" && ev.tool !== "Write") || gap < 0) return null;
  const path = input.slice(0, gap);
  const body = input.slice(gap + 2);
  const cut = body.length >= WORDS_SENT;
  if (ev.tool === "Write") return { path, lines: lineDiff([], lines(body)), cut };
  const at = body.indexOf("\n+ ");
  return { path, lines: lineDiff(lines((at < 0 ? body : body.slice(0, at)).replace(/^- /, "")), at < 0 ? [] : lines(body.slice(at + 3))), cut };
}

// The characters that change the order text is shown in without being seen (U+202A-202E, U+2066-2069, and the marks
// U+200E, U+200F and U+061C): a request shows each as its code, so a path or a command reads as what it is ("doc", a
// right-to-left override, "fdp.exe" would otherwise show as "docexe.pdf").
const STEERING = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
export function revealSteering(text: string): (string | { code: string })[] {
  const out: (string | { code: string })[] = [];
  let from = 0;
  for (const m of text.matchAll(STEERING)) {
    if (m.index! > from) out.push(text.slice(from, m.index));
    out.push({ code: `U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` });
    from = m.index! + m[0].length;
  }
  if (from < text.length || !out.length) out.push(text.slice(from));
  return out;
}
export const hasSteering = (text: string) => revealSteering(text).some((part) => typeof part !== "string");
