// Pip, the companion: an original fox, drawn abstract in big blocks, with a few moods.
import React from "react";

export type Mood = "idle" | "wave" | "work" | "ask" | "happy" | "worried";
type Px = [number, number, string];

const C: Record<string, string> = {
  O: "#F2892E", D: "#CF6620", W: "#FFF2DF", K: "#2A2236", P: "#FF9C8A", A: "#FF5D5D", Y: "#FFF1A8", U: "#7CC8FF", G: "#8A84A0",
};

// Pip is drawn on a coarse grid, 11 blocks by 10, each block two pixels square, so the sprite stays 22 pixels
// wide with its feet on the same line as before. A block's rows start a pixel above the top, where the ears are.
const block = (x: number, y: number, color: string): Px[] => [[2 * x, 2 * y - 1, color], [2 * x + 1, 2 * y - 1, color], [2 * x, 2 * y, color], [2 * x + 1, 2 * y, color]];
// Rows of letters from the palette above, one per block; a dot is empty.
const blocks = (rows: string[]): Px[] => rows.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === "." ? [] : block(x, y, C[ch]))));
// Single blocks, as [x, y, letter].
const at = (list: [number, number, string][]): Px[] => list.flatMap(([x, y, key]) => block(x, y, C[key]));

// A small nose on top of the cream muzzle: one block, two pixels square.
const nose: Px[] = [[10, 11, C.K], [11, 11, C.K], [10, 12, C.K], [11, 12, C.K]];

// From the front: two ears with dark tips, a cream chest with the nose, the tail out to the right with a cream
// tip, two feet. The eyes are left out here, so they can blink.
const FRONT = [...blocks([
  ".D.......D.",
  ".OD.....DO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  ".OOOWWWOOO.",
  "..OWWWWWOWW",
  "..OWWWWWOOO",
  "..DD...DD..",
]), ...nose];
const eyesOpen = at([[3, 4, "K"], [3, 5, "K"], [7, 4, "K"], [7, 5, "K"]]);
const eyesShut = at([[3, 5, "K"], [7, 5, "K"]]);
const eyesHappy = at([[2, 5, "K"], [3, 4, "K"], [4, 5, "K"], [6, 5, "K"], [7, 4, "K"], [8, 5, "K"]]);
const blush = at([[2, 6, "P"], [8, 6, "P"]]);
// A small open mouth under the nose, with a gap between them, for when Pip is worried.
const mouth: Px[] = [[10, 14, C.K], [11, 14, C.K]];
const sweat = at([[10, 2, "U"], [10, 3, "U"]]);
// A paw raised beside the head, high and then lower, to wave. The browser draws the waving paw on a layer of
// its own, and where its edge meets the body's a thin line of background can show through; so the paw reaches
// one pixel into the body, where the overlap is the same orange, and the two edges never meet.
const into = (rows: number[], x: number): Px[] => rows.map((y) => [x, y, C.O]);
const pawHigh = [...at([[1, 7, "O"], [0, 6, "O"], [0, 5, "O"]]), ...into([9, 10, 11, 12], 2), ...into([13, 14], 4)];
const pawLow = [...at([[1, 7, "O"], [0, 7, "O"], [0, 6, "O"]]), ...into([11, 12], 2), ...into([13, 14], 4)];
// An exclamation mark between the ears, in single pixels, since a block is too big for its gap.
const alert: Px[] = [[10, -2, C.A], [11, -2, C.A], [10, -1, C.A], [11, -1, C.A], [10, 0, C.A], [11, 0, C.A], [10, 2, C.A], [11, 2, C.A]];
// Two twinkles that swap corners.
const sparkA = at([[0, 1, "Y"], [10, 4, "Y"]]);
const sparkB = at([[10, 1, "Y"], [0, 4, "Y"]]);
const dots = (n: number) => at(([[3, 1, "G"], [5, 1, "G"], [7, 1, "G"]] as [number, number, string][]).slice(0, n));

// Joins neighbouring pixels of one colour into a single rectangle, so a sprite stays a few dozen nodes.
function Pixels({ px: list, className, transform }: { px: Px[]; className?: string; transform?: string }) {
  const cells = new Map<string, string>();
  for (const [x, y, color] of list) cells.set(`${x},${y}`, color);
  const rows = new Map<number, number[]>();
  for (const key of cells.keys()) {
    const [x, y] = key.split(",").map(Number);
    rows.set(y, [...(rows.get(y) ?? []), x]);
  }
  const rects: React.ReactElement[] = [];
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let start = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const color = cells.get(`${xs[i - 1]},${y}`);
      if (i < xs.length && xs[i] === xs[i - 1] + 1 && cells.get(`${xs[i]},${y}`) === color) continue;
      rects.push(<rect key={`${start},${y}`} x={start} y={y} width={xs[i - 1] - start + 1} height={1} fill={color} />);
      start = xs[i];
    }
  }
  return <g className={className} transform={transform}>{rects}</g>;
}

const MOODS: Record<Mood, { still: Px[]; a?: Px[]; b?: Px[]; eyes: "blink" | "happy" }> = {
  idle: { still: [], eyes: "blink" },
  wave: { still: [], a: pawHigh, b: pawLow, eyes: "blink" },
  work: { still: [], a: dots(2), b: dots(3), eyes: "blink" },
  ask: { still: [], a: alert, b: [], eyes: "blink" },
  happy: { still: blush, a: sparkA, b: sparkB, eyes: "happy" },
  worried: { still: [...mouth, ...sweat], eyes: "blink" },
};

// From behind, for hopping away from the camera: the tail out to the left, as it is on the right from the front.
const BACK = blocks([
  ".D.......D.",
  ".OD.....DO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  "WWOOOOOOO..",
  "OOOOOOOOO..",
  "..DD...DD..",
]);
// In the air: the tail swung up, the body narrower, the feet tucked in under it.
const BACK_LEAP = blocks([
  ".D.......D.",
  ".OD.....DO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  "WWOOOOOOOO.",
  "OOOOOOOOO..",
  "..OOOOOOO..",
  "...D...D...",
]);

export type Pixel = Px;

// The fox as a list of pixels, for drawing on a canvas: the same sprite the app shows.
export function foxPixels(view: "front" | "back" | "leap", mood: Mood = "idle", frame: "a" | "b" = "a", blink = false): Px[] {
  if (view === "back") return BACK;
  if (view === "leap") return BACK_LEAP;
  const m = MOODS[mood];
  const eyes = m.eyes === "happy" ? eyesHappy : blink ? eyesShut : eyesOpen;
  return [...FRONT, ...m.still, ...eyes, ...((frame === "a" ? m.a : m.b) ?? [])];
}

// The logo: a fox head in one colour, the text colour around it. Pointed ears, wide cheeks, a pointed chin, and
// the eyes cut out.
const MARK = [
  "X.........X",
  "XX.......XX",
  "XXX.....XXX",
  "XXXXXXXXXXX",
  "XXX.XXX.XXX",
  "XXXXXXXXXXX",
  ".XXXXXXXXX.",
  "...XXXXX...",
  "....XXX....",
  ".....X.....",
];
const MARK_PATH = MARK.map((row, y) => [...row.matchAll(/X+/g)].map((m) => `M${m.index} ${y}h${m[0].length}v1h-${m[0].length}z`).join("")).join("");

export function PipMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`pip-mark ${className}`} viewBox="0 0 11 10" shapeRendering="crispEdges" aria-hidden="true">
      <path d={MARK_PATH} fill="currentColor" />
    </svg>
  );
}

export function Pip({ mood = "idle", className = "", label }: { mood?: Mood; className?: string; label?: string }) {
  const m = MOODS[mood];
  return (
    <svg className={`pip pip-${mood} ${className}`} viewBox="0 -2 22 21" shapeRendering="crispEdges" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect className="pip-shadow" x={4} y={18.5} width={14} height={0.5} fill="#000" opacity={0.2} />
      <g className="pip-bob">
        <Pixels px={FRONT} />
        <Pixels px={m.still} />
        {m.eyes === "happy" ? <Pixels px={eyesHappy} /> : <>
          <Pixels px={eyesOpen} className="pip-open" />
          <Pixels px={eyesShut} className="pip-shut" />
        </>}
        {m.a && <Pixels px={m.a} className="pip-a" />}
        {m.b && <Pixels px={m.b} className="pip-b" />}
      </g>
    </svg>
  );
}
