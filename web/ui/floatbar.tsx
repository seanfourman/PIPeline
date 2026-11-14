// The page's scrollbar, our own: a thin bar floating over the page's edge, as a phone's or a Mac's does, rather than
// the browser's, which on Windows takes a lane of its own where nothing of the page can be drawn. So a banner runs to
// the window's edge, and no page shifts sideways as a bar comes or goes. It shows whenever the page is long enough to
// scroll, clear of the page's top and bottom edges; it can be dragged, and a press above or below the thumb moves a
// page. The browser's own is hidden (styles.css, main), and the page still scrolls by the wheel, the touchpad and the keys.
import React, { useEffect, useRef } from "react";

// The thumb is never shorter than this, so a long page's is still easy to take.
const MIN_THUMB = 36;
// The room kept between the bar's track and the page's top and bottom edges.
const INSET = 8;

export function FloatBar({ scroller }: { scroller: React.RefObject<HTMLElement | null> }) {
  const lane = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const main = scroller.current;
    const bar = lane.current;
    const knob = thumb.current;
    if (!main || !bar || !knob) return;
    let frame = 0;
    // Laid over the scroller's end edge (its left in Hebrew), INSET in from its top and bottom, the thumb as long and as
    // far down its track as the part shown is of the page.
    const measure = () => {
      frame = 0;
      const box = main.getBoundingClientRect();
      const room = main.scrollHeight - main.clientHeight;
      if (room <= 1) { delete bar.dataset.room; return; }
      bar.dataset.room = "";
      const rtl = getComputedStyle(main).direction === "rtl";
      const track = Math.max(MIN_THUMB, main.clientHeight - 2 * INSET);
      bar.style.top = `${box.top + INSET}px`;
      bar.style.height = `${track}px`;
      bar.style.left = `${rtl ? box.left : box.right - bar.offsetWidth}px`;
      const size = Math.min(track, Math.max(MIN_THUMB, (track * main.clientHeight) / main.scrollHeight));
      knob.style.height = `${size}px`;
      knob.style.transform = `translateY(${(main.scrollTop / room) * (track - size)}px)`;
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(measure); };
    // Measured again as the window or the page's content changes size, each screen's own root watched as it comes.
    const sizes = new ResizeObserver(later);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(main);
      for (const child of Array.from(main.children)) sizes.observe(child);
      later();
    };
    const screens = new MutationObserver(watch);
    screens.observe(main, { childList: true });
    main.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    watch();
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      screens.disconnect();
      main.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
    };
  }, [scroller]);

  // Dragged, the page follows the thumb, as far as the thumb's track is to the page's.
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const main = scroller.current;
    const knob = thumb.current;
    if (!main || !knob || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    knob.setPointerCapture(e.pointerId);
    const from = e.clientY;
    const start = main.scrollTop;
    const ratio = (main.scrollHeight - main.clientHeight) / Math.max(1, (lane.current?.clientHeight ?? main.clientHeight) - knob.offsetHeight);
    lane.current?.classList.add("held");
    const move = (ev: PointerEvent) => { main.scrollTop = start + (ev.clientY - from) * ratio; };
    const up = () => {
      knob.removeEventListener("pointermove", move);
      knob.removeEventListener("pointerup", up);
      knob.removeEventListener("pointercancel", up);
      lane.current?.classList.remove("held");
    };
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", up);
    knob.addEventListener("pointercancel", up);
  };
  // Pressed above or below the thumb: a page up or down.
  const page = (e: React.PointerEvent<HTMLDivElement>) => {
    const main = scroller.current;
    const knob = thumb.current;
    if (!main || !knob || e.target !== e.currentTarget || e.button !== 0) return;
    const down = e.clientY > knob.getBoundingClientRect().top;
    main.scrollBy({ top: (down ? 1 : -1) * main.clientHeight * 0.9, behavior: "smooth" });
  };

  return (
    <div ref={lane} className="float-bar" aria-hidden="true" onPointerDown={page}>
      <div ref={thumb} className="float-thumb" onPointerDown={drag} />
    </div>
  );
}
