import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachmentContent, getUpload, MAX_IMAGE, saveUpload } from "./uploads";

const dir = mkdtempSync(path.join(os.tmpdir(), "uploads-"));
const b64 = (bytes: number[] | string) => Buffer.from(typeof bytes === "string" ? bytes : Uint8Array.from(bytes)).toString("base64");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];

describe("uploads", () => {
  test("takes images, PDFs and text whose bytes are what their names say", () => {
    expect(saveUpload("screen shot.png", b64(PNG), dir)).toMatchObject({ name: "screen shot.png", kind: "image", type: "image/png", size: PNG.length });
    expect(saveUpload("קורות חיים.pdf", b64("%PDF-1.7 x"), dir)).toMatchObject({ name: "קורות חיים.pdf", kind: "pdf" });
    expect(saveUpload("notes.md", b64("# שלום"), dir).kind).toBe("text");
  });

  test("refuses other kinds, disguised files and oversized images", () => {
    for (const [name, data] of [["page.html", b64("<script>")], ["drawing.svg", b64("<svg/>")], ["fake.png", b64("<html>")], ["fake.pdf", b64(PNG)], ["bin.txt", b64([0, 1, 2])], ["empty.png", ""]]) {
      expect(() => saveUpload(name, data, dir)).toThrow();
    }
    expect(() => saveUpload("big.png", Buffer.concat([Buffer.from(PNG), Buffer.alloc(MAX_IMAGE)]).toString("base64"), dir)).toThrow("size");
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
