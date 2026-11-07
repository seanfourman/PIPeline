// The installer's pictures, from Pip's own pixels (web/ui/pip.tsx): its icon, his mark in his orange at each size
// Windows asks for, square pixels to the last; and the wizard's two bitmaps, him waving on the grass under the
// forest's morning sky, and his mark small in the corner of its pages. drawArt(dir) writes pip.ico, wizard.bmp and
// wizard-small.bmp there, and pip.png, the mark big, which a Mac makes its app's icon of (install-mac.sh). No
// library: a bitmap, an icon of bitmaps and a PNG are simple enough to write as they are.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { foxPixels, MARK } from "../web/ui/pip";

type Colour = [number, number, number, number];
const ORANGE = "#F2892E";
const colour = (hex: string): Colour => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];

class Picture {
  readonly px: Colour[];
  constructor(readonly w: number, readonly h: number, fill: Colour = [0, 0, 0, 0]) {
    this.px = Array.from({ length: w * h }, () => fill);
  }
  at(x: number, y: number) { return this.px[y * this.w + x]; }
  rect(x: number, y: number, w: number, h: number, c: Colour) {
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) this.px[j * this.w + i] = c;
  }
}

// Pixels, as pip.tsx gives them, each drawn as a square of scale, the top left of the lot at (x, y).
function draw(p: Picture, pixels: [number, number, string][], scale: number, x: number, y: number) {
  const left = Math.min(...pixels.map((q) => q[0]));
  const top = Math.min(...pixels.map((q) => q[1]));
  for (const [i, j, c] of pixels) p.rect(x + (i - left) * scale, y + (j - top) * scale, scale, scale, colour(c));
}
const markPixels = (): [number, number, string][] =>
  MARK.flatMap((row, y) => [...row].flatMap((ch, x): [number, number, string][] => (ch === "X" ? [[x, y, ORANGE]] : [])));
const size = (pixels: [number, number, string][]) => [
  Math.max(...pixels.map((q) => q[0])) - Math.min(...pixels.map((q) => q[0])) + 1,
  Math.max(...pixels.map((q) => q[1])) - Math.min(...pixels.map((q) => q[1])) + 1,
];

// A 24-bit bitmap, its rows from the bottom up, each to a whole number of four bytes.
function bmp(p: Picture) {
  const row = Math.ceil((p.w * 3) / 4) * 4;
  const out = Buffer.alloc(54 + row * p.h);
  out.write("BM", 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(p.w, 18);
  out.writeInt32LE(p.h, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * p.h, 34);
  out.writeInt32LE(2835, 38);
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const [r, g, b] = p.at(x, p.h - 1 - y);
      const o = 54 + y * row + x * 3;
      out[o] = b; out[o + 1] = g; out[o + 2] = r;
    }
  }
  return out;
}

// An icon of 32-bit bitmaps, one for each size, their see-through in the alpha (the old mask left empty).
function ico(pictures: Picture[]) {
  const images = pictures.map((p) => {
    const mask = Math.ceil(p.w / 32) * 4 * p.h;
    const out = Buffer.alloc(40 + p.w * p.h * 4 + mask);
    out.writeUInt32LE(40, 0);
    out.writeInt32LE(p.w, 4);
    out.writeInt32LE(p.h * 2, 8);
    out.writeUInt16LE(1, 12);
    out.writeUInt16LE(32, 14);
    out.writeUInt32LE(p.w * p.h * 4 + mask, 20);
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const [r, g, b, a] = p.at(x, p.h - 1 - y);
        const o = 40 + (y * p.w + x) * 4;
        out[o] = b; out[o + 1] = g; out[o + 2] = r; out[o + 3] = a;
      }
    }
    return out;
  });
  const head = Buffer.alloc(6 + 16 * pictures.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pictures.length, 4);
  let offset = head.length;
  pictures.forEach((p, i) => {
    const e = 6 + 16 * i;
    head[e] = p.w >= 256 ? 0 : p.w;
    head[e + 1] = p.h >= 256 ? 0 : p.h;
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(images[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([head, ...images]);
}

// A PNG of 8-bit colour with alpha: each row led by the "none" filter, the lot deflated, every chunk with its CRC.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: Buffer) => {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(p: Picture) {
  const raw = Buffer.alloc((p.w * 4 + 1) * p.h);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) raw.set(p.at(x, y), y * (p.w * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(p.w, 0);
  head.writeUInt32BE(p.h, 4);
  head[8] = 8;
  head[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function drawArt(dir: string) {
  const mark = markPixels();
  const [mw, mh] = size(mark);
  // The mark as big as each size holds it in whole pixels, in the middle.
  const icons = [16, 24, 32, 48, 64, 256, 512].map((s) => {
    const scale = Math.max(1, Math.floor(s / mw));
    const p = new Picture(s, s);
    draw(p, mark, scale, Math.floor((s - mw * scale) / 2), Math.floor((s - mh * scale) / 2));
    return p;
  });
  writeFileSync(path.join(dir, "pip.ico"), ico(icons.slice(0, -1)));
  writeFileSync(path.join(dir, "pip.png"), png(icons[icons.length - 1]));

  // The wizard's tall picture: the sky in the forest's two blues, a pale band of trees far off, the grass with its
  // darker edge, and Pip on it waving hello.
  const wizard = new Picture(164, 314, colour("#86c7e6"));
  wizard.rect(0, 150, 164, 70, colour("#a9dcef"));
  wizard.rect(0, 200, 164, 24, colour("#9fcfa8"));
  wizard.rect(0, 224, 164, 90, colour("#5fae44"));
  wizard.rect(0, 224, 164, 6, colour("#367a32"));
  for (const [x, y] of [[14, 250], [120, 262], [52, 286], [140, 298], [92, 244]]) wizard.rect(x, y, 6, 6, colour("#ff9cbf"));
  const fox = foxPixels("front", "wave") as [number, number, string][];
  const [fw, fh] = size(fox);
  const scale = 6;
  draw(wizard, fox, scale, Math.floor((164 - fw * scale) / 2), 230 - fh * scale);
  writeFileSync(path.join(dir, "wizard.bmp"), bmp(wizard));

  // The small one, in the corner of the pages between: his mark on the white they are.
  const small = new Picture(55, 55, colour("#ffffff"));
  draw(small, mark, 3, Math.floor((55 - mw * 3) / 2), Math.floor((55 - mh * 3) / 2));
  writeFileSync(path.join(dir, "wizard-small.bmp"), bmp(small));
}
