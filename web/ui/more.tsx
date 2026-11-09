// Long lists a part at a time: the first part, and the next one as the end of what is shown comes up toward the
// bottom of the screen, about a screen ahead, so the list reads as whole while a thousand jobs draw only as many as
// have been scrolled to.
import { useEffect, useState } from "react";

// The nearest box around el that scrolls up and down (the app's main), or null for the page itself. One that only
// scrolls sideways (the applications' table) says auto both ways, so it has to hold more than it shows, too.
function scroller(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const y = getComputedStyle(at).overflowY;
    if ((y === "auto" || y === "scroll") && at.scrollHeight > at.clientHeight) return at;
  }
  return null;
}

// How far below the bottom of the screen the end of a list brings the next part.
const AHEAD = "0px 0px 1200px 0px";

// count things, step at a time: how many to show (shown), and end, for the empty element right after the list
// (.more-end), whose coming that near shows step more. reset says it is another list now (a new search), which starts
// again from the first part.
export function useMore(count: number, step: number, reset: string | number | null = null) {
  const [seen, setSeen] = useState({ reset, shown: step });
  const shown = Math.min(count, seen.reset === reset ? Math.max(seen.shown, step) : step);
  // The element itself, kept as state, so the list's end coming onto the page later than the list's first drawing
  // (the portals page is a spinner until its settings are in) is watched as it comes.
  const [el, end] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el || shown >= count) return;
    // Watched afresh after every part, so a part that still leaves the end that near brings the next one at once.
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen({ reset, shown: shown + step });
    }, { root: scroller(el), rootMargin: AHEAD });
    watch.observe(el);
    return () => watch.disconnect();
  }, [el, shown, count, step, reset]);
  return { shown, end };
}
