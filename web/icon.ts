// Pip's icon (ICON in ui/pip.tsx) as pictures, at each size a tab, Windows or a Mac asks for: every block a whole
// number of pixels square, the fox as big as that fits and in the middle. At 16 pixels, where a pixel a block would
// leave him small in the square, some blocks take two, picked to keep his face even and his eyes taller than wide.
// And the files they go in, written as they are with no library: an icon of bitmaps (.ico) and a PNG. The tab's is
// public/icon.ico, which bun icon.ts writes again after a change to the fox; bun icon.ts mac <dir> writes a Mac's two
// there as it installs (installer/install-mac.sh): the fox big for its app, and the logo for its menu bar.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { ICON, ICON_COLORS, MARK } from "./ui/pip";

export type Colour = [number, number, number, number];
export const colour = (hex: string): Colour => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];

export class Picture {
  readonly px: Colour[];
  constructor(readonly w: number, readonly h: number, fill: Colour = [0, 0, 0, 0]) {
    this.px = Array.from({ length: w * h }, () => fill);
  }
  at(x: number, y: number) { return this.px[y * this.w + x]; }
  rect(x: number, y: number, w: number, h: number, c: Colour) {
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++) this.px[j * this.w + i] = c;
  }
}

// How many pixels each of the fox's ten columns and ten rows takes at 16: the face's columns the same either side of
// the nose, the eyes two wide and three tall and the nose two square, as at 20 they are two by four and two square.
const SIXTEEN = { columns: [1, 2, 2, 1, 2, 1, 2, 2, 1, 2], rows: [1, 2, 2, 1, 2, 1, 2, 2, 2, 1] };

// The fox in a square of size, on fill (see-through if none).
export function foxIcon(size: number, fill?: Colour) {
  const block = Math.floor(size / Math.max(ICON.length, ICON[0].length));
  const { columns, rows } = size === 16 ? SIXTEEN : { columns: ICON[0].split("").map(() => block), rows: ICON.map(() => block) };
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
  const p = new Picture(size, size, fill);
  let y = Math.floor((size - sum(rows)) / 2);
  ICON.forEach((line, j) => {
    let x = Math.floor((size - sum(columns)) / 2);
    [...line].forEach((key, i) => {
      if (key !== ".") p.rect(x, y, columns[i], rows[j], colour(ICON_COLORS[key]));
      x += columns[i];
    });
    y += rows[j];
  });
  return p;
}

// An icon of 32-bit bitmaps, one for each size, their see-through in the alpha (the old mask left empty).
export function ico(pictures: Picture[]) {
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
export function png(p: Picture) {
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

// The tab's icon, at the size a browser draws it on a screen at 100% up to 300%: it takes the one for its scale.
export const tabIcon = () => ico([16, 20, 24, 32, 40, 48].map((size) => foxIcon(size)));

// The logo (MARK in ui/pip.tsx), his face in black on nothing, scale pixels to each of its own: for a Mac's menu bar,
// which takes it as a template and colours it to suit itself.
export function markPicture(scale: number) {
  const p = new Picture(MARK[0].length * scale, MARK.length * scale);
  MARK.forEach((row, y) => [...row].forEach((key, x) => {
    if (key === "X") p.rect(x * scale, y * scale, scale, scale, [0, 0, 0, 255]);
  }));
  return p;
}

if (import.meta.main) {
  const [what, dir] = process.argv.slice(2);
  if (what === "mac") {
    writeFileSync(path.join(dir, "pip.png"), png(foxIcon(512)));
    writeFileSync(path.join(dir, "menu.png"), png(markPicture(2)));
  } else writeFileSync(path.join(import.meta.dir, "public", "icon.ico"), tabIcon());
}
