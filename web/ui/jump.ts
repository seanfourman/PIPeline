// Pip's jumps, for the login's scene (intro.ts) and the introduction's board (views/welcome.tsx): a thrown body's
// path under gravity, after a crouch and before a landing, squashing and stretching as he goes. Lengths are in his
// own pixels times px, the size of one where he is drawn, so he jumps alike at any size; times are in seconds.

// How hard he falls, how far over the higher end a jump tops out, how long he crouches before it and settles after
// it, how much he squashes and stretches, and the speed at which he stretches the most.
const GRAVITY = 1700;
const LIFT = 7;
const CROUCH = 0.09;
const SETTLE = 0.14;
const SQUASH = 0.2;
const STRETCH = 0.14;
const FAST = 450;
// How long after a jump off a board starts he is clear of it, for the board to start turning.
export const OFF_BOARD = CROUCH + 0.05;

export type Point = [x: number, y: number];
// Where his feet are, how wide and tall he is drawn from them (1 is as he is), and whether he is in the air.
export type Pose = { x: number; y: number; sx: number; sy: number; air: boolean };

// A jump from one place to another, y down: it tops out LIFT over the higher of the two and falls the rest, so a
// jump up passes over its end and comes down onto it, and x goes at one speed. He crouches first, as deep as the
// push off is hard, flies stretched as much as he is fast, then lands squashed, as much as he lands hard, and
// springs back past his height to it. length is how long it all takes; at gives his pose at a time in it, and the
// last one after it.
export function jump(from: Point, to: Point, px = 1) {
  const g = GRAVITY * px;
  const top = Math.min(from[1], to[1]) - LIFT * px;
  const rise = Math.sqrt((2 * (from[1] - top)) / g);
  const air = rise + Math.sqrt((2 * (to[1] - top)) / g);
  // How much a push off or a landing at this speed squashes him: never less than half, so a small one still shows.
  const squashAt = (speed: number) => SQUASH * Math.max(0.5, Math.min(1, speed / (FAST * px)));
  const crouch = squashAt(g * rise);
  const land = squashAt(g * (air - rise));
  const length = CROUCH + air + SETTLE;
  const at = (time: number): Pose => {
    const s = Math.min(length, Math.max(0, time));
    const inAir = s >= CROUCH && s < CROUCH + air;
    let [x, y] = s < CROUCH ? from : to;
    let squash: number;
    if (s < CROUCH) squash = crouch * Math.sin(((s / CROUCH) * Math.PI) / 2);
    else if (inAir) {
      const k = s - CROUCH;
      x = from[0] + ((to[0] - from[0]) * k) / air;
      y = top + (g / 2) * (k - rise) ** 2;
      squash = -STRETCH * Math.min(1, Math.abs(g * (k - rise)) / (FAST * px));
    } else {
      const k = (s - CROUCH - air) / SETTLE;
      squash = land * (1 - k) * Math.cos(k * Math.PI * 1.5);
    }
    return { x, y, sx: 1 + squash * 0.6, sy: 1 - squash, air: inAir };
  };
  return { length, at };
}
export type Jump = ReturnType<typeof jump>;
