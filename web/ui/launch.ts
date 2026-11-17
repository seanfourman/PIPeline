// A conversation's start (Sean's pick of four sketches, 2026-11-12: "אנימציה של התחלת שיחה"): on send, the new
// conversation's box glides down to its place at the conversation's foot while the words lift out of it into their
// bubble at the top, and the greeting and the starts fade where they stood. Only transform and opacity move and
// nothing takes clicks, so the conversation is usable at once. Neither move overshoots: a box that sank past its place
// and came back up read as a jump ("קפיצה קטנה עם התיבת טקסט למטה").
import { type RefObject, useLayoutEffect, useState } from "react";

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Launch = {
  words: string; known: Set<string>; at: number; focused: boolean;
  box: Rect; start: { x: number; y: number }; ink: string; ltr: boolean;
  ghosts: { node: HTMLElement; rect: Rect }[];
};

const GLIDE = { duration: 420, easing: "cubic-bezier(0.32, 0.72, 0, 1)" };
const OUT = "cubic-bezier(0.22, 0.8, 0.3, 1)";
const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
};

let pending: Launch | null = null;

// On send, before the page changes: where the box is and where its words begin, and copies of the greeting and the
// starts. words is the message as its bubble will show it, or "" when the bubble will look otherwise (a command,
// files over the words), and then only the box moves. known: the conversations there already,
// so a different one opened meanwhile doesn't take the move.
export function takeOff(words: string, known: string[]) {
  pending = null;
  const root = document.querySelector(".chat-new");
  const box = root?.querySelector(".composer-box");
  const area = root?.querySelector("textarea");
  if (!root || !box || !area || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const field = rectOf(area), css = getComputedStyle(area), ltr = area.matches(":dir(ltr)");
  pending = {
    words, known: new Set(known), at: performance.now(), focused: document.activeElement === area, box: rectOf(box), ink: css.color, ltr,
    start: { x: ltr ? field.left + parseFloat(css.paddingLeft) : field.right - parseFloat(css.paddingRight), y: field.top + parseFloat(css.paddingTop) },
    ghosts: [...root.querySelectorAll<HTMLElement>(".chat-new-head, .chat-starts")].map((el) => ({ node: el.cloneNode(true) as HTMLElement, rect: rectOf(el) })),
  };
}

// The conversation didn't start: nothing to land.
export function grounded() {
  pending = null;
}

// In the conversation that opens: the handoff, taken once while fresh (the server makes the conversation in between),
// and the move played from it before the first paint. Its words stand in for the first message until the server's
// first word, so they have a bubble to land in.
export function useLanding(id: string, convo: RefObject<HTMLElement>) {
  const [landing] = useState(() => {
    const l = pending;
    pending = null;
    return l && !l.known.has(id) && performance.now() - l.at < 4000 ? l : null;
  });
  useLayoutEffect(() => { if (landing && convo.current) land(landing, convo.current); }, [landing, convo]);
  return landing;
}

function land(l: Launch, convo: HTMLElement) {
  const form = convo.querySelector<HTMLElement>(".composer");
  const box = form?.querySelector(".composer-box");
  if (!form || !box) return;
  const now = rectOf(box), frame = rectOf(convo);
  const leaving: Animation[] = [];
  const extras: Element[] = [];

  // The box, bottom to bottom so its buttons' row starts where it was (a box grown to two lines leaves its words over
  // it), empty: its placeholder comes back once the words have left. The page's top comes in as it goes.
  form.animate([{ transform: `translate(${l.box.left + l.box.width / 2 - (now.left + now.width / 2)}px, ${l.box.bottom - now.bottom}px) scaleX(${l.box.width / now.width})` }, { transform: "none" }], { ...GLIDE, fill: "backwards" });
  const area = form.querySelector("textarea");
  area?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 200, easing: "linear", fill: "backwards" });
  // On a computer the box keeps the focus it had, ready for the next message; a phone's keyboard stays shut.
  if (l.focused && matchMedia("(pointer: fine)").matches) area?.focus({ preventScroll: true });
  convo.querySelector(".chat-top")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 120, easing: "linear", fill: "backwards" });
  convo.querySelector(".working-line")?.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: 260, easing: OUT, fill: "backwards" });
  // The taller box's shape stays behind its words a moment, so nothing jumps at the start.
  if (l.box.height > now.height + 4) {
    const shape = document.createElement("div");
    shape.className = "launch-shape";
    Object.assign(shape.style, { left: `${l.box.left - frame.left}px`, top: `${l.box.top - frame.top}px`, width: `${l.box.width}px`, height: `${l.box.height}px` });
    convo.append(shape);
    extras.push(shape);
    leaving.push(shape.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: "linear", fill: "both" }));
  }

  // The words, from where they began in the box to where they begin in the bubble, passing over the box on the way
  // (it comes after them on the page); the bubble fills in around them.
  const bubble = l.words ? convo.querySelector<HTMLElement>(".msg-user .msg-bubble") : null;
  if (bubble) {
    const b = rectOf(bubble), css = getComputedStyle(bubble);
    const x = l.ltr ? b.left + parseFloat(css.paddingLeft) : b.right - parseFloat(css.paddingRight);
    Object.assign(bubble.style, { position: "relative", zIndex: "1" });
    bubble.animate([{ transform: `translate(${l.start.x - x}px, ${l.start.y - b.top - parseFloat(css.paddingTop)}px)` }, { transform: "none" }], { ...GLIDE, fill: "backwards" })
      .finished.then(() => Object.assign(bubble.style, { position: "", zIndex: "" }), () => {});
    bubble.animate([{ backgroundColor: "transparent", color: l.ink }, { backgroundColor: css.backgroundColor, color: css.color }], { duration: 260, delay: 60, easing: OUT, fill: "backwards" });
  }

  // The greeting goes up into a blur and the starts go at once, from where they stood, behind the conversation, so the
  // box and the words pass over them, and taking no clicks.
  const layer = document.createElement("div");
  layer.className = "chat-new launch-ghosts";
  layer.inert = true;
  layer.setAttribute("aria-hidden", "true");
  for (const g of l.ghosts) {
    Object.assign(g.node.style, { left: `${g.rect.left - frame.left}px`, top: `${g.rect.top - frame.top}px`, width: `${g.rect.width}px`, height: `${g.rect.height}px` });
    layer.append(g.node);
    leaving.push(g.node.classList.contains("chat-starts")
      ? g.node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, easing: "linear", fill: "both" })
      : g.node.animate([{ opacity: 1, transform: "none", filter: "blur(0)" }, { opacity: 0, transform: "translateY(-18px)", filter: "blur(6px)" }], { duration: 280, easing: OUT, fill: "both" }));
  }
  convo.append(layer);
  extras.push(layer);
  const clear = () => { for (const el of extras) el.remove(); };
  Promise.all(leaving.map((a) => a.finished)).then(clear, clear);
}
