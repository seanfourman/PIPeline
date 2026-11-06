// The user's grade sheet, kept from the settings in the folder /setup reads diplomas from (user/documents/README.md),
// for the jobs whose posting asks for one: the applications page offers it beside the CV, on its own and joined to
// the CV in one file, made when it is asked for. A PDF only, a new one in the old one's place; one locked against
// copying can go on its own but not be joined.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { REPO } from "./policy";

export const TRANSCRIPT = "user/documents/diplomas/transcript.pdf";
// Whether it can be joined, worked out once as it comes in.
const META = "user/app/transcript.json";
const MAX = 20 * 1024 * 1024;

export class TranscriptError extends Error {}
export type TranscriptInfo = { size: number; joinable: boolean };

export async function saveTranscript(data: unknown, root = REPO): Promise<TranscriptInfo> {
  const bytes = Buffer.from(String(data ?? ""), "base64");
  if (!bytes.length) throw new TranscriptError("transcript_empty");
  if (bytes.length > MAX) throw new TranscriptError("transcript_size");
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new TranscriptError("transcript_type");
  // Joinable if it opens as it is, with pages: a locked one only opens past its lock, its pages unreadable once
  // copied.
  const joinable = await PDFDocument.load(bytes).then((doc) => doc.getPageCount() > 0).catch(() => false);
  for (const [file, content] of [[TRANSCRIPT, bytes], [META, JSON.stringify({ joinable })]] as const) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return { size: bytes.length, joinable };
}

// The one kept, if any; one put there by hand is taken to be joinable until joining it fails.
export function transcriptInfo(root = REPO): TranscriptInfo | null {
  const file = path.join(root, TRANSCRIPT);
  if (!existsSync(file)) return null;
  let joinable = true;
  try { joinable = JSON.parse(readFileSync(path.join(root, META), "utf8")).joinable !== false; } catch { /* none kept */ }
  return { size: statSync(file).size, joinable };
}

export function removeTranscript(root = REPO) {
  rmSync(path.join(root, TRANSCRIPT), { force: true });
  rmSync(path.join(root, META), { force: true });
}

// Whether a posting asks for one, by the words it would use: ציונים, with a letter or two before it (והציונים)
// or none, or a transcript, grades, a grade sheet or report, an academic record. A posting is only ever read for
// this.
export const asksForTranscript = (text: string) =>
  /(?:^|[^\p{L}])[והבלמשכ]{0,2}ציונים(?!\p{L})/u.test(text) || /\b(?:transcripts?|grades|grade (?:sheet|report)s?|academic records?)\b/i.test(text);

// The CV and the grade sheet in one file, the CV's pages first.
export async function joinWithTranscript(cvPdf: string, root = REPO) {
  const joined = await PDFDocument.create();
  for (const file of [cvPdf, path.join(root, TRANSCRIPT)]) {
    const doc = await PDFDocument.load(readFileSync(file));
    for (const page of await joined.copyPages(doc, doc.getPageIndices())) joined.addPage(page);
  }
  return joined.save();
}
