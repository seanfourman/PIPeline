// Pip, the companion: an original pixel fox, shown from the front with a few moods.
import React from "react";

export type Mood = "idle" | "wave" | "work" | "ask" | "happy" | "worried";
type Px = [number, number, string];

const C: Record<string, string> = {
  O: "#F2892E", D: "#CF6620", W: "#FFF2DF", K: "#2A2236", S: "#FFFFFF", B: "#5A372B",
  P: "#FF9C8A", A: "#FF5D5D", Y: "#FFF1A8", U: "#7CC8FF", G: "#8A84A0", R: "#FFA04D",
};

// Rows of letters from the palette above; a dot is empty.
const grid = (rows: string[]): Px[] =>
  rows.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === "." ? [] : [[x, y, C[ch]] as Px])));
const px = (list: [number, number, string][]): Px[] => list.map(([x, y, key]) => [x, y, C[key]]);

// Front view, 22 by 19. The eyes are left out here, so they can blink.
const FRONT = grid([
  "...B..............B...",
  "...BO............OB...",
  "...OWO..........OWO...",
  "..OOWWO........OWWOO..",
  "..OOWWOOOOOOOOOOWWOO..",
  ".OOOWOOOOOOOOOOOOWOOO.",
  ".OOOOOOOOOOOOOOOOOOOO.",
  ".OOOOOOOOOOOOOOOOOOOO.",
  "OOOOOOOOOOOOOOOOOOOOOO",
  "OWWOOOOOOWKKWOOOOOOWWO",
  ".WWWWOOOWWWWWWOOOWWWW.",
  "..WWWWWWWWWWWWWWWWWW..",
  "....WWWWWWWWWWWWWW....",
  "......OOWWWWWWOO......",
  ".....OOOWWWWWWOOO.....",
  ".....OOOWWWWWWOOO.....",
  ".....OOOOWWWWOOOO.....",
  ".....DOOOOOOOOOOD.....",
  ".....BBB......BBB.....",
]);
const TAIL = px([
  [17, 17, "D"], [18, 17, "D"], [19, 17, "D"], [17, 16, "O"], [18, 16, "O"], [19, 16, "O"], [20, 16, "O"],
  [18, 15, "O"], [19, 15, "O"], [20, 15, "O"], [21, 15, "O"], [19, 14, "O"], [20, 14, "O"], [21, 14, "O"],
  [19, 13, "O"], [20, 13, "W"], [21, 13, "W"], [20, 12, "W"], [21, 12, "W"],
]);
const eyesOpen = px([[6, 7, "K"], [7, 7, "S"], [14, 7, "K"], [15, 7, "S"], [6, 8, "K"], [7, 8, "K"], [14, 8, "K"], [15, 8, "K"]]);
const eyesShut = px([[6, 8, "K"], [7, 8, "K"], [14, 8, "K"], [15, 8, "K"]]);
const eyesHappy = px([[5, 8, "K"], [6, 7, "K"], [7, 7, "K"], [8, 8, "K"], [13, 8, "K"], [14, 7, "K"], [15, 7, "K"], [16, 8, "K"]]);
const blush = px([[2, 10, "P"], [3, 10, "P"], [18, 10, "P"], [19, 10, "P"]]);
const smile = px([[9, 11, "K"], [12, 11, "K"], [10, 12, "K"], [11, 12, "K"]]);
const grin = px([[9, 11, "K"], [10, 11, "P"], [11, 11, "P"], [12, 11, "K"], [10, 12, "K"], [11, 12, "K"]]);
const frown = px([[9, 12, "K"], [10, 11, "K"], [11, 11, "K"], [12, 12, "K"]]);
const brows = px([[5, 6, "D"], [6, 6, "D"], [7, 5, "D"], [16, 6, "D"], [15, 6, "D"], [14, 5, "D"]]);
const sweat = px([[21, 4, "U"], [21, 5, "U"]]);
const arm = px([[4, 15, "O"], [4, 14, "O"], [3, 14, "O"], [3, 13, "O"]]);
const pawOut = [...arm, ...px([[2, 13, "O"], [2, 12, "B"], [1, 12, "B"]])];
const pawIn = [...arm, ...px([[3, 12, "B"], [2, 12, "B"]])];
const pawHigh = [...arm, ...px([[2, 13, "O"], [2, 12, "O"], [1, 12, "O"], [1, 11, "B"], [0, 11, "B"]])];
const alert = px([[10, 0, "A"], [11, 0, "A"], [10, 1, "A"], [11, 1, "A"], [10, 3, "A"], [11, 3, "A"]]);
const sparkA = px([[1, 1, "Y"], [0, 2, "Y"], [1, 2, "S"], [2, 2, "Y"], [1, 3, "Y"]]);
const sparkB = px([[20, 0, "Y"], [19, 1, "Y"], [20, 1, "S"], [21, 1, "Y"], [20, 2, "Y"]]);
const dots = (n: number) => px([[8, 2, "G"], [10, 2, "G"], [12, 2, "G"]].slice(0, n) as [number, number, string][]);

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
  idle: { still: [...smile, ...blush], eyes: "blink" },
  wave: { still: [...smile, ...blush], a: pawOut, b: pawIn, eyes: "blink" },
  work: { still: [...smile, ...blush], a: dots(2), b: dots(3), eyes: "blink" },
  ask: { still: [...smile, ...blush, ...pawHigh], a: alert, b: [], eyes: "blink" },
  happy: { still: [...grin, ...blush], a: [...pawOut, ...sparkA], b: [...pawIn, ...sparkB], eyes: "happy" },
  worried: { still: [...frown, ...brows, ...sweat], eyes: "blink" },
};

// Back view, for hopping away from the camera: the back of the head, and the tail curled up on the right.
const BACK_HEAD = [
  "...B..............B...",
  "...BO............OB...",
  "...OOD..........DOO...",
  "..OOOOD........DOOOO..",
  "..OOOOOOOOOOOOOOOOOO..",
  ".OOOOOOOOOOOOOOOOOOOO.",
  ".OOOOOOOOOOOOOOOOOOOO.",
  ".OOOOOOOOOOOOOOOOOOOO.",
  "WOOOOOOOOOOOOOOOOOOOOW",
  "WWOOOOOOOOOOOOOOOOOOWW",
  ".WDDOOOOOOOOOOOOOODDW.",
  "...DDOOOOOOOOOOOODD...",
];
const BACK = grid([...BACK_HEAD,
  "....DOOOOOOOOOOOOD.WW.",
  "...OOOOOOOOOOOOOODWWWW",
  "...OOOOOOOOOOOOODRRRRO",
  "...OOOOOOOOOOOODRRRRRO",
  "...OOOOOOOOOOODRRRRROD",
  "...DOOOOOOOODRRRRRROD.",
  "....DDOOOODRRRRRRODD..",
  "....BBB...DDDDDDD.....",
]);
// In the air: the body narrower, the paws tucked under it, no gaps.
const BACK_LEAP = grid([...BACK_HEAD,
  "....DOOOOOOOOOOOOD..WW",
  "....OOOOOOOOOOOOOD.WWW",
  "....OOOOOOOOOOOODRRWWW",
  "....OOOOOOOOOOODRRRRRO",
  "....OOOOOOOOOODRRRRROD",
  "....DOOOOOOODRRRRRROD.",
  "....DDOOOODDRRRRRDD...",
  ".....BPB...DDDDD......",
]);

export type Pixel = Px;

// The fox as a list of pixels, for drawing on a canvas: the same sprite the app shows.
export function foxPixels(view: "front" | "back" | "leap", mood: Mood = "idle", frame: "a" | "b" = "a", blink = false): Px[] {
  if (view === "back") return BACK;
  if (view === "leap") return BACK_LEAP;
  const m = MOODS[mood];
  const eyes = m.eyes === "happy" ? eyesHappy : blink ? eyesShut : eyesOpen;
  return [...TAIL, ...FRONT, ...m.still, ...eyes, ...((frame === "a" ? m.a : m.b) ?? [])];
}

export function Pip({ mood = "idle", className = "", label }: { mood?: Mood; className?: string; label?: string }) {
  const m = MOODS[mood];
  return (
    <svg className={`pip pip-${mood} ${className}`} viewBox="0 -2 22 21" shapeRendering="crispEdges" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect className="pip-shadow" x={5} y={18.5} width={14} height={0.5} fill="#000" opacity={0.2} />
      <g className="pip-bob">
        <Pixels px={TAIL} />
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
