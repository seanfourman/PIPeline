// Pip's vault, the background of Pip's haul on My Jobs (views/loot.tsx): a room heaped with gold coins, painted a
// pixel at a time like the home page's forest. Three rooms, each full of coins: the gold, its walls stone with torches,
// an open chest, a crown, a goblet and a sword in the pile; high-tech, steel panels with a strip of light, racks of
// servers against the wall and gold chips in the pile; and outside high-tech, a bank's vault, its wall safe-deposit
// boxes under hanging lamps, with bars of gold and sacks of coins. The coins rise in mounds against the back wall,
// kept low where asked (clear) and under the words on it, and cover the floor below, darker further down; under that
// they thin out, one by one, into the page and grow lighter as they go. Pure, on buffers (vaultScene, vaultPixels),
// so it can be tried without a page: the scene knows which coin each pixel is, so the coins can pour in, each falling
// into its place, and fall away again (pourFrame).

export type Room = "gold" | "tech" | "low";
export const ROOMS: readonly Room[] = ["gold", "tech", "low"];
// Screen pixels a pixel, and how far the hill Pip stands on rises over the floor, in pixels.
export const VAULT_PX = 3;
export const PEAK = 8;

// The room's size in pixels; floor: how far down the back wall meets the floor; clear: spans across it, from and to,
// kept low (the doors); quiet: boxes on the wall (left, right, top, bottom) where words or signs stand, nothing hung
// on the wall there and the heap kept under them; pip: the middle of the hill Pip stands on, or null for none; thin:
// the rows (from, to) over which the coins thin out into the page, none left past the last.
export type VaultPlan = {
  width: number; height: number; floor: number; clear: [number, number][]; quiet: [number, number, number, number][]; pip: number | null;
  thin?: [number, number];
};

type RGB = [number, number, number];
// A drawing: one character a pixel, each letter a colour, a dot for none; glow: the letters that give light.
type Art = { rows: string[]; colors: Record<string, string>; glow?: string };

const rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

// The same number for the same place every time, so a room looks the same each time it is painted at a size.
function hash(x: number, y: number, s: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function random(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the things in the rooms ----------

const TORCH: Art = {
  rows: [
    "...f...", "..fF...", "..fFf..", ".fFYFf.", ".fYWYf.", ".fYWYf.", "..fYf..", ".OhhhO.", ".OHhHO.", "..OwO..", "..OwO..",
    "OOOwOOO", "OiiwiiO", "..OwO..", "..OwO..", "..OOO..",
  ],
  colors: { f: "#e2541e", F: "#ff9a2e", Y: "#ffd04a", W: "#fff6c8", O: "#1c130d", h: "#5a3a1c", H: "#7a5228", w: "#6b4423", i: "#5c5f68" },
  glow: "fFYW",
};
const CHEST: Art = {
  rows: [
    "...OOOOOOOOOOOOOO...", "..ObbbbbbbbbbbbbbO..", "..ObBBBBBBBBBBBBbO..", "..ObBBBBBBBBBBBBbO..", "..OGGGGGGGGGGGGGGO..",
    "..OkkkkkkkkkkkkkkO..", ".OLYLYYLWYLYYLYLYYO.", "OYLYYDYLYYDYYLYDYYLO", "OGGGGGGGGGGGGGGGGGGO", "ObbbbbbbOOOObbbbbbbO",
    "ObBBBBBBOYLOBBBBBBbO", "ObBBBBBBOYDOBBBBBBbO", "ObBBBBBBBOOBBBBBBBbO", "OGGGGGGGGGGGGGGGGGGO", "ObbbbbbbbbbbbbbbbbbO",
    "OOOOOOOOOOOOOOOOOOOO",
  ],
  colors: { O: "#2a1608", b: "#a2622c", B: "#7a4420", G: "#e8ad2e", k: "#1a0e05", Y: "#f6c445", L: "#ffe68a", D: "#c98a1c", W: "#ffffff" },
};
const CROWN: Art = {
  rows: [
    "O.....O.....O", "OO...OWO...OO", "OYO..OYO..OYO", "OYYO.OYO.OYYO", "OYYYOYYYOYYYO", "OYYYYYYYYYYYO", "OYrYYYbYYYrYO",
    "OYYYYYYYYYYYO", "ODDDDDDDDDDDO", "OOOOOOOOOOOOO",
  ],
  colors: { O: "#5c3a0a", Y: "#f6c445", D: "#c98a1c", W: "#fff3c4", r: "#e0483a", b: "#3fa9f5" },
};
const GOBLET: Art = {
  rows: ["OOOOOOO", "OLYYYDO", "OLYrYDO", ".OYYDO.", "..OYO..", "..OYO..", "..ODO..", ".OYYDO.", "OOOOOOO"],
  colors: { O: "#5c3a0a", Y: "#f6c445", D: "#c98a1c", L: "#ffe68a", r: "#e0483a" },
};
const SWORD: Art = {
  rows: ["..OOO..", "..OrO..", "..OYO..", "OOOYOOO", "OYYYYDO", "OOOhOOO", "..OhO..", "..OhO..", "..OSO..", "..OWO..", "..OSO..", "..OSO..", "..OSO.."],
  colors: { O: "#24180e", r: "#e0483a", Y: "#f6c445", D: "#c98a1c", h: "#6b4423", S: "#b9c3cf", W: "#f2f6fa" },
};
const CHIP: Art = {
  rows: [".p.p.p.p.", "ppppppppp", ".pkkkkkp.", "ppkYYYkpp", ".pkYLDkp.", "ppkYDDkpp", ".pkkkkkp.", "ppppppppp", ".p.p.p.p."],
  colors: { p: "#e8ad2e", k: "#1d2b26", Y: "#f6c445", L: "#fff0a8", D: "#c98a1c" },
};
const LAMP: Art = {
  rows: ["....OOO....", "..OgggggO..", ".OgGGGGGgO.", "OOOOOOOOOOO", "...yWWWy..."],
  colors: { O: "#142a1e", g: "#2f6b4a", G: "#4c9a6c", y: "#ffe9a0", W: "#fffbe6" },
  glow: "yW",
};
const SACK: Art = {
  rows: [
    "....OOO....", "...OtTtO...", "....OOO....", "...OsssO...", "..OsSSssO..", ".OsSSSSssO.", "OsSSSSSSssO", "OsSSLYSSssO",
    "OsSSYDSSssO", "OsSSSSSSssO", ".OssssssssO", "..OOOOOOOO.",
  ],
  colors: { O: "#3a2412", t: "#8a5a2a", T: "#c98a4a", s: "#b8925a", S: "#d9b47a", Y: "#f6c445", L: "#ffe68a", D: "#c98a1c" },
};
// A rack of servers, units stacked with lights in them.
const RACK: Art = (() => {
  const rows = ["OOOOOOOOOOOOOO", "OkkkkkkkkkkkkO"];
  for (let u = 0; u < 9; u++) rows.push(u % 3 === 1 ? "OkSgSbSSSmmmkO" : u % 3 === 2 ? "OkSSSSaSgSmmkO" : "OkSbSSSSSSmmkO", "OkkkkkkkkkkkkO");
  rows.push("OOOOOOOOOOOOOO");
  return { rows, colors: { O: "#0b1016", k: "#151d27", S: "#26323f", m: "#33414f", g: "#3fe08a", b: "#3fd0e0", a: "#ffb43f" }, glow: "gba" };
})();
// Bars of gold in a pyramid, three, two and one.
const BARS: Art = (() => {
  const bar = [".OOOOOOO.", "OLLLLLLYO", "OYYYYYYDO", "OOOOOOOOO"];
  const rows: string[] = [];
  for (const n of [1, 2, 3]) {
    const pad = ".".repeat((3 - n) * 4);
    for (const line of bar) rows.push(pad + Array(n).fill(line).join("") + pad);
  }
  return { rows, colors: { O: "#5c3a0a", L: "#fff0a8", Y: "#f6c445", D: "#c98a1c" } };
})();

// The coins' colours: bright, gold and old, each light, middle, dark and edge.
const COINS: RGB[][] = [
  ["#fff3b0", "#f8cc4c", "#cf921e", "#8a5a12"],
  ["#ffe07a", "#eaae2e", "#b97a16", "#7a4e0e"],
  ["#f2cc62", "#d69a26", "#a86c12", "#6b430c"],
].map((p) => p.map(rgb));
const GEMS: RGB[][] = [
  ["#ffd6d6", "#ff5e6c", "#b81d34"], ["#d6f0ff", "#3f9cf0", "#1d4fa8"], ["#d6ffe6", "#34c77a", "#167043"], ["#f0dcff", "#a660ec", "#5a2a99"],
].map((p) => p.map(rgb));
const DEEP = rgb("#4a2e08");
const WHITE: RGB = [255, 255, 255];

// A coin's pixels at a size, seen from above at a slant and lit from the top left: its face an ellipse, its rim light
// on the top left and dark on the bottom right, a glint near the top left, and under the face the coin's edge and a
// dark line that parts it from the coins below. Shades: 0 light, 1 middle, 2 dark, 3 the line, 4 the glint.
type Stamp = { w: number; h: number; face: number; px: [number, number, number][] };
function stamp(w: number, face: number): Stamp {
  const cx = (w - 1) / 2, cy = (face - 1) / 2, rx = w / 2, ry = face / 2;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < face && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.05;
  const px: [number, number, number][] = [];
  let glint = false;
  for (let y = 0; y < face; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const side = (x - cx) / rx + (y - cy) / ry;
      let shade = edge ? (side < -0.1 ? 0 : 2) : 1;
      if (!edge && !glint && w >= 7 && side < -0.3) { shade = 4; glint = true; }
      px.push([x, y, shade]);
    }
  }
  for (let x = 0; x < w; x++) {
    let low = -1;
    for (let y = 0; y < face; y++) if (inside(x, y)) low = y;
    if (low < 0) continue;
    const end = x === 0 || x === w - 1;
    px.push([x, low + 1, end ? 3 : 2], [x, low + 2, 3]);
  }
  return { w, h: face + 2, face, px };
}
const STAMPS = [stamp(5, 2), stamp(7, 3), stamp(9, 4), stamp(11, 5)];

type Put = (x: number, y: number, c: RGB, k?: number) => void;
// A coin at a size, its colours by where it lies, or now and then a gem in its place (and then no colours back).
function coinAt(put: Put, x: number, y: number, st: Stamp): RGB[] | null {
  const h = hash(x, y, 11);
  if (h < 0.006) {
    const g = GEMS[Math.floor(hash(x, y, 12) * GEMS.length)];
    const c = x + (st.w >> 1);
    const r = st.w >= 9 ? 2 : 1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r + Math.abs(dy); dx <= r - Math.abs(dy); dx++) put(c + dx, y + r + dy, g[dy < 0 || (dy === 0 && dx < 0) ? 0 : dy === 0 ? 1 : 2]);
    put(c, y + r, g[1]);
    return null;
  }
  const pal = COINS[h < 0.28 ? 0 : h < 0.8 ? 1 : 2];
  for (const [dx, dy, shade] of st.px) put(x + dx, y + dy, shade === 4 ? (hash(x, y, 15) > 0.5 ? WHITE : pal[0]) : pal[shade]);
  return pal;
}
// How dark the floor is far from the wall, where the jobs lie on it.
const FLOOR_DIM = 0.48;
// Far out on the floor the biggest coins lie looser: some a size smaller, each up to two pixels off its row. Gives
// the coin and how far down it lies.
function loose(x: number, y: number, st: Stamp): [Stamp, number] {
  const j = hash(x, y, 9);
  if (st !== STAMPS[3]) return [st, j < 0.25 ? -1 : j > 0.75 ? 1 : 0];
  return [hash(x, y, 10) < 0.22 ? STAMPS[2] : st, Math.floor(j * 5) - 2];
}

// The walls, by room: stones, panels or boxes, each a few shades, and the joints between them.
const STONES = ["#4d3829", "#553e2d", "#463222", "#3f2c1f", "#5a4230"].map(rgb);
const PANELS = ["#24303e", "#283546", "#202b38"].map(rgb);
const BOXES = ["#8d929a", "#969ba3", "#868b93", "#9ea3aa"].map(rgb);

const lighter = (c: RGB, n: number): RGB => [c[0] + n, c[1] + n, c[2] + n];

// ---------- painting ----------

// A room painted, with what it is made of. pixels: the room; wall: the back wall and what hangs on it alone, lit the
// same, for what shows behind the heap before its coins are in; owner: what each pixel is, WALL, GROUND (the heap's
// dark ground between the coins) or the number of the coin or thing it is, in the order they were laid, back to
// front; ys: each coin's or thing's row; order and starts: the pixels of each coin, coin after coin; top: the heap's
// highest row.
export type VaultScene = {
  width: number; height: number; floor: number; top: number;
  pixels: Uint8ClampedArray; wall: Uint8ClampedArray; owner: Int32Array; ys: Float32Array; order: Int32Array; starts: Int32Array;
};
export const WALL = -1;
export const GROUND = -2;

export function vaultPixels(room: Room, plan: VaultPlan): Uint8ClampedArray {
  return vaultScene(room, plan).pixels;
}

export function vaultScene(room: Room, plan: VaultPlan): VaultScene {
  const W = Math.max(1, plan.width), H = Math.max(1, plan.height);
  const floor = clamp(Math.round(plan.floor), 0, H);
  const out = new Uint8ClampedArray(W * H * 4);
  // What each pixel is, for the light: 0 the wall, 1 the coins and things, 2 a light.
  const kind = new Uint8Array(W * H);
  // The heap's dark ground showing between the coins, which fades out where they thin.
  const ground = new Uint8Array(W * H);
  // Whose each pixel is (VaultScene's owner), set as it is put: who is the one being laid now.
  const owner = new Int32Array(W * H).fill(WALL);
  const ys: number[] = [];
  let who = WALL;
  const next = (y: number) => { ys.push(y); who = ys.length - 1; };
  const glows: { x: number; y: number; r: number; k: number }[] = [];
  const rand = random(W * 31 + floor * 7 + ROOMS.indexOf(room) * 1009);
  const put = (x: number, y: number, c: RGB, k = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
    kind[i] = k;
    ground[i] = 0;
    owner[i] = who;
  };
  const draw = (art: Art, x0: number, y0: number, k = 1) => {
    const colors = Object.fromEntries(Object.entries(art.colors).map(([ch, h]) => [ch, rgb(h)]));
    art.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ".") put(x0 + x, y0 + y, colors[ch], art.glow?.includes(ch) ? 2 : k);
    }));
  };
  const awayFrom = (x: number, w: number, gap: number) =>
    plan.clear.every(([a, b]) => x + w + gap < a || x - gap > b) && (plan.pip === null || Math.abs(x + w / 2 - plan.pip) > 22 + w / 2);
  // A thing on the wall: away from the doors and Pip, and off the words.
  const onWall = (x: number, y: number, w: number, h: number, gap: number, doors = true) =>
    (!doors || awayFrom(x, w, gap)) && plan.quiet.every(([a, b, t, u]) => x + w + gap < a || x - gap > b || y + h + gap < t || y - gap > u);

  // The back wall.
  for (let y = 0; y < floor; y++) {
    for (let x = 0; x < W; x++) {
      const up = floor - 1 - y;
      if (room === "gold") {
        const row = Math.floor(up / 8), off = row % 2 ? 8 : 0;
        const lx = (x + off) % 16, ly = up % 8, bx = Math.floor((x + off) / 16);
        if (ly === 7 || lx === 15) { put(x, y, [34, 24, 17], 0); continue; }
        const base = STONES[Math.floor(hash(bx, row, 1) * STONES.length)];
        const n = ly === 6 ? 12 : ly === 0 ? -10 : lx === 0 ? 6 : 0;
        put(x, y, lighter(base, n + (hash(x, y, 2) > 0.93 ? -8 : 0)), 0);
      } else if (room === "tech") {
        const row = Math.floor(up / 14), lx = x % 24, ly = up % 14, bx = Math.floor(x / 24);
        if (ly === 13 || lx === 23) { put(x, y, [16, 22, 30], 0); continue; }
        const base = PANELS[Math.floor(hash(bx, row, 3) * PANELS.length)];
        const rivet = (lx === 2 || lx === 20) && (ly === 2 || ly === 10);
        if (rivet) { put(x, y, [96, 116, 136], 0); continue; }
        const n = ly === 12 ? 10 : ly === 0 ? -8 : lx === 0 ? 7 : lx === 22 ? -6 : 0;
        put(x, y, lighter(base, n), 0);
      } else {
        const row = Math.floor(up / 8), lx = x % 13, ly = up % 8, bx = Math.floor(x / 13);
        if (ly === 7 || lx === 12) { put(x, y, [58, 62, 69], 0); continue; }
        const base = BOXES[Math.floor(hash(bx, row, 5) * BOXES.length)];
        if (lx === 6 && (ly === 2 || ly === 3)) { put(x, y, [40, 43, 48], 0); continue; }
        if (ly === 5 && lx >= 2 && lx <= 4) { put(x, y, [201, 162, 74], 0); continue; }
        const n = ly === 6 ? 16 : ly === 0 ? -14 : lx === 0 ? 8 : lx === 11 ? -8 : 0;
        put(x, y, lighter(base, n), 0);
      }
    }
  }

  // On the wall: torches, a strip of light along the ceiling with racks under it, or hanging lamps; each wherever
  // there is room for it, from the left, a little apart from the last.
  const along = (w: number, y: number, h: number, apart: number, at: (x: number) => void, gap = 8, doors = true) => {
    let last = -Infinity;
    for (let x = 14; x <= W - 14 - w; x += 1) {
      if (x - last < apart || !onWall(x, y, w, h, gap, doors)) continue;
      at(x);
      last = x;
    }
  };
  if (room === "gold") {
    // Beside the doors, at the height of their middle.
    const y = Math.max(1, floor - 25);
    along(7, y, 16, 60, (x) => { draw(TORCH, x, y, 0); glows.push({ x: x + 3, y: y + 4, r: 56, k: 0.6 }); }, 2);
  } else if (room === "tech") {
    const ny = 3;
    for (let x = 0; x < W; x++) {
      put(x, ny - 1, [31, 140, 170], 2); put(x, ny, [190, 252, 255], 2); put(x, ny + 1, [31, 140, 170], 2);
    }
    glows.push({ x: -1, y: ny, r: 18, k: 0.3 });
    for (let i = 0; i < W / 30; i++) {
      const x = Math.floor(hash(i, 1, 21) * W), y = Math.floor(ny + 6 + hash(i, 2, 21) * Math.max(1, floor - ny - 10));
      if (onWall(x, y, 1, 1, 2)) put(x, y, hash(i, 3, 21) > 0.5 ? [63, 224, 138] : [63, 208, 224], 2);
    }
    const rackY = floor - RACK.rows.length + 4;
    if (rackY > ny + 3) along(14, rackY, RACK.rows.length, 90, (x) => draw(RACK, x, rackY));
  } else {
    const ly = Math.max(3, Math.round(floor * 0.22));
    along(11, 0, ly + 5, 80, (x) => {
      for (let y = 0; y < ly; y++) put(x + 5, y, [30, 30, 34], 0);
      draw(LAMP, x, ly);
      glows.push({ x: x + 5, y: ly + 6, r: 64, k: 0.5 });
    }, 8, false);
  }

  // The wall alone, before the heap is laid over it.
  const bare = out.slice(0, W * floor * 4);
  const bareKind = kind.slice(0, W * floor);

  // The heap: mounds against the wall, low before the doors, a hill for Pip.
  const maxM = clamp(Math.round(floor * 0.42), 6, 20);
  const m = new Float32Array(W).fill(2);
  for (let i = Math.max(3, Math.round(W / 40)); i > 0; i--) {
    const cx = rand() * W, half = 22 + rand() * 34, h = 4 + rand() * (maxM - 4);
    for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(W, Math.ceil(cx + half)); x++) {
      const v = (h * (Math.cos((Math.PI * (x - cx)) / half) + 1)) / 2;
      if (v > m[x]) m[x] = v;
    }
  }
  if (plan.pip !== null) {
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x - plan.pip);
      if (d <= 18) m[x] = Math.min(m[x], PEAK);
      if (d <= 22) m[x] = Math.max(m[x], (PEAK * (Math.cos((Math.PI * d) / 22) + 1)) / 2);
      if (d <= 4) m[x] = PEAK;
    }
  }
  for (const [a, b] of plan.clear) {
    for (let x = 0; x < W; x++) {
      const d = x < a ? a - x : x > b ? x - b : 0;
      const g = clamp((d - 1) / 12, 0, 1);
      m[x] = Math.min(m[x], 1 + (m[x] - 1) * g);
    }
  }
  for (const [a, b, , u] of plan.quiet) {
    for (let x = Math.max(0, Math.floor(a) - 6); x < Math.min(W, Math.ceil(b) + 6); x++) m[x] = Math.min(m[x], Math.max(1, floor - u - 3));
  }
  const top = Int32Array.from(m, (v) => floor - Math.round(v));
  const topAt = (x: number) => top[clamp(x, 0, W - 1)];
  // Where the coins thin out, from the first of those rows to the last: how far along, 0 to 1, or null above them.
  const [thinFrom, thinTo] = plan.thin ?? [H, H + 1];
  const thinning = (y: number) => y < thinFrom ? null : smooth((y - thinFrom) / Math.max(1, thinTo - thinFrom));
  who = GROUND;
  for (let x = 0; x < W; x++) for (let y = Math.max(0, top[x]); y < Math.min(H, thinTo); y++) { put(x, y, DEEP); ground[y * W + x] = 1; }

  // The coins, row by row from the back of the heap to the front, small at the back and bigger nearer, each row
  // over the one behind it; now and then a gem in a coin's place, and on top of the heap a coin standing on its edge
  // or a glint.
  let minTop = H;
  for (let x = 0; x < W; x++) minTop = Math.min(minTop, top[x]);
  // The coins' size by how far they lie from the wall: the biggest from a little way out, as under the room.
  const sizeAt = (y: number) => {
    const d = y - floor;
    return STAMPS[d < -6 ? 0 : d < 30 ? 1 : d < 80 ? 2 : 3];
  };
  const coin = (x: number, y: number, st: Stamp, surface: boolean) => {
    const gone = thinning(y);
    if (gone !== null && hash(x, y, 17) < gone * 1.08) return;
    next(y);
    const pal = coinAt(put, x, y, st);
    if (!pal || !surface) return;
    const e = hash(x, y, 13);
    const c = x + (st.w >> 1);
    if (e > 0.9) { const [L, Y, D] = pal; for (let k = 1; k <= st.h; k++) { put(c, y - k, k > st.h - 2 ? L : Y); put(c + 1, y - k, D); } put(c - 1, y - 1, Y); }
    else if (e < 0.07) { put(c, y, WHITE, 2); put(c - 1, y, pal[0]); put(c + 1, y, pal[0]); put(c, y - 1, pal[0]); put(c, y + 1, pal[0]); }
  };
  const coinsOver = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0, row = 0; y < y1; row++) {
      const st = sizeAt(y);
      for (let x = x0 - Math.floor(hash(row, y, 8) * st.w); x < x1; x += st.w - 2 + Math.floor(hash(x, y, 7) * 3)) {
        const t = topAt(x + (st.w >> 1));
        const [one, dy] = loose(x, y, st);
        const yy = y + dy;
        if (yy >= t - 1) coin(x, yy, one, yy - t < one.face);
      }
      y += Math.max(2, st.face);
    }
  };
  coinsOver(-12, W + 12, minTop - 1, H + 2);

  // The room's things in the heap, sunk into it, coins over their foot: a chest down in the heap's front, where it
  // is thick, the rest up on its mounds against the wall.
  const things: Art[] = room === "gold" ? [CHEST, CROWN, SWORD, GOBLET, CHEST, CROWN] : room === "tech" ? [CHIP, CHIP, CHIP, CHIP] : [BARS, SACK, BARS, SACK, BARS];
  const taken: number[] = [];
  for (const art of things) {
    const w = art.rows[0].length, h = art.rows.length;
    const front = art === CHEST;
    for (let tries = 0; tries < 24; tries++) {
      const x = Math.floor(8 + rand() * (W - 16 - w));
      if (x < 0 || !awayFrom(x, w, 6) || taken.some((t) => Math.abs(t - x) < 34 + w)) continue;
      let t = H;
      if (front) t = floor + 12 + Math.floor(rand() * 8);
      else for (let i = 0; i < w; i++) t = Math.min(t, topAt(x + i));
      const sink = front ? 3 : art === SWORD ? 5 : 2;
      const y = t - h + sink;
      if (y < 2 || (front ? t + 8 > Math.min(H, thinTo) : t > floor) || !onWall(x, y, w, h, front ? 10 : 3)) continue;
      next(y);
      draw(art, x, y);
      coinsOver(x - 3, x + w + 3, t + sink - (front ? 4 : 2), t + sink + 1);
      taken.push(x);
      break;
    }
  }

  // The light: the wall darker towards the ceiling, lit by the room's lights, the floor darker further down so what
  // lies on it reads, and the two sides in shadow.
  const warm = room === "tech" ? [0, 10, 26] : room === "low" ? [18, 14, 6] : [34, 16, 0];
  const strip = room === "tech" ? glows.find((g) => g.x < 0) : undefined;
  const lightUp = (out: Uint8ClampedArray, kind: Uint8Array, ground: Uint8Array | null, rows: number) => {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (kind[i] === 2) continue;
        let f = kind[i] === 0 ? 0.5 + 0.3 * (y / Math.max(1, floor)) : 1;
        const deep = y < floor ? 0 : smooth((y - floor) / 70);
        if (y >= floor) f *= 1 - (1 - FLOOR_DIM) * deep;
        const gone = thinning(y);
        if (gone !== null) f += (0.95 - f) * smooth(gone * 1.6);
        f *= 1 - (0.3 - 0.3 * smooth(Math.min(x, W - 1 - x) / 42)) * (1 - deep);
        let glow = 0;
        for (const g of glows) {
          if (g.x < 0) continue;
          const d = Math.hypot(x - g.x, (y - g.y) * 1.15);
          if (d < g.r) glow += g.k * (1 - d / g.r) ** 2;
        }
        if (strip && y < floor) glow += strip.k * Math.max(0, 1 - Math.abs(y - strip.y) / strip.r);
        f += glow;
        const p = i * 4;
        out[p] = out[p] * f + warm[0] * glow; out[p + 1] = out[p + 1] * f + warm[1] * glow; out[p + 2] = out[p + 2] * f + warm[2] * glow;
        if (ground?.[i] && gone !== null) out[p + 3] = 255 * (1 - smooth(gone / 0.6));
      }
    }
  };
  lightUp(out, kind, ground, H);
  const wall = new Uint8ClampedArray(W * H * 4);
  wall.set(bare);
  lightUp(wall, bareKind, null, floor);

  // Each coin's pixels together, coin after coin in the order they were laid.
  const n = ys.length;
  const starts = new Int32Array(n + 1);
  for (let i = 0; i < W * H; i++) if (owner[i] >= 0) starts[owner[i] + 1]++;
  for (let k = 0; k < n; k++) starts[k + 1] += starts[k];
  const order = new Int32Array(starts[n]);
  const at = starts.slice(0, n);
  for (let i = 0; i < W * H; i++) if (owner[i] >= 0) order[at[owner[i]]++] = i;
  return { width: W, height: H, floor, top: minTop, pixels: out, wall, owner, ys: Float32Array.from(ys), order, starts };
}

// The coins pouring in or falling away, as a frame at t, 0 to 1, into out (the scene's size).
// Pouring in: the wall shows first; then the coins fall into their places from a little above, the lowest first, so
// the heap fills up from the floor, the things in it landing last, each with a little bounce, and the dark ground
// between them fills in under them. Falling away: the coins drop down and fade, in no order, and the wall goes.
export function pourFrame(s: VaultScene, t: number, out: Uint8ClampedArray, leaving = false) {
  const { width: W, height: H, pixels: px, wall, owner, ys, order, starts } = s;
  out.fill(0);
  const blend = (j: number, src: Uint8ClampedArray, p: number, a: number) => {
    const sa = (src[p + 3] / 255) * a;
    if (sa <= 0) return;
    const da = out[j + 3] / 255, keep = da * (1 - sa), oa = sa + keep;
    out[j] = (src[p] * sa + out[j] * keep) / oa;
    out[j + 1] = (src[p + 1] * sa + out[j + 1] * keep) / oa;
    out[j + 2] = (src[p + 2] * sa + out[j + 2] * keep) / oa;
    out[j + 3] = oa * 255;
  };
  const span = Math.max(1, H - s.top);
  const low = (y: number) => clamp((y - s.top) / span, 0, 1);

  const wallA = leaving ? 1 - smooth(t / 0.65) : smooth(t / 0.3);
  if (wallA > 0) for (let i = 0; i < W * s.floor; i++) blend(i * 4, wall, i * 4, wallA);

  for (let i = 0; i < W * H; i++) {
    if (owner[i] !== GROUND) continue;
    const y = Math.floor(i / W);
    const a = leaving ? 1 - smooth(t / 0.5) : smooth((t - 0.62 * (1 - low(y)) - 0.12) / 0.2);
    if (a > 0) blend(i * 4, px, i * 4, a);
  }

  for (let k = 0; k + 1 < starts.length; k++) {
    const h1 = hash(k, 0, 31), h2 = hash(k, 1, 31);
    let dy: number, a: number;
    if (leaving) {
      const u = clamp((t - 0.45 * h1) / 0.55, 0, 1);
      dy = (8 + 12 * h2) * u * u;
      a = 1 - smooth(u);
    } else {
      const u = clamp((t - 0.62 * (1 - low(ys[k])) - 0.1 * h1) / 0.28, 0, 1);
      if (u <= 0) continue;
      dy = u < 0.8 ? -(12 + 16 * h2) * (1 - (u / 0.8) ** 2) : -1.5 * Math.sin((Math.PI * (u - 0.8)) / 0.2);
      a = smooth(u / 0.25);
    }
    if (a <= 0) continue;
    const shift = Math.round(dy) * W;
    for (let o = starts[k]; o < starts[k + 1]; o++) {
      const i = order[o], j = i + shift;
      if (j >= 0 && j < W * H) blend(j * 4, px, i * 4, a);
    }
  }
}
