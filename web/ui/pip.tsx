// Pip, the companion: an original fox, drawn abstract in big blocks, with his moods.
import React from "react";

export type Mood = "idle" | "wave" | "work" | "ask" | "happy" | "worried" | "scared"
  | "angry" | "sad" | "tired" | "party" | "love" | "surprised" | "cool" | "confused";
type Px = [number, number, string];

const C: Record<string, string> = {
  O: "#F2892E", D: "#CF6620", W: "#FFF2DF", K: "#2A2236", P: "#FF9C8A", A: "#FF5D5D", Y: "#FFF1A8", U: "#7CC8FF", G: "#8A84A0",
  R: "#E8443A", S: "#FFFFFF", J: "#FFC94A",
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
// The same from the front in the air: the tail swung up beside the face, the feet tucked in under the body.
const FRONT_LEAP = [...blocks([
  ".D.......D.",
  ".OD.....DO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOO.",
  ".OOOOOOOOOW",
  ".OOOWWWOOOO",
  "..OWWWWWOO.",
  "..OWWWWWO..",
  "...D...D...",
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
// Single pixels from rows of palette letters, from (x, y); a dot draws nothing.
const art = (x: number, y: number, rows: string[]): Px[] =>
  rows.flatMap((row, dy) => [...row].flatMap((ch, dx): Px[] => (ch === "." ? [] : [[x + dx, y + dy, C[ch]]])));
// Marks over his head, in single pixels, clear of it: an exclamation mark, frightened, two pixels over his ear tips
// as the dots at work are; and a question mark, waiting for your answer, lower, between the ears and two pixels over
// his head, which hovers a pixel up and down (a and b).
const alert = art(10, -9, ["AA", "AA", "AA", "AA", "..", "AA"]);
const QUESTION = [".AAAA.", "AA..AA", "....AA", "...AA.", "..AA..", "......", "..AA.."];
const askA = art(8, -6, QUESTION);
const askB = art(8, -7, QUESTION);
// Happy: two gold four-pointed stars twinkling in the air out past his head's sides, one at a time flaring big
// while the other is small (a and b). They stay where they are, so they never read as paws.
const twinkle = (x: number, y: number, big: boolean) =>
  big ? art(x - 2, y - 2, ["..J..", "..J..", "JJJJJ", "..J..", "..J.."]) : art(x - 1, y - 1, [".J.", "JJJ", ".J."]);
const sparkA = [...twinkle(-2, 3, true), ...twinkle(23, 5, false)];
const sparkB = [...twinkle(-2, 3, false), ...twinkle(23, 5, true)];
// Frightened: each eye wide open, a round white with a small pupil, in single pixels where the eyes usually are.
const eyesWide = [...art(5, 7, [".WW.", "WKKW", "WKKW", ".WW."]), ...art(13, 7, [".WW.", "WKKW", "WKKW", ".WW."])];
// Lying down and frightened, a drop of sweat by the head and an exclamation mark above it.
const fright = [...art(0, 3, [".U", "UU", "UU"]), ...art(10, -5, ["AA", "AA", "AA", "..", "AA"])];
// Not looking, while a password is typed: the front legs rise over the cream chest, each ending in a round dark
// pad like the feet and the ear tips, in three steps: 1 at the chest, 2 at the cheeks, 3 over the eyes, which are
// then hidden, with a blush beside the paws.
const PAD = [".DDDD.", "DDDDDD", "DDDDDD", ".DDDD."];
const PAD_TOP = [0, 13, 10, 7];
function frontPaws(step: number): Px[] {
  const top = PAD_TOP[step];
  const leg = (x0: number) => art(x0 + 1, top + 3, Array.from({ length: 17 - (top + 3) }, () => "OOOO"));
  const paws = [4, 12].flatMap((x0) => [...leg(x0), ...art(x0, top, PAD)]);
  return step === 3 ? [...paws, ...art(3, 11, ["P", "P"]), ...art(18, 11, ["P", "P"])] : paws;
}

// His faces, each drawn whole, eyes and all, with its moving part in two frames (FACES' a and b). A mouth sits a row
// below the nose, as the worried one does, so the two never join into one long nose.
// Brows: angry ones slant down to the middle, sad ones up to it.
const browsAngry = [...art(5, 5, ["KK..", "..KK"]), ...art(13, 5, ["..KK", "KK.."])];
const browsSad = [...art(5, 5, ["..KK", "KK.."]), ...art(13, 5, ["KK..", "..KK"])];
const frown = art(9, 14, [".KK.", "K..K"]);
const HEART = [".A.A.", "AAAAA", ".AAA.", "..A.."];
const HEART_BIG = ["AA.AA", "AAAAA", "AAAAA", ".AAA.", "..A.."];
const ROUND = [".SS.", "SKKS", "SKKS", ".SS."];
const FACES: Partial<Record<Mood, { still: Px[]; a: Px[]; b: Px[] }>> = {
  // Glaring under brows down to the middle, a frown, red cheeks, and the angry mark by his ear, pulsing: the ear on
  // the picture's left, the side he shows when he peeks from behind the sidebar.
  angry: {
    still: [...art(6, 8, ["KK", "KK"]), ...art(14, 8, ["KK", "KK"]), ...browsAngry, ...frown, ...art(4, 11, ["RR"]), ...art(16, 11, ["RR"])],
    a: art(4, 1, ["R.R", "...", "R.R"]),
    b: art(3, 0, ["RR.RR", "R...R", ".....", "R...R", "RR.RR"]),
  },
  // Eyes cast down under brows up to the middle, a frown, and a tear running down his cheek.
  sad: {
    still: [...art(6, 9, ["KK", "KK"]), ...art(14, 9, ["KK", "KK"]), ...browsSad, ...frown],
    a: art(6, 11, ["U", "U"]),
    b: art(6, 13, ["U", "U"]),
  },
  // Heavy lids, dark under the eyes, and now and then a yawn.
  tired: {
    still: [...art(6, 9, ["KK"]), ...art(14, 9, ["KK"]), ...art(6, 11, ["DD"]), ...art(14, 11, ["DD"])],
    a: art(10, 14, ["KK"]),
    b: art(10, 14, ["KK", "KK", "KK"]),
  },
  // Eyes shut with joy and blushing as when he is happy, a big open smile, a paw up, and confetti over his head,
  // twinkling.
  party: {
    still: [...eyesHappy, ...blush, ...art(9, 14, ["KKKK", ".PP."]), ...pawHigh],
    a: art(0, -2, ["A......Y....U........", "...............P....."]),
    b: art(0, -2, [".....P.......A.....Y.", "U..........Y........."]),
  },
  // Heart eyes, beating, and a blush.
  love: {
    still: [...art(4, 11, ["PP"]), ...art(16, 11, ["PP"])],
    a: [...art(4, 6, HEART), ...art(13, 6, HEART)],
    b: [...art(4, 5, HEART_BIG), ...art(13, 5, HEART_BIG)],
  },
  // Round eyes, a small round mouth, and his brows jumping up.
  surprised: {
    still: [...art(5, 6, ROUND), ...art(13, 6, ROUND), ...art(10, 14, ["KK", "KK"])],
    a: [...art(5, 3, ["KKKK"]), ...art(13, 3, ["KKKK"])],
    b: [...art(5, 4, ["KKKK"]), ...art(13, 4, ["KKKK"])],
  },
  // One eye big and one small, a brow up over the small one, a wavy mouth; the two eyes swap.
  confused: {
    still: art(9, 14, [".K.K", "K.K."]),
    a: [...art(6, 7, ["KK", "KK", "KK", "KK"]), ...art(14, 8, ["KK", "KK"]), ...art(13, 5, ["KKK"])],
    b: [...art(6, 8, ["KK", "KK"]), ...art(14, 7, ["KK", "KK", "KK", "KK"]), ...art(5, 5, ["KKK"])],
  },
};
const face = (mood: Mood) => ({ ...FACES[mood]!, eyes: "none" as const });
// At work: three grey dots over his head, two pixels clear of his ears, that rise a pixel in turn like a wave (each
// its own pip-dot), and him looking up at them, a small "hmm" of a mouth to one side.
const workLook = [...art(6, 6, ["KK", "KK", "KK"]), ...art(14, 6, ["KK", "KK", "KK"]), ...art(11, 14, ["KK"])];
const workDots = [6, 10, 14].map((x) => art(x, -5, ["GG", "GG"]));
// Cool: sunglasses and a smirk, and now and then a glint sweeping across the glasses from left to right, a pixel at a
// time (pip-glint): two thin white streaks slanting like light off glass, seen only where the glasses are. They start
// clear of the glasses' left end, and pip-glint's 17 pixels in styles.css take them past the right one.
const GLASSES = art(4, 7, ["KKKKKKKKKKKKKK", ".KKKK....KKKK.", "..KK......KK.."]);
const GLINT = art(-1, 7, ["..S.S", ".S.S.", "S.S.."]);

// Joins neighbouring pixels of one colour into rectangles, so a sprite stays a few dozen nodes.
function pixelRects(list: Px[]) {
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
  return rects;
}

function Pixels({ px: list, className, transform }: { px: Px[]; className?: string; transform?: string }) {
  return <g className={className} transform={transform}>{pixelRects(list)}</g>;
}

// Something drawn only where another shape is, as a glint is only on the glass: its own clip, named for this Pip so
// two on a page don't share one.
function Clipped({ to, children }: { to: Px[]; children: React.ReactNode }) {
  const id = `pip-clip${React.useId().replace(/:/g, "")}`;
  return (
    <>
      <clipPath id={id}>{pixelRects(to)}</clipPath>
      <g clipPath={`url(#${id})`}>{children}</g>
    </>
  );
}

// still is drawn all the time, a and b take turns, and mark is drawn on its own (pip-alert), so the page can take
// it away mid-animation, like the frightened Pip's exclamation mark as he falls. dots each move on their own; glint
// sweeps over the shape it is on (pip-glint).
const MOODS: Record<Mood, {
  still: Px[]; a?: Px[]; b?: Px[]; mark?: Px[]; dots?: Px[][]; glint?: { on: Px[]; streak: Px[] }; eyes: "blink" | "happy" | "wide" | "none";
}> = {
  idle: { still: [], eyes: "blink" },
  wave: { still: [], a: pawHigh, b: pawLow, eyes: "blink" },
  work: { still: workLook, dots: workDots, eyes: "none" },
  ask: { still: [], a: askA, b: askB, eyes: "blink" },
  happy: { still: blush, a: sparkA, b: sparkB, eyes: "happy" },
  worried: { still: [...mouth, ...sweat], eyes: "blink" },
  scared: { still: [...mouth, ...sweat], mark: alert, eyes: "wide" },
  angry: face("angry"),
  sad: face("sad"),
  tired: face("tired"),
  party: face("party"),
  love: face("love"),
  surprised: face("surprised"),
  cool: { still: [...GLASSES, ...art(10, 14, ["KKK"]), ...art(13, 13, ["K"])], glint: { on: GLASSES, streak: GLINT }, eyes: "none" },
  confused: face("confused"),
};
// The faces above draw their own eyes ("none").
const steadyEyes = { happy: eyesHappy, wide: eyesWide, none: [] as Px[] } as const;

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
// The backpack he sets off with (PipSetsOff): green, a lighter flap with a yellow buckle. On his back from behind,
// with two straps up to the shoulders; held up in front of him, his paws on its top corners; and from the side, on
// his back as he runs.
const BAG: Record<string, string> = { L: "#24541f", G: "#367a32", H: "#5fae44", Y: "#ffc94a", D: C.D };
const bag = (x0: number, y0: number, rows: string[]): Px[] =>
  rows.flatMap((row, dy) => [...row].flatMap((ch, dx): Px[] => (ch === "." ? [] : [[x0 + dx, y0 + dy, BAG[ch]]])));
const BACKPACK = bag(6, 6, [".L......L.", ".L......L.", "LLLLLLLLLL", "LHHHHHHHHL", "LHHHHHHHHL", "LGGGYYGGGL", "LGGGGGGGGL", "LGGGGGGGGL", "LLLLLLLLLL"]);
const HELD_PACK = bag(6, 13, ["LLLLLLLLLL", "LHHHHHHHHL", "LGGGYYGGGL", "LGGGGGGGGL", "LGGGGGGGGL", "LLLLLLLLLL"]);
const HOLDING_PAWS = bag(4, 12, ["DDD......DDD", "DDD......DDD"]);
// From the side, upright as he always stands, facing right, running with it on: the near ear and the far one behind
// it, the eye near the front, the nose at the snout's tip, the cream chest in front, the tail out behind low down;
// the pack on his back with its strap over the shoulder; two steps on his two legs, apart (a) and passing (b).
const SIDE = blocks([
  "......D.D...",
  "......ODOD..",
  "....OOOOOOO.",
  "....OOOOOKO.",
  "....OOOOOOWK",
  "....OOOOOWW.",
  "WW..OOOOOWW.",
  "OOOOOOOOOOW.",
]);
const steps = (near: string, far: string) => blocks([...Array<string>(8).fill(""), near, far]);
const RUN_A = steps("....D....D..", "...D......D.");
const RUN_B = steps("......DD....", "......DD....");
const SIDE_PACK = bag(3, 3, ["...L...", "..L....", "LLLLL..", "LHHHL..", "LHHHL..", "LHYHL..", "LGGGL..", "LGGGL..", "LGGGL..", "LLLLL.."]);

// Stone, wood and earth, for Pip's pickaxe (PipMiner).
const M: Record<string, string> = { stone: "#a4abb3", stoneDark: "#7f8790", beam: "#a8713f", light: "#ddb07c" };
// Pip's hard hat, between the ears, with its lamp in front; and the pickaxe, raised (a) and struck into what it
// digs (b), where bits of earth fly.
const HAT: Record<string, string> = { Y: "#ffc94a", H: "#d6962a", L: "#fffbe6" };
const hat = (x0: number, y0: number, rows: string[]): Px[] => rows.flatMap((row, dy) => [...row].map((ch, dx): Px => [x0 + dx, y0 + dy, HAT[ch]]));
const HELMET: Px[] = [...hat(7, 0, ["YYYYYYYY"]), ...hat(6, 1, ["YYYYYYYYYY"]), ...hat(5, 2, ["HHHHHHHHHHHH"]), ...hat(10, 0, ["LL", "LL"])];
// A pickaxe held at the hand (hx, hy), out to one side (side: 1 right, -1 left): a wooden handle and a curved iron
// head across its end, bulging away from the handle and its two points bending back, darker at the points.
// Raised, the handle slants up and out; struck, it lies level and the head stands upright, with bits of earth
// flying off past it.
function pickaxe(hx: number, hy: number, side: 1 | -1) {
  const at = (c: string) => ([x, y]: number[]): Px => [hx + side * x, hy + y, c];
  const raised = [
    ...[[1, -1], [2, -2], [3, -3], [4, -4], [5, -5], [6, -6], [7, -7]].map(at(M.beam)),
    ...[[4, -11], [5, -11], [6, -10], [7, -10], [8, -9], [8, -8], [9, -8], [10, -7], [10, -6], [11, -5], [11, -4]].map(at(M.stone)),
    ...[[3, -10], [10, -3]].map(at(M.stoneDark)),
  ];
  const struck = [
    ...[[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0]].map(at(M.beam)),
    ...[[9, -4], [9, -3], [10, -2], [10, -1], [9, 0], [10, 0], [10, 1], [10, 2], [9, 3], [9, 4]].map(at(M.stone)),
    ...[[8, -5], [8, 5]].map(at(M.stoneDark)),
    ...[[12, -2], [13, 0], [12, 2], [14, -1], [13, 3]].map(at(M.light)),
  ];
  return { raised, struck };
}
// Out to Pip's left, so its tail stays on the right.
const { raised: PICK_UP, struck: PICK_DOWN } = pickaxe(1, 11, -1);

// The edge of a shape's pixels: those with a side that touches nothing of it, in the text's colour.
const INK = "currentColor";
function edgeOf(px: Px[]): Px[] {
  const on = new Set(px.map(([x, y]) => `${x},${y}`));
  return px.filter(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !on.has(`${x + dx},${y + dy}`))).map(([x, y]): Px => [x, y, INK]);
}
const inInk = (px: Px[]): Px[] => px.map(([x, y]): Px => [x, y, INK]);
// Pip in the hard hat drawn as lines in the text's colour: the edge of the whole fox, of the hat and of the cream
// chest and tail tip, with the eyes, the nose and the pickaxe.
const MINER_LINES = [...edgeOf([...FRONT, ...HELMET]), ...edgeOf(HELMET), ...edgeOf(FRONT.filter(([, , c]) => c === C.W)), ...inInk(nose)];

// Pip in the hard hat, swinging the pickaxe out to its left (dig-a raised, dig-b struck, with bits of earth
// flying), its tail on the right, on its own, for a mine the page draws round it; outline draws it all as lines
// in the text's colour (its CSS color).
export function PipMiner({ className = "", outline = false }: { className?: string; outline?: boolean }) {
  const paint = outline ? inInk : (px: Px[]) => px;
  return (
    <svg className={`pip pip-digging ${className}`} viewBox="-13 -1 35 20" shapeRendering="crispEdges" aria-hidden="true">
      <g className="pip-bob">
        <Pixels px={outline ? MINER_LINES : [...FRONT, ...HELMET]} />
        <Pixels px={paint(eyesOpen)} className="pip-open" />
        <Pixels px={paint(eyesShut)} className="pip-shut" />
      </g>
      <Pixels px={paint(PICK_UP)} className="dig-a" />
      <Pixels px={paint(PICK_DOWN)} className="dig-b" />
    </svg>
  );
}

// Lying flat: its back curving down from behind the ears and out to a big round rump, its tail along its front.
// The eyes are left out, for the two that lie like this to add.
const LYING: Px[] = [
  ...blocks([
    "...............",
    ".D.......D.....",
    ".OD.....DO.....",
    ".OOOOOOOOOOOO..",
    ".OOOOOOOOOOOOO.",
    ".OOOOOOOOOOOOOO",
    ".OOOWKWOOOOOOOO",
    ".OWWWWWWOOOOOOO",
    "WWOOOOOOOOOOOOO",
  ]),
  // The rump, a quarter of an ellipse: how far right each row reaches, from the top of the back down to the ground.
  ...[25, 26, 28, 29, 30, 30, 31, 31, 31, 32, 32, 32].flatMap((to, i) => Array.from({ length: to - 19 }, (_, k): Px => [20 + k, 5 + i, C.O])),
];

// Asleep, for a list with nothing in it yet: lying flat with its lids shut, curving down, and three Zs rising off
// its back, each bigger than the last. It doesn't move, and the page shows it in grey.
const ASLEEP: Px[] = [
  ...LYING,
  ...art(5, 9, ["K..K....K..K", ".KK......KK."]),
  ...art(22, 0, ["GGGG", "..G.", ".G..", "GGGG"]),
  ...art(26, -6, ["GGGGG", "...G.", "..G..", ".G...", "GGGGG"]),
  ...art(31, -13, ["GGGGGG", "....G.", "...G..", "..G...", ".G....", "GGGGGG"]),
];

export function PipAsleep({ className = "" }: { className?: string }) {
  return (
    <svg className={`pip pip-asleep ${className}`} viewBox="0 -13 37 30" shapeRendering="crispEdges" aria-hidden="true">
      <Pixels px={ASLEEP} />
    </svg>
  );
}

// Lying awake, in its colours, the eyes open and now and then blinking (pip-open and pip-shut in the CSS): for
// lounging on the top of something, like the jobs page's search box. Scared, the eyes go wide and the mouth
// opens, with a drop of sweat and an exclamation mark, and he shivers (pip-scared in the CSS).
export function PipLying({ className = "", scared = false }: { className?: string; scared?: boolean }) {
  return (
    <svg className={`pip pip-lying ${scared ? "pip-scared" : ""} ${className}`} viewBox="0 1 33 16" shapeRendering="crispEdges" aria-hidden="true">
      <Pixels px={LYING} />
      {scared ? <Pixels px={[...eyesWide, ...mouth, ...fright]} /> : <>
        <Pixels px={eyesOpen} className="pip-open" />
        <Pixels px={eyesShut} className="pip-shut" />
      </>}
    </svg>
  );
}

// Setting off to look for jobs, at the end of the introduction, a scene at a time, where Pip stands: pulling the
// backpack out over his head and holding it up, happy (pull, its pack pip-pack and his paws pip-paws for the CSS to
// bring in); from behind, the pack coming down onto his back (on); and from the side running on his two legs with it
// on, a little wider than he is from the front, the two steps taking turns (run, pip-a and pip-b).
export function PipSetsOff({ scene }: { scene: "pull" | "on" | "run" }) {
  if (scene === "run") return (
    <svg className="pip pip-run" viewBox="0 -2 24 21" shapeRendering="crispEdges" aria-hidden="true">
      <Pixels px={[...SIDE, ...SIDE_PACK]} />
      <Pixels px={RUN_A} className="pip-a" />
      <Pixels px={RUN_B} className="pip-b" />
    </svg>
  );
  if (scene === "on") return (
    <svg className="pip pip-on" viewBox="0 -2 22 21" shapeRendering="crispEdges" aria-hidden="true">
      <Pixels px={BACK} />
      <Pixels px={BACKPACK} className="pip-pack" />
    </svg>
  );
  return (
    <svg className="pip pip-pull" viewBox="0 -2 22 21" shapeRendering="crispEdges" aria-hidden="true">
      <Pixels px={[...FRONT, ...blush, ...eyesHappy]} />
      <Pixels px={HELD_PACK} className="pip-pack" />
      <Pixels px={HOLDING_PAWS} className="pip-paws" />
    </svg>
  );
}

export type Pixel = Px;

// The fox as a list of pixels, for drawing on a canvas: the same sprite the app shows. frontLeap is the front in the
// air, with the mood's face; leap is the back in the air. paws is how far the front paws are lifted to cover the
// eyes, 0 to 3 (see frontPaws).
export function foxPixels(view: "front" | "frontLeap" | "back" | "leap", mood: Mood = "idle", frame: "a" | "b" = "a", blink = false, paws = 0): Px[] {
  if (view === "back") return BACK;
  if (view === "leap") return BACK_LEAP;
  const m = MOODS[mood];
  const eyes = paws === 3 ? [] : m.eyes !== "blink" ? steadyEyes[m.eyes] : blink ? eyesShut : eyesOpen;
  return [...(view === "frontLeap" ? FRONT_LEAP : FRONT), ...m.still, ...(m.mark ?? []), ...(m.dots ?? []).flat(), ...eyes, ...((frame === "a" ? m.a : m.b) ?? []), ...(paws ? frontPaws(paws) : [])];
}

// Pip's icon: the fox standing as the page shows him, his eyes open, in rows of his blocks, a letter of ICON_COLORS
// for each and a dot for none. The tab's icon, the program's and the installer's are drawn from it (web/icon.ts), and
// the login's computer has it on its desktop.
export const ICON = (() => {
  const px = foxPixels("front");
  const left = Math.min(...px.map(([x]) => x));
  const top = Math.min(...px.map(([, y]) => y));
  const letter = new Map(Object.entries(C).map(([key, color]) => [color, key]));
  const rows = Array.from({ length: (Math.max(...px.map(([, y]) => y)) - top + 1) / 2 }, () => Array<string>((Math.max(...px.map(([x]) => x)) - left + 1) / 2).fill("."));
  for (const [x, y, color] of px) rows[(y - top) >> 1][(x - left) >> 1] = letter.get(color)!;
  return rows.map((row) => row.join(""));
})();
export const ICON_COLORS = Object.fromEntries(Object.entries(C).filter(([key]) => ICON.some((row) => row.includes(key))));

// The logo: Pip's face alone, from his icon's blocks, from the ear tips down to the nose and across his head (not the
// tail), in rows of X (filled) and dot (empty), a pixel each, half a block: in one colour, the text's, with the eyes
// and the nose cut out, the face's two bottom corners cut by a pixel and a row under it narrower again, for a jaw.
const FACE_ROWS = 7;
const FACE_COLUMNS = 9;
export const MARK = (() => {
  const blocks = ICON.slice(0, FACE_ROWS).map((row) => [...row.slice(0, FACE_COLUMNS)].flatMap((key) => [key, key]).join(""));
  const pixels = blocks.flatMap((row) => [row, row]);
  const width = pixels[0].length;
  const face = pixels.map((row, y) => [...row].map((key, x) => {
    const corner = y === pixels.length - 1 && (x === 0 || x === width - 1);
    return key === "." || key === "K" || corner ? "." : "X";
  }).join(""));
  return [...face, `..${"X".repeat(width - 4)}..`];
})();
// One SVG path for a one-colour drawing in rows of X (filled) and dot (empty), one unit per cell.
export const pixelPath = (rows: string[]) =>
  rows.map((row, y) => [...row.matchAll(/X+/g)].map((m) => `M${m.index} ${y}h${m[0].length}v1h-${m[0].length}z`).join("")).join("");
export const MARK_PATH = pixelPath(MARK);

export function PipMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`pip-mark ${className}`} viewBox={`0 0 ${MARK[0].length} ${MARK.length}`} shapeRendering="crispEdges" aria-hidden="true">
      <path d={MARK_PATH} fill="currentColor" />
    </svg>
  );
}

// leaps adds the pose in the air (pip-leap) over the standing one (pip-stand), for a page whose CSS shows one of
// the two at a time while Pip jumps.
export function Pip({ mood = "idle", className = "", label, leaps = false }: { mood?: Mood; className?: string; label?: string; leaps?: boolean }) {
  const m = MOODS[mood];
  return (
    <svg className={`pip pip-${mood} ${className}`} viewBox="0 -2 22 21" shapeRendering="crispEdges" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <g className="pip-bob">
        <Pixels px={FRONT} className={leaps ? "pip-stand" : undefined} />
        {leaps && <Pixels px={FRONT_LEAP} className="pip-leap" />}
        <Pixels px={m.still} />
        {m.mark && <Pixels px={m.mark} className="pip-alert" />}
        {m.eyes !== "blink" ? <Pixels px={steadyEyes[m.eyes]} /> : <>
          <Pixels px={eyesOpen} className="pip-open" />
          <Pixels px={eyesShut} className="pip-shut" />
        </>}
        {m.a && <Pixels px={m.a} className="pip-a" />}
        {m.b && <Pixels px={m.b} className="pip-b" />}
        {m.dots?.map((px, i) => <Pixels key={i} px={px} className={`pip-dot pip-dot-${i}`} />)}
        {m.glint && <Clipped to={m.glint.on}><Pixels px={m.glint.streak} className="pip-glint" /></Clipped>}
      </g>
    </svg>
  );
}
