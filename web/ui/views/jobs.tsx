import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../app";
import { api, Badge, Btn, Card, ClaudeMark, External, Icon, Page, safeUrl, ThinBar, useGoSlot } from "../kit";
import { SaveNote, useAutoSave } from "../autosave";
import { Pip, PipLying, PipMark, PipMiner } from "../pip";
import { roleLabel, type Role } from "../../roles";
import { areaName, AreasEditor, marketLabel, MarketsEditor } from "./settings";

type Job = { id?: string; key?: string; title: string; company: string; location: string; tier: string; date: string; url: string; score?: number | null; verdict?: string; status?: string };

// Kept between visits to the screen, so leaving and coming back does not lose the results.
// round counts the searches, so each one's results rise in afresh; chosen is whether the user's saved choices of
// days, market, mode and areas have been taken in yet.
const search = { q: null as string | null, days: "14", market: "all", mode: "", areas: "relevant", results: null as Job[] | null, failed: [] as string[], busy: false, round: 0, chosen: false };

export const TIER_TONE: Record<string, string> = { near: "good", ok: "good", edge: "warn", far: "bad", unknown: "" };

function JobRow({ job, saved }: { job: Job; saved?: boolean }) {
  const { t, s, start } = useApp();
  const showTier = !(job.tier === "unknown" && !s.settings.areas?.length);
  return (
    <article className="job">
      <div className="job-main">
        {saved && <div className="score">{job.score ?? "–"}</div>}
        <div>
          <div className="job-title" dir="auto">{job.title}</div>
          <div className="job-meta" dir="auto">{[job.company, job.location, job.date].filter(Boolean).join(" · ")}</div>
          <div className="row">
            {showTier && <Badge tone={TIER_TONE[job.tier] ?? ""}>{t(`tiers.${job.tier}`)}</Badge>}
            {saved && job.verdict && <Badge>{job.verdict}</Badge>}
          </div>
        </div>
      </div>
      <div className="row job-actions">
        <External url={job.url}>{t("jobs.open")}</External>
        {safeUrl(job.url) && <Btn kind="primary" onClick={() => start(`/apply ${job.url}`)}>{t("jobs.apply")}</Btn>}
      </div>
    </article>
  );
}

// How long ago a job was posted, in words: today, yesterday, so many days or weeks ago; past two months, the date.
function postedAgo(date: string, t: (key: string, params?: Record<string, string | number>) => string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return date ?? "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - new Date(+m[1], +m[2] - 1, +m[3]).getTime()) / 86_400_000);
  if (days < 0 || days > 60) return date;
  if (days === 0) return t("jobs.when.today");
  if (days === 1) return t("jobs.when.yesterday");
  if (days === 2) return t("jobs.when.twoDays");
  if (days < 7) return t("jobs.when.days", { n: days });
  if (days < 14) return t("jobs.when.week");
  if (days < 21) return t("jobs.when.twoWeeks");
  return t("jobs.when.weeks", { n: Math.floor(days / 7) });
}

// One of the forest colours for a company, the same one each time it comes up.
function tint(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `var(--sky-${(h % 6) + 1})`;
}

// A search result, as a plain row like a search engine's: the company's initial on a round tile, the title, the
// company and place, chips for how long ago it was posted and its area, and two round buttons at its end, to
// open the posting and to check it and apply; under the pointer, or reached by the keyboard, a button's name
// floats over it. index is its place in the results, for rising in one after another.
function ResultRow({ job, index }: { job: Job; index: number }) {
  const { t, s, start } = useApp();
  const showTier = !(job.tier === "unknown" && !s.settings.areas?.length);
  const href = safeUrl(job.url);
  const name = job.company || job.title || "?";
  const initial = [...name.trim()].find((ch) => /[\p{L}\p{N}]/u.test(ch))?.toUpperCase() ?? "?";
  return (
    <article className="result" style={{ "--i": Math.min(index, 12), "--tint": tint(name) } as React.CSSProperties}>
      <span className="result-mark" aria-hidden="true">{initial}</span>
      <div className="result-text">
        <h3 className="result-title">{job.title}</h3>
        <p className="result-meta">{[job.company, job.location].filter(Boolean).join(" · ")}</p>
        <div className="result-chips">
          {job.date && <span className="result-chip">{postedAgo(job.date, t)}</span>}
          {showTier && <span className={`result-chip ${TIER_TONE[job.tier] ?? ""}`}>{t(`tiers.${job.tier}`)}</span>}
        </div>
      </div>
      {href && (
        <div className="result-actions">
          <a className="result-act" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${t("jobs.open")}: ${job.title}`}>
            <Icon name="open" /><span className="result-act-label" aria-hidden="true">{t("jobs.open")}</span>
          </a>
          <button type="button" className="result-act primary" aria-label={`${t("jobs.apply")}: ${job.title}`} onClick={() => start(`/apply ${job.url}`)}>
            <Icon name="apply" /><span className="result-act-label" aria-hidden="true">{t("jobs.apply")}</span>
          </button>
        </div>
      )}
    </article>
  );
}

// What lies buried in the earth under the results, as small pictures in the page's ink, one character a pixel:
// a fish's and a little dinosaur's skeletons, a bone, a skull, a shell, a gem, a key, a coin, a worm, a boot, a
// bottle, stones and a treasure chest.
const BURIED = [
  ["#...............", "##...#..#..#.##.", ".###########.###", "##...#..#..#.##.", "#..............."],
  ["............##..", "...........#..#.", "..#.#.#.#.####..", ".#########......", "#..#.#.#.#......", "...#...#........", "..##..##........"],
  ["##......##", ".########.", "##......##"],
  ["..#####..", ".#.....#.", "#.##.##.#", "#.##.##.#", "#.......#", ".#.#.#.#.", "..#####.."],
  [".#####.", "#.....#", "#.###.#", "#.#.#.#", "#.#...#", "#.#####", "#......"],
  ["..#..", ".#.#.", "#...#", ".#.#.", "..#.."],
  [".###.......", "#...#######", "#...#..#.#.", ".###......."],
  [".###.", "#.#.#", "#.#.#", "#.#.#", ".###."],
  [".##....##.", "#..#..#..#", "....##...."],
  ["..###...", "..#.#...", "..#.#...", "..#.#...", ".##.###.", "#......#", "########"],
  [".###.", "..#..", "..#..", ".#.#.", "#...#", "#...#", "#...#", "#####"],
  ["..####.", ".#....#", "#.....#", ".#####."],
  [".####.", "#....#", "######"],
  [".#########.", "#.........#", "###########", "#....#....#", "#...###...#", "#....#....#", "#.........#", "###########"],
];
// A buried thing's pixel, and the grain of the specks and strata, in screen pixels.
const EARTH_PX = 5;
// The treasure chest, the last of them, is buried only once.
const CHEST = BURIED.length - 1;
// How far a thing's grey may stray from the earth's, toward white or black.
const EARTH_SHADE = 0.35;

// The earth under the results, almost all white, in light greys around one (its CSS colour), each thing its own
// shade: a ragged line where it begins, sparse specks and faint strata, and the buried things scattered at
// random across it, some fainter
// as if deeper, each kept clear of the others, of the words, of the shaft and of Pip's room. Drawn again whenever
// its size changes; the same each time for a size.
function Earth() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current!;
    const draw = () => {
      const box = el.getBoundingClientRect();
      const { width, height } = box;
      const dpr = devicePixelRatio || 1;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      const g = el.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      let seed = 11;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      // Each thing in its own shade of the grey: up to 35% of the way toward white or toward black.
      const grey = (getComputedStyle(el).color.match(/\d+/g) ?? ["123", "138", "150"]).slice(0, 3).map(Number);
      const shade = () => {
        const f = (rand() * 2 - 1) * EARTH_SHADE, to = f > 0 ? 255 : 0;
        g.fillStyle = `rgb(${grey.map((v) => Math.round(v + (to - v) * Math.abs(f))).join(" ")})`;
      };
      const cols = Math.ceil(width / EARTH_PX), rows = Math.ceil(height / EARTH_PX);
      const dot = (c: number, r: number, w = 1) => g.fillRect(c * EARTH_PX, r * EARTH_PX, w * EARTH_PX, EARTH_PX);
      // Where the earth begins: a line two pixels deep with gaps, and tufts over it.
      for (let c = 0; c < cols; c++) {
        shade();
        g.globalAlpha = 0.6;
        if (rand() < 0.8) dot(c, 3);
        if (rand() < 0.35) dot(c, 4);
        if (rand() < 0.12) dot(c, 2);
        g.globalAlpha = 0.22;
        if (rand() < 0.25) dot(c, 5 + Math.floor(rand() * 3));
      }
      g.globalAlpha = 0.1;
      for (let r = 22; r < rows; r += 16 + Math.floor(rand() * 9)) for (let c = 0; c < cols; c++) if (rand() < 0.45) { shade(); dot(c, r); }
      for (let i = 0; i < (cols * rows) / 90; i++) {
        shade();
        g.globalAlpha = [0.12, 0.2, 0.3][Math.floor(rand() * 3)];
        dot(Math.floor(rand() * cols), 8 + Math.floor(rand() * rows));
      }
      // The buried things, each where it touches nothing kept clear (with room around it), at most one try in
      // twenty failing; flipped or not.
      // Less room around things on a narrow screen, so some still fit.
      const room = width < 600 ? 8 : 24;
      const around = (sel: string) => [...(el.parentElement?.querySelectorAll<HTMLElement>(sel) ?? [])].map((e) => {
        const r = e.getBoundingClientRect();
        return { x0: r.left - box.left - room, y0: r.top - box.top - room, x1: r.right - box.left + room, y1: r.bottom - box.top + room };
      });
      const taken = [...around(".mine-title, .mine-count"), ...around(".mine-shaft"), ...around(".mine-room")];
      const wanted = Math.max(8, Math.min(20, Math.round((width * height) / 34000)));
      const order = BURIED.map((_, i) => i).sort(() => rand() - 0.5);
      const again = order.filter((i) => i !== CHEST);
      for (let n = 0, tries = 0; n < wanted && tries < wanted * 20; tries++) {
        const art = BURIED[n < order.length ? order[n] : again[(n - order.length) % again.length]];
        const w = art[0].length * EARTH_PX, h = art.length * EARTH_PX;
        const x = Math.round((rand() * (width - w - 16) + 8) / EARTH_PX) * EARTH_PX;
        const y = Math.round((40 + rand() * (height - h - 52)) / EARTH_PX) * EARTH_PX;
        const spot = { x0: x - room, y0: y - room, x1: x + w + room, y1: y + h + room };
        if (taken.some((t) => spot.x0 < t.x1 && spot.x1 > t.x0 && spot.y0 < t.y1 && spot.y1 > t.y0)) continue;
        taken.push(spot);
        const flip = rand() < 0.5;
        shade();
        g.globalAlpha = rand() < 0.35 ? 0.35 : 0.65;
        art.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "#") g.fillRect(x + (flip ? row.length - 1 - c : c) * EARTH_PX, y + r * EARTH_PX, EARTH_PX, EARTH_PX); }));
        n++;
      }
      g.globalAlpha = 1;
    };
    draw();
    const sizes = new ResizeObserver(draw);
    sizes.observe(el);
    return () => sizes.disconnect();
  }, []);
  return <canvas ref={canvas} className="mine-earth" aria-hidden="true" />;
}

// The foot of the results: the earth across the whole page, from under the last result down to the page's bottom,
// in black and white, with a shaft and its ladder going down to where Pip, grey in its lamp's light, digs beside
// it; in the middle, a line that this is all of them (or that there were none) and how many there are, with any
// hidden by area.
function ResultsEnd({ count, hidden }: { count: number; hidden: number }) {
  const { t } = useApp();
  return (
    <section className="mine" role="status" style={{ "--i": Math.min(count, 12) } as React.CSSProperties}>
      <Earth />
      <span className="mine-shaft" aria-hidden="true" />
      <span className="mine-room" aria-hidden="true"><PipMiner outline className="mine-pip" /></span>
      <div className="mine-words">
        <p className="mine-title">{t(count ? "jobs.end" : "jobs.endNone")}</p>
        <p className="mine-count">{t("jobs.count", { n: count })}{hidden ? t("jobs.hiddenCount", { n: hidden }) : ""}</p>
      </div>
    </section>
  );
}

function Saved() {
  const { s, t, start } = useApp();
  const jobs = s.jobs.filter((j) => j.tier !== "far" && j.status !== "skipped" && j.status !== "expired")
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || String(b.date).localeCompare(String(a.date)));
  if (!jobs.length) return <Card className="empty">{t("jobs.savedEmpty")}<Btn kind="primary" onClick={() => start("/job-scraper")}>{t("jobs.runSmart")}</Btn></Card>;
  return (
    <>
      <p className="note">{t("jobs.priority")}</p>
      <Card className="joblist">{jobs.map((j) => <JobRow key={j.key} job={j as Job} saved />)}</Card>
    </>
  );
}

// Behind the search, only gradients, as if alive: a forest rainbow (the --sky colours, a sunny forest's by day and
// the night forest's at night) as six clouds that drift, turn and stretch round a breathing glow, blending as they
// pass, each on its own slow course.
const Sky = () => (
  <div className="seek-sky" aria-hidden="true">
    {[1, 2, 3, 4, 5, 6].map((n) => <span key={n} className={`sky-blob sky-blob-${n}`} />)}
    <span className="sky-core" />
  </div>
);

// The box's hint: Pip's line most of the time; every few seconds it rubs itself out, types one of the roles to
// look for, letter by letter, holds it, and types Pip's line back. Still, with reduced motion.
function useHint(line: string, examples: string[]) {
  const [hint, setHint] = useState(line);
  const key = examples.join("|");
  useEffect(() => {
    setHint(line);
    if (!examples.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let live = true;
    const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
    const retype = async (from: string, to: string) => {
      for (let n = from.length; n >= 0 && live; n--) { setHint(from.slice(0, n)); await sleep(24); }
      for (let n = 1; n <= to.length && live; n++) { setHint(to.slice(0, n)); await sleep(55); }
    };
    (async () => {
      await sleep(3500);
      for (let i = 0; live; i++) {
        const example = examples[i % examples.length];
        await retype(line, example);
        await sleep(1800);
        await retype(example, line);
        await sleep(4500);
      }
    })();
    return () => { live = false; };
  }, [line, key]);
  return hint;
}

// How many roles show under the box before the button for the rest: what fits in one row, fewer on a phone.
const NARROW = "(max-width: 520px)";
function useFewRoles() {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useEffect(() => {
    const query = matchMedia(NARROW);
    const change = () => setNarrow(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return narrow ? 2 : 4;
}

// A role in the fan is 40 pixels tall with 8 between; the fan has 12 above its roles and 24 below.
const FAN_PITCH = 48;
const FAN_PAD = 36;

// The extra roles unfold from the + button along a curve, like a Dock stack. Only as many go down as fit above
// the bottom of the window; the rest start another column beside it, further in, with a curve of its own. When
// the columns would not fit across, the curve and the roles narrow. Keeping them mounted lets them fold back
// into the button too; closed items are hidden from focus and assistive technology.
function RoleSuggestions({ onPick }: { onPick: (query: string) => void }) {
  const { s, t, lang } = useApp();
  const roles = (s.settings.roles ?? []) as Role[];
  const few = useFewRoles();
  const extra = roles.slice(few);
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState({ width: 600, height: 400 });
  const stack = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fan = useRef<HTMLDivElement>(null);
  const id = useId();

  // The room under the button down to the window's bottom, and across to the window's far side.
  useLayoutEffect(() => {
    const fit = () => {
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.max(0, (lang === "he" ? innerWidth - box.left : box.right) - 16);
      const height = Math.max(0, innerHeight - box.bottom - 8 - 16);
      setRoom((old) => old.width === width && old.height === height ? old : { width, height });
    };
    fit();
    addEventListener("resize", fit);
    addEventListener("scroll", fit, true);
    return () => { removeEventListener("resize", fit); removeEventListener("scroll", fit, true); };
  }, [open, lang, few]);

  const perColumn = Math.max(1, Math.floor((room.height - FAN_PAD + 8) / FAN_PITCH));
  const columns = Array.from({ length: Math.ceil(extra.length / perColumn) }, (_, c) => extra.slice(c * perColumn, (c + 1) * perColumn));
  // The bend is counted once, since the columns bend together; what is left across is shared between them.
  const curve = Math.round(Math.min(56, room.width * 0.12));
  const widest = Math.max(72, Math.floor((room.width - curve - 14 - 12 * (columns.length - 1)) / Math.max(1, columns.length)));
  // Every column bends the same way down its length, so a short last column just stops early.
  const length = Math.min(perColumn, extra.length);

  // A column beside the first folds back towards the button too: how far across it is from the button's end.
  useLayoutEffect(() => {
    const button = trigger.current?.getBoundingClientRect();
    if (!button) return;
    for (const column of fan.current?.querySelectorAll<HTMLElement>(".role-fan-col") ?? []) {
      const box = column.getBoundingClientRect();
      column.style.setProperty("--fan-fold-x", `${Math.round(lang === "he" ? button.left - box.left : button.right - box.right)}px`);
    }
  }, [columns.length, perColumn, room, lang]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!stack.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", escape);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", escape); };
  }, [open]);

  const pick = (query: string) => {
    setOpen(false);
    trigger.current?.focus();
    onPick(query);
  };
  // Up and down go through the roles in order, from one column into the next.
  const navigate = (e: React.KeyboardEvent) => {
    const buttons = Array.from(fan.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const index = buttons.indexOf(e.target as HTMLButtonElement);
    if (index < 0) return;
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1
      : e.key === "ArrowDown" ? (index + 1) % buttons.length
      : e.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : -1;
    if (next >= 0) { e.preventDefault(); buttons[next]?.focus(); }
  };

  return (
    <div className="seek-pills">
      {roles.slice(0, few).map((role) => (
        <button key={role.query} type="button" className="seek-pill" dir="auto" onClick={() => onPick(role.query)}>
          <span className="role-label">{roleLabel(role, lang)}</span>
        </button>
      ))}
      {extra.length > 0 && (
        <div className="role-stack" data-open={open} ref={stack}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
          <button ref={trigger} type="button" className="seek-pill seek-pill-more" aria-expanded={open} aria-controls={id}
            aria-label={t(open ? "jobs.closeRoles" : "jobs.moreRoles", { n: extra.length })}
            onClick={() => setOpen(!open)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown") return;
              e.preventDefault();
              setOpen(true);
              requestAnimationFrame(() => fan.current?.querySelector<HTMLButtonElement>("button")?.focus());
            }}>
            <Icon name="plus" /><span>{t("jobs.moreRoles", { n: extra.length })}</span>
          </button>
          <div id={id} ref={fan} className="role-fan" role="group" aria-label={t("jobs.otherRoles")} aria-hidden={!open}
            style={{ "--fan-curve": `${curve}px`, "--fan-widest": `${widest}px` } as React.CSSProperties} onKeyDown={navigate}>
            {columns.map((column, c) => (
              <div key={c} className="role-fan-col">
                {column.map((role, row) => {
                  const i = c * perColumn + row;
                  const progress = (row + 1) / length;
                  const style = {
                    "--fan-x": `${Math.round(progress * progress * curve)}px`,
                    "--fan-angle": `${(progress * 12).toFixed(1)}deg`,
                    "--fan-fold": `${-row * FAN_PITCH - 30}px`,
                    "--fan-in": `${Math.min(i, 12) * 25}ms`,
                    "--fan-out": `${Math.min(extra.length - i - 1, 12) * 18}ms`,
                  } as React.CSSProperties;
                  return (
                    <button key={role.query} type="button" className="seek-pill role-fan-item" style={style}
                      tabIndex={open ? 0 : -1} onClick={() => pick(role.query)}>
                      <span className="role-label" dir="auto">{roleLabel(role, lang)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// One of the search's options in the filters menu: its name over a row of round choices, the one in use filled.
function Choice({ label, value, options, onPick }: { label: string; value: string; options: [string, string][]; onPick: (v: string) => void }) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      <span className="choice-label">{label}</span>
      <div className="choice-options">
        {options.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} className="choice-option" onClick={() => onPick(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

// How long the where window takes to fade away; matches dialog-out in styles.css.
const CLOSE_MS = 160;
// How long a menu at the search box's end takes to fade away; matches panel-out in styles.css.
const MENU_OUT_MS = 130;
// Where to search, changed right on the jobs page in a window like a chat app's settings, rather than on the
// settings screen: the markets and the areas' ratings, each change saved on its own a moment later (and at once
// if the window closes first), with a quiet note by the title of how it went. A native modal dialog, so Escape,
// the × and a click outside close it and the rest of the page waits behind. However it closes, it fades and
// shrinks away first, its dimmed backdrop with it (closing), and only then goes.
function WhereDialog({ onClose }: { onClose: () => void }) {
  const { s, t, lang, refresh } = useApp();
  const [draft, setDraft] = useState(() => structuredClone(s.settings));
  const [closing, setClosing] = useState(false);
  const box = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const title = useId();
  useEffect(() => {
    box.current?.showModal();
    return () => clearTimeout(closeTimer.current);
  }, []);
  const close = () => {
    if (closing) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    setClosing(true);
    closeTimer.current = setTimeout(onClose, CLOSE_MS);
  };
  const update = (fn: (d: any) => void) => { const next = structuredClone(draft); fn(next); setDraft(next); };
  // Each change saves itself a moment later, the rest of the settings as they are.
  const saving = useAutoSave({ markets: draft.markets, areas: draft.areas }, async (where) => {
    await api("settings", { ...s.settings, ...where, language: lang });
    await refresh();
  });
  return (
    <dialog ref={box} className={`where-dialog ${closing ? "closing" : ""}`} aria-labelledby={title}
      onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === box.current) close(); }}>
      <div className="where-sheet">
        <header className="where-head">
          <h2 id={title}>{t("jobs.whereTitle")}</h2>
          <SaveNote state={saving} />
          <button type="button" className="where-close" aria-label={t("common.close")} onClick={close}><Icon name="close" /></button>
        </header>
        <div className="where-scroll">
          <div ref={body} className="where-body">
            <section className="where-section">
              <MarketsEditor draft={draft} update={update} title={<h3>{t("jobs.whereMarkets")}</h3>} />
            </section>
            <section className="where-section">
              <h3>{t("settings.areas")}</h3>
              <AreasEditor draft={draft} update={update} />
            </section>
          </div>
          <ThinBar target={body} />
        </div>
      </div>
    </dialog>
  );
}

// How long the search takes to rise to the top, and how long Pip rides up on it, frightened, before he leaps.
const RISE_MS = 700;
const SCARED_MS = 330;

// Pip running away, standing and frightened, from where he lay (x, the middle of his feet, and y, under them):
// a leap down to the window's bottom, a squash as he lands, then a dash in hops, leaning into it, out past the
// window's edge on the page's end side, away from the sidebar.
function EscapingPip({ x, y, onGone }: { x: number; y: number; onGone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current!;
    const w = el.offsetWidth;
    const away = document.documentElement.dir === "rtl" ? -1 : 1;
    const ground = innerHeight - 14 - y;
    const leap = away * 70;
    const exit = away < 0 ? -w - x : innerWidth + w - x;
    const leapMs = 620;
    const runMs = Math.max(450, Math.abs(exit - leap) / 1.15);
    const total = leapMs + runMs;
    const at = (ms: number) => ms / total;
    const frames: Keyframe[] = [
      { offset: 0, translate: "0 0", scale: "1 1", rotate: "0deg", easing: "ease-out" },
      { offset: at(170), translate: `${leap * 0.3}px -56px`, scale: "1 1", rotate: `${away * -6}deg`, easing: "ease-in" },
      { offset: at(470), translate: `${leap}px ${ground}px`, scale: "1 1", rotate: "0deg" },
      { offset: at(530), translate: `${leap}px ${ground}px`, scale: "1.2 0.8", rotate: "0deg" },
      { offset: at(leapMs), translate: `${leap}px ${ground}px`, scale: "1 1", rotate: `${away * 8}deg` },
    ];
    // The dash: hops of about a hundred pixels, each up and down again.
    const hops = Math.max(3, Math.round(Math.abs(exit - leap) / 100));
    for (let h = 1; h <= hops; h++) {
      const xAt = (k: number) => leap + (exit - leap) * k;
      frames.push({ offset: at(leapMs + runMs * (h - 0.5) / hops), translate: `${xAt((h - 0.5) / hops)}px ${ground - 22}px`, scale: "1 1", rotate: `${away * 8}deg` });
      frames.push({ offset: at(leapMs + runMs * h / hops), translate: `${xAt(h / hops)}px ${ground}px`, scale: "1 1", rotate: `${away * 8}deg` });
    }
    const dash = el.animate(frames, { duration: total, fill: "forwards" });
    dash.finished.then(onGone).catch(() => {});
    // Halfway down the fall the fright has passed: the exclamation mark goes, at once, as a sprite's would.
    const mark = el.querySelector(".pip-alert")?.animate([{ opacity: 0 }, { opacity: 0 }], { delay: 320, duration: total, fill: "forwards" });
    return () => { dash.cancel(); mark?.cancel(); };
  }, []);
  return (
    <div ref={box} className="escape-pip" aria-hidden="true" style={{ left: x - 33, top: y - 63 }}>
      <Pip mood="scared" />
    </div>
  );
}

// The search, plain like a chat app's first screen: a question, one round box with Pip lying on its top edge,
// and the first few roles in a row of glass buttons, with a + that unfolds the rest. At the box's end, a menu of where
// and how to search, and the sparkles, for Pip's two jobs that use Claude; once something is typed, the search
// button flies in past them.
function Quick() {
  const { s, t, lang, err, start, refresh } = useApp();
  const [, paint] = useState(0);
  const repaint = () => paint((n) => n + 1);
  const [menu, setMenu] = useState<"" | "filters" | "ai">("");
  const [whereOpen, setWhereOpen] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const { markets = [], roles = [], workMode = "any", areas: myAreas = [] } = s.settings;
  search.q ??= "";
  const [q, setQ] = useState(search.q ?? "");
  const typing = q.trim() !== "";
  const toggle = (which: "filters" | "ai") => setMenu(menu === which ? "" : which);
  // The search button's place, open while something is typed and while the button rolls back out; the settings
  // and the sparkles slide over as it opens and closes (useGoSlot in kit.tsx).
  const slotOpen = useGoSlot(typing, menuBox, ".seek-icon, .seek-ai");
  // A menu closes on a click outside the box's end, or on Escape.
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!menuBox.current?.contains(e.target as Node)) setMenu(""); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(""); };
    addEventListener("pointerdown", away);
    addEventListener("keydown", escape);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", escape); };
  }, [menu]);
  // A menu that closes stays a moment as it fades away (shut), rather than vanishing; with reduced motion it just
  // goes. Worked out as the menu changes, so the closing one is never taken off the page and put back.
  const [shut, setShut] = useState<typeof menu>("");
  const [lastMenu, setLastMenu] = useState(menu);
  if (lastMenu !== menu) {
    setLastMenu(menu);
    setShut(lastMenu && !matchMedia("(prefers-reduced-motion: reduce)").matches ? lastMenu : "");
  }
  useEffect(() => {
    if (!shut) return;
    const timer = setTimeout(() => setShut(""), MENU_OUT_MS);
    return () => clearTimeout(timer);
  }, [shut]);
  const showing = (which: typeof menu) => menu === which || shut === which;
  const panelClass = (which: typeof menu) => (menu === which ? "" : "closing");
  // The first search of a visit: everything rises from the middle of the page to the top (from where the box
  // was, rise). Pip rides up on the box for a moment, frightened, then leaps off it and runs away (EscapingPip).
  // He is back on the box the next time the page opens.
  const page = useRef<HTMLDivElement>(null);
  const rise = useRef<number | null>(null);
  const [pip, setPip] = useState<{ phase: "rest" | "scared" | "escape" | "gone"; x?: number; y?: number }>({ phase: "rest" });
  const asked = search.results !== null || search.busy;
  useLayoutEffect(() => {
    const before = rise.current;
    rise.current = null;
    const box = page.current?.querySelector<HTMLElement>(".seek-box");
    if (before === null || !box) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setPip({ phase: "gone" }); return; }
    const dy = before - box.getBoundingClientRect().top;
    for (const el of page.current!.querySelectorAll<HTMLElement>(":scope > .seek-title, :scope > .seek-box, :scope > .seek-pills")) {
      el.animate([{ translate: `0 ${dy}px` }, { translate: "0 0" }], { duration: RISE_MS, easing: "cubic-bezier(0.45, 0, 0.25, 1)" });
    }
  }, [asked]);
  // A moment of fright on the rising box, then off it, from where he is by then.
  useEffect(() => {
    if (pip.phase !== "scared") return;
    const timer = setTimeout(() => {
      const lay = page.current?.querySelector(".seek-pip")?.getBoundingClientRect();
      setPip(lay ? { phase: "escape", x: lay.left + lay.width / 2, y: lay.bottom } : { phase: "gone" });
    }, SCARED_MS);
    return () => clearTimeout(timer);
  }, [pip.phase]);
  const noMarket = !markets.length;
  const hint = useHint(t("jobs.hint"), roles.map((r: any) => String(r.query)));
  // The choices in the filters menu are the user's, kept in the saved settings: taken from there once, and saved
  // again whenever one is picked (set, below).
  const saved = s.settings.quickSearch;
  if (!search.chosen && saved) {
    Object.assign(search, { days: saved.days, market: saved.market, mode: saved.mode, areas: saved.areas, chosen: true });
  }
  search.mode ||= workMode;
  if (search.market !== "all" && !markets.some((m: any) => m.code === search.market)) search.market = "all";
  const excluded = myAreas.filter((a: any) => a.tier === "far").map((a: any) => areaName(a.name, lang));
  const where = noMarket ? t("jobs.noMarket")
    : markets.map((m: any) => (m.city ? `${m.city}, ${marketLabel(m, lang, t)}` : marketLabel(m, lang, t))).join(" · ");

  const run = async (query = q) => {
    if (!asked) {
      rise.current = page.current?.querySelector(".seek-box")?.getBoundingClientRect().top ?? null;
      if (pip.phase === "rest") setPip({ phase: "scared" });
    }
    search.q = query;
    setQ(query);
    search.busy = true;
    search.round++;
    repaint();
    try {
      const data = await api(`search?q=${encodeURIComponent(query)}&days=${search.days}&market=${search.market}&mode=${search.mode}`);
      search.results = data.results;
      search.failed = data.failed;
    } catch (e) {
      search.results = [];
      search.failed = [err(e)];
    }
    search.busy = false;
    repaint();
  };
  const set = (key: "days" | "market" | "mode" | "areas") => (value: string) => {
    search[key] = value;
    repaint();
    const quickSearch = { days: search.days, market: search.market, mode: search.mode, areas: search.areas };
    api("settings", { ...s.settings, quickSearch, language: lang }).then(() => refresh()).catch(() => {});
  };
  const results = search.results ?? [];
  const shown = results.filter((j) => {
    if (search.areas === "all") return true;
    if (search.areas === "listed" && myAreas.length) return ["near", "ok", "edge"].includes(j.tier);
    return j.tier !== "far";
  });
  const hidden = results.length - shown.length;

  return (
    <>
      <div ref={page} className={`seek ${asked ? "asked" : ""}`}>
        <Sky />
        {pip.phase === "escape" && <EscapingPip x={pip.x!} y={pip.y!} onGone={() => setPip({ phase: "gone" })} />}
        {whereOpen && <WhereDialog onClose={() => setWhereOpen(false)} />}
        <h1 className="seek-title">{t("jobs.prompt")}</h1>
        <form className={`seek-box ${typing ? "typing" : ""} ${slotOpen ? "slot-open" : ""}`} onSubmit={(e) => { e.preventDefault(); setMenu(""); if (typing) run(); }}>
          {(pip.phase === "rest" || pip.phase === "scared") && <PipLying className="seek-pip" scared={pip.phase === "scared"} />}
          {/* Empty, the box takes the page's direction, so the hint starts on the page's side; typed words take their own. */}
          <input
            type="search" value={q} placeholder={hint} aria-label={t("jobs.query")} dir={q ? "auto" : undefined} disabled={noMarket}
            onChange={(e) => { setQ(e.target.value); search.q = e.target.value; }}
          />
          <div className="seek-tools" ref={menuBox}>
            <button type="button" className="seek-icon" aria-label={t("jobs.menu")} aria-expanded={menu === "filters"} onClick={() => toggle("filters")}><Icon name="filters" /></button>
            <button type="button" className="seek-ai" aria-label={t("jobs.ai")} aria-expanded={menu === "ai"} onClick={() => toggle("ai")}><Icon name="ai" /></button>
            {/* The search button's place, closed until something is typed. */}
            <span className="seek-go-slot">
              <button type="submit" className="seek-go" aria-label={t("jobs.search")} aria-hidden={!typing} tabIndex={typing ? undefined : -1} disabled={!typing || search.busy || noMarket}><Icon name="jobs" /></button>
            </span>
            {/* Where, as a row that opens the window for changing it: the markets, with the areas hidden under them;
                then the search's options as rows of choices. */}
            {showing("filters") && (
              <div className={`seek-panel seek-filters ${panelClass("filters")}`} role="group" aria-label={t("jobs.menu")}>
                <button type="button" className="where-row" onClick={() => { setMenu(""); setWhereOpen(true); }}>
                  <span className="where-mark"><Icon name="pin" /></span>
                  <span className="where-text">
                    <span className="where-place">{where}</span>
                    {excluded.length > 0 && <span className="where-hidden">{t("jobs.hidden", { names: excluded.join(", ") })}</span>}
                  </span>
                  <span className="where-change">{t("jobs.change")}<Icon name="onward" /></span>
                </button>
                {!noMarket && <>
                  {markets.length > 1 && (
                    <Choice label={t("jobs.where")} value={search.market} onPick={set("market")}
                      options={[["all", t("jobs.allMarkets")], ...markets.map((m: any): [string, string] => [m.code, marketLabel(m, lang, t)])]} />
                  )}
                  <Choice label={t("jobs.posted")} value={search.days} onPick={set("days")} options={["1", "7", "14", "30"].map((v): [string, string] => [v, t(`jobs.days.d${v}`)])} />
                  <Choice label={t("jobs.mode")} value={search.mode} onPick={set("mode")} options={["any", "remote", "hybrid", "onsite"].map((v): [string, string] => [v, t(`modes.${v}`)])} />
                  {myAreas.length > 0 && (
                    <Choice label={t("jobs.areaFilter")} value={search.areas} onPick={set("areas")} options={["relevant", "listed", "all"].map((v): [string, string] => [v, t(`jobs.areas.${v}`)])} />
                  )}
                </>}
              </div>
            )}
            {showing("ai") && (
              <div className={`seek-panel seek-ai-panel ${panelClass("ai")}`} role="group" aria-label={t("jobs.ai")}>
                {/* Claude's mark over the two jobs, and a warning that they use the user's Claude tokens. */}
                <header className="ai-head">
                  <span className="ai-claude"><ClaudeMark /></span>
                  <strong>{t("jobs.aiTitle")}</strong>
                </header>
                <p className="ai-warn" role="note"><Icon name="warn" /><span>{t("jobs.aiNote")}</span></p>
                {([["smart", "/job-scraper"], ["rank", "/rank"]] as const).map(([job, command]) => (
                  <button key={job} type="button" className="seek-action" onClick={() => start(command)}>
                    <span className="action-text"><strong>{t(`jobs.${job}`)}</strong><small>{t(`jobs.${job}Note`)}</small></span>
                    <Icon name="onward" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </form>
        {noMarket ? (
          <p className="seek-note">{t("jobs.needMarket")} <a href="#/settings">{t("jobs.toSettings")}</a></p>
        ) : (
          <RoleSuggestions onPick={run} />
        )}
        {search.failed.length > 0 && <p className="error-line">{t("jobs.failed", { list: search.failed.join(", ") })}</p>}
        {search.results !== null && !search.busy && shown.length > 0 && (
          <div key={search.round} className="seek-results">
            <div className="results">{shown.map((j, i) => <ResultRow key={j.id ?? j.url} job={j} index={i} />)}</div>
          </div>
        )}
      </div>
      {/* While it searches, in the middle of the page: Pip's head in a turning ring, nothing written. */}
      {search.busy && (
        <div className="seek-loading" role="status" aria-label={t("jobs.searching")}>
          <span className="seek-ring" aria-hidden="true" />
          <PipMark className="seek-loading-mark" />
        </div>
      )}
      {/* Outside the search's column, so the earth can reach the page's sides and foot. */}
      {search.results !== null && !search.busy && <ResultsEnd key={search.round} count={shown.length} hidden={hidden} />}
    </>
  );
}

// The search on its own page, with no title; the page fills the window, so the earth under the results reaches its
// foot.
export const Jobs = () => <div className="page jobs-page"><Quick /></div>;

// The saved jobs, a tab of their own in the sidebar.
export function SavedJobs() {
  const { s, t } = useApp();
  return <Page title={t("jobs.saved", { n: s.jobs.length })}><Saved /></Page>;
}
