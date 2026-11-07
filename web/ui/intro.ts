// The login's opening, in pixel art: leaves cover the screen and part to the sides, the camera pushes into the
// forest, Pip hops in from the edge of the screen and away into the clearing, turns round, sparks gather into
// the form, and Pip jumps onto it. The form stands on a board drawn here in the same pixels.
// The forest is a morning one in the light theme and a night one in the dark.
// Everything is drawn in blocks of a few screen pixels, in flat colours.

import { jump, type Jump, type Point, type Pose } from "./jump";
import { foxPixels, type Mood, type Pixel } from "./pip";

type Ctx = CanvasRenderingContext2D;
type Card = DOMRect | null;
// wrong and right answer the login; off is Pip jumping off the board while it flips to another language.
export type Reaction = "wrong" | "right" | "off";
// card gives the form's box; shown says whether the form is on screen yet, so its board appears with it.
// calm is for reduced motion: day and night then change at once, without the leaves. onSwap says when the
// scene has changed to night or day, so the form's colours change at the same moment.
export type IntroOptions = {
  play: boolean; calm: boolean; night: boolean; card: () => Card; shown: () => boolean;
  onCardShow: () => void; onSwap: (night: boolean) => void;
};

// Changing between day and night, in seconds: the new time's leaves close over the whole screen, the scene
// changes under them while they hold, and they part again like at the start.
const SWAP = { close: 0.4, hold: 0.12, open: 0.6 };

const GROUND = 2;
const FOX_Z = 15;
// How far in front of the camera Pip first shows up.
const FOX_NEAR = 2.8;
// Seconds for each of the three steps of Pip's paws going up over its eyes, or down again.
const PAW_STEP = 0.07;
const T ={ part: 0.55, parted: 1.65, foxIn: 1.45, foxStop: 3.05, gather: 3.3, card: 3.95, jump: 4.45, land: 5.05, end: 6.2 };
// How long Pip waits on the ground, after jumping off the board for a change of language, once he has landed and
// the board is open again.
const BEAT = 0.05;

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (k: number) => 1 - Math.pow(1 - clamp(k), 3);
const easeSoft = (k: number) => 1 - Math.pow(1 - clamp(k), 2);
const easeInOut = (k: number) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const pick = <V>(list: V[]) => list[Math.floor(rnd() * list.length)];

const camAt = (t: number) => {
  const k = ease(t / 4.4);
  return { x: lerp(0.6, 0, k), y: lerp(1.5, 0.45, ease(t / 3.6)), z: lerp(-2.4, 4.4, k) };
};
const CAM_END = camAt(99);
// The widest picture, width to height, whose sides the near plants frame as they are; wider, they move out.
const PEEK = 3;

// ---------- the colours of the two times of day ----------

// Lists have the same length in both, so the random choices, and so the forest's shape, stay the same.
type Palette = {
  sky: string[]; stars: string[];
  far: string[]; farRim: string; farShade: string; mist: string; shaft: string;
  stone: [lit: string, body: string];
  thin: [body: string, rim: string, shade: string]; trunk: [body: string, rim: string, shade: string];
  backGround: string[]; backPlants: string[]; backVein: string; canopy: [light: string, dark: string]; vine: [stem: string, leaf: string, tip: string]; backGrass: [string, string];
  clearGround: string[]; clearPlants: string[]; clearVein: string; clearGrass: string[]; clearTips: string[];
  midGround: string[]; midPlant: [string, string]; midGrass: [string, string];
  nearGround: string[]; nearPlants: string[]; nearVein: string; nearGrass: [string, string];
  flower: [stem: string, petal: string, middle: string]; mushroom: [stem: string, cap: string, shine: string];
  leaves: string[]; leafVein: string; leafFill: string;
  flies: [string, string];
  // The sun in the morning, the moon at night: its disc, a lighter middle, a dithered ring, and spots.
  light: { body: string; core: string; halo: string; spots: string };
  // The form's board. The form's own colours in styles.css are picked to sit on it.
  board:{ line: string; frame: string; frameLight: string; frameShade: string; rivet: string; panel: string; panelShade: string; vine: [stem: string, leaf: string, light: string, tip: string] };
};

const NIGHT: Palette = {
  sky: ["#0b0a22", "#121233", "#191b47", "#20245c", "#2a3073"], stars: ["#8f9cff", "#3b4290"],
  far: ["#2c3478", "#323b85", "#28306e"], farRim: "#4552b0", farShade: "#232a62", mist: "#3a46a6", shaft: "#323c94",
  stone: ["#2f8f95", "#1a2050"],
  thin: ["#262d6c", "#4a5cc4", "#1d2358"], trunk: ["#101336", "#3f56c8", "#0a0c28"],
  backGround: ["#161b48", "#11163c"], backPlants: ["#1d2f6e", "#1a4560"], backVein: "#3d7fd0", canopy: ["#1f2d6a", "#0a0c26"], vine: ["#1e2c66", "#2b3d85", "#8cffd8"], backGrass: ["#1c3f7a", "#5ae8ff"],
  clearGround: ["#1c2457", "#161d4a", "#11163c"], clearPlants: ["#1f3a7c", "#1b4d68"], clearVein: "#4a8fe0", clearGrass: ["#2a8aa8", "#25a08c"], clearTips: ["#5ff2ff", "#7dffd6"],
  midGround: ["#151b46", "#11163c", "#0d1130", "#0a0d26"], midPlant: ["#15295e", "#2f5aa8"], midGrass: ["#0f1d4a", "#4fdcff"],
  nearGround: ["#0c1130", "#090d27", "#06081c"], nearPlants: ["#132a62", "#123649"], nearVein: "#2f6fc0", nearGrass: ["#070c22", "#3fb8e0"],
  flower: ["#20305e", "#c98dff", "#f3e1ff"], mushroom: ["#a9bdf0", "#6ff0ff", "#d6fbff"],
  leaves: ["#0c2b21", "#0a2331", "#103526"], leafVein: "#1f5a3d", leafFill: "#071a14",
  flies: ["#e4ff8a", "#9ff8ff"],
  light: { body: "#e9ecff", core: "#e9ecff", halo: "#2c3375", spots: "#c3c9f0" },
  board:{ line: "#0b0a22", frame: "#262c6e", frameLight: "#3f4fb8", frameShade: "#1a1f52", rivet: "#8f9cff", panel: "#14163a", panelShade: "#0f1130", vine: ["#1a4560", "#2f7fa0", "#4fc0d8", "#8cffd8"] },
};

const MORNING: Palette = {
  sky: ["#86c7e6", "#a3d5e6", "#c3e3e0", "#dfedcf", "#f6efc0"], stars: [],
  far: ["#9cc3ad", "#a7cbb4", "#91b9a4"], farRim: "#d4ebd3", farShade: "#85ac98", mist: "#c4e1ca", shaft: "#fff3bd",
  stone: ["#b3c7a0", "#76866f"],
  thin: ["#8d7a66", "#cdb898", "#75644f"], trunk: ["#5a4030", "#e3ab6a", "#3f2c20"],
  backGround: ["#7cad5a", "#6c9e4f"], backPlants: ["#559a44", "#468f56"], backVein: "#a4dc76", canopy: ["#78bb4c", "#376f31"], vine: ["#3f7a34", "#6aa845", "#ffe27a"], backGrass: ["#5e9e3f", "#c8ee7c"],
  clearGround: ["#93c75e", "#82ba53", "#72aa48"], clearPlants: ["#5ea84a", "#4e9d5c"], clearVein: "#b8ea8a", clearGrass: ["#7cc248", "#6db856"], clearTips: ["#e4fa9c", "#f8ffc4"],
  midGround: ["#6fa448", "#639841", "#578c3a", "#4c8034"], midPlant: ["#428c3c", "#8acb62"], midGrass: ["#529139", "#b4e272"],
  nearGround: ["#4d8436", "#43782f", "#396b29"], nearPlants: ["#3c7632", "#316c3e"], nearVein: "#7dbb54", nearGrass: ["#316527", "#a2d668"],
  flower: ["#3f7a34", "#ff8fb3", "#fff3a0"], mushroom: ["#f1e5cf", "#e2553f", "#ffffff"],
  leaves: ["#2f6e2c", "#3b7f33", "#285f27"], leafVein: "#7cba52", leafFill: "#22511f",
  flies: ["#fffbe0", "#ffe68f"],
  light: { body: "#ffe98a", core: "#fffbe0", halo: "#fff6cf", spots: "" },
  board:{ line: "#3a2414", frame: "#9a6438", frameLight: "#cf9356", frameShade: "#73472a", rivet: "#f6d79a", panel: "#fbf1d8", panelShade: "#efdfba", vine: ["#3f7a34", "#5aa548", "#8fd16a", "#ffe27a"] },
};

// ---------- pixel painting, once per screen size ----------

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

const rect = (g: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
};

// Every other pixel, for soft edges without any blending.
function dither(g: Ctx, x: number, y: number, w: number, h: number, color: string) {
  g.fillStyle = color;
  for (let j = 0; j < h; j++) for (let i = (j % 2); i < w; i += 2) g.fillRect(Math.round(x) + i, Math.round(y) + j, 1, 1);
}

// A leaf rasterised pixel by pixel: a flat body with a lighter middle vein.
function leaf(g: Ctx, x: number, y: number, len: number, wid: number, angle: number, body: string, vein?: string) {
  const reach = Math.ceil(len + wid);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let py = -reach; py <= reach; py++) {
    for (let px = -reach; px <= reach; px++) {
      const u = px * cos + py * sin;
      const v = -px * sin + py * cos;
      if (u < 0 || u > len) continue;
      const half = wid * 4 * (u / len) * (1 - u / len) * 0.5;
      if (Math.abs(v) > half) continue;
      g.fillStyle = vein && Math.abs(v) < 0.5 && u < len * 0.85 ? vein : body;
      g.fillRect(Math.round(x + px), Math.round(y + py), 1, 1);
    }
  }
}

function plant(g: Ctx, x: number, y: number, size: number, spread: number, body: string, vein: string, n = 6) {
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i / (n - 1) - 0.5) * spread + (rnd() - 0.5) * 0.3;
    const len = size * (0.6 + rnd() * 0.5);
    leaf(g, x, y, len, Math.max(2, len * 0.32), ang, body, vein);
  }
}

// A trunk row by row: tapering, leaning, flaring into roots, lit on its left edge.
function tree(g: Ctx, x: number, base: number, w: number, h: number, lean: number, [body, rim, shade]: string[]) {
  for (let y = 0; y < h; y++) {
    const fromBase = y / h;
    const flare = fromBase < 0.08 ? (0.08 - fromBase) * 10 : 0;
    const half = Math.max(0.6, w * (0.5 - fromBase * 0.15 + flare));
    const center = x + lean * y;
    const left = Math.round(center - half);
    const right = Math.round(center + half);
    const row = Math.round(base - y);
    rect(g, left, row, right - left + 1, 1, body);
    rect(g, left, row, 1, 1, rim);
    if (right - left > 3) rect(g, right, row, 1, 1, shade);
  }
}

function grass(g: Ctx, x: number, y: number, h: number, color: string, tip?: string) {
  const height = Math.max(1, Math.round(h * (0.5 + rnd() * 0.7)));
  rect(g, x, y - height + 1, 1, height, color);
  if (tip) rect(g, x, y - height + 1, 1, 1, tip);
}

function mushroom(g: Ctx, x: number, y: number, s: number, [stem, cap, shine]: string[]) {
  const k = Math.max(1, Math.round(s));
  rect(g, x - Math.floor(k / 2), y - 2 * k + 1, k, 2 * k, stem);
  rect(g, x - k * 1.5, y - 3 * k + 1, k * 4, k, cap);
  rect(g, x - k, y - 4 * k + 1, k * 3, k, cap);
  rect(g, x - k * 0.5, y - 3 * k + 1, Math.max(1, k), k, shine);
}

function flower(g: Ctx, x: number, y: number, s: number, [stem, petal, middle]: string[]) {
  const k = Math.max(1, Math.round(s));
  rect(g, x, y - 3 * k, 1, 3 * k, stem);
  rect(g, x - k, y - 4 * k, k * 3, k, petal);
  rect(g, x, y - 5 * k, k, k * 3, petal);
  rect(g, x, y - 4 * k, k, k, middle);
}

function stone(g: Ctx, x: number, y: number, w: number, h: number, [lit, body]: string[]) {
  for (let j = 0; j < h; j++) {
    const half = Math.round(w * Math.sqrt(1 - (j / h) ** 2));
    rect(g, x - half, y - j, half * 2 + 1, 1, j > h * 0.6 ? lit : body);
  }
}

// The ground of a strip: a stepped edge, then flat bands that get darker toward the camera.
function ground(g: Ctx, W: number, H: number, u: number, below: number, colors: string[]) {
  const line = Math.round(H - below * u);
  let y = line;
  for (let x = 0; x < W; x += 3) {
    if (rnd() < 0.3) y = clamp(y + (rnd() < 0.5 ? -1 : 1), line - 2, line + 2);
    rect(g, x, y, 3, H - y, colors[0]);
  }
  const band = (H - line) / colors.length;
  for (let i = 1; i < colors.length; i++) {
    const top = line + band * i + 2;
    dither(g, 0, top - 2, W, 2, colors[i]);
    rect(g, 0, top, W, H - top, colors[i]);
  }
  return line;
}

type Layer = { img: HTMLCanvasElement; y: number; w: number; h: number; z: number };

// One layer: a strip standing in the world at depth z, its bottom at height y. It is painted at the
// size it has when the camera stops, so the resting picture is pixel for pixel.
function layer(w: number, h: number, z: number, f: number, paint: (g: Ctx, W: number, H: number, u: number) => void, y = GROUND): Layer {
  const u = f / (z - CAM_END.z);
  const c = canvas(w * u, h * u);
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  paint(g, c.width, c.height, u);
  return { img: c, y, w, h, z };
}

function paintSky(W: number, H: number, p: Palette) {
  const c = canvas(W, H);
  const g = c.getContext("2d")!;
  const step = (H * 0.62) / p.sky.length;
  p.sky.forEach((color, i) => {
    rect(g, 0, i * step, W, H, color);
    if (i) dither(g, 0, i * step - 2, W, 2, color);
  });
  if (p.stars.length) for (let i = 0; i < 60; i++) rect(g, rnd() * W, rnd() * H * 0.4, 1, 1, rnd() > 0.7 ? p.stars[0] : p.stars[1]);
  return c;
}

// minWidth is the width, in low-resolution pixels, the forest must fill with the camera at rest: 0 on the login,
// the banner's width on the home page. A layer narrower than that is painted wider, with as many more trees,
// plants and leaves, so the forest runs to both edges and stays as thick. With 0, every layer is as it always was.
function paintForest(f: number, p: Palette, minWidth = 0): Layer[] {
  seed = 11;
  const layers: Layer[] = [];
  // How many times its usual width a layer at depth z must be.
  const widen = (w: number, z: number) => Math.max(1, (minWidth * 1.04) / (w * (f / (z - CAM_END.z))));
  const many = (n: number, k: number) => Math.round(n * k);
  // Things kept to the sides of a clear middle: fx is where a thing sits on a layer of the usual width, up to
  // `edge` from either end; a wider layer spreads them over its wider sides and keeps the middle as it was.
  const aside = (fx: number, edge: number, k: number) => {
    const reach = 0.5 - (0.5 - edge) / k;
    return fx < 0.5 ? (fx / edge) * reach : 1 - ((1 - fx) / edge) * reach;
  };
  // Things in the middle stay in the same middle however wide the layer.
  const centre = (fx: number, k: number) => 0.5 + (fx - 0.5) / k;

  // Far trees in pale mist.
  {
    const k = widen(170, 50);
    layers.push(layer(170 * k, 28, 50, f, (g, W, H, u) => {
      for (let i = 0; i < many(38, k); i++) tree(g, rnd() * W, H - 1, Math.max(1, (0.9 + rnd() * 1.3) * u), (14 + rnd() * 14) * u, (rnd() - 0.5) * 0.04, [pick(p.far), p.farRim, p.farShade]);
      dither(g, 0, H - 6 * u, W, 2, p.mist);
      rect(g, 0, H - 6 * u + 2, W, 6 * u, p.mist);
    }, GROUND + 0.6));
  }

  // Shafts of light: dithered stripes falling through the canopy, over the clearing.
  {
    const k = widen(90, 32);
    layers.push(layer(90 * k, 30, 32, f, (g, W, H, u) => {
      for (let i = 0; i < 3; i++) {
        const x = W * centre(0.3 + rnd() * 0.4, k);
        const width = Math.max(4, (1.2 + rnd()) * u);
        for (let y = 0; y < H; y++) {
          const drift = (y / H) * u * 6;
          for (let s = (y % 2); s < width; s += 2) rect(g, x + drift + s, y, 1, 1, p.shaft);
        }
      }
    }));
  }

  // Big trees framing the clearing, plants at their feet, the canopy above.
  {
    const k = widen(84, 25);
    layers.push(layer(84 * k, 28, 25, f, (g, W, H, u) => {
      const line = ground(g, W, H, u, 1.2, p.backGround);
      for (let i = 0; i < many(8, k); i++) stone(g, rnd() * W, line + 2, (2 + rnd() * 4) * u, (0.5 + rnd() * 0.8) * u, p.stone);
      for (let i = 0; i < many(10, k); i++) {
        const x = W * aside(rnd() < 0.5 ? 0.02 + rnd() * 0.36 : 0.62 + rnd() * 0.36, 0.38, k);
        tree(g, x, line + 1, (0.4 + rnd() * 0.5) * u, H * 0.95, (rnd() - 0.5) * 0.05, p.thin);
      }
      for (const s of [0.04, 0.17, 0.3, 0.7, 0.81, 0.95]) {
        tree(g, W * aside(s, 0.38, k) + (rnd() - 0.5) * u * 3, line + 1, (0.8 + rnd() * 1.2) * u, H * 0.95, (rnd() - 0.5) * 0.06, p.trunk);
      }
      // More of the big trunks on a wider layer, out in its wider sides.
      for (let i = 0; i < many(6, k) - 6; i++) {
        const x = W * aside(rnd() < 0.5 ? rnd() * 0.38 : 0.62 + rnd() * 0.38, 0.38, k);
        tree(g, x, line + 1, (0.8 + rnd() * 1.2) * u, H * 0.95, (rnd() - 0.5) * 0.06, p.trunk);
      }
      for (let i = 0; i < many(22, k); i++) plant(g, W * rnd(), line + 1, (1.2 + rnd() * 2) * u, 2.4, pick(p.backPlants), p.backVein);
      const canopyTop = H * 0.3;
      const canopyBottom = H * 0.56;
      // How far down the canopy's leaves reach at x: over the middle of the clearing only its top part.
      const leavesTo = (x: number) => canopyTop + (canopyBottom - canopyTop) * (Math.abs(x / W - 0.5) < 0.12 / k ? 0.35 : 1);
      // The leaves are drawn after the vines, over their tops, so each is kept to draw then.
      const leaves: (() => void)[] = [];
      for (let i = 0; i < many(420, k); i++) {
        const x = rnd() * W;
        const y = canopyTop + rnd() * (leavesTo(x) - canopyTop);
        const [len, wid, angle, color] = [(1.4 + rnd() * 2.4) * u, (0.6 + rnd() * 0.6) * u, rnd() * Math.PI * 2, rnd() > 0.82 ? p.canopy[0] : p.canopy[1]];
        leaves.push(() => leaf(g, x, y, len, wid, angle, color));
      }
      // Vines hang from half way into the leaves above them, so none starts in the open sky, down to below the
      // canopy.
      for (let i = 0; i < many(20, k); i++) {
        const x = Math.round(rnd() * W);
        const top = Math.round((canopyTop + leavesTo(x)) / 2);
        const end = Math.round(canopyBottom - u + (2 + rnd() * 6) * u);
        rect(g, x, top, 1, end - top, p.vine[0]);
        // Small leaves along it, on alternate sides.
        for (let d = 3; d < end - top - 2; d += 4) rect(g, x + ((d >> 2) % 2 ? 1 : -1), top + d, 1, 2, p.vine[1]);
        rect(g, x - 1, end, 3, 2, p.vine[2]);
      }
      for (const draw of leaves) draw();
      for (let i = 0; i < many(160, k); i++) grass(g, rnd() * W, line + rnd() * 3, u * 0.5, p.backGrass[0], p.backGrass[1]);
    }, GROUND + 1.2));
  }

  // The clearing floor, where Pip stops.
  {
    const k = widen(64, 16.5);
    layers.push(layer(64 * k, 8, 16.5, f, (g, W, H, u) => {
      const line = ground(g, W, H, u, 3, p.clearGround);
      for (let i = 0; i < many(16, k); i++) stone(g, rnd() * W, line + u * (0.2 + rnd() * 1.4), u * (0.3 + rnd() * 0.5), u * (0.2 + rnd() * 0.3), p.stone);
      for (let i = 0; i < many(12, k); i++) plant(g, W * aside(rnd() < 0.5 ? rnd() * 0.3 : 0.7 + rnd() * 0.3, 0.3, k), line + 2, (0.8 + rnd() * 1.1) * u, 2.4, pick(p.clearPlants), p.clearVein, 5);
      for (let i = 0; i < many(520, k); i++) grass(g, rnd() * W, line + u * rnd() * 2.6, u * (0.2 + rnd() * 0.35), pick(p.clearGrass), pick(p.clearTips));
      for (let i = 0; i < many(26, k); i++) flower(g, rnd() * W, line + u * rnd() * 1.8, u * 0.12, p.flower);
      for (let i = 0; i < many(12, k); i++) mushroom(g, rnd() * W, line + u * (0.2 + rnd() * 1.2), u * (0.1 + rnd() * 0.06), p.mushroom);
    }, GROUND + 3));
  }

  // The floor between the clearing and the camera.
  {
    const k = widen(40, 10.5);
    layers.push(layer(40 * k, 13, 10.5, f, (g, W, H, u) => {
      const line = ground(g, W, H, u, 8.5, p.midGround);
      for (let i = 0; i < many(10, k); i++) stone(g, rnd() * W, line + u * (0.3 + rnd() * 3.5), u * (0.4 + rnd() * 0.6), u * (0.25 + rnd() * 0.35), p.stone);
      for (let i = 0; i < many(12, k); i++) plant(g, rnd() * W, line + u * (0.2 + rnd() * 3), (0.9 + rnd() * 1.2) * u, 1.8, p.midPlant[0], p.midPlant[1], 5);
      for (let i = 0; i < many(520, k); i++) grass(g, rnd() * W, line + u * rnd() * 4.2, u * (0.3 + rnd() * 0.4), p.midGrass[0], rnd() > 0.75 ? p.midGrass[1] : undefined);
      for (let i = 0; i < many(10, k); i++) flower(g, rnd() * W, line + u * rnd() * 3, u * 0.12, p.flower);
      for (let i = 0; i < many(6, k); i++) mushroom(g, rnd() * W, line + u * (0.5 + rnd() * 3), u * (0.12 + rnd() * 0.05), p.mushroom);
    }, GROUND + 8.5));
  }

  // Near plants at the sides, and dark grass across the bottom. On a picture wider than PEEK to 1 the plants
  // move out with its two ends, so on a wide banner too they only peek in at the corners, not fill its sides.
  {
    const k = widen(28, 7);
    // f is 0.82 of the picture's height.
    const out = Math.max(0, (minWidth - (PEEK * f) / 0.82) / 2) / (f / (7 - CAM_END.z));
    layers.push(layer(28 * k + 2 * out, 14, 7, f, (g, W, H, u) => {
      const line = ground(g, W, H, u, 7, p.nearGround);
      const inner = W - 2 * out * u;
      const side = (from: number, to: number, shift: number) => {
        for (let i = 0; i < many(8, k); i++) plant(g, inner * aside(from + rnd() * (to - from), 0.28, k) + shift, line + u * rnd(), (2 + rnd() * 2.4) * u, 2.6, pick(p.nearPlants), p.nearVein, 7);
      };
      side(0, 0.28, 0);
      side(0.72, 1, 2 * out * u);
      for (let i = 0; i < many(380, (k * W) / inner); i++) grass(g, rnd() * W, line + u * rnd() * 3, u * (0.12 + rnd() * 0.18), p.nearGrass[0], rnd() > 0.85 ? p.nearGrass[1] : undefined);
    }, GROUND + 7));
  }

  return layers;
}

// The leaves that cover the screen at the start: two bunches, three deep, each painted at screen size.
// The nearer a sheet, the faster it moves aside.
type Sheet = { img: HTMLCanvasElement; side: number; speed: number };

function paintCurtain(W: number, H: number, p: Palette): Sheet[] {
  seed = 23;
  const sheets: Sheet[] = [];
  for (const [depth, speed] of [1, 1.25, 1.5].entries()) {
    for (const side of [-1, 1]) {
      const c = canvas(W, H);
      const g = c.getContext("2d")!;
      // Drawn as the left bunch, pointing right; the right bunch is mirrored.
      const draw = (x: number, y: number, len: number, angle: number, body: string, vein: string) =>
        leaf(g, side < 0 ? x : W - 1 - x, y, len, len * 0.36, side < 0 ? angle : Math.PI - angle, body, vein);
      if (depth === 0) {
        // A solid back up to the middle, so the two bunches meet and nothing shows through at first.
        rect(g, side < 0 ? 0 : W / 2, 0, W / 2, H, p.leafFill);
        for (let i = 0; i < 40; i++) draw(rnd() * W * 0.5, rnd() * H, (0.1 + rnd() * 0.15) * H, rnd() * Math.PI * 2, pick(p.leaves), p.leafVein);
        // Its straight edge hidden under a close row of leaves, each crossing the edge at its widest.
        const rows = 26;
        for (let i = 0; i < rows; i++) {
          const len = (0.14 + rnd() * 0.12) * H;
          const angle = (rnd() - 0.5) * 1.4;
          const y = ((i + rnd()) / rows) * H;
          draw(W / 2 - len * 0.45 * Math.cos(angle), y - len * 0.45 * Math.sin(angle), len, angle, pick(p.leaves), p.leafVein);
        }
      } else if (depth === 1) {
        for (let i = 0; i < 14; i++) draw(W * (0.05 + rnd() * 0.42), rnd() * H, (0.2 + rnd() * 0.15) * H, (rnd() - 0.5) * 2.2, pick(p.leaves), p.leafVein);
      } else {
        for (let i = 0; i < 6; i++) draw(W * (0.1 + rnd() * 0.35), H * (rnd() < 0.5 ? rnd() * 0.3 : 0.7 + rnd() * 0.3), (0.3 + rnd() * 0.2) * H, (rnd() - 0.5) * 1.4, p.leafFill, p.leaves[0]);
      }
      sheets.push({ img: c, side, speed });
    }
  }
  return sheets;
}

// ---------- the sky's light ----------

const MOON_SPOTS = [[-2, -2], [-3, -1], [1, 2], [2, 1], [2, -3], [-1, 3]];

// The sun or the moon high over the clearing, up and left of the shafts of light unless `at` moves it: a
// disc with a dithered ring round it.
function drawSkyLight(g: Ctx, W: number, H: number, p: Palette, at = 0.3) {
  const { body, core, halo, spots } = p.light;
  const cx = Math.round(W * at);
  const cy = Math.round(H * 0.13);
  for (let j = -10; j <= 10; j++) {
    for (let i = -10; i <= 10; i++) {
      const d = Math.hypot(i, j);
      if (d <= 6.4) rect(g, cx + i, cy + j, 1, 1, d <= 3.6 ? core : body);
      else if (d <= 9.6 && (i + j) % 2 === 0) rect(g, cx + i, cy + j, 1, 1, halo);
    }
  }
  if (spots) for (const [i, j] of MOON_SPOTS) rect(g, cx + i, cy + j, 1, 1, spots);
}

// ---------- the form's board ----------

// Mushrooms in blocks, bottom row last: c cap, s shine, t stem.
const MUSHROOMS = [
  ["..cc..", ".cccc.", "ccsccc", "cccccc", "..tt..", "..tt..", ".tttt."],
  [".ccc.", "ccscc", "ccccc", "..t..", "..t.."],
  [".cc.", "cscc", ".tt.", ".tt."],
];
// A steady pseudo-random number for i, so the board's grass is the same on every frame.
const steady = (i: number) => (((i + 1) * 2654435761) >>> 0) / 4294967296;

// Drawn behind the form in screen pixels, in blocks of b, from the form's own box, so it pops in and shakes
// with the form: a framed panel with stepped corners, a vine over one corner, mushrooms and grass along the
// bottom, and fireflies around it.
function drawBoard(g: Ctx, box: DOMRect, b: number, p: Palette, t: number) {
  const x0 = Math.round(box.left);
  const y0 = Math.round(box.top);
  const C = Math.round(box.width / b);
  const R = Math.max(30, Math.round(box.height / b));
  // Narrower than its frame, in the middle of a flip: nothing to draw.
  if (C < 10) return;
  const q = p.board;
  const at = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x0 + x * b, y0 + y * b, w * b, h * b);
  };
  // A rectangle inset i blocks, its corners stepped k blocks.
  const plate = (i: number, k: number, color: string) => {
    const w = C - 2 * i;
    const h = R - 2 * i;
    at(i, i + k, w, h - 2 * k, color);
    for (let j = 0; j < k; j++) {
      at(i + k - j, i + j, w - 2 * (k - j), 1, color);
      at(i + k - j, i + h - 1 - j, w - 2 * (k - j), 1, color);
    }
  };
  const stamp = (rows: string[], x: number, bottom: number) => rows.forEach((row, j) => [...row].forEach((ch, i) => {
    const color = { c: p.mushroom[1], s: p.mushroom[2], t: p.mushroom[0] }[ch];
    if (color) at(x + i, bottom - rows.length + 1 + j, 1, 1, color);
  }));

  // The frame: a dark outline, two blocks lit on the top and left with a little grain and a rivet in each
  // corner, then a dark groove where the panel is set in.
  plate(0, 2, q.line);
  plate(1, 1, q.frame);
  at(2, 1, C - 4, 1, q.frameLight);
  at(1, 2, 1, R - 4, q.frameLight);
  at(2, R - 2, C - 4, 1, q.frameShade);
  at(C - 2, 2, 1, R - 4, q.frameShade);
  for (let x = 7; x < C - 10; x += 13) {
    at(x, 2, 4, 1, q.frameShade);
    at(x + 6, R - 3, 4, 1, q.frameShade);
  }
  for (let y = 9; y < R - 10; y += 15) {
    at(2, y, 1, 3, q.frameShade);
    at(C - 3, y + 7, 1, 3, q.frameShade);
  }
  for (const [x, y] of [[2, 2], [C - 3, 2], [2, R - 3], [C - 3, R - 3]]) at(x, y, 1, 1, q.rivet);
  plate(3, 1, q.frameShade);
  // The panel, shaded under the groove's top and left edges.
  plate(4, 1, q.panel);
  at(5, 4, C - 10, 1, q.panelShade);
  at(4, 5, 1, R - 10, q.panelShade);

  // Too narrow for the rest, in a flip: just the bare board.
  if (C < 40) return;

  // A vine along the top right edge, sagging a little, then hanging down the right side to a blossom.
  const [stem, leaf, light, tip] = q.vine;
  // A leaf of three blocks, growing from the stem at (x, y) toward (dx, dy).
  const sprout = (x: number, y: number, dx: number, dy: number) => {
    at(x + dx, y, 1, 1, leaf);
    at(x + dx, y + dy, 1, 1, leaf);
    at(x + 2 * dx, y + dy, 1, 1, light);
  };
  const along = Math.min(26, C - 34);
  for (let i = 0; i <= along; i++) {
    const x = C - 2 - along + i;
    const y = Math.round(Math.sin((i / along) * Math.PI) * 2);
    at(x, y, 1, 1, stem);
    if (i % 5 === 1) sprout(x, y, 1, -1);
    if (i % 5 === 3) sprout(x, y, -1, 1);
  }
  const hang = Math.min(Math.round(R * 0.42), R - 14);
  for (let j = 1; j <= hang; j++) {
    const x = C - 2 + (Math.floor(j / 6) % 2);
    at(x, j, 1, 1, stem);
    if (j % 4 === 1) sprout(x, j, 1, 1);
    if (j % 4 === 3) sprout(x, j, -1, 1);
  }
  const end = C - 2 + (Math.floor(hang / 6) % 2);
  at(end - 1, hang + 1, 3, 3, tip);
  at(end, hang + 2, 1, 1, light);

  // Mushrooms standing at the bottom left corner, grass and a few flowers growing up over the bottom edge.
  MUSHROOMS.forEach((rows, i) => stamp(rows, [1, 7, 12][i], R));
  for (let x = 17; x < C - 2; x++) {
    const r = steady(x + C * 7);
    if (r > 0.45) continue;
    const h = r < 0.1 ? 4 : r < 0.2 ? 3 : r < 0.32 ? 2 : 1;
    at(x, R + 1 - h, 1, h, p.clearGrass[0]);
    at(x, R + 1 - h, 1, 1, p.clearTips[0]);
  }
  for (const k of [0.28, 0.6, 0.85]) {
    const x = Math.round(C * k);
    at(x, R - 2, 1, 3, p.flower[0]);
    at(x + 1, R - 1, 1, 1, leaf);
    at(x - 1, R - 3, 3, 1, p.flower[1]);
    at(x, R - 4, 1, 3, p.flower[1]);
    at(x, R - 3, 1, 1, p.flower[2]);
  }

  // Fireflies, or motes of light in the morning, drifting and blinking around the board.
  const spots = [[-4, 0.3], [-7, 0.68], [C + 3, 0.22], [C + 6, 0.55], [C + 2, 0.9], [-3, 1.04], [C * 0.45, 1.08], [C * 0.75, -0.04]];
  spots.forEach(([x, y], i) => {
    if (Math.sin(t * 1.7 + i * 2.3) < -0.1) return;
    at(Math.round(x + Math.sin(t * 0.6 + i) * 1.5), Math.round(y * R + Math.cos(t * 0.8 + i * 1.7) * 1.5), 1, 1, p.flies[i % 2]);
  });
}

// ---------- the fox, from the app's own sprite ----------

const spriteCache = new Map<string, HTMLCanvasElement>();
function sprite(view: "front" | "frontLeap" | "back" | "leap", mood: Mood, frame: "a" | "b", blink: boolean, paws = 0) {
  const key = `${view}/${mood}/${frame}/${blink}/${paws}`;
  let c = spriteCache.get(key);
  if (!c) {
    c = canvas(22, 21);
    const g = c.getContext("2d")!;
    for (const [x, y, color] of foxPixels(view, mood, frame, blink, paws) as Pixel[]) {
      g.fillStyle = color;
      g.fillRect(x, y + 1, 1, 1);
    }
    spriteCache.set(key, c);
  }
  return c;
}

// Draws Pip with its feet at (x, y), each of its pixels `size` wide, its corner on a grid of 1/`grid`; sx and sy
// squash or stretch it from its feet.
function drawFox(g: Ctx, x: number, y: number, size: number, img: HTMLCanvasElement, grid = 1, sx = 1, sy = 1) {
  const snap = (v: number) => Math.round(v * grid) / grid;
  g.drawImage(img, snap(x - 11 * size * sx), snap(y - 20 * size * sy), 22 * size * sx, 21 * size * sy);
}

// ---------- the forest at rest, for the home page ----------

// Painted forests by size and time of day, so moving between pages or themes does not paint them again.
const stills = new Map<string, { layers: Layer[]; sky: HTMLCanvasElement }>();

// A number from 0 to 1 that looks random but is the same for the same block every time, so the fade's scatter of
// blocks stays put when the banner is painted again.
// It mixes the two the way MurmurHash3 finishes, so neighbouring blocks share no stripes.
const scatter = (x: number, y: number) => {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y + 0x9e3779b9, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// The clearing as it is once the camera stops, drawn into a canvas of any size in the same pixels as the login:
// the home page's banner. sunAt places the sun or moon across the width, clear of what covers the banner. fade,
// if given, is a strip that much taller at the bottom (in CSS pixels), where the forest goes on and breaks off
// into the page's colour, in 8-pixel patches, two of the banner's pixel blocks. The break is a ragged line that
// bellies down in the middle like part of a circle and rises to the two ends; above it the forest is whole,
// below it is the page's colour, with a few patches of forest left over that thin out further down.
export function paintStill(c: HTMLCanvasElement, night: boolean, sunAt = 0.3, fade?: { height: number; color: string }) {
  const below = fade?.height ?? 0;
  const scale = Math.max(2, Math.round((c.clientHeight - below) / 225));
  const W = Math.max(1, Math.ceil(c.clientWidth / scale));
  const H = Math.max(1, Math.ceil((c.clientHeight - below) / scale));
  const total = Math.max(H, Math.ceil(c.clientHeight / scale));
  const p = night ? NIGHT : MORNING;
  const key = `${W}x${H}/${night}`;
  let still = stills.get(key);
  if (!still) {
    if (stills.size >= 4) stills.delete(stills.keys().next().value!);
    still = { layers: paintForest(H * 0.82, p, W), sky: paintSky(W, H, p) };
    stills.set(key, still);
  }
  c.width = W * scale;
  c.height = total * scale;
  const g = c.getContext("2d")!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(still.sky, 0, 0);
  drawSkyLight(g, W, H, p, sunAt);
  const f = H * 0.82;
  for (const L of [...still.layers].sort((a, b) => b.z - a.z)) {
    const s = f / (L.z - CAM_END.z);
    const w = Math.round(L.w * s);
    const h = Math.round(L.h * s);
    g.drawImage(L.img, Math.round(W / 2 - CAM_END.x * s - w / 2), Math.round(H * 0.46 + (L.y - CAM_END.y) * s - h), w, h);
  }
  if (fade && total > H) {
    const block = Math.max(1, Math.round(8 / scale));
    const rows = Math.ceil((total - H) / block);
    // The belly reaches a little over half way down the strip in the middle, and the line wobbles a block up or
    // down from it at random.
    const sag = Math.max(1, Math.floor(rows * 0.55));
    let wobble = 0;
    g.fillStyle = fade.color;
    for (let bx = 0; bx * block < W; bx++) {
      const across = ((bx + 0.5) * block - W / 2) / (W / 2);
      const arc = sag * Math.sqrt(Math.max(0, 1 - across * across));
      wobble = Math.min(1, Math.max(-1, wobble + Math.floor(scatter(bx, -1) * 3) - 1));
      const edge = Math.min(rows - 2, Math.max(0, Math.round(arc) + wobble));
      for (let by = edge; by < rows; by++) {
        // How much of the forest is left: a quarter of the patches just under the line, fewer further down, and
        // none in the last row, so the banner meets the page without a seam.
        const left = by === rows - 1 ? 0 : 0.25 * Math.pow(1 - (by - edge) / (rows - edge), 2);
        if (scatter(bx, by) >= left) g.fillRect(bx * block, H + by * block, block, block);
      }
    }
  }
}

// ---------- the scene ----------

type Fly = { x: number; y: number; z: number; ph: number; color: number };
type Spark = { a: number; r: number; speed: number; color: string };

// How many screen pixels the login's forest gives each of its pixels, by the window's height; Pip on the board is
// drawn at that size too, so what is placed by him (login.tsx's PipSays) takes it from here.
export const forestScale = () => Math.max(2, Math.round(innerHeight / 225));

export function startIntro(bg: HTMLCanvasElement, fx: HTMLCanvasElement, opts: IntroOptions) {
  seed = 41;
  const flies: Fly[] = Array.from({ length: 70 }, () => ({
    x: (rnd() - 0.5) * 30, y: GROUND - 0.3 - rnd() * 5, z: 6 + rnd() * 28, ph: rnd() * 10, color: rnd() > 0.45 ? 0 : 1,
  }));
  const sparks: Spark[] = Array.from({ length: 90 }, () => ({ a: rnd() * Math.PI * 2, r: 0.5 + rnd() * 0.7, speed: 0.6 + rnd() * 1.4, color: pick(["#ffffff", "#fff1a8", "#ffd27a", "#9ff8ff"]) }));
  const bgx = bg.getContext("2d")!;
  const fxx = fx.getContext("2d")!;
  let W = 0;
  let H = 0;
  let scale = 4;
  let destroyed = false;

  // The forest painted in each time of day, with its leaves, kept so switching back and forth does not paint
  // it again.
  type World = { pal: Palette; layers: Layer[]; sky: HTMLCanvasElement; leaves?: Sheet[] };
  const worlds = new Map<Palette, World>();
  const worldOf = (p: Palette) => {
    let w = worlds.get(p);
    if (!w) {
      w = { pal: p, layers: paintForest(H * 0.82, p), sky: paintSky(W, H, p) };
      worlds.set(p, w);
    }
    return w;
  };
  const leavesOf = (w: World) => (w.leaves ??= paintCurtain(W, H, w.pal));
  // Leaf sheets drawn apart by part: 0 closed over the whole screen, 1 off its sides, far enough that the
  // longest leaves are gone on a wide screen or a phone.
  const drawLeaves = (g: Ctx, sheets: Sheet[], part: number) => {
    const away = (W + H) / 2;
    for (const sheet of sheets) g.drawImage(sheet.img, Math.round(sheet.side * part * away * sheet.speed), 0);
  };
  // The time of day on screen, the one asked for, and a change between them under the leaves.
  let world!: World;
  let target = opts.night ? NIGHT : MORNING;
  let swap: { at: number | null; done: boolean } | null = null;
  // Where Pip starts: close to the camera, just past the left edge of the screen.
  let entryX = 0;

  // How many screen pixels wide each of Pip's pixels is, at a depth where a world unit is s low-resolution
  // pixels. It changes a screen pixel at a time, so Pip shrinks smoothly as it hops away instead of in big
  // steps, and in the clearing it is exactly the size of the forest's pixels.
  const foxPixel = (s: number) => clamp(Math.round((scale * s * (FOX_Z - CAM_END.z)) / (H * 0.82)), scale, scale * 6);

  const resize = () => {
    scale = forestScale();
    const w = Math.ceil(innerWidth / scale);
    const h = Math.ceil(innerHeight / scale);
    const changed = h !== H;
    W = w;
    H = h;
    // Both canvases are full size and draw in low-resolution units through a transform, so the forest is
    // still in blocks while Pip and the board can sit on the finer grid of screen pixels.
    for (const [c, g] of [[bg, bgx], [fx, fxx]] as const) {
      c.width = W * scale;
      c.height = H * scale;
      c.style.width = `${W * scale}px`;
      c.style.height = `${H * scale}px`;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.imageSmoothingEnabled = false;
    }
    // The form's fields and buttons use the same block size for their pixel edges.
    bg.parentElement?.style.setProperty("--px", `${scale}px`);
    if (changed) worlds.clear();
    for (const w of worlds.values()) {
      w.sky = paintSky(W, H, w.pal);
      w.leaves = undefined;
    }
    world = worldOf(world?.pal ?? target);
    const s = (H * 0.82) / FOX_NEAR;
    entryX = camAt(T.foxIn).x + ((-11 * foxPixel(s)) / scale - 2 - W / 2) / s;
  };
  resize();
  addEventListener("resize", resize);

  const start = performance.now();
  let clock = opts.play ? 0 : T.end;
  let offset = clock;
  let cardShown = false;
  let landed = false;
  // off is the change of language's: when the board is open again, what to do once Pip is back on it, and, from
  // the first frame, where he waits and his jumps down and back up.
  type Off = { opened: number; done: () => void; wait?: Point; down?: Jump; backAt?: number; up?: Jump; over?: boolean };
  let reaction: { kind: Reaction; at: number; off?: Off } | null = null;
  // The jump onto the board at the start, planned when it begins.
  let hopOn: Jump | null = null;
  // The paws over the eyes go up, or down, a step every PAW_STEP seconds from the step they were at when the
  // password field took or lost the focus.
  let covering = false;
  let coverFrom = 0;
  let coverAt = 0;
  const pawStep = (now: number) => {
    const steps = Math.floor((now - coverAt) / PAW_STEP) + 1;
    return covering ? Math.min(3, coverFrom + steps) : Math.max(0, coverFrom - steps);
  };
  let jumpFrom: { x: number; y: number } | null = null;
  let frame = 0;

  // Pip stops just left of where the form will appear, so the form does not hide it.
  let stopX: number | null = null;
  const placeStop = (card: Card) => {
    if (stopX !== null || !card) return;
    const s = (H * 0.82) / (FOX_Z - CAM_END.z);
    const target = card.width / scale > W * 0.7 ? W * 0.18 : card.left / scale - 16;
    stopX = CAM_END.x + (target - W / 2) / s;
  };
  // Where Pip stood in the clearing, with the camera at rest.
  const clearingSpot = () => {
    const s = (H * 0.82) / (FOX_Z - CAM_END.z);
    return { x: W / 2 + ((stopX ?? -4.6) - CAM_END.x) * s, y: H * 0.46 + (GROUND - CAM_END.y) * s };
  };
  function tick(now: number) {
    clock = (now - start) / 1000 + offset;
    const t = clock;
    placeStop(opts.card());
    const cam = camAt(t);
    const f = H * 0.82;
    const cx = W / 2;
    const cy = H * 0.46;
    const project = (x: number, y: number, z: number) => {
      const d = z - cam.z;
      if (d <= 0.15) return null;
      const s = f / d;
      return { x: cx + (x - cam.x) * s, y: cy + (y - cam.y) * s, s };
    };

    const box = opts.card();

    // The whole forest in one time of day, with the board behind the form once the form is on screen.
    const paintWorld = (g: Ctx, w: World) => {
      g.drawImage(w.sky, 0, 0);
      drawSkyLight(g, W, H, w.pal);

      type Item = { z: number; draw: () => void };
      const items: Item[] = [];
      for (const L of w.layers) {
        items.push({ z: L.z, draw: () => {
          const p = project(0, L.y, L.z);
          if (!p) return;
          const lw = Math.round(L.w * p.s);
          const lh = Math.round(L.h * p.s);
          g.drawImage(L.img, Math.round(p.x - lw / 2), Math.round(p.y - lh), lw, lh);
        } });
      }
      for (const fl of flies) {
        items.push({ z: fl.z, draw: () => {
          if (Math.sin(t * 1.7 + fl.ph * 3) < -0.2) return;
          const p = project(fl.x + Math.sin(t * 0.4 + fl.ph) * 0.5, fl.y + Math.sin(t * 0.7 + fl.ph * 2) * 0.25, fl.z);
          if (!p) return;
          const size = p.s > 30 ? 2 : 1;
          rect(g, p.x, p.y, size, size, w.pal.flies[fl.color]);
        } });
      }

      // Pip comes in from the left edge, seen from behind, hops away into the clearing, then turns round.
      if (t >= T.foxIn && t < T.jump) {
        const run = clamp((t - T.foxIn) / (T.foxStop - T.foxIn));
        const z = lerp(camAt(T.foxIn).z + FOX_NEAR, FOX_Z, easeSoft(run));
        items.push({ z, draw: () => {
          const hops = 4;
          const phase = (run * hops) % 1;
          const moving = run < 1;
          const lift = moving ? Math.sin(phase * Math.PI) * 0.55 : 0;
          const x = lerp(entryX, stopX ?? -4.6, easeSoft(run));
          const p = project(x, GROUND - lift, z);
          if (!p) return;
          const view = moving ? (phase > 0.12 && phase < 0.88 ? "leap" : "back") : "front";
          // Standing in the clearing it sits on the forest's own grid, where its jump onto the form starts.
          drawFox(g, p.x, p.y, foxPixel(p.s) / scale, sprite(view, "idle", "a", !moving && (t % 3.1) < 0.14), moving ? scale : 1);
          jumpFrom = { x: p.x, y: p.y };
        } });
      }
      items.sort((a, b) => b.z - a.z).forEach((i) => i.draw());

      // The leaves in front of everything, parting to the sides.
      if (t < T.parted) drawLeaves(g, leavesOf(w), easeInOut((t - T.part) / (T.parted - T.part)));

      if (box && opts.shown()) {
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        drawBoard(g, box, scale, w.pal, t);
        g.restore();
      }
    };

    // Changing between day and night: the leaves of the time asked for close over the screen, the scene
    // changes under them, and they part again. part is how far apart they are; they are drawn last, on top.
    let part: number | null = null;
    if (swap) {
      swap.at ??= t;
      const e = t - swap.at;
      // They rush in at once and slow as they meet, so the button answers on the next frame.
      if (e < SWAP.close) part = 1 - ease(e / SWAP.close);
      else if (e < SWAP.close + SWAP.hold) part = 0;
      else part = easeInOut((e - SWAP.close - SWAP.hold) / SWAP.open);
      if (e >= SWAP.close && !swap.done) {
        swap.done = true;
        if (world.pal !== target) {
          world = worldOf(target);
          opts.onSwap(target === NIGHT);
        }
      }
      if (e >= SWAP.close + SWAP.hold + SWAP.open) {
        part = null;
        // Asked for the other one again while this ran: go round once more.
        swap = world.pal === target ? null : { at: null, done: false };
      }
    }
    paintWorld(bgx, world);

    // The opening: from black in four steps.
    if (t < 0.6) {
      bgx.fillStyle = `rgba(4,4,14,${1 - Math.floor(t / 0.15) / 4})`;
      bgx.fillRect(0, 0, W, H);
    }

    // In front of the form: the sparks, and Pip once it jumps.
    fxx.clearRect(0, 0, W, H);
    const card = box && { left: box.left / scale, top: box.top / scale, width: box.width / scale, height: box.height / scale };
    if (!cardShown && t >= T.card) { cardShown = true; opts.onCardShow(); }
    if (card && t >= T.gather && t < T.card + 0.9) {
      const gx = card.left + card.width / 2;
      const gy = card.top + card.height / 2;
      const k = ease((t - T.gather) / (T.card - T.gather));
      const burst = clamp((t - T.card) / 0.9);
      const from = jumpFrom ?? { x: W * 0.3, y: H * 0.7 };
      for (const sp of sparks) {
        if (Math.sin(t * 9 + sp.a * 7) < -0.4) continue;
        const swirl = sp.a + t * sp.speed * 2;
        const radius = (1 - k) * Math.min(W, H) * 0.35 * sp.r + burst * Math.max(card.width, card.height) * 0.7 * sp.r;
        const x = lerp(from.x, gx, k) + Math.cos(swirl) * radius;
        const y = lerp(from.y - 10, gy, k) + Math.sin(swirl) * radius * 0.6;
        if (burst < 1) rect(fxx, x, y, 1, 1, sp.color);
      }
    }

    if (t >= T.jump && card) {
      // Near the board's left end, or over its middle while it is narrow in a flip.
      const perch: Point = [card.left + Math.min(16, card.width / 2), card.top + 1];
      hopOn ??= jump(jumpFrom ? [jumpFrom.x, jumpFrom.y] : [perch[0] - 40, H * 0.8], perch);
      const on = t - T.jump >= hopOn.length;
      let pose: Pose = on ? { x: perch[0], y: perch[1], sx: 1, sy: 1, air: false } : hopOn.at(t - T.jump);
      let mood: Mood = on ? "idle" : "happy";
      if (on && !landed) {
        landed = true;
        // Paint the other time of day and its leaves while nothing is happening, one at a time, so the first
        // switch starts at once.
        const other = world.pal === NIGHT ? MORNING : NIGHT;
        const idle = (fn: () => void) => {
          const run = () => { if (!destroyed) fn(); };
          if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 4000 });
          else setTimeout(run, 1500);
        };
        idle(() => { worldOf(other); idle(() => leavesOf(worldOf(other))); });
      }
      if (on) {
        const since = t - T.jump - hopOn.length;
        mood = since < 0.8 ? "happy" : Math.sin(t * 0.45) > 0.85 ? "wave" : "idle";
      }
      // Paws over the eyes while the password is typed, with no wave or sparkles under them; they drop at once
      // when the password is right.
      const paws = on && reaction?.kind !== "right" ? pawStep(t) : 0;
      if (paws) mood = "idle";
      if (reaction) {
        const since = t - reaction.at;
        if (reaction.kind === "right") {
          mood = "happy";
          pose.y -= Math.round(Math.abs(Math.sin(since * 9)) * 6 * Math.max(0, 1 - since / 1.2));
        } else if (reaction.off && !reaction.off.over) {
          // Off the board while it flips: down beside it in the clearing, or below it when the board fills the
          // screen's width; then, once he has landed and the board is open again, back up onto it. The spot and
          // the jump down are fixed on the first frame, while the board is still whole, the jump back up once it
          // is whole again.
          const off = reaction.off;
          if (!off.down) {
            const spot = clearingSpot();
            off.wait = spot.x + 12 < card.left ? [spot.x, spot.y] : [card.left + 18, Math.min(H - 2, card.top + card.height + 24)];
            off.down = jump(perch, off.wait);
            off.backAt = Math.max(off.down.length, off.opened) + BEAT;
          }
          if (since < off.backAt!) pose = off.down.at(since);
          else {
            off.up ??= jump(off.wait!, perch);
            pose = off.up.at(since - off.backAt!);
            if (since - off.backAt! >= off.up.length) {
              off.over = true;
              off.done();
            }
          }
          if (pose.air) mood = "happy";
        } else if (reaction.kind === "wrong" && since < 2.2) {
          mood = "worried";
          if (since < 0.5) pose.x += Math.round(Math.sin(since * 40));
        }
      }
      const frameName = Math.floor(t * 4) % 2 ? "b" : "a";
      // On the form's grid of screen pixels, so it stands squarely on the board; in the air in its leaping pose.
      const look = sprite(pose.air ? "frontLeap" : "front", mood, frameName, mood !== "happy" && (t % 3.7) < 0.13, paws);
      drawFox(fxx, pose.x, pose.y, 1, look, scale, pose.sx, pose.sy);
    }

    // The leaves of a change between day and night, over everything, the form too.
    if (part !== null) drawLeaves(fxx, leavesOf(worldOf(target)), part);

    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);

  return {
    skip() {
      if (clock >= T.land) return;
      offset += T.end - clock;
    },
    // A right or wrong answer ends a jump off the board at once, with Pip back on it.
    react(kind: "wrong" | "right") {
      if (reaction?.off && !reaction.off.over) reaction.off.done();
      reaction = { kind, at: clock };
    },
    // A change of language: Pip jumps off the board, and back on once it is open again, opened seconds from now;
    // done is called when he is on it. Before he has first landed on it, he just lands, and done waits for the board.
    hopOff(opened: number, done: () => void) {
      if (reaction?.off && !reaction.off.over) reaction.off.done();
      if (!landed) { setTimeout(done, opened * 1000); return; }
      reaction = { kind: "off", at: clock, off: { opened, done } };
    },
    // Whether Pip covers its eyes, for while the password field has the focus.
    cover(on: boolean) {
      if (on === covering) return;
      coverFrom = pawStep(clock);
      covering = on;
      coverAt = clock;
    },
    // Morning in the light theme, night in the dark one; the forest keeps its shape. The change happens under
    // closing leaves, except with reduced motion and under the opening leaves, where it is at once.
    setNight(night: boolean) {
      target = night ? NIGHT : MORNING;
      if (swap || target === world.pal) return;
      if (opts.calm || clock < T.parted) {
        world = worldOf(target);
        opts.onSwap(night);
        return;
      }
      // Painted now if not yet, so the leaves start closing on the next frame rather than after a pause.
      leavesOf(worldOf(target));
      swap = { at: null, done: false };
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      removeEventListener("resize", resize);
    },
  };
}
