// Pip's haul on My Jobs (jobs.tsx): the pixel items for its kinds of job, on chips and filters, and its
// background, his vault, a room heaped with gold coins painted a pixel at a time (ui/vault.ts), which pours in as the
// list opens and falls away as it is left.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Loot } from "../loot";
import { pourFrame, VAULT_PX, vaultScene, type Room, type VaultScene } from "../vault";
import { Sprite } from "./home";

// The items, one character a pixel, each letter a colour of its own and a dot for none.
type Art = { rows: string[]; colors: Record<string, string> };
const GOLD = { O: "#8a5a12", D: "#d9971f", Y: "#f6c445", L: "#ffdf7a", W: "#fff3c4" };
export const LOOT_ART: Record<Loot | "coinSmall" | "gemSmall", Art> = {
  // A coin and a gem small enough for a chip on a job's row.
  coinSmall: { rows: [".OOOO.", "OWLYYO", "OLYYDO", "OYYYDO", "OYDDDO", ".OOOO."], colors: GOLD },
  gemSmall: {
    rows: [".OOOOO.", "OLWLGGO", "OOOOOOO", ".OLGDO.", "..OGO..", "...O..."],
    colors: { O: "#145c4c", W: "#ffffff", L: "#b8f5e6", G: "#3cc9a5", D: "#1f8f75" },
  },
  // A pile of coins, one standing on it.
  gold: {
    rows: [
      "..........OOOO..", "........OOWLLYOO", "........OWLYYYDO", "........OLYDDYDO", "........OLYDDYDO", "........OYYYYDDO",
      "...OOOOOOOYDDDO.", "..OWLLLLLLOOOO..", "..ODDDDDDDDDO...", ".OOOOOOOOOOOOO..", ".OWLLLLLLLLLLYO.", ".ODDDDDDDDDDDDO.",
      "OOOOOOOOOOOOOOOO", "OWLLLLLLLLLLLLYO", "ODDDDDDDDDDDDDDO", "OOOOOOOOOOOOOOOO",
    ],
    colors: GOLD,
  },
  // A cut gem.
  gems: {
    rows: [
      "....OOOOOOOO....", "...OWWLOOLLLO...", "..OWLLOGGOLLGO..", ".OLLLOGGGGOLGGO.", "OOOOOOOOOOOOOOOO", ".OLGGGOGGGGODGO.",
      "..OLGGOGGGGODO..", "...OLGOGGGGOO...", "....OLOGGGDO....", ".....OLGGDO.....", "......OGDO......", ".......OO.......",
    ],
    colors: { O: "#145c4c", W: "#ffffff", L: "#b8f5e6", G: "#3cc9a5", D: "#1f8f75" },
  },
  // A gold chip, high-tech's.
  hightech: {
    rows: [
      "....O..O..O..O..", "....O..O..O..O..", "..OOOOOOOOOOOOOO", "...OkkkkkkkkkkO.", "..OOkYYYYYYYYkOO", "...OkYLLLLLYYkO.",
      "..OOkYLYYYYDYkOO", "...OkYLYYYYDYkO.", "..OOkYYYYYDDYkOO", "...OkYYDDDDDYkO.", "..OOkkkkkkkkkkOO", "..OOOOOOOOOOOOOO",
      "....O..O..O..O..", "....O..O..O..O..",
    ],
    colors: { O: "#8a5a12", k: "#1d2b26", Y: "#f6c445", L: "#fff0a8", D: "#c98a1c" },
  },
  // A building with columns, a bank's or a ministry's.
  lowtech: {
    rows: [
      ".......OO.......", ".....OOccOO.....", "...OOccWWccOO...", ".OOccccccccccOO.", "OOOOOOOOOOOOOOOO", ".OcccccccccccccO",
      ".OOOOOOOOOOOOOO.", "..OWO.OWO.OWO.O.", "..OcO.OcO.OcO.O.", "..OcO.OcO.OcO.O.", "..OcO.OcO.OcO.O.", "..OdO.OdO.OdO.O.",
      ".OOOOOOOOOOOOOO.", "Occccccccccccccc", "OOOOOOOOOOOOOOOO",
    ],
    colors: { O: "#4a3a2a", c: "#e9dcc4", W: "#fffaf0", d: "#b9a888" },
  },
  // A sprout.
  fresh: {
    rows: [
      "................", "..........OOO...", ".........OgGGO..", "...OOO..OgGGGO..", "..OgGGO.OGGGO...", "..OGgGGOGGGO....",
      "...OGGGOGGO.....", "....OOOGGO......", "......OGO.......", "......OGO.......", "...OOOOOOOOOO...", "..ObbbbbbbbbbO..",
      "..OBBBBBBBBBBO..", "...OOOOOOOOOO...",
    ],
    colors: { O: "#1f4d2b", G: "#4fbf63", g: "#a6ec97", b: "#9a6a44", B: "#6e4a2e" },
  },
  // An hourglass.
  closing: {
    rows: [
      "..OOOOOOOOOOO...", "..OwwwwwwwwwO...", "..OOOOOOOOOOO...", "...OgSSSSSSO....", "...OggSSSSSO....", "....OgSSSSO.....",
      ".....OgSSO......", "......OSO.......", ".....OgSgO......", "....Og.S..O.....", "...Og..S...O....", "...OgSSSSSSO....",
      "..OOOOOOOOOOO...", "..OwwwwwwwwwO...", "..OOOOOOOOOOO...",
    ],
    colors: { O: "#4a2f1c", w: "#c98a4a", g: "#e6f3ff", S: "#f2b632" },
  },
  // A house.
  home: {
    rows: [
      ".......OO..OOO..", "......OrrO.OcO..", ".....OrrrrOOcO..", "....OrrrrrrOcO..", "...OrrrrrrrrOO..", "..OrrrrrrrrrrO..",
      ".OrrrrrrrrrrrrO.", "OOOOOOOOOOOOOOOO", ".OwwwwwwwwwwwwO.", ".OwOOOwwwwOOOwO.", ".OwOyOwwwwOyOwO.", ".OwOOOwOOwOOOwO.",
      ".OwwwwwObOwwwwO.", ".OwwwwwObOwwwwO.", ".OOOOOOOOOOOOOO.",
    ],
    colors: { O: "#3a2414", r: "#d9553f", c: "#8a8f99", w: "#f6e7c8", y: "#ffd45a", b: "#9a6438" },
  },
  // Sparkles, the AI's.
  ai: {
    rows: [
      "......O.........", ".....OSO........", ".....OSO........", "....OSWSO.......", ".OOOSWWWSOOO....", "OSSSWWWWWSSSO...",
      ".OOOSWWWSOOO....", "....OSWSO....O..", ".....OSO....OSO.", ".....OSO...OSWSO", "......O.....OSO.", ".............O..",
    ],
    colors: { O: "#5b3fa8", S: "#b79cff", W: "#ffffff" },
  },
  // A graduate's cap.
  grads: {
    rows: [
      ".......OO.......", ".....OOkkOO.....", "...OOkkKKkkOO...", ".OOkkKKKKKKkkOO.", "OKKKKKKKKKKKKKKO", ".OOKKKKKKKKKKOOy",
      "...OOKKKKKKOO.y.", "....OKOOOOKO..y.", "....OKKKKKKO.yyy", ".....OOOOOO..yyy",
    ],
    colors: { O: "#1e2236", K: "#3a4066", k: "#5c6494", y: "#f2b632" },
  },
  // A crown.
  big: {
    rows: [
      "..O.....O.....O.", ".OYO...OYO...OYO", ".OYYO..OYO..OYYO", ".OYYYO.OYO.OYYYO", ".OYYYYOYYYOYYYYO", ".OYYYYYYYYYYYYYO",
      ".OYrYYYYbYYYYrYO", ".OYYYYYYYYYYYYYO", ".ODDDDDDDDDDDDDO", "..OOOOOOOOOOOOO.",
    ],
    colors: { O: "#8a5a12", Y: "#f6c445", D: "#d9971f", r: "#e0483a", b: "#3fa9f5" },
  },
  // A shield with a star.
  defense: {
    rows: [
      "..OOOOOOOOOOOO..", "..OWWSSSSSSSSO..", "..OWSSSScSSSDO..", "..OSSScccSSSDO..", "..OScccccccSDO..", "...OSScccSSDO...",
      "...OSScScSSDO...", "....OSSSSSDO....", ".....OSSSDO.....", "......OSDO......", ".......OO.......",
    ],
    colors: { O: "#2c3a4a", W: "#e3ecf5", S: "#9fb3c8", D: "#6a7d92", c: "#f2b632" },
  },
};

// An item at its own size, a few screen pixels a pixel (--w and --h its pixels across and down, for the CSS).
export function LootArt({ id, className = "" }: { id: keyof typeof LOOT_ART; className?: string }) {
  const art = LOOT_ART[id];
  return (
    <span className={`loot-art ${className}`} style={{ "--w": art.rows[0].length, "--h": art.rows.length } as React.CSSProperties} aria-hidden="true">
      <Sprite className="loot-sprite" rows={art.rows} colors={art.colors} />
    </span>
  );
}

// Pip's haul's background (jobs.tsx): his vault, the room picked, painted behind the top of My jobs from the page's
// top, edge to edge (ui/vault.ts): the wall behind the page's title and the buttons of its lists and rooms, the coins
// heaped under them and thinning out, one by one, into the page down to where the room's list begins. Opened, the
// coins pour in; left for another list, they fall away, and then it goes. Painted again, at once, when the room or the
// page's size changes. With less motion asked for, it is simply there, and simply goes.
const POUR_IN_MS = 900;
const POUR_OUT_MS = 420;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function LootBackdrop({ on, room }: { on: boolean; room: Room }) {
  const [here, setHere] = useState(on);
  if (on && !here) setHere(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<VaultScene | null>(null);
  // The pour playing (its next frame) and since when; and whether it has poured in since the list was opened.
  const play = useRef({ frame: 0, start: 0, poured: false });

  const show = (t: number, leaving: boolean) => {
    const s = scene.current, g = canvas.current?.getContext("2d");
    if (!s || !g) return;
    const img = g.createImageData(s.width, s.height);
    if (t >= 1 && !leaving) img.data.set(s.pixels);
    else pourFrame(s, t, img.data, leaving);
    g.putImageData(img, 0, 0);
  };
  const run = (leaving: boolean, done?: () => void) => {
    const p = play.current;
    cancelAnimationFrame(p.frame);
    p.start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - p.start) / (leaving ? POUR_OUT_MS : POUR_IN_MS));
      show(t, leaving);
      if (t < 1) p.frame = requestAnimationFrame(step);
      else { p.frame = 0; done?.(); }
    };
    p.frame = requestAnimationFrame(step);
  };

  // While the list is open: measured from the page, the wall down to a little under the rooms' buttons, which with
  // the page's title and lists' buttons are words on it, and the coins thinning out from just under the wall's foot
  // to the top of the room's list.
  useLayoutEffect(() => {
    if (!on) return;
    const c = canvas.current!;
    const page = c.parentElement!;
    let size = "", frame = 0;
    const measure = () => {
      const p = page.getBoundingClientRect();
      const row = (y: number) => (y - p.top) / VAULT_PX;
      const rooms = page.querySelector(".loot-rooms")?.getBoundingClientRect();
      const list = page.querySelector(".loot-list")?.getBoundingClientRect();
      const floor = rooms ? row(rooms.bottom) + 5 : 60;
      const end = Math.max(floor + 30, list ? row(list.top) : 0);
      const width = Math.ceil(p.width / VAULT_PX), height = Math.ceil(end);
      return { p, row, floor, end, width, height, key: `${width}x${height}x${Math.round(floor)}` };
    };
    const paint = () => {
      frame = 0;
      const { p, row, floor, end, width, height, key } = measure();
      size = key;
      const quiet = [...page.querySelectorAll(".saved-title, .saved-tabs, .saved-row .list-bar")].map((w): [number, number, number, number] => {
        const b = w.getBoundingClientRect();
        return [(b.left - p.left) / VAULT_PX, (b.right - p.left) / VAULT_PX, row(b.top), row(b.bottom)];
      });
      scene.current = vaultScene(room, { width, height, floor, clear: [], quiet, pip: null, thin: [floor + 6, end] });
      c.width = width;
      c.height = height;
      c.style.width = `${width * VAULT_PX}px`;
      c.style.height = `${height * VAULT_PX}px`;
      const now = play.current;
      if (!now.poured) {
        now.poured = true;
        if (calm()) show(1, false);
        else run(false);
      } else if (!now.frame) show(1, false);
    };
    paint();
    const watch = new ResizeObserver(() => {
      if (measure().key !== size && !frame) frame = requestAnimationFrame(paint);
    });
    watch.observe(page);
    return () => { watch.disconnect(); cancelAnimationFrame(frame); };
  }, [on, room]);

  // Left for another list: the coins fall away, and then it goes. Opened again before then, they pour in again (the
  // pour in, above, ends this).
  useEffect(() => {
    if (on || !here) return;
    play.current.poured = false;
    if (calm() || !scene.current) { setHere(false); return; }
    run(true, () => { scene.current = null; setHere(false); });
  }, [on]);
  useEffect(() => () => cancelAnimationFrame(play.current.frame), []);

  return here || on ? <canvas ref={canvas} className="loot-scene" aria-hidden="true" /> : null;
}
