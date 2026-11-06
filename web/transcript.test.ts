import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { postingAsksTranscript } from "./data";
import { asksForTranscript, joinWithTranscript, removeTranscript, saveTranscript, TRANSCRIPT, transcriptInfo } from "./transcript";

const pdf = async (pages: number) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
};

describe("transcript", () => {
  test("keeps a PDF in the diplomas folder, in the old one's place, and puts it away", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "transcript-"));
    expect(transcriptInfo(root)).toBeNull();
    expect(await saveTranscript((await pdf(1)).toString("base64"), root)).toMatchObject({ joinable: true });
    const again = await pdf(2);
    await saveTranscript(again.toString("base64"), root);
    expect(transcriptInfo(root)).toEqual({ size: again.length, joinable: true });
    removeTranscript(root);
    expect(existsSync(path.join(root, TRANSCRIPT))).toBe(false);
    expect(transcriptInfo(root)).toBeNull();
  });

  test("refuses what is not a PDF, an empty file, and one past the size", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "transcript-"));
    await expect(saveTranscript(Buffer.from("<html>").toString("base64"), root)).rejects.toThrow("transcript_type");
    await expect(saveTranscript("", root)).rejects.toThrow("transcript_empty");
    await expect(saveTranscript(Buffer.alloc(21 * 1024 * 1024).toString("base64"), root)).rejects.toThrow("transcript_size");
    expect(transcriptInfo(root)).toBeNull();
  });

  test("a locked PDF, or one with no pages, is kept but not to be joined", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "transcript-"));
    const locked = [
      "%PDF-1.4", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj", "2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj",
      "3 0 obj << /Filter /Standard /V 1 /R 2 /P -4 >> endobj", "trailer << /Root 1 0 R /Encrypt 3 0 R >>", "%%EOF",
    ].join("\n");
    expect(await saveTranscript(Buffer.from(locked).toString("base64"), root)).toMatchObject({ joinable: false });
    expect(transcriptInfo(root)?.joinable).toBe(false);
    expect(await saveTranscript(Buffer.from("%PDF-1.7 not really").toString("base64"), root)).toMatchObject({ joinable: false });
  });

  test("joins the CV and the grade sheet in one file, the CV first", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "transcript-"));
    await saveTranscript((await pdf(3)).toString("base64"), root);
    const cv = path.join(root, "cv.pdf");
    writeFileSync(cv, await pdf(2));
    const joined = await PDFDocument.load(await joinWithTranscript(cv, root));
    expect(joined.getPageCount()).toBe(5);
  });

  test("a posting asks for one by its words, in Hebrew or English", () => {
    for (const text of ["יש לצרף קורות חיים וגיליון ציונים", "חובה לצרף גליון ציונים.", "נא לשלוח תדפיס ציונים", "קו\"ח והציונים מהתואר", "Please attach your transcript.", "Official transcripts required", "Send a grade sheet", "with your grades"]) {
      expect(asksForTranscript(text)).toBe(true);
    }
    for (const text of ["5+ years of experience in Python", "Bachelor's degree in Computer Science", "ציון לשבח בצבא", "צוות מצטיין"]) {
      expect(asksForTranscript(text)).toBe(false);
    }
  });

  test("an application's posting is found through its CV, and one with none asks nothing", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "transcript-"));
    const folder = path.join(root, "user", "documents", "applications", "acme_data_analyst");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "job_posting.md"), "# Data Analyst\n\nיש לצרף גיליון ציונים.");
    expect(postingAsksTranscript("user/cv/main_acme_data_analyst.tex", root)).toBe(true);
    expect(postingAsksTranscript("cv/main_acme_data_analyst.tex", root)).toBe(true);
    expect(postingAsksTranscript("user/cv/main_other_role.tex", root)).toBe(false);
    expect(postingAsksTranscript("", root)).toBe(false);
  });
});
