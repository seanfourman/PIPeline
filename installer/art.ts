// The installer's pictures, from Pip's own pixels (web/ui/pip.tsx): its icon, the fox as the page shows him at each
// size Windows asks for (web/icon.ts); and the wizard's two bitmaps, him waving on the grass under the forest's
// morning sky, and his icon small in the corner of its pages. drawArt(dir) writes pip.ico, wizard.bmp and
// wizard-small.bmp there. No library: a bitmap is simple enough to write as it is. (A Mac draws its own, from
// web/icon.ts, as it installs.)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { colour, foxIcon, ico, Picture } from "../web/icon";
import { foxPixels } from "../web/ui/pip";

// Pixels, as pip.tsx gives them, each drawn as a square of scale, the top left of the lot at (x, y).
function draw(p: Picture, pixels: [number, number, string][], scale: number, x: number, y: number) {
  const left = Math.min(...pixels.map((q) => q[0]));
  const top = Math.min(...pixels.map((q) => q[1]));
  for (const [i, j, c] of pixels) p.rect(x + (i - left) * scale, y + (j - top) * scale, scale, scale, colour(c));
}
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

export function drawArt(dir: string) {
  // Windows' small and big icons at 100% to 200% of their size, and the biggest, for a desktop's large icons.
  writeFileSync(path.join(dir, "pip.ico"), ico([16, 20, 24, 32, 40, 48, 64, 256].map((s) => foxIcon(s))));

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

  // The small one, in the corner of the pages between: his icon on the white they are.
  writeFileSync(path.join(dir, "wizard-small.bmp"), bmp(foxIcon(55, colour("#ffffff"))));
}
