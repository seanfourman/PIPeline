import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { attachmentContent, getUpload, MAX_FILE, MAX_IMAGE, saveUpload, uploadNote, uploadText } from "./uploads";

const dir = mkdtempSync(path.join(os.tmpdir(), "uploads-"));
const b64 = (bytes: number[] | string) => Buffer.from(typeof bytes === "string" ? bytes : Uint8Array.from(bytes)).toString("base64");
// A zip of the given files, packed as Office packs them, as base64.
function zip(files: Record<string, string>) {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), packed = deflateRawSync(raw), title = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(title.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(title.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, title, packed); central.push(entry, title);
    offset += 30 + title.length + packed.length;
  }
  const dirBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(dirBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBytes, end]).toString("base64");
}
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];

describe("uploads", () => {
  test("takes images, PDFs and text whose bytes are what their names say", () => {
    expect(saveUpload("screen shot.png", b64(PNG), dir)).toMatchObject({ name: "screen shot.png", kind: "image", type: "image/png", size: PNG.length });
    expect(saveUpload("קורות חיים.pdf", b64("%PDF-1.7 x"), dir)).toMatchObject({ name: "קורות חיים.pdf", kind: "pdf" });
    expect(saveUpload("notes.md", b64("# שלום"), dir).kind).toBe("text");
  });

  test("takes any other file, as what its bytes are, never as an image or a page it isn't", () => {
    // A page or a drawing is text, served as plain text; a file dressed as an image or a PDF is a plain file.
    expect(saveUpload("page.html", b64("<script>"), dir)).toMatchObject({ kind: "text", type: "text/plain; charset=utf-8" });
    expect(saveUpload("drawing.svg", b64("<svg/>"), dir).kind).toBe("text");
    expect(saveUpload("fake.png", b64("<html>"), dir).kind).toBe("text");
    expect(saveUpload("fake.pdf", b64(PNG), dir)).toMatchObject({ kind: "file", type: "application/octet-stream" });
    expect(saveUpload("bin.txt", b64([0, 1, 2]), dir).kind).toBe("file");
    expect(saveUpload("program.exe", b64([0x4d, 0x5a, 0, 0]), dir)).toMatchObject({ kind: "file", name: "program.exe" });
    expect(saveUpload("Makefile", b64("all:"), dir)).toMatchObject({ kind: "text", name: "Makefile" });
    // An image too big to show is kept as a file; past the limit, or empty, nothing is kept.
    expect(saveUpload("big.png", Buffer.concat([Buffer.from(PNG), Buffer.alloc(MAX_IMAGE)]).toString("base64"), dir).kind).toBe("file");
    expect(() => saveUpload("huge.bin", Buffer.alloc(MAX_FILE + 1).toString("base64"), dir)).toThrow("size");
    expect(() => saveUpload("empty.png", "", dir)).toThrow("empty");
    // Never over the folder's own record.
    expect(saveUpload("upload.json", b64("{}"), dir).name).toBe("upload_.json");
  });

  test("unpacks a zip beside it for the agent, with a list of what it holds, every file kept inside its folder", () => {
    const up = saveUpload("project.zip", zip({
      "project/README.md": "# Pip",
      "project/src/main.ts": "console.log(1);",
      "project/דוח.txt": "שלום",
      "project/logo.bin": "\u0000\u0001",
      "../escape.txt": "out",
      "C:/Windows/evil.txt": "out",
    }), dir);
    expect(up.kind).toBe("zip");
    const kept = getUpload(up.id, dir)!;
    expect(kept.folder).toBe(path.join(dir, up.id, "project.zip.files"));
    expect(readFileSync(path.join(kept.folder!, "project", "src", "main.ts"), "utf8")).toBe("console.log(1);");
    expect(readFileSync(path.join(kept.folder!, "project", "דוח.txt"), "utf8")).toBe("שלום");
    expect(existsSync(path.join(dir, up.id, "escape.txt"))).toBe(false);
    expect(existsSync(path.join(dir, "escape.txt"))).toBe(false);
    const list = uploadText(kept);
    expect(list).toStartWith("project.zip holds 4 files:");
    expect(list).toContain("../escape.txt: its name leads outside the zip");
    expect(list).toContain("--- project/README.md ---\n# Pip");
    expect(list).not.toContain("--- project/logo.bin");
    expect(uploadNote(kept)).toContain("unpacked into ");
    expect(uploadNote(kept)).toContain("project.zip.files/");
    // A file named .zip that doesn't open as one is kept as a plain file.
    expect(saveUpload("broken.zip", b64([0x50, 0x4b, 0x03, 0x04, 9, 9]), dir).kind).toBe("file");
  });

  test("takes Word, Excel and PowerPoint files, keeping their words beside them for the agent", () => {
    const word = getUpload(saveUpload("קורות חיים.docx", zip({
      "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>Sean &amp; Pip</w:t></w:r></w:p><w:p><w:r><w:t>Junior</w:t><w:tab/><w:t>2026</w:t></w:r></w:p></w:body></w:document>`,
    }), dir).id, dir)!;
    expect(word).toMatchObject({ kind: "office", name: "קורות חיים.docx" });
    expect(uploadText(word)).toBe("Sean & Pip\nJunior\t2026");
    expect(uploadNote(word)).toContain(", its words as text: ");
    expect(attachmentContent("", [word])).toContain("קורות חיים.docx.txt");

    const sheet = getUpload(saveUpload("jobs.xlsx", zip({
      "xl/workbook.xml": `<workbook><sheets><sheet name="Applied" sheetId="1"/></sheets></workbook>`,
      "xl/sharedStrings.xml": `<sst><si><t>Wix</t></si><si><r><t>Back</t></r><r><t>end</t></r></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>92</v></c></row></sheetData></worksheet>`,
    }), dir).id, dir)!;
    expect(uploadText(sheet)).toBe("Applied\nWix\tBackend\t92");

    const deck = getUpload(saveUpload("talk.pptx", zip({
      "ppt/slides/slide10.xml": `<p:sld><a:p><a:r><a:t>Last</a:t></a:r></a:p></p:sld>`,
      "ppt/slides/slide2.xml": `<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>`,
    }), dir).id, dir)!;
    expect(uploadText(deck)).toBe("Slide 1\nFirst\n\nSlide 2\nLast");

    // A Word file that is no zip is what its bytes are; an old .doc is a plain file the agent opens itself.
    expect(saveUpload("fake.docx", b64("<html>"), dir).kind).toBe("text");
    expect(saveUpload("old.doc", b64([0xd0, 0xcf, 0x11, 0xe0]), dir).kind).toBe("file");
  });

  test("keeps a name inside its own folder", () => {
    const up = saveUpload("../../evil<>.png", b64(PNG), dir);
    expect(up.name).toBe("evil_.png");
    expect(path.dirname(getUpload(up.id, dir)!.file)).toBe(path.join(dir, up.id));
    expect(getUpload("../x", dir)).toBeNull();
    expect(getUpload(crypto.randomUUID(), dir)).toBeNull();
  });

  test("an image goes to Claude as an image, a PDF as a line saying where it is", () => {
    const image = getUpload(saveUpload("a.png", b64(PNG), dir).id, dir)!;
    const pdf = getUpload(saveUpload("cv.pdf", b64("%PDF-1.4"), dir).id, dir)!;
    const content = attachmentContent("what do you think?", [image, pdf]) as any[];
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: b64(PNG) } });
    expect(content[1].type).toBe("text");
    expect(content[1].text).toStartWith("what do you think?");
    expect(content[1].text).toContain("Attached file (cv.pdf):");
    expect(attachmentContent("", [pdf])).toContain("cv.pdf");
  });
});
