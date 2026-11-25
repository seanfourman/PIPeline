// The words in a Word, Excel or PowerPoint file (.docx, .xlsx, .pptx), for an attachment in the chat (uploads.ts):
// each is a zip of XML files (zip.ts). Only the parts that hold the words are opened.
import { readZip } from "./zip";

type Parts = Map<string, () => Buffer>;
// The parts of an Office file by name (zip.ts).
const partsOf = (zip: Buffer): Parts => new Map(readZip(zip).map((e) => [e.name, e.read]));

const decode = (text: string) => text
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const words = (xml: string) => decode(xml.replace(/<[^>]+>/g, ""));
const tidy = (text: string) => text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
// The parts whose names match, in their number's order (slide2 before slide10).
const numbered = (parts: Parts, pattern: RegExp) =>
  [...parts.keys()].filter((name) => pattern.test(name)).sort((a, b) => Number(a.match(pattern)![1]) - Number(b.match(pattern)![1]));

function wordText(parts: Parts) {
  const xml = parts.get("word/document.xml")?.().toString("utf8") ?? "";
  return words(xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n"));
}

function slidesText(parts: Parts) {
  return numbered(parts, /^ppt\/slides\/slide(\d+)\.xml$/).map((name, i) => {
    const xml = parts.get(name)!().toString("utf8");
    return `Slide ${i + 1}\n${words(xml.replace(/<a:br\/>/g, "\n").replace(/<\/a:p>/g, "\n"))}`;
  }).join("\n\n");
}

function sheetsText(parts: Parts) {
  const shared = [...(parts.get("xl/sharedStrings.xml")?.().toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(""));
  const names = [...(parts.get("xl/workbook.xml")?.().toString("utf8") ?? "").matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decode(m[1]));
  return numbered(parts, /^xl\/worksheets\/sheet(\d+)\.xml$/).map((name, i) => {
    const xml = parts.get(name)!().toString("utf8");
    const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
      [...row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, inner = ""]) => {
        if (/\bt="s"/.test(attrs)) return shared[Number(inner.match(/<v>([^<]*)<\/v>/)?.[1])] ?? "";
        if (/\bt="inlineStr"/.test(attrs)) return words(inner);
        return decode(inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? "");
      }).join("\t").replace(/\t+$/, ""));
    return `${names[i] ?? `Sheet ${i + 1}`}\n${rows.filter(Boolean).join("\n")}`;
  }).join("\n\n");
}

// The words of an Office file by its extension, or an error when it isn't one.
export function officeText(bytes: Buffer, ext: string) {
  const parts = partsOf(bytes);
  const read = ext === "docx" ? wordText : ext === "pptx" ? slidesText : ext === "xlsx" ? sheetsText : null;
  if (!read) throw new Error("not an office file");
  return tidy(read(parts));
}
