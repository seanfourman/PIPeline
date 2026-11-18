// The chat's themes (Sean 2026-11-17, after buildwithclaude.com's: "can you add something like this to our chat?"):
// each a scene from Pip's world painted behind the conversation in pixel art, with the chat's colours to match it.
// Original scenes, drawn here in code: a morning meadow, a rainy day, a sunset, the forest at night with fireflies,
// snow, and a starry night with Pip on a hill. "plain" is the chat as it was, with no scene.
//
// A scene is painted on a canvas a few screen pixels to each of its own (px), flat colours, scaled up crisp. What
// stays still (sky, hills, trees) is painted once for each size; what moves (clouds, rain, snow, fireflies, stars) is
// worked out from the time alone, each speck from its number, so nothing is kept from frame to frame and a new size
// needs nothing more. It moves at a few frames a second, slowly, behind the words; with reduced motion it is a still.

import { foxPixels } from "./pip";

export type ThemeId = "plain" | "meadow" | "rain" | "sunset" | "forest" | "snow" | "stars" | "christmas";
type G = CanvasRenderingContext2D;
// still: painted once for each size. moving: the specks (snow, rain, stars), faint in the conversation's column.
// actors: what moves and is someone (Pip, the tree's lights, the sleigh), drawn over the rest as they are.
type Scene = {
  still: (g: G, w: number, h: number) => void;
  moving: (g: G, w: number, h: number, t: number) => void;
  actors?: (g: G, w: number, h: number, t: number) => void;
};

// dark: the chat's colours are a night's (styles.css .chat[data-chat-theme]).
export const CHAT_THEMES: { id: ThemeId; dark: boolean }[] = [
  { id: "plain", dark: false }, { id: "meadow", dark: false }, { id: "rain", dark: false }, { id: "sunset", dark: false },
  { id: "forest", dark: true }, { id: "snow", dark: true }, { id: "stars", dark: true }, { id: "christmas", dark: true },
];
export const isTheme = (v: unknown): v is ThemeId => CHAT_THEMES.some((x) => x.id === v);

// ---------- drawing ----------

// A number from 0 to 1 for each whole number, always the same one.
const hash = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const wrap = (v: number, m: number) => ((v % m) + m) % m;

// The sky from top to bottom in flat bands, each meeting the next across two rows of checkered pixels; below y1, to the
// foot of the picture, the last band goes on, so a dip in the hills never shows the page through.
function bands(g: G, w: number, y0: number, y1: number, colors: string[]) {
  g.fillStyle = colors[colors.length - 1];
  g.fillRect(0, Math.floor(y1), w, g.canvas.height);
  const step = (y1 - y0) / colors.length;
  colors.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, Math.floor(y0 + i * step), w, Math.ceil(step) + 1); });
  for (let i = 1; i < colors.length; i++) {
    const y = Math.floor(y0 + i * step);
    g.fillStyle = colors[i];
    for (let x = 0; x < w; x += 2) g.fillRect(x, y - 2, 1, 1);
    for (let x = 1; x < w; x += 2) g.fillRect(x, y - 1, 1, 1);
    g.fillStyle = colors[i - 1];
    for (let x = 1; x < w; x += 2) g.fillRect(x, y, 1, 1);
  }
}

// The land below a rolling line about `top`, from there to the bottom.
function hill(g: G, w: number, h: number, top: number, amp: number, freq: number, phase: number, color: string) {
  g.fillStyle = color;
  for (let x = 0; x < w; x++) {
    const y = Math.round(top - amp * (0.65 * Math.sin(x * freq + phase) + 0.35 * Math.sin(x * freq * 2.7 + phase * 1.9)));
    g.fillRect(x, y, 1, h - y);
  }
}
const hillTop = (x: number, top: number, amp: number, freq: number, phase: number) =>
  Math.round(top - amp * (0.65 * Math.sin(x * freq + phase) + 0.35 * Math.sin(x * freq * 2.7 + phase * 1.9)));

// A pine of three tiers on its base, snow on each tier's top when it has some.
function pine(g: G, x: number, base: number, size: number, color: string, snow?: string) {
  const tier = Math.max(3, Math.round(size / 3));
  g.fillStyle = color;
  g.fillRect(x, base - 2, 1, 2);
  for (let k = 0; k < 3; k++) {
    const top = base - 2 - size + k * Math.round(tier * 0.8);
    for (let r = 0; r < tier; r++) {
      const half = Math.floor((r + k) * 0.6);
      g.fillStyle = color;
      g.fillRect(x - half, top + r, half * 2 + 1, 1);
      // Snow on the top's tip and on each tier's two lowest points, as it lies on branches.
      if (snow && ((k === 0 && r <= 1) || (r === tier - 1 && half > 0))) {
        g.fillStyle = snow;
        if (k === 0 && r <= 1) g.fillRect(x - half, top + r, half * 2 + 1, 1);
        else { g.fillRect(x - half, top + r, 1, 1); g.fillRect(x + half, top + r, 1, 1); }
      }
    }
  }
}

// A round tree: a crown of stacked rows on a short trunk.
function roundTree(g: G, x: number, base: number, size: number, color: string, trunk: string) {
  g.fillStyle = trunk;
  g.fillRect(x, base - Math.round(size * 0.35), 1, Math.round(size * 0.35));
  g.fillStyle = color;
  const r = Math.round(size * 0.45);
  const cy = base - Math.round(size * 0.35) - r + 1;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy) * 1.1);
    g.fillRect(x - half, cy + dy, half * 2 + 1, 1);
  }
}

// A cloud of three rows, a shade along its foot; s is its size in pixels per step.
function cloud(g: G, x: number, y: number, s: number, body: string, shade: string) {
  const rows: [number, number][] = [[3, 5], [1, 9], [0, 11]];
  rows.forEach(([from, width], i) => { g.fillStyle = body; g.fillRect(Math.round(x + from * s), y + i * s, width * s, s); });
  g.fillStyle = shade;
  g.fillRect(Math.round(x + s), y + 3 * s - 1, 9 * s, 1);
}

// A disc, row by row.
function disc(g: G, cx: number, cy: number, r: number, color: string) {
  g.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

// A speck with a faint glow around it.
function glow(g: G, x: number, y: number, core: string, halo: string, alpha: number) {
  g.globalAlpha = alpha * 0.35;
  g.fillStyle = halo;
  g.fillRect(x - 1, y - 1, 3, 3);
  g.globalAlpha = alpha;
  g.fillStyle = core;
  g.fillRect(x, y, 1, 1);
  g.globalAlpha = 1;
}

// So many specks for a picture this big, one for each `per` pixels of it.
const count = (w: number, h: number, per: number, most = 400) => Math.min(most, Math.max(6, Math.round((w * h) / per)));

// ---------- Christmas: Pip as Santa ----------

// Santa's hat for Pip, in his sprite's own units (pip.tsx, two to each of its blocks): the brim across the top of his
// head, the ears' tips out at its sides, the cone leaning over to the right in Santa red with its shade, and the
// pompom at its tip.
const SANTA_HAT: [number, number, string][] = (() => {
  const hat: [number, number, string][] = [];
  const span = (y: number, x0: number, x1: number, c: string) => { for (let x = x0; x <= x1; x++) hat.push([x, y, c]); };
  const cone: [number[], number, number][] = [[[-1, 0], 6, 15], [[-3, -2], 8, 15], [[-5, -4], 10, 17], [[-7, -6], 14, 19]];
  for (const [rows, x0, x1] of cone) for (const y of rows) { span(y, x0, x1 - 2, "#E8443A"); span(y, x1 - 1, x1, "#B8322A"); }
  for (const y of [-9, -8, -7, -6]) span(y, 20, 23, y === -6 ? "#DDE3EE" : "#FFFFFF");
  span(1, 4, 17, "#FFFFFF");
  span(2, 4, 17, "#DDE3EE");
  return hat;
})();

// Pip standing with his feet on `ground` from `x`, in Santa's hat; now and then he blinks, and now and then he waves.
function santaPip(g: G, x: number, ground: number, t: number) {
  const cycle = wrap(t, 9);
  const waving = cycle > 6 && cycle < 8;
  const sprite = waving ? foxPixels("front", "wave", Math.floor(t * 4) % 2 ? "a" : "b") : foxPixels("front", "idle", "a", wrap(t, 4.2) < 0.15);
  const top = ground - 19;
  for (const [px, py, c] of [...sprite, ...SANTA_HAT]) { g.fillStyle = c; g.fillRect(x + px, top + py, 1, 1); }
}

// Where the tree stands, for the still picture and for its lights alike: near the start edge, in the margin the
// conversation's card leaves at the side, with Pip in front of it, so neither is behind the card or the box.
const xmasTree = (w: number, h: number) => ({ x: Math.max(16, Math.round(w * 0.06)), base: Math.round(h * 0.96), size: Math.round(h * 0.3) });

// A sleigh going across the sky, pulled by two reindeer, all in shadow, facing the way it goes (to the start side).
const REINDEER = ["#.#..", ".##..", ".####", ".#..#"];
const SLEIGH = ["#......#", "########", ".#....#."];
function sleigh(g: G, x: number, y: number) {
  g.fillStyle = "#1a1433";
  const sprite = (rows: string[], ox: number, oy: number) => rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "#") g.fillRect(ox + c, oy + r, 1, 1); }));
  sprite(REINDEER, x, y);
  sprite(REINDEER, x + 6, y);
  g.fillRect(x + 4, y + 2, 9, 1);
  sprite(SLEIGH, x + 12, y);
  g.fillStyle = "#E8443A";
  g.fillRect(x + 15, y - 1, 2, 1);
}

const CHRISTMAS: Scene = {
  // A Christmas night: a deep blue sky with a big moon, snowy hills with little houses lit inside, the tree hung with
  // lights and a star on top, presents under it, and Pip beside it in Santa's hat.
  still(g, w, h) {
    bands(g, w, 0, h * 0.88, ["#0d1330", "#111838", "#151e41", "#1a2449", "#1f2a51"]);
    disc(g, Math.round(w * 0.93), Math.round(h * 0.17), Math.max(5, Math.round(h * 0.06)), "#f6f1d6");
    disc(g, Math.round(w * 0.93) - 2, Math.round(h * 0.17) - 1, Math.max(2, Math.round(h * 0.02)), "#e7e0c0");
    for (let i = 0; i < count(w, h, 1100, 100); i++) {
      g.fillStyle = hash(i + 120) < 0.15 ? "#fff3c4" : "#8d97c8";
      g.fillRect(Math.floor(hash(i + 121) * w), Math.floor(hash(i + 122) * h * 0.55), 1, 1);
    }
    hill(g, w, h, h * 0.89, h * 0.02, 0.014, 1.4, "#c3cfe3");
    // Little houses on the far hill, a light in each window.
    for (let i = 0; i < Math.max(3, Math.round(w / 90)); i++) {
      const x = Math.round(w * (0.3 + 0.65 * hash(i + 130)));
      const base = hillTop(x + 3, h * 0.89, h * 0.02, 0.014, 1.4) + 1;
      g.fillStyle = "#3b3550"; g.fillRect(x, base - 4, 7, 4);
      for (let r = 0; r < 3; r++) { g.fillStyle = "#f2f5fb"; g.fillRect(x - 1 + r, base - 5 - r, 9 - r * 2, 1); }
      g.fillStyle = "#ffd56b"; g.fillRect(x + 2, base - 3, 1, 1); g.fillRect(x + 4, base - 3, 1, 1);
    }
    hill(g, w, h, h * 0.95, h * 0.012, 0.026, 3.8, "#e6edf7");
    const tree = xmasTree(w, h);
    pine(g, tree.x, tree.base, tree.size, "#1e5a3c", "#eef4fb");
    // Presents under it: boxes in red, green and gold, a ribbon across each.
    const boxes: [number, number, number, string, string][] = [[-16, 6, 5, "#E8443A", "#ffd56b"], [12, 7, 4, "#3fae6a", "#f2f5fb"], [19, 5, 6, "#ffcf4d", "#E8443A"]];
    for (const [dx, bw, bh, body, ribbon] of boxes) {
      const bx = tree.x + dx;
      g.fillStyle = body; g.fillRect(bx, tree.base - bh, bw, bh);
      g.fillStyle = ribbon; g.fillRect(bx + Math.floor(bw / 2), tree.base - bh, 1, bh); g.fillRect(bx, tree.base - bh + 1, bw, 1);
      g.fillRect(bx + Math.floor(bw / 2) - 1, tree.base - bh - 1, 3, 1);
    }
  },
  // Snow, gently.
  moving(g, w, h, t) {
    for (let i = 0; i < count(w, h, 600); i++) {
      const near = hash(i + 7) < 0.15;
      const y = wrap(hash(i + 2) * h + t * ((near ? 12 : 5) + hash(i + 1) * 6), h + 4) - 2;
      const x = Math.round(wrap(hash(i) * w + Math.sin(t * 0.8 + i) * (near ? 3 : 1.5), w));
      g.globalAlpha = near ? 0.9 : 0.6;
      g.fillStyle = "#f4f8ff";
      g.fillRect(x, Math.round(y), near ? 2 : 1, near ? 2 : 1);
    }
    g.globalAlpha = 1;
  },
  actors(g, w, h, t) {
    const tree = xmasTree(w, h);
    // The lights along the tree's tiers, each blinking in its own time, in four colours.
    const tier = Math.max(3, Math.round(tree.size / 3));
    const lights = ["#ff5d5d", "#ffd56b", "#6ab8ff", "#7cf09a"];
    let n = 0;
    for (let k = 0; k < 3; k++) {
      const top = tree.base - 2 - tree.size + k * Math.round(tier * 0.8);
      for (let r = 1; r < tier; r += 2) {
        const half = Math.floor((r + k) * 0.6);
        for (let dx = -half + ((r + k) % 2); dx <= half; dx += 3) {
          const on = Math.sin(t * (1.4 + hash(n) * 1.8) + n * 1.7) > -0.2;
          if (on) { g.fillStyle = lights[n % 4]; g.fillRect(tree.x + dx, top + r, 1, 1); }
          n++;
        }
      }
    }
    // The star on top, twinkling.
    const starY = tree.base - 2 - tree.size - 2;
    g.globalAlpha = 0.75 + 0.25 * Math.sin(t * 3);
    g.fillStyle = "#ffe37a";
    g.fillRect(tree.x - 1, starY, 3, 1); g.fillRect(tree.x, starY - 1, 1, 3);
    g.globalAlpha = 1;
    santaPip(g, tree.x - 12, tree.base + 1, t);
    // Now and then the sleigh crosses the sky, sparkles behind it.
    const k = wrap(t / 22, 1);
    if (k < 0.4) {
      const x = Math.round(w + 10 - (k / 0.4) * (w + 50));
      const y = Math.round(h * 0.16 + Math.sin(k * 20) * 3);
      for (let s = 1; s < 10; s++) {
        g.globalAlpha = (1 - s / 10) * (0.5 + 0.5 * Math.sin(t * 9 + s));
        g.fillStyle = "#ffe37a";
        g.fillRect(x + 20 + s * 2, y + 2 + (s % 2), 1, 1);
      }
      g.globalAlpha = 1;
      sleigh(g, x, y);
    }
  },
};

// ---------- the scenes ----------

const SCENES: Record<Exclude<ThemeId, "plain">, Scene> = {
  // A morning meadow: a pale sky, hills in two greens with flowers, clouds drifting, two butterflies.
  meadow: {
    still(g, w, h) {
      bands(g, w, 0, h * 0.86, ["#bfe6fb", "#cdebfb", "#dbf1fc", "#e8f6fd", "#f3fafe"]);
      hill(g, w, h, h * 0.87, h * 0.035, 0.018, 1.2, "#a8dba0");
      hill(g, w, h, h * 0.93, h * 0.025, 0.027, 4.1, "#7cc56c");
      for (let i = 0; i < count(w, h, 260, 260); i++) {
        const x = Math.floor(hash(i * 3.1) * w);
        const y = hillTop(x, h * 0.93, h * 0.025, 0.027, 4.1) + 2 + Math.floor(hash(i * 7.7) * h * 0.06);
        g.fillStyle = hash(i) < 0.45 ? "#5fae55" : hash(i) < 0.75 ? "#ffcf4d" : hash(i) < 0.9 ? "#ff9fc4" : "#ffffff";
        g.fillRect(x, y, 1, 1);
      }
    },
    moving(g, w, h, t) {
      for (let i = 0; i < 4; i++) {
        const s = hash(i + 9) < 0.5 ? 1 : 2;
        const x = wrap(hash(i) * w - t * (1.2 + hash(i + 3) * 1.6), w + 30) - 24;
        cloud(g, x, Math.round(h * (0.06 + hash(i + 5) * 0.32)), s, "#ffffff", "#e3f1fa");
      }
      for (let i = 0; i < 2; i++) {
        const x = Math.round(w * (0.2 + 0.6 * hash(i + 21)) + Math.sin(t * 0.35 + i * 2) * w * 0.12);
        const y = Math.round(h * (0.78 + 0.05 * Math.sin(t * 0.6 + i)) + Math.sin(t * 2.4 + i) * 2);
        const open = Math.floor(t * 6 + i) % 2 === 0;
        g.fillStyle = i ? "#ff8fbf" : "#ffb347";
        g.fillRect(x - 1, y - (open ? 1 : 0), 1, 1);
        g.fillRect(x + 1, y - (open ? 1 : 0), 1, 1);
        g.fillStyle = "#5a4a3a";
        g.fillRect(x, y, 1, 1);
      }
    },
  },

  // A rainy day: a grey-blue sky, low hills, rain slanting down, rings on the puddles.
  rain: {
    still(g, w, h) {
      bands(g, w, 0, h * 0.88, ["#c7d3de", "#cfdae4", "#d7e0e9", "#dfe7ee", "#e7edf3"]);
      hill(g, w, h, h * 0.89, h * 0.03, 0.02, 2.3, "#b3c3d1");
      hill(g, w, h, h * 0.94, h * 0.015, 0.031, 0.4, "#9fb2c3");
      g.fillStyle = "#8ea3b6";
      g.fillRect(0, Math.round(h * 0.97), w, h);
    },
    moving(g, w, h, t) {
      g.fillStyle = "#6f87a0";
      g.globalAlpha = 0.55;
      for (let i = 0; i < count(w, h, 420); i++) {
        const speed = h * (0.9 + hash(i + 1) * 0.5);
        const y = wrap(hash(i + 2) * h + t * speed, h + 6) - 4;
        const x = Math.round(wrap(hash(i) * w - y * 0.28, w));
        g.fillRect(x, Math.round(y), 1, 3);
      }
      g.globalAlpha = 1;
      const band = Math.round(h * 0.97);
      for (let i = 0; i < Math.max(4, Math.round(w / 35)); i++) {
        const k = wrap(t / 1.4 + hash(i + 40), 1);
        const x = Math.round(hash(i + 41 + Math.floor(t / 1.4 + hash(i + 40))) * w);
        const r = Math.round(1 + k * 5);
        g.globalAlpha = 1 - k;
        g.fillStyle = "#e7edf3";
        g.fillRect(x - r, band + 2, 2, 1);
        g.fillRect(x + r - 1, band + 2, 2, 1);
        g.globalAlpha = 1;
      }
    },
  },

  // A sunset: warm bands down to the hills, the sun half set behind them, thin clouds drifting, birds going by.
  sunset: {
    still(g, w, h) {
      bands(g, w, 0, h * 0.9, ["#ffd8a8", "#ffc59a", "#ffb08f", "#f99a93", "#ec8a9f", "#d27ca8"]);
      const sx = Math.round(w * 0.86);
      const sy = Math.round(h * 0.89);
      disc(g, sx, sy, Math.round(h * 0.11), "#ffe08a");
      disc(g, sx, sy, Math.round(h * 0.085), "#fff1b8");
      hill(g, w, h, h * 0.9, h * 0.03, 0.016, 2.8, "#8a5a86");
      hill(g, w, h, h * 0.95, h * 0.02, 0.025, 0.9, "#5d3f66");
    },
    moving(g, w, h, t) {
      g.fillStyle = "#ffe6c4";
      g.globalAlpha = 0.8;
      for (let i = 0; i < 5; i++) {
        const len = Math.round(w * (0.08 + hash(i + 2) * 0.12));
        const x = Math.round(wrap(hash(i) * w + t * (0.8 + hash(i + 3)), w + len) - len);
        g.fillRect(x, Math.round(h * (0.12 + hash(i + 4) * 0.45)), len, 1);
      }
      g.globalAlpha = 1;
      const cycle = Math.floor(t / 14);
      const k = wrap(t / 14, 1);
      if (k < 0.6) {
        g.fillStyle = "#4a2f55";
        for (let b = 0; b < 3; b++) {
          const x = Math.round(w * (1.05 - (k / 0.6) * 1.15) + b * 6);
          const y = Math.round(h * (0.25 + hash(cycle) * 0.2) + b * 3 * (b % 2 ? 1 : -0.5));
          const up = Math.floor(t * 5 + b) % 2 === 0;
          g.fillRect(x - 1, y - (up ? 1 : 0), 1, 1);
          g.fillRect(x, y, 1, 1);
          g.fillRect(x + 1, y - (up ? 1 : 0), 1, 1);
        }
      }
    },
  },

  // The forest at night: a deep sky, a small moon, trees in two rows of shadow, fireflies wandering and blinking.
  forest: {
    still(g, w, h) {
      bands(g, w, 0, h, ["#0c1838", "#0f2042", "#13284a", "#173052", "#1b3858"]);
      disc(g, Math.round(w * 0.82), Math.round(h * 0.16), Math.max(3, Math.round(h * 0.04)), "#efe9c8");
      disc(g, Math.round(w * 0.82) + 2, Math.round(h * 0.16) - 1, Math.max(3, Math.round(h * 0.04)) - 1, "#0e1c3c");
      for (let i = 0; i < count(w, h, 900, 120); i++) {
        g.fillStyle = hash(i + 90) < 0.2 ? "#e9e4c6" : "#7f8fb8";
        g.fillRect(Math.floor(hash(i + 91) * w), Math.floor(hash(i + 92) * h * 0.5), 1, 1);
      }
      hill(g, w, h, h * 0.74, h * 0.05, 0.011, 0.8, "#16324e");
      const trees = Math.round(w / 14);
      for (let i = 0; i < trees; i++) {
        const x = Math.round((i / trees) * w + hash(i) * 10);
        const base = Math.round(h * (0.86 + hash(i + 2) * 0.03));
        const size = Math.round(h * (0.16 + hash(i + 1) * 0.12));
        if (hash(i + 3) < 0.55) pine(g, x, base, size, "#1b4260"); else roundTree(g, x, base, size, "#1d4866", "#142f45");
      }
      hill(g, w, h, h * 0.88, h * 0.015, 0.03, 1.7, "#0c2230");
      for (let i = 0; i < Math.round(w / 9); i++) {
        const x = Math.round((i / (w / 9)) * w + hash(i + 50) * 6);
        const base = h + 2;
        const size = Math.round(h * (0.1 + hash(i + 51) * 0.08));
        if (hash(i + 52) < 0.5) pine(g, x, base, size, "#0a1a24"); else roundTree(g, x, base, size, "#0b1d28", "#07141c");
      }
    },
    moving(g, w, h, t) {
      for (let i = 0; i < count(w, h, 1500, 90); i++) {
        const x = Math.round(w * hash(i) + Math.sin(t * (0.2 + hash(i + 1) * 0.3) + i) * w * 0.06);
        const y = Math.round(h * (0.45 + hash(i + 2) * 0.48) + Math.cos(t * (0.25 + hash(i + 3) * 0.3) + i * 1.3) * h * 0.04);
        const blink = Math.max(0, Math.sin(t * (0.8 + hash(i + 4) * 0.9) + i * 2.1));
        if (blink > 0.05) glow(g, x, y, "#e6ff8a", "#b8f25a", blink * blink);
      }
    },
  },

  // Snow: a night-blue sky, snowy hills with pines on them, snow falling and swaying, nearer flakes bigger.
  snow: {
    still(g, w, h) {
      bands(g, w, 0, h * 0.88, ["#131f3d", "#172645", "#1b2c4d", "#203355", "#253a5d"]);
      hill(g, w, h, h * 0.89, h * 0.025, 0.017, 0.6, "#b9c9de");
      for (let i = 0; i < Math.round(w / 22); i++) {
        const x = Math.round(hash(i + 70) * w);
        pine(g, x, hillTop(x, h * 0.89, h * 0.025, 0.017, 0.6) + 2, Math.round(h * (0.08 + hash(i + 71) * 0.07)), "#16323a", "#e8f0fa");
      }
      hill(g, w, h, h * 0.95, h * 0.015, 0.028, 3.3, "#dfe9f5");
    },
    moving(g, w, h, t) {
      for (let i = 0; i < count(w, h, 380); i++) {
        const near = hash(i + 7) < 0.18;
        const speed = (near ? 14 : 6) + hash(i + 1) * 8;
        const y = wrap(hash(i + 2) * h + t * speed, h + 4) - 2;
        const x = Math.round(wrap(hash(i) * w + Math.sin(t * 0.9 + i) * (near ? 3 : 1.5), w));
        g.fillStyle = "#f4f8ff";
        g.globalAlpha = near ? 0.9 : 0.65;
        g.fillRect(x, Math.round(y), near ? 2 : 1, near ? 2 : 1);
      }
      g.globalAlpha = 1;
    },
  },

  // A starry night: a deep sky, a dark hill with Pip sitting on it, seen from behind, looking up; stars twinkling and
  // now and then one falling.
  stars: {
    still(g, w, h) {
      bands(g, w, 0, h, ["#060918", "#080c1f", "#0b1026", "#0e142e", "#121a37"]);
      const top = h * 0.84;
      hill(g, w, h, top, h * 0.06, 0.012, 2.2, "#0a0f26");
      // Pip on the hill, a little in from the start side, in his own colours.
      const fox = foxPixels("back");
      const xs = fox.map(([x]) => x);
      const ys = fox.map(([, y]) => y);
      const fw = Math.max(...xs) - Math.min(...xs) + 1;
      const fh = Math.max(...ys) - Math.min(...ys) + 1;
      const fx = Math.round(w * 0.16);
      const fy = hillTop(fx + Math.round(fw / 2), top, h * 0.06, 0.012, 2.2) - fh + 2;
      for (const [x, y, c] of fox) { g.fillStyle = c; g.fillRect(fx + x - Math.min(...xs), fy + y - Math.min(...ys), 1, 1); }
    },
    moving(g, w, h, t) {
      for (let i = 0; i < count(w, h, 300, 500); i++) {
        const x = Math.floor(hash(i) * w);
        const y = Math.floor(hash(i + 1) * h * 0.78);
        const tw = 0.45 + 0.55 * Math.max(0, Math.sin(t * (0.6 + hash(i + 2) * 1.6) + i));
        g.globalAlpha = tw * (hash(i + 3) < 0.15 ? 1 : 0.7);
        g.fillStyle = hash(i + 4) < 0.1 ? "#ffe9a8" : hash(i + 4) < 0.2 ? "#bcd4ff" : "#ffffff";
        g.fillRect(x, y, 1, 1);
      }
      g.globalAlpha = 1;
      const cycle = Math.floor(t / 9);
      const k = wrap(t / 9, 1);
      if (k < 0.1) {
        const p = k / 0.1;
        const x0 = w * (0.35 + hash(cycle) * 0.55);
        const y0 = h * (0.05 + hash(cycle + 1) * 0.25);
        for (let s = 0; s < 12; s++) {
          const q = p - s * 0.02;
          if (q < 0) break;
          g.globalAlpha = (1 - s / 12) * (1 - p * 0.6);
          g.fillStyle = "#ffffff";
          g.fillRect(Math.round(x0 - q * w * 0.25), Math.round(y0 + q * h * 0.12), 1, 1);
        }
        g.globalAlpha = 1;
      }
    },
  },

  christmas: CHRISTMAS,
};

// ---------- running one ----------

// Frames a second: enough for drifting specks, few enough to cost nothing behind the words.
const FPS = 15;
// How much of the moving specks shows in the conversation's column, and over how many screen pixels on each side of
// it they come up to full: the scene keeps quiet where the words are, and is itself at the sides.
const QUIET = 0.3;
const QUIET_FADE = 56;

// A scene on this canvas, in pixels of px screen pixels each, sized to the canvas's own box as that changes, until the
// returned function stops it. quiet: the width in screen pixels of the column in the middle where the words go, in
// which what moves is faint (QUIET); none on a card's small scene.
export function runScene(canvas: HTMLCanvasElement, id: ThemeId, px: number, quiet = 0) {
  if (id === "plain") return () => {};
  const scene = SCENES[id];
  const g = canvas.getContext("2d")!;
  const still = document.createElement("canvas");
  const sg = still.getContext("2d")!;
  // What moves is drawn apart first, to be faded in the column (destination-in, by a gradient across), then laid over.
  const moving = document.createElement("canvas");
  const mg = moving.getContext("2d")!;
  let mask: CanvasGradient | null = null;
  const column = () => {
    const half = quiet / 2 / px;
    const fade = QUIET_FADE / px;
    const at = (x: number) => Math.min(1, Math.max(0, x / w));
    const grad = mg.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#000");
    grad.addColorStop(at(w / 2 - half - fade), "#000");
    grad.addColorStop(at(w / 2 - half), `rgba(0, 0, 0, ${QUIET})`);
    grad.addColorStop(at(w / 2 + half), `rgba(0, 0, 0, ${QUIET})`);
    grad.addColorStop(at(w / 2 + half + fade), "#000");
    grad.addColorStop(1, "#000");
    return grad;
  };
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, frame = 0, last = 0;
  const start = performance.now() - hash(id.length) * 60_000;

  const draw = (now: number) => {
    if (!w || !h) return;
    g.drawImage(still, 0, 0);
    const t = calm ? 30 : (now - start) / 1000;
    if (!mask) scene.moving(g, w, h, t);
    else {
      mg.clearRect(0, 0, w, h);
      scene.moving(mg, w, h, t);
      mg.globalCompositeOperation = "destination-in";
      mg.fillStyle = mask;
      mg.fillRect(0, 0, w, h);
      mg.globalCompositeOperation = "source-over";
      g.drawImage(moving, 0, 0);
    }
    scene.actors?.(g, w, h, t);
  };
  const size = () => {
    const box = canvas.getBoundingClientRect();
    const nw = Math.max(1, Math.ceil(box.width / px));
    const nh = Math.max(1, Math.ceil(box.height / px));
    if (nw === w && nh === h) return;
    w = canvas.width = still.width = moving.width = nw;
    h = canvas.height = still.height = moving.height = nh;
    mask = quiet ? column() : null;
    g.imageSmoothingEnabled = false;
    sg.clearRect(0, 0, w, h);
    scene.still(sg, w, h);
    draw(performance.now());
  };
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    if (now - last < 1000 / FPS) return;
    last = now;
    draw(now);
  };
  const watch = new ResizeObserver(size);
  watch.observe(canvas);
  size();
  if (!calm) frame = requestAnimationFrame(loop);
  return () => { cancelAnimationFrame(frame); watch.disconnect(); };
}
