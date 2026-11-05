// A list to pick one from, drawn by the page rather than the browser, so it looks like the rest of it.
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "./app";
import { Icon, ThinBar } from "./kit";

// keywords are found by the search but not shown; icon goes before the label, here and in the box, and so does
// tone, a coloured dot (select-dot and its tone in the CSS); note is a line of explanation under the label in the
// list.
export type Option = { value: string; label: string; keywords?: string; icon?: string; tone?: string; note?: string };
const Dot = ({ tone }: { tone?: string }) => (tone ? <span className={`select-dot dot-${tone}`} aria-hidden="true" /> : null);

// The panel's gap from the box and its tallest; a list longer than SEARCH_FROM gets a search box on top.
const GAP = 6;
const TALLEST = 320;
const SEARCH_FROM = 12;

// A box like the text boxes showing the choice, with a chevron that turns as it opens, and a round panel of the
// options under it, the one in use ticked, scrolling with the slim bar. A long list has a search box on top that
// finds a name in either language (keywords). The options go by with the arrow keys and Enter.
//
// The panel is a popover: it stands above everything, a window it is in too, and Escape or a click outside closes
// it. It is put in that window, or in the nearest part of the page that keeps its lists itself (data-popovers: the
// introduction, which gives them its own look, and its conversation, which keeps the site's), or else the page's
// body: inside a label, a click on an option would count as one on the box, and outside an open window it could not
// be clicked at all. It opens under the box, or over it when there is more room above (data-side), and fades and
// grows in and out (styles.css).
//
// compact makes the box a round button with only the choice's icon, named by the label and the choice.
export function Select({ value, options, onChange, label, placeholder, className = "", disabled, compact = false }: {
  value: string; options: Option[]; onChange: (value: string) => void; label?: string; placeholder?: string; className?: string; disabled?: boolean; compact?: boolean;
}) {
  const { t } = useApp();
  const id = useId();
  const box = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const find = useRef<HTMLInputElement>(null);
  // Whether the panel was open as the box was pressed: the press outside it has closed it already then, and the
  // click that follows should not open it again.
  const wasOpen = useRef(false);
  const [home, setHome] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const searching = options.length > SEARCH_FROM;
  const picked = options.find((o) => o.value === value);
  const words = query.trim().toLocaleLowerCase();
  const shown = words ? options.filter((o) => `${o.label} ${o.keywords ?? ""}`.toLocaleLowerCase().includes(words)) : options;
  const current = Math.min(active, shown.length - 1);

  useLayoutEffect(() => { setHome(box.current?.closest("dialog") ?? box.current?.closest<HTMLElement>("[data-popovers]") ?? document.body); }, []);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const toggled = (e: Event) => {
      const opened = (e as ToggleEvent).newState === "open";
      setOpen(opened);
      if (!opened) setQuery("");
    };
    el.addEventListener("toggle", toggled);
    return () => el.removeEventListener("toggle", toggled);
  }, [home]);

  // Open, it closes when the page under it scrolls or the window changes size, as the browser's own does.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!panel.current?.contains(e.target as Node)) panel.current?.hidePopover(); };
    const shut = () => panel.current?.hidePopover();
    addEventListener("scroll", away, true);
    addEventListener("resize", shut);
    return () => { removeEventListener("scroll", away, true); removeEventListener("resize", shut); };
  }, [open]);

  // The option the keys are on stays in sight.
  useEffect(() => {
    const scroller = list.current;
    const row = scroller?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    if (!open || !scroller || !row) return;
    if (row.offsetTop < scroller.scrollTop) scroller.scrollTop = row.offsetTop - 4;
    else if (row.offsetTop + row.offsetHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = row.offsetTop + row.offsetHeight - scroller.clientHeight + 4;
  }, [current, open]);

  const show = () => {
    const el = box.current, pop = panel.current;
    if (!el || !pop || disabled) return;
    const rect = el.getBoundingClientRect();
    const below = innerHeight - rect.bottom - GAP - 8, above = rect.top - GAP - 8;
    const upward = below < Math.min(TALLEST, 220) && above > below;
    // Level with the box's start; a round button's list is wider than it, so it lines up with the button's end
    // instead and opens over what the button sits at the end of.
    const rtl = getComputedStyle(el).direction === "rtl";
    const width = document.documentElement.clientWidth;
    const fromLeft = rtl === compact;
    Object.assign(pop.style, {
      top: upward ? "auto" : `${rect.bottom + GAP}px`, bottom: upward ? `${innerHeight - rect.top + GAP}px` : "auto",
      left: fromLeft ? `${rect.left}px` : "auto", right: fromLeft ? "auto" : `${width - rect.right}px`, minWidth: `${rect.width}px`,
    });
    pop.style.setProperty("--room", `${Math.min(TALLEST, upward ? above : below)}px`);
    pop.dataset.side = upward ? "up" : "down";
    const at = Math.max(0, options.findIndex((o) => o.value === value));
    setActive(at);
    pop.showPopover();
    // Kept inside the window, 8 pixels from its sides, where it would reach past one.
    const shown = pop.getBoundingClientRect();
    if (shown.left < 8) Object.assign(pop.style, { left: "8px", right: "auto" });
    else if (shown.right > width - 8) Object.assign(pop.style, { left: "auto", right: "8px" });
    (find.current ?? list.current)?.focus({ preventScroll: true });
    // The one in use in the middle of the list, as it opens.
    const row = list.current?.querySelector<HTMLElement>(`[data-index="${at}"]`);
    if (row && list.current) list.current.scrollTop = row.offsetTop - (list.current.clientHeight - row.offsetHeight) / 2;
  };
  const pick = (next: string) => {
    onChange(next);
    panel.current?.hidePopover();
    box.current?.focus({ preventScroll: true });
  };
  const keys = (e: React.KeyboardEvent) => {
    const last = shown.length - 1;
    const onList = e.target === list.current;
    if (e.key === "ArrowDown") setActive(Math.min(last, current + 1));
    else if (e.key === "ArrowUp") setActive(Math.max(0, current - 1));
    else if (e.key === "Home" && onList) setActive(0);
    else if (e.key === "End" && onList) setActive(last);
    else if (e.key === "Enter") { if (shown[current]) pick(shown[current].value); }
    else {
      // Tab leaves the list as it does the browser's: closed, on to whatever comes after the box.
      if (e.key === "Tab") { panel.current?.hidePopover(); box.current?.focus({ preventScroll: true }); }
      return;
    }
    e.preventDefault();
  };
  const optionId = (i: number) => (shown[i] ? `${id}-${i}` : undefined);

  return (
    <>
      <button
        ref={box} type="button" className={`select ${open ? "open" : ""} ${className}`} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={compact && picked ? `${label}: ${picked.label}` : label}
        onPointerDown={() => { wasOpen.current = open; }}
        onClick={() => { if (wasOpen.current) wasOpen.current = false; else show(); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); show(); } }}
      >
        {picked?.icon && <Icon name={picked.icon} />}
        <Dot tone={picked?.tone} />
        {!compact && <>
          <span className={`select-value ${picked ? "" : "select-blank"}`}>{picked?.label ?? placeholder}</span>
          <Icon name="down" />
        </>}
      </button>
      {home && createPortal(
        // popover is not in React 18's types yet, so it goes in as a plain attribute.
        <div ref={panel} {...{ popover: "auto" }} className="select-panel" onKeyDown={keys}>
          {searching && (
            // The words at the start, by the page's direction while empty, and the magnifier at the end, like the
            // jobs search's box.
            <label className="select-find">
              <input
                ref={find} type="text" dir={query ? "auto" : undefined} value={query} placeholder={t("common.search")} aria-label={t("common.search")}
                role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={optionId(current)}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              />
              <Icon name="find" />
            </label>
          )}
          <div className="select-scroll">
            <div ref={list} id={`${id}-list`} className="select-list" role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={searching ? undefined : optionId(current)}>
              <div>
                {shown.map((o, i) => (
                  <div
                    key={o.value} id={`${id}-${i}`} data-index={i} role="option" aria-selected={o.value === value} className={`select-option ${i === current ? "active" : ""}`}
                    onPointerMove={() => { if (i !== current) setActive(i); }} onClick={() => pick(o.value)}
                  >
                    {o.icon && <Icon name={o.icon} />}
                    <Dot tone={o.tone} />
                    <span className="select-label">{o.label}{o.note && <small className="select-note">{o.note}</small>}</span>
                    {o.value === value && <Icon name="check" />}
                  </div>
                ))}
                {!shown.length && <p className="select-empty">{t("common.noMatch")}</p>}
              </div>
            </div>
            {open && <ThinBar target={list} />}
          </div>
        </div>,
        home,
      )}
    </>
  );
}
