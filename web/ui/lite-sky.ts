import { useEffect, type RefObject } from "react";

// The sky behind the search (Sky in views/jobs.tsx), for a browser drawing without the graphics card (html.lite,
// public/boot.js). There, seven big moving gradients laid over each other took a whole core, so the same clouds are
// drawn instead on one small canvas, a few times a second, and stretched to their size: the same six clouds and
// glow, the same courses, timings and colours as .sky-blob and .sky-core in styles.css (keep the two in step).
// Soft as they are, neither the low resolution nor the few frames show.

export const lite = () => document.documentElement.classList.contains("lite");

// The canvas on the page: as far round the sky's middle as the clouds reach (less below than above, so it never
// makes a page taller than its words), and how much of it is drawn.
export const SKY_W = 1000;
export const SKY_H = 850;
export const SKY_TOP = 440;
const DETAIL = 0.25;
const FPS = 15;

// Each cloud: its colour, its place, its course's length in seconds, how far into it it starts, and whether it runs
// backwards; two shift a little in hue on a course of their own.
type Cloud = { tint: number; dx: number; dy: number; dur: number; delay: number; reverse?: boolean; shimmer?: [number, number] };
const CLOUDS: Cloud[] = [
  { tint: 1, dx: -240, dy: -40, dur: 23, delay: 0 },
  { tint: 2, dx: -100, dy: 120, dur: 27, delay: -5 },
  { tint: 3, dx: 230, dy: -70, dur: 25, delay: -11 },
  { tint: 4, dx: 30, dy: -140, dur: 31, delay: 0, reverse: true, shimmer: [14, 0] },
  { tint: 5, dx: 220, dy: 110, dur: 29, delay: -17 },
  { tint: 6, dx: -30, dy: 40, dur: 35, delay: 0, reverse: true, shimmer: [17, -6] },
];

// @keyframes drift: at each quarter, the move from the cloud's place, the turn, and the stretch.
const DRIFT = [
  { at: 0, x: (dx: number) => dx, y: (dy: number) => dy, r: 0, sx: 1, sy: 1 },
  { at: 0.25, x: (dx: number) => dx * 0.4, y: (dy: number) => dy - 80, r: 28, sx: 1.3, sy: 0.85 },
  { at: 0.5, x: (dx: number) => dx * -0.3, y: (dy: number) => dy + 30, r: -12, sx: 0.9, sy: 1.2 },
  { at: 0.75, x: (dx: number) => dx * 0.8, y: (dy: number) => dy + 70, r: 18, sx: 1.15, sy: 0.95 },
  { at: 1, x: (dx: number) => dx, y: (dy: number) => dy, r: 0, sx: 1, sy: 1 },
];

// CSS's ease-in-out, cubic-bezier(0.42, 0, 0.58, 1).
function easeInOut(t: number) {
  const bez = (u: number, a: number, b: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  let lo = 0, hi = 1, u = t;
  for (let i = 0; i < 20; i++) {
    u = (lo + hi) / 2;
    if (bez(u, 0.42, 0.58) < t) lo = u; else hi = u;
  }
  return bez(u, 0, 1);
}

// Where in its course a cloud is, t seconds after the sky came.
const progress = (t: number, dur: number, delay: number, reverse = false) => {
  const p = (((t - delay) / dur) % 1 + 1) % 1;
  return reverse ? 1 - p : p;
};

// CSS's hue-rotate, on one colour.
function hueRotate([r, g, b]: number[], deg: number) {
  const a = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return [
    (0.213 + 0.787 * a - 0.213 * s) * r + (0.715 - 0.715 * a - 0.715 * s) * g + (0.072 - 0.072 * a + 0.928 * s) * b,
    (0.213 - 0.213 * a + 0.143 * s) * r + (0.715 + 0.285 * a + 0.14 * s) * g + (0.072 - 0.072 * a - 0.283 * s) * b,
    (0.213 - 0.213 * a - 0.787 * s) * r + (0.715 - 0.715 * a + 0.715 * s) * g + (0.072 + 0.928 * a + 0.072 * s) * b,
  ].map((v) => Math.max(0, Math.min(255, Math.round(v))));
}

// A colour token as numbers: the canvas reads any CSS colour and gives it back as #rrggbb.
function rgb(g: CanvasRenderingContext2D, token: string) {
  g.fillStyle = "#000";
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#000";
  const hex = String(g.fillStyle);
  return hex.startsWith("#") ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : (hex.match(/\d+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
}

// An oval of colour fading out to its edge, as radial-gradient(closest-side, colour, transparent end).
function oval(g: CanvasRenderingContext2D, [r, gr, b]: number[], alpha: number, end: number, x: number, y: number, rot: number, rx: number, ry: number) {
  const k = DETAIL;
  g.setTransform(k, 0, 0, k, (SKY_W / 2) * k, SKY_TOP * k);
  g.translate(x, y);
  g.rotate((rot * Math.PI) / 180);
  g.scale(rx, ry);
  const fill = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  fill.addColorStop(0, `rgb(${r} ${gr} ${b} / ${alpha})`);
  fill.addColorStop(end, `rgb(${r} ${gr} ${b} / 0)`);
  g.fillStyle = fill;
  g.fillRect(-1, -1, 2, 2);
}

function draw(g: CanvasRenderingContext2D, t: number, tints: number[][], core: number[]) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  for (const c of CLOUDS) {
    const p = progress(t, c.dur, c.delay, c.reverse);
    const i = Math.min(3, Math.floor(p * 4));
    const a = DRIFT[i], b = DRIFT[i + 1];
    const e = easeInOut((p - a.at) / (b.at - a.at));
    const mix = (from: number, to: number) => from + (to - from) * e;
    let tint = tints[c.tint - 1];
    if (c.shimmer) {
      const s = progress(t, c.shimmer[0], c.shimmer[1]);
      tint = hueRotate(tint, -28 * easeInOut(s < 0.5 ? s * 2 : 2 - s * 2));
    }
    oval(g, tint, 0.34, 1, mix(a.x(c.dx), b.x(c.dx)), mix(a.y(c.dy), b.y(c.dy)), mix(a.r, b.r), 230 * mix(a.sx, b.sx), 170 * mix(a.sy, b.sy));
  }
  // The glow in the middle, breathing: @keyframes breathe.
  const s = progress(t, 8, 0);
  const e = easeInOut(s < 0.5 ? s * 2 : 2 - s * 2);
  g.globalAlpha = 0.6 + 0.4 * e;
  oval(g, core, 0.26, 0.7, 0, 0, 0, 450 * (0.9 + 0.18 * e), 280 * (0.94 + 0.1 * e));
  g.globalAlpha = 1;
}

// Draws the sky on the canvas while it is on the page, FPS times a second, and only while the tab is in sight and
// no window covers the page.
export function useLiteSky(canvas: RefObject<HTMLCanvasElement | null>, on: boolean) {
  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!on || !el || !g) return;
    el.width = Math.round(SKY_W * DETAIL);
    el.height = Math.round(SKY_H * DETAIL);
    const tints = [1, 2, 3, 4, 5, 6].map((n) => rgb(g, `--sky-${n}`));
    const core = tints[0].map((v, i) => Math.round((v + tints[1][i]) / 2));
    const start = performance.now();
    let last = -Infinity, frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 1000 / FPS - 4 || document.querySelector("dialog[open]")) return;
      last = now;
      draw(g, (now - start) / 1000, tints, core);
    };
    draw(g, 0, tints, core);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on]);
}
