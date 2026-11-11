import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { store, stored, useApp, type AppState } from "../app";
import { ActLabel, AiSky, api, Icon, safeUrl, Spaced, ThinBar, useGoSlot } from "../kit";
import { SaveNote, useAutoSave } from "../autosave";
import { useMore } from "../more";
import { Pip, PipLying, PipMark, PipMiner } from "../pip";
import { roleLabel, type Role } from "../../roles";
import { jobId } from "../jobid";
import { MAKERS, useFirstAi } from "./chat";
import { openJob, sendOpen } from "./job";
import { areaName, AreasEditor, marketLabel, MarketsEditor } from "./settings";

export type Job = { id?: string; key?: string; title: string; company: string; location: string; tier: string; date: string; url: string; score?: number | null; verdict?: string; status?: string };

// How many jobs a list of them shows at first, and how many more each time its end comes near the bottom of the
// screen (ui/more.tsx): each row has its own live AI button.
const JOBS_STEP = 20;
// A row's place for its rise in one after another (--i): the first rows' own, and 0 for those that come as the list is
// scrolled down, which come at once rather than after the rows before them, mostly out of sight.
const rising = (i: number) => (i < JOBS_STEP ? i : 0);

// Kept between visits to the screen, so leaving and coming back does not lose the results.
// round counts the searches, so each one's results rise in afresh; chosen is whether the user's saved choices of
// days, market, mode and areas have been taken in yet.
const search = { q: null as string | null, days: "14", market: "all", mode: "", areas: "relevant", results: null as Job[] | null, failed: [] as string[], busy: false, round: 0, chosen: false };

export const TIER_TONE: Record<string, string> = { near: "good", ok: "good", edge: "warn", far: "bad", unknown: "" };

// Whether a job is among those the user saved, and a click that saves it or takes it off (saved.ts).
export function useSave() {
  const { s, refresh } = useApp();
  const urls = new Set((s.saved ?? []).map((j) => j.url));
  const toggle = (job: Pick<Job, "url" | "title" | "company" | "location" | "date">) =>
    api("saved", { url: job.url, title: job.title, company: job.company, location: job.location, date: job.date, save: !urls.has(job.url) }).then(() => refresh()).catch(() => {});
  return { isSaved: (url: string) => urls.has(url), toggle };
}

// How long ago a job was posted, in words: today, yesterday, so many days or weeks ago; past two months, the date.
export function postedAgo(date: string, t: (key: string, params?: Record<string, string | number>) => string) {
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
export function tint(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `var(--sky-${(h % 6) + 1})`;
}

// The company's initial on a round tile, in its forest colour, at the start of a job's row.
export function Initial({ name }: { name: string }) {
  const initial = [...name.trim()].find((ch) => /[\p{L}\p{N}]/u.test(ch))?.toUpperCase() ?? "?";
  return <span className="result-mark" aria-hidden="true" style={{ "--tint": tint(name) } as React.CSSProperties}>{initial}</span>;
}

// A job as a plain row, like a search engine's result: what leads it (the company's initial, or Pip's score), the
// title, the company and place, chips, and three round buttons at its end, to save it, open the posting, and apply.
// Applying is the AI's work: its paper plane is in its neighbours' grey, with the AI's colours as a soft light along
// the inside of its rim (.apply-rim in styles.css). Under the pointer, or reached by the keyboard, a button's name
// floats over it. index is its place in the list, for rising in one after another; faded, a job just taken off the
// saved list, kept in its place.
// rank: a job of Pip's not ranked yet has a button that ranks it on its own (RankOne), turning while that runs.
// The title opens the job's own page (views/job.tsx), and so does a click anywhere on the row but its buttons.
function JobRow({ job, index, lead, chips, faded = false, rank }: {
  job: Job; index: number; lead: React.ReactNode; chips?: React.ReactNode; faded?: boolean; rank?: { busy: boolean; onRank: () => void };
}) {
  const id = jobId(job.url);
  const basics = { url: job.url, title: job.title, company: job.company, location: job.location, date: job.date };
  return (
    <article className={`result ${faded ? "faded" : ""} ${id ? "opens" : ""}`} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
      {lead}
      <div className="result-text">
        <h3 className="result-title">
          {id ? (
            <a className="result-open" href={`/job/${id}`}
              onClick={(e) => {
                // A new tab or window opens the page there; the job is told to the server first, so it has it.
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { sendOpen(basics); return; }
                e.preventDefault();
                openJob(basics);
              }}
              onAuxClick={() => sendOpen(basics)}>{job.title}</a>
          ) : job.title}
        </h3>
        <p className="result-meta"><Spaced parts={[job.company, job.location].filter(Boolean)} /></p>
        <div className="result-chips">{chips}</div>
      </div>
      <JobActions job={job} rank={rank} />
    </article>
  );
}

// A job's round buttons, on its row and on its own page: save it, open its posting on its site, rank it (a job of
// Pip's not ranked yet, on its row), and apply.
export function JobActions({ job, rank }: { job: Pick<Job, "url" | "title" | "company" | "location" | "date">; rank?: { busy: boolean; onRank: () => void } }) {
  const { t, start } = useApp();
  const { isSaved, toggle } = useSave();
  const on = isSaved(job.url);
  const href = safeUrl(job.url);
  if (!href) return null;
  return (
    <div className="result-actions">
      <button type="button" className={`result-act save ${on ? "on" : ""}`} aria-pressed={on} aria-label={`${on ? t("jobs.unsave") : t("jobs.save")}: ${job.title}`} onClick={() => toggle(job)}>
        <Icon name="saved" filled={on} /><ActLabel>{on ? t("jobs.savedOne") : t("jobs.save")}</ActLabel>
      </button>
      <a className="result-act" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${t("jobs.open")}: ${job.title}`}>
        <Icon name="open" /><ActLabel>{t("jobs.open")}</ActLabel>
      </a>
      {rank && (
        <button type="button" className={`result-act rank-one ${rank.busy ? "busy" : ""}`} aria-label={`${t(rank.busy ? "jobs.rankingOne" : "jobs.rankOne")}: ${job.title}`}
          aria-busy={rank.busy} disabled={rank.busy} onClick={rank.onRank}>
          {rank.busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="gauge" />}
          <ActLabel>{t(rank.busy ? "jobs.rankingOne" : "jobs.rankOne")}</ActLabel>
        </button>
      )}
      <button type="button" className="result-act apply" aria-label={`${t("jobs.apply")}: ${job.title}`} onClick={() => start(`/apply ${job.url}`)}>
        <span className="apply-rim" aria-hidden="true" /><Icon name="apply" /><ActLabel>{t("jobs.apply")}</ActLabel>
      </button>
    </div>
  );
}

// A search result: the company's initial, and chips for how long ago it was posted and its area.
function ResultRow({ job, index }: { job: Job; index: number }) {
  const { t, s } = useApp();
  const showTier = !(job.tier === "unknown" && !s.settings.areas?.length);
  return (
    <JobRow job={job} index={index} lead={<Initial name={job.company || job.title || "?"} />} chips={<>
      {job.date && <span className="result-chip">{postedAgo(job.date, t)}</span>}
      {showTier && <span className={`result-chip ${TIER_TONE[job.tier] ?? ""}`}>{t(`tiers.${job.tier}`)}</span>}
    </>} />
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

// What Pip found that is still worth a look, in the areas wanted, the best scored first: what the ranking reads, not
// what the AI skipped, nor the expired.
const pipFound = (jobs: Record<string, any>[]) => jobs.filter((j) => j.tier !== "far" && j.status !== "skipped" && j.status !== "expired")
  .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || String(b.date).localeCompare(String(a.date)));

// Behind the search, only gradients, as if alive: a forest rainbow (the --sky colours, a sunny forest's by day and
// the night forest's at night) as six clouds that drift, turn and stretch round a breathing glow, blending as they
// pass, each on its own slow course.
export const Sky = () => (
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

// The extra roles unfold from the + button along a curve, like a Dock stack, in one column. Only as many go down as
// fit above the bottom of the window; when more are left, the last place says how many, and opens the list of every
// role, in a menu like the search settings', rather than a second column. Keeping the fan mounted lets it fold back
// into the button too; closed items are hidden from focus and assistive technology.
function RoleSuggestions({ onPick }: { onPick: (query: string) => void }) {
  const { s, t, lang } = useApp();
  const roles = (s.settings.roles ?? []) as Role[];
  const few = useFewRoles();
  const extra = roles.slice(few);
  const [open, setOpen] = useState(false);
  // The list of every role: open, fading away as the search settings' menu does (closing), or gone.
  const [list, setList] = useState<"" | "open" | "closing">("");
  const listOpen = list === "open";
  const expanded = open || listOpen;
  const [room, setRoom] = useState({ width: 600, height: 400 });
  const stack = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fan = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const listTimer = useRef<ReturnType<typeof setTimeout>>();
  const id = useId();
  const listId = useId();

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
  }, [open, listOpen, lang, few]);

  // When they don't all fit down the window, the last place goes to the pill for the rest.
  const fits = Math.max(1, Math.floor((room.height - FAN_PAD + 8) / FAN_PITCH));
  const shown = extra.length > fits ? extra.slice(0, fits - 1) : extra;
  const rest = extra.length - shown.length;
  const length = shown.length + (rest > 0 ? 1 : 0);
  const curve = Math.round(Math.min(56, room.width * 0.12));
  const widest = Math.max(72, Math.floor(room.width - curve - 14));

  // The column folds back towards the button: how far across it is from the button's end.
  useLayoutEffect(() => {
    const button = trigger.current?.getBoundingClientRect();
    const column = fan.current?.querySelector<HTMLElement>(".role-fan-col");
    if (!button || !column) return;
    const box = column.getBoundingClientRect();
    column.style.setProperty("--fan-fold-x", `${Math.round(lang === "he" ? button.left - box.left : button.right - box.right)}px`);
  }, [length, room, lang]);

  useEffect(() => () => clearTimeout(listTimer.current), []);
  // Everything closes: the fan folds back, and the list fades away first, unless motion is reduced.
  const close = () => {
    setOpen(false);
    if (list !== "open") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setList(""); return; }
    setList("closing");
    listTimer.current = setTimeout(() => setList(""), MENU_OUT_MS);
  };

  useEffect(() => {
    if (!expanded) return;
    const away = (e: PointerEvent) => { if (!stack.current?.contains(e.target as Node)) close(); };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); trigger.current?.focus(); }
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", escape);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", escape); };
  }, [open, list]);

  const pick = (query: string) => {
    close();
    trigger.current?.focus();
    onPick(query);
  };
  // The fan's last place opens the list in the fan's stead. Focus goes into it, since the place that opened it folds
  // away: onto its first role when the keyboard opened it, and otherwise onto the list itself, which shows no ring.
  const openList = (keyboard: boolean) => {
    clearTimeout(listTimer.current);
    setOpen(false);
    setList("open");
    requestAnimationFrame(() => (keyboard ? rows.current?.querySelector<HTMLButtonElement>("button") : rows.current)?.focus());
  };
  // Up and down go through the roles in order, in the fan or in the list (from the list itself, to its first or its
  // last); Home and End go to the first and the last.
  const navigate = (e: React.KeyboardEvent<HTMLElement>) => {
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const index = buttons.indexOf(e.target as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1
      : e.key === "ArrowDown" ? (index + 1) % buttons.length
      : e.key === "ArrowUp" ? (index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length) : -1;
    if (next >= 0) { e.preventDefault(); buttons[next]?.focus(); }
  };
  // A place in the fan: how far it bends and tilts, where it folds back to, and when it moves in its turn.
  const fanItem = (row: number) => {
    const progress = (row + 1) / length;
    return {
      "--fan-x": `${Math.round(progress * progress * curve)}px`,
      "--fan-angle": `${(progress * 12).toFixed(1)}deg`,
      "--fan-fold": `${-row * FAN_PITCH - 30}px`,
      "--fan-in": `${Math.min(row, 12) * 25}ms`,
      "--fan-out": `${Math.min(length - row - 1, 12) * 18}ms`,
    } as React.CSSProperties;
  };

  return (
    <div className="seek-pills">
      {roles.slice(0, few).map((role) => (
        <button key={role.query} type="button" className="seek-pill" dir="auto" onClick={() => onPick(role.query)}>
          <span className="role-label">{roleLabel(role, lang)}</span>
        </button>
      ))}
      {extra.length > 0 && (
        <div className="role-stack" data-open={open} data-list={listOpen} ref={stack}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close(); }}>
          <button ref={trigger} type="button" className="seek-pill seek-pill-more" aria-expanded={expanded} aria-controls={id}
            aria-label={t(expanded ? "jobs.closeRoles" : "jobs.moreRoles", { n: extra.length })}
            onClick={() => (expanded ? close() : setOpen(true))}
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
            <div className="role-fan-col">
              {shown.map((role, row) => (
                <button key={role.query} type="button" className="seek-pill role-fan-item" style={fanItem(row)}
                  tabIndex={open ? 0 : -1} onClick={() => pick(role.query)}>
                  <span className="role-label" dir="auto">{roleLabel(role, lang)}</span>
                </button>
              ))}
              {rest > 0 && (
                <button type="button" className="seek-pill role-fan-item role-fan-rest" style={fanItem(shown.length)}
                  tabIndex={open ? 0 : -1} aria-expanded={listOpen} aria-controls={listId} onClick={(e) => openList(e.detail === 0)}>
                  <Icon name="dots" /><span className="role-label">{t("jobs.moreRoles", { n: rest })}</span>
                </button>
              )}
            </div>
          </div>
          {list && (
            <div id={listId} className={`seek-panel role-list${list === "closing" ? " closing" : ""}`} role="group" aria-label={t("jobs.allRoles")}
              style={{ "--room": `${room.height}px` } as React.CSSProperties}>
              <div className="role-list-scroll">
                <div ref={rows} className="role-list-rows" tabIndex={-1} onKeyDown={navigate}>
                  {roles.map((role) => (
                    <button key={role.query} type="button" className="role-list-row" onClick={() => pick(role.query)}>
                      <span className="role-label" dir="auto">{roleLabel(role, lang)}</span>
                    </button>
                  ))}
                </div>
                {listOpen && <ThinBar target={rows} />}
              </div>
            </div>
          )}
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
// How long the sparkles' colours take to go back into them, off the box they took over; matches smart-shrink in
// styles.css.
const SMART_OUT_MS = 300;
// Kept once the sparkles have been pressed and have asked: their name floats over them no more after that.
const SMART_TIP = "smart-tip";
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

// The sparkles' circle under the pointer (styles.css): it won't keep quite round, as if something alive in it were
// trying to get out. Once the pointer has stayed a moment, then every two seconds or so, at random, a whole lump of
// it pushes out a little somewhere new, strains there a moment and draws slowly back into a gentle wobble; once
// the pointer goes, it is round again. Each shape, the circle too, is a ring of points round the
// middle, so the browser can turn one into the next.
const BLOB_POINTS = 96;
const LUMP_WIDTH = 1.1;
// How long the pointer stays on the sparkles before the first lump.
const BLOB_WAIT_MS = 800;
type Wave = { k: number; size: number; turn: number };
type Lump = { at: number; height: number };
// Three gentle waves round it, each turned at random, together a pixel or two.
function wobble(): Wave[] {
  const turn = () => Math.random() * 2 * Math.PI;
  return [
    { k: 2, size: 0.6 + Math.random() * 0.5, turn: turn() },
    { k: 3, size: 0.3 + Math.random() * 0.4, turn: turn() },
    { k: 4, size: 0.2 + Math.random() * 0.2, turn: turn() },
  ];
}
// One lump of 2 to 3 pixels, now and then a smaller second across from it, each over a wide arc, round all the
// way; the far side gives a little, as the mass goes over.
function lumps(): Lump[] {
  const first = Math.random() * 2 * Math.PI;
  const all = [{ at: first, height: 2 + Math.random() }];
  if (Math.random() < 0.2) all.push({ at: first + Math.PI * (0.7 + Math.random() * 0.6), height: 1.5 + Math.random() });
  return all;
}
function blobShape(waves: Wave[] = [], pushes: Lump[] = [], strength = 1) {
  const swell = (off: number) => (off < LUMP_WIDTH ? Math.cos(((off / LUMP_WIDTH) * Math.PI) / 2) ** 2 : 0);
  const points = Array.from({ length: BLOB_POINTS }, (_, i) => {
    const a = (i / BLOB_POINTS) * 2 * Math.PI;
    let r = waves.reduce((r, w) => r + w.size * Math.sin(w.k * a + w.turn), waves.length ? 22.4 : 22);
    for (const lump of pushes) {
      const off = Math.abs(Math.atan2(Math.sin(a - lump.at), Math.cos(a - lump.at)));
      r += lump.height * strength * (swell(off) - 0.25 * swell(Math.PI - off));
    }
    return `calc(50% + ${(r * Math.cos(a)).toFixed(2)}px) calc(50% + ${(r * Math.sin(a)).toFixed(2)}px)`;
  });
  return `polygon(${points.join(", ")})`;
}
function useBlob() {
  const lit = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const moving = useRef<Animation>();
  useEffect(() => () => { clearTimeout(timer.current); moving.current?.cancel(); }, []);
  // From wherever the circle is now (the circle as points, the first time) through the shapes given, keeping the
  // last; the first stretch eased as given.
  const move = (frames: Keyframe[], duration: number, easing: string) => {
    const el = lit.current;
    if (!el) return;
    const from = el.style.clipPath ? getComputedStyle(el).clipPath : blobShape();
    moving.current?.cancel();
    el.style.clipPath = String(frames[frames.length - 1].clipPath);
    moving.current = el.animate([{ clipPath: from, easing }, ...frames], { duration });
  };
  // Out fairly fast most of the way, a last push as it strains, then slowly back in, to the same wobble under the
  // lump; the next a couple of seconds later.
  const lash = () => {
    const waves = wobble(), pushes = lumps();
    move([
      { clipPath: blobShape(waves, pushes, 0.85), offset: 0.25, easing: "ease-in-out" },
      { clipPath: blobShape(waves, pushes), offset: 0.45, easing: "cubic-bezier(0.4, 0, 0.3, 1)" },
      { clipPath: blobShape(waves) },
    ], 1500, "cubic-bezier(0.3, 0.7, 0.4, 1)");
    timer.current = setTimeout(lash, 1800 + Math.random() * 800);
  };
  // A mouse's pointer only, and not with reduced motion; not at once either, but once it has stayed a moment.
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(lash, BLOB_WAIT_MS);
  };
  const leave = () => {
    clearTimeout(timer.current);
    if (lit.current?.style.clipPath) move([{ clipPath: blobShape() }], 450, "ease-out");
  };
  return { lit, enter, leave };
}

// The search, plain like a chat app's first screen: a question, one round box with Pip lying on its top edge,
// and the first few roles in a row of glass buttons, with a + that unfolds the rest. At the box's end, a menu of where
// and how to search, and the sparkles, for the smart search, which uses the settings' AI; once something is typed,
// the search button flies in past them.
function Quick() {
  const { s, t, lang, err, run: inBackground, refresh } = useApp();
  const [, paint] = useState(0);
  const repaint = () => paint((n) => n + 1);
  const [menu, setMenu] = useState<"" | "filters" | "ai">("");
  const [whereOpen, setWhereOpen] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const { markets = [], roles = [], workMode = "any", areas: myAreas = [] } = s.settings;
  search.q ??= "";
  const [q, setQ] = useState(search.q ?? "");
  const typing = q.trim() !== "";
  // The AI the smart search runs on, the settings' first while it is connected (as a new conversation's). The
  // sparkles ask straight away to go ahead with it, as it takes from that AI's quota. Started, it runs in the
  // background, in a conversation of its own listed with the rest, while Pip peeks out at work (run in app.tsx), and
  // the box is itself again; why it couldn't start shows where it was asked, until asked again.
  const ai = MAKERS[useFirstAi()].name;
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const askNote = useId();
  const toggle = (which: "filters" | "ai") => { setMenu(menu === which ? "" : which); setStartError(""); };
  // The sparkles' name floats over them until they have been pressed once, in this browser (kept in its storage, as
  // the theme is): it fades as they take over the box, and is gone once the box is back.
  const [tipDone, setTipDone] = useState(() => stored(SMART_TIP) === "done");
  useEffect(() => {
    if (menu !== "ai" || tipDone) return;
    setTipDone(true);
    store(SMART_TIP, "done");
  }, [menu, tipDone]);
  const tip = !tipDone || menu === "ai";
  const blob = useBlob();
  const smart = () => {
    setStarting(true);
    setStartError("");
    inBackground("/job-scraper").then(() => setMenu("")).catch((e) => setStartError(err(e))).finally(() => setStarting(false));
  };
  // The search button's place, open while something is typed and while the button rolls back out; the settings
  // and the sparkles slide over as it opens and closes (useGoSlot in kit.tsx).
  const slotOpen = useGoSlot(typing, menuBox, ".seek-icon, .seek-ai");
  // A menu closes on a click outside the box's end (outside the box, while the sparkles ask in it), or on Escape.
  const boxRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!(menu === "ai" ? boxRef : menuBox).current?.contains(e.target as Node)) setMenu(""); };
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
    const timer = setTimeout(() => setShut(""), shut === "ai" ? SMART_OUT_MS : MENU_OUT_MS);
    return () => clearTimeout(timer);
  }, [shut]);
  const showing = (which: typeof menu) => menu === which || shut === which;
  const panelClass = (which: typeof menu) => (menu === which ? "" : "closing");
  // Pressed, the sparkles ask in the box itself: their circle melts into it as it grows over all of it, its colours
  // drifting in clouds, their mark staying, then Confirm shows, an outline that fills, and the question with it
  // (styles.css); going, the colours go back into the circle. It grows from their own middle, worked out from
  // where they are laid out in the box (so their slide in useGoSlot doesn't throw it; the row they are in is placed
  // too while they ask) as the asking starts, and shrinks back to it.
  const asking = showing("ai");
  useLayoutEffect(() => {
    const box = boxRef.current, spark = menuBox.current?.querySelector<HTMLElement>(".seek-ai");
    if (!asking || !box || !spark) return;
    let x = spark.offsetWidth / 2, at: Element | null = spark;
    for (; at instanceof HTMLElement && at !== box; at = at.offsetParent) x += at.offsetLeft;
    if (at === box) box.style.setProperty("--from-x", `${x}px`);
  }, [asking]);
  // The first search of a visit: the box and the roles rise from the middle of the page to the top (from where
  // the box was, rise), and the question over them goes down into the box as it rises, fading, gone by the time
  // the box is up. Pip rides up on the box for a moment, frightened, then leaps off it and runs away
  // (EscapingPip). He stays away while the search's results are kept (search, above), so going to another page and
  // back finds the results without him; he is on the box again on the next visit, which starts without a search.
  const page = useRef<HTMLDivElement>(null);
  const rise = useRef<{ box: number; title: number } | null>(null);
  const [pip, setPip] = useState<{ phase: "rest" | "scared" | "escape" | "gone"; x?: number; y?: number }>(() => ({ phase: search.results !== null || search.busy ? "gone" : "rest" }));
  const asked = search.results !== null || search.busy;
  useLayoutEffect(() => {
    const before = rise.current;
    rise.current = null;
    const box = page.current?.querySelector<HTMLElement>(".seek-box");
    const title = page.current?.querySelector<HTMLElement>(".seek-title");
    if (before === null || !box) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setPip({ phase: "gone" }); return; }
    const easing = "cubic-bezier(0.45, 0, 0.25, 1)";
    const now = box.getBoundingClientRect();
    const dy = before.box - now.top;
    for (const el of page.current!.querySelectorAll<HTMLElement>(":scope > .seek-box, :scope > .seek-pills")) {
      el.animate([{ translate: `0 ${dy}px` }, { translate: "0 0" }], { duration: RISE_MS, easing });
    }
    if (title) {
      // From where it was to the middle of the box where it ends up, with the box's easing, so it keeps going down
      // into the box all the way up; it slips under the box's top edge as it fades out.
      const at = title.getBoundingClientRect();
      const into = now.top + now.height / 2 - at.height / 2 - at.top;
      title.animate([{ translate: `0 ${before.title - at.top}px`, scale: 1 }, { translate: `0 ${into}px`, scale: 0.6 }], { duration: RISE_MS, easing });
      title.animate([{ opacity: 1 }, { opacity: 0 }], { duration: RISE_MS * 0.55, easing: "ease-in" });
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
    : <Spaced parts={markets.map((m: any) => (m.city ? `${m.city}, ${marketLabel(m, lang, t)}` : marketLabel(m, lang, t)))} />;

  const run = async (query = q) => {
    if (!asked) {
      const box = page.current?.querySelector(".seek-box")?.getBoundingClientRect();
      const title = page.current?.querySelector(".seek-title")?.getBoundingClientRect();
      rise.current = box ? { box: box.top, title: title?.top ?? box.top } : null;
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
  // A new search, or other areas shown (which changes the list at once), starts again from its top.
  const at = useMore(shown.length, JOBS_STEP, `${search.round}|${search.areas}`);

  return (
    <>
      <div ref={page} className={`seek ${asked ? "asked" : ""}`}>
        <Sky />
        {pip.phase === "escape" && <EscapingPip x={pip.x!} y={pip.y!} onGone={() => setPip({ phase: "gone" })} />}
        {whereOpen && <WhereDialog onClose={() => setWhereOpen(false)} />}
        <h1 className="seek-title">{t("jobs.prompt")}</h1>
        <form
          ref={boxRef} className={`seek-box ${typing ? "typing" : ""} ${slotOpen ? "slot-open" : ""} ${asking ? `asking ${panelClass("ai")}` : ""}`}
          onSubmit={(e) => { e.preventDefault(); setMenu(""); if (typing) run(); }}
        >
          {(pip.phase === "rest" || pip.phase === "scared") && <PipLying className="seek-pip" scared={pip.phase === "scared"} />}
          {/* The sparkles' colours over the whole box while they ask, and their glow about it. */}
          {asking && <>
            <span className="smart-glow" aria-hidden="true" />
            <span className="smart-sky" aria-hidden="true">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <span key={n} className={`smart-blob smart-blob-${n}`} />)}
            </span>
          </>}
          {/* The words to search for, and in their place while the sparkles ask, their question: what the smart
              search will go over now, and that it takes from the quota of the AI it runs on, which the server does
              it with (scraper.ts), or why it couldn't start. Ranking what it found is on the saved jobs page, by the
              list. */}
          <div className="seek-field">
            {/* Empty, the box takes the page's direction, so the hint starts on the page's side; typed words take their own. */}
            <input
              type="search" value={q} placeholder={hint} aria-label={t("jobs.query")} dir={q ? "auto" : undefined} disabled={noMarket}
              onChange={(e) => { setQ(e.target.value); search.q = e.target.value; }}
            />
            {asking && (
              <p className="smart-q" id={askNote}>
                <strong>{t("jobs.aiAsk")}</strong>
                {startError
                  ? <small className="error-line" role="alert">{startError}</small>
                  : <small>{roles.length === 1 ? t("jobs.aiAskOne") : t("jobs.aiAskMany", { n: roles.length })} <b>{t("jobs.aiQuota", { ai })}</b></small>}
              </p>
            )}
          </div>
          <div className="seek-tools" ref={menuBox}>
            {/* Confirm's fill is drawn over it with its words again (data-label, in styles.css), so its name is given. */}
            {asking ? (
              <button type="button" className="smart-go" data-label={t("jobs.aiGo")} aria-label={t("jobs.aiGo")} autoFocus aria-describedby={askNote}
                disabled={starting} onClick={smart}>{t("jobs.aiGo")}</button>
            ) : (
              // The search settings, with their name floating over them under the pointer, as the sparkles' does.
              <button type="button" className="seek-icon" aria-label={t("jobs.menu")} aria-expanded={menu === "filters"} onClick={() => toggle("filters")}>
                <Icon name="filters" /><ActLabel>{t("jobs.menuTip")}</ActLabel>
              </button>
            )}
            {/* The sparkles, their colours drifting in clouds as the sky's do (styles.css), with their name floating
                over them under the pointer, as a result's buttons have, until first pressed (tip), and their circle
                pushing out in lumps under it (useBlob); pressed, their
                circle melts into the colours it spreads over the box, and their mark stays, to be pressed again to
                go back. Confirm comes before them, so they keep their place. */}
            <button type="button" className="seek-ai" aria-label={t("jobs.ai", { ai })} aria-expanded={menu === "ai"} onClick={() => toggle("ai")}
              onPointerEnter={blob.enter} onPointerLeave={blob.leave}>
              <span className="seek-ai-lit" ref={blob.lit} aria-hidden="true">
                {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`ai-blob ai-blob-${n}`} />)}
              </span>
              <Icon name="ai" />
              {tip && <ActLabel>{t("jobs.aiTip")}</ActLabel>}
            </button>
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
          </div>
        </form>
        {noMarket ? (
          <p className="seek-note">{t("jobs.needMarket")} <a href="/settings">{t("jobs.toSettings")}</a></p>
        ) : (
          <RoleSuggestions onPick={run} />
        )}
        {search.failed.length > 0 && <p className="error-line">{t("jobs.failed", { list: search.failed.join(", ") })}</p>}
        {search.results !== null && !search.busy && shown.length > 0 && (
          <div key={search.round} className="seek-results">
            <div className="results">{shown.slice(0, at.shown).map((j, i) => <ResultRow key={j.id ?? j.url} job={j} index={rising(i)} />)}</div>
            <div ref={at.end} className="more-end" aria-hidden="true" />
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

// ---------- the saved jobs page ----------

type Saved = AppState["saved"][number];
// A job Pip found: gate is the check it failed when it was left out: its place or its language (the ranking's), or the
// years it asks (years) or its senior title, above a junior search; portal is where it was found (seen_jobs.json).
export type Found = Job & { key: string; deadline?: string; veto?: boolean; gate?: string; years?: number | null; portal?: string; fit?: string };

// The background runs the page waits on, by their conversations' titles (server.ts).
const RANK = "/rank";
const SMART = "/job-scraper";

// Pip's bands for a score (BANDS in tools/rank_state.py): a strong fit from 75, a good one from 60, a fair one from
// 45, and less below that.
export const bandOf = (score: number) => (score >= 75 ? "strong" : score >= 60 ? "good" : score >= 45 ? "fair" : "low");

// The groups Pip's list is shown in, in this order: the strong fits; the good and fair ones; the rest; those with
// nothing to go on yet; and those left out, for their place, their language or the level they ask. A job ranked goes by its
// score; one not ranked yet by the fit the smart search gave it as it was found (scraper.ts: high, medium, low), so
// a list of a thousand not yet ranked is still in its order, the best first.
const GROUPS = ["strong", "worth", "less", "waiting", "out"] as const;
function groupOf(job: Found): (typeof GROUPS)[number] {
  if (job.veto) return "out";
  if (typeof job.score !== "number") return job.fit === "high" ? "strong" : job.fit === "medium" ? "worth" : job.fit === "low" ? "less" : "waiting";
  const band = bandOf(job.score);
  return band === "strong" ? "strong" : band === "low" ? "less" : "worth";
}

// The ranking's score at the start of a job Pip found, on a round tile where a search result has the company's
// initial: green for a strong or good fit, amber for a fair one, grey below, or when the ranking left the job out
// (out). A job not ranked yet has its company's initial there, as everywhere else. fresh is a score just come in
// while the page is open, which pops up.
export function Score({ score, fresh = false, out = false }: { score: number; fresh?: boolean; out?: boolean }) {
  const { t } = useApp();
  return (
    <span className={`result-mark score-mark ${out ? "low" : bandOf(score)} ${fresh ? "fresh" : ""}`} role="img" aria-label={t("jobs.score", { n: score })}>
      {score}
    </span>
  );
}

// Days from today to a date given as YYYY-MM-DD, or null without one.
export function daysTo(date: string | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(+m[1], +m[2] - 1, +m[3]).getTime() - today.getTime()) / 86_400_000);
}

// What a job Pip found says in its chips: that it couldn't be opened, or why the ranking left it out; that it
// closes within the week; how long ago it was posted; and its area.
function FoundChips({ job }: { job: Found }) {
  const { t, s } = useApp();
  const days = daysTo(job.deadline);
  const showTier = Boolean(job.tier) && !(job.tier === "unknown" && !s.settings.areas?.length);
  return <>
    {job.status === "unreachable" && <span className="result-chip warn">{t("jobs.flags.unreachable")}</span>}
    {job.veto && (job.gate === "location" || job.gate === "language" || job.gate === "senior") && <span className="result-chip bad">{t(`jobs.flags.${job.gate}`)}</span>}
    {job.veto && job.gate === "years" && <span className="result-chip bad">{typeof job.years === "number" ? t("jobs.flags.years", { n: job.years }) : t("jobs.flags.yearsSome")}</span>}
    {days !== null && days >= 0 && days <= 7 && (
      <span className="result-chip warn">{days === 0 ? t("jobs.flags.closesToday") : days === 1 ? t("jobs.flags.closesTomorrow") : t("jobs.flags.closesIn", { n: days })}</span>
    )}
    {job.date && <span className="result-chip">{postedAgo(job.date, t)}</span>}
    {showTier && <span className={`result-chip ${TIER_TONE[job.tier] ?? ""}`}>{t(`tiers.${job.tier}`)}</span>}
  </>;
}

// The scores seen on this visit, and those just come in (a job waiting that now has one), for a moment, so each
// pops up as it lands. None the first time round, which is only what was there already.
function useFreshScores(jobs: Found[]) {
  const seen = useRef<Map<string, number | null>>();
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const sign = jobs.map((j) => `${j.key}:${j.score ?? ""}`).join("|");
  useEffect(() => {
    const before = seen.current;
    seen.current = new Map(jobs.map((j) => [j.key, typeof j.score === "number" ? j.score : null]));
    if (!before) return;
    const landed = jobs.filter((j) => typeof j.score === "number" && before.has(j.key) && before.get(j.key) === null).map((j) => j.key);
    if (!landed.length) return;
    setFresh(new Set(landed));
    const timer = setTimeout(() => setFresh(new Set()), 1600);
    return () => clearTimeout(timer);
  }, [sign]);
  return fresh;
}

// The saved list as it shows while the page is open: a job taken off it stays where it was, faded, so the same
// button saves it again; a job newly saved comes in at the top. Once the page is left, those taken off are gone.
function useKeptList(list: Saved[]) {
  const [shown, setShown] = useState(list);
  const sign = list.map((j) => j.url).join("\n");
  useEffect(() => {
    setShown((old) => {
      const now = new Map(list.map((j) => [j.url, j]));
      const added = list.filter((j) => !old.some((o) => o.url === j.url));
      return [...added, ...old.map((j) => now.get(j.url) ?? j)];
    });
  }, [sign]);
  return shown;
}

// Work the AI does, offered over a list: a glass pill like the role buttons on the jobs page, the sparkles' live colours
// in its round mark, and two lines, what it does and what it takes. At work a ring turns round the mark, and while
// that work has a conversation (chat) the pill opens it. Why it couldn't start shows under it.
export function AiAction({ title, note, busy = false, disabled = false, error = "", onClick, chat }: {
  title: string; note: string; busy?: boolean; disabled?: boolean; error?: string; onClick?: () => void; chat?: { id: string; label: string } | null;
}) {
  const inside = (
    <>
      <span className="rank-orb" aria-hidden="true"><AiSky orb />{busy && <span className="rank-ring" />}<Icon name="ai" /></span>
      <span className="rank-text"><strong>{title}</strong><small>{note}</small></span>
    </>
  );
  return (
    <div className="rank-row" aria-live="polite">
      {chat
        ? <a className={`rank-pill ${busy ? "busy" : ""}`} href={`/chat/${chat.id}`} aria-label={`${title} ${chat.label}`}>{inside}</a>
        : <button type="button" className={`rank-pill ${busy ? "busy" : ""}`} disabled={disabled} onClick={onClick}>{inside}</button>}
      {error && <small className="error-line" role="alert">{error}</small>}
    </div>
  );
}

// An empty list: Pip lying on top of what to do about it, as he lies on the search box on the jobs page, and under it
// what the list waits for.
export function Empty({ title, text, after, children }: { title: string; text: string; after?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="saved-empty">
      <div className="saved-empty-stage">
        <PipLying className="saved-empty-pip" />
        {children}
      </div>
      <p><strong>{title}</strong>{text}</p>
      {after}
    </div>
  );
}

// Nothing saved yet: the way to the search, where every job has a save button.
function MineEmpty() {
  const { t } = useApp();
  return (
    <Empty title={t("jobs.mineEmptyTitle")} text={t("jobs.mineEmpty")}>
      <a className="seek-pill saved-empty-go" href="/jobs">{t("home.toJobs")}</a>
    </Empty>
  );
}

// Nothing found yet: the smart search, in the AI's colours, with what it takes under it. It runs in the background
// (run in app.tsx); meanwhile the words say Pip is searching and the button says so too, with a light passing over it,
// and takes no clicks. Why it couldn't start shows under it.
function FoundEmpty({ searching }: { searching: boolean }) {
  const { t, run, err } = useApp();
  const ai = MAKERS[useFirstAi()].name;
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const busy = searching || starting;
  const go = () => {
    setStarting(true);
    setError("");
    run(SMART).catch((e) => setError(err(e))).finally(() => setStarting(false));
  };
  return (
    <Empty
      title={t(busy ? "jobs.smartRunningTitle" : "jobs.foundEmptyTitle")} text={t(busy ? "jobs.smartRunning" : "jobs.foundEmpty")}
      after={<>
        {!busy && <small className="saved-empty-note">{t("jobs.aiQuota", { ai })}</small>}
        {error && <small className="error-line" role="alert">{error}</small>}
      </>}
    >
      <button type="button" className={`ai-pill ${busy ? "busy" : ""}`} disabled={busy} onClick={go}>
        <span className="ai-glow" aria-hidden="true" />
        <AiSky />
        <Icon name="ai" />
        <span>{t(busy ? "jobs.smartRunningPill" : "jobs.runSmart")}</span>
      </button>
    </Empty>
  );
}

// ---------- what the lists are filtered by ----------

// Pip's list and the saved one, each filtered on its own: words in a job's title, company or place; then, for Pip's,
// how well it fits (its group), its area, how lately it was posted, where it was found, whether it closes within the
// week, and the order. Kept for the visit, as the search's results are, so the page left and come back to keeps them.
type Filters = { q: string; fit: string; area: string; days: string; source: string; closing: string; sort: string };
const NO_FILTERS: Filters = { q: "", fit: "all", area: "all", days: "all", source: "all", closing: "all", sort: "fit" };
const MINE_DEFAULT: Filters = { ...NO_FILTERS, sort: "new" };
const filtersKept: Record<"found" | "mine", Filters> = { found: { ...NO_FILTERS }, mine: { ...MINE_DEFAULT } };
// How the search and filters show, while Sean picks one of three quiet ways (user/mockups/my-jobs): q1, a slim
// search with one button for the filters in it; q2, the slim search with the filters as a line of words under it;
// q3, the search and that button on the lists' own row, beside their buttons.
const LOOK = (() => { try { return localStorage.getItem("pip-myjobs-look") ?? "q1"; } catch { return "q1"; } })();

// Where Pip found a job, by the portal its list names (seen_jobs.json): a job site by its name, an employer's own
// page among the companies' sites, anything else as another.
const SOURCE_NAMES: Record<string, string> = {
  "linkedin-search": "LinkedIn", "freehire-search": "freehire", "alljobs-search": "AllJobs", "drushim-search": "Drushim", "jobmaster-search": "JobMaster",
};
const sourceOf = (job: Found) => (SOURCE_NAMES[job.portal ?? ""] ? job.portal! : job.portal === "careers-page" ? "careers" : "other");

// Days since a date given as YYYY-MM-DD, or null without one.
const ageOf = (date: string | undefined) => {
  const days = daysTo(date);
  return days === null ? null : -days;
};
const within = (n: number | null, most: number) => n !== null && n >= 0 && n <= most;
const has = (words: string, ...texts: string[]) => !words || texts.join(" ").toLowerCase().includes(words);

function filterFound(jobs: Found[], f: Filters) {
  const words = f.q.trim().toLowerCase();
  const list = jobs.filter((j) => has(words, j.title, j.company, j.location)
    && (f.fit === "all" || groupOf(j) === f.fit)
    && (f.area === "all" || j.tier === f.area)
    && (f.days === "all" || within(ageOf(j.date), Number(f.days)))
    && (f.source === "all" || sourceOf(j) === f.source)
    && (f.closing === "all" || within(daysTo(j.deadline), 7)));
  return f.sort === "new" ? [...list].sort((a, b) => String(b.date).localeCompare(String(a.date))) : list;
}

function filterMine(jobs: Saved[], f: Filters) {
  const words = f.q.trim().toLowerCase();
  const list = jobs.filter((j) => has(words, j.title, j.company, j.location) && (f.days === "all" || within(ageOf(j.date), Number(f.days))));
  return f.sort === "posted" ? [...list].sort((a, b) => String(b.date).localeCompare(String(a.date))) : list;
}

type Option = [string, string, number?];
type Filter = { key: keyof Filters; label: string; options: Option[] };

// The filters a list has, each a row of choices, with how many jobs each would leave for Pip's groups and areas.
function useFilters(tab: "found" | "mine", jobs: Found[]): Filter[] {
  const { t } = useApp();
  const days: Filter = { key: "days", label: t("jobs.filters.posted"), options: [["all", t("jobs.filters.anyTime")], ...["1", "7", "14", "30"].map((v): Option => [v, t(`jobs.days.d${v}`)])] };
  if (tab === "mine") return [days, { key: "sort", label: t("jobs.filters.sort"), options: [["new", t("jobs.filters.bySaved")], ["posted", t("jobs.filters.byPosted")]] }];
  const count = (test: (j: Found) => boolean) => jobs.filter(test).length;
  const sources = [...new Set(jobs.map(sourceOf))].sort((a, b) => (a === "other" ? 1 : b === "other" ? -1 : a.localeCompare(b)));
  return [
    { key: "fit", label: t("jobs.filters.fit"), options: [["all", t("jobs.filters.all")], ...GROUPS.map((g): Option => [g, t(`jobs.groups.${g}`), count((j) => groupOf(j) === g)]).filter((o) => o[2])] },
    { key: "area", label: t("jobs.filters.area"), options: [["all", t("jobs.filters.all")], ...(["near", "ok", "edge", "unknown"] as const).map((a): Option => [a, t(`tiers.${a}`), count((j) => j.tier === a)]).filter((o) => o[2])] },
    days,
    { key: "source", label: t("jobs.filters.source"), options: [["all", t("jobs.filters.all")], ...sources.map((s): Option => [s, SOURCE_NAMES[s] ?? t(`jobs.filters.${s}`)])] },
    { key: "closing", label: t("jobs.filters.closing"), options: [["all", t("jobs.filters.all")], ["week", t("jobs.filters.thisWeek")]] },
    { key: "sort", label: t("jobs.filters.sort"), options: [["fit", t("jobs.filters.byFit")], ["new", t("jobs.filters.byNew")]] },
  ];
}

// One filter's choices, as the jobs page's search menu has them (Choice), with a count after each where there is one.
function FilterChoice({ filter, value, onPick }: { filter: Filter; value: string; onPick: (v: string) => void }) {
  return (
    <div className="choice" role="radiogroup" aria-label={filter.label}>
      <span className="choice-label">{filter.label}</span>
      <div className="choice-options">
        {filter.options.map(([v, text, n]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} className="choice-option" onClick={() => onPick(v)}>
            {text}{n !== undefined && <span className="choice-count">{n}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// A menu that closes on a click outside its box or on Escape, and stays a moment as it fades (panel-out).
function useMenu<T extends string>(box: React.RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState<T | "">("");
  const [shut, setShut] = useState<T | "">("");
  const close = () => {
    if (open && !matchMedia("(prefers-reduced-motion: reduce)").matches) setShut(open);
    setOpen("");
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) close(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("pointerdown", away);
    addEventListener("keydown", escape);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", escape); };
  });
  useEffect(() => {
    if (!shut) return;
    const timer = setTimeout(() => setShut(""), MENU_OUT_MS);
    return () => clearTimeout(timer);
  }, [shut]);
  const toggle = (which: T) => (open === which ? close() : (setShut(""), setOpen(which)));
  return { open, toggle, close, showing: (which: T) => open === which || shut === which, panel: (which: T) => (open === which ? "" : "closing") };
}

// Over a list, quiet: a slim box finding words in the jobs' titles, companies and places as they are typed, and the
// filters, one way of three while Sean picks (LOOK): behind one button in the box (q1, q3), or as a line of words
// under it, each opening its own choices (q2). Nothing else shows until a filter is in use; then what is in use, a
// way to clear it, and how many jobs are left of how many.
function ListBar({ tab, filters, value, onChange, shown, total }: {
  tab: "found" | "mine"; filters: Filter[]; value: Filters; onChange: (f: Filters) => void; shown: number; total: number;
}) {
  const { t } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const menu = useMenu<string>(box);
  const base = tab === "mine" ? MINE_DEFAULT : NO_FILTERS;
  const set = (key: keyof Filters) => (v: string) => onChange({ ...value, [key]: v });
  const used = filters.filter((f) => value[f.key] !== base[f.key]);
  const nameOf = (f: Filter) => f.options.find(([v]) => v === value[f.key])?.[1] ?? "";
  const words = LOOK === "q2";
  return (
    <div className={`list-bar look-${LOOK}`} ref={box}>
      <div className="list-search">
        <Icon name="find" />
        <input type="search" value={value.q} placeholder={t(tab === "found" ? "jobs.filters.findFound" : "jobs.filters.findMine")} aria-label={t("jobs.filters.find")}
          dir={value.q ? "auto" : undefined} onChange={(e) => set("q")(e.target.value)} />
        {value.q && <button type="button" className="list-x" aria-label={t("jobs.filters.clearWords")} onClick={() => set("q")("")}><Icon name="close" /></button>}
        {!words && (
          <button type="button" className={`list-filter ${used.length ? "on" : ""}`} aria-expanded={menu.open === "menu"} onClick={() => menu.toggle("menu")}>
            <Icon name="filters" /><span>{t("jobs.filters.button")}</span>{used.length > 0 && <span className="list-filter-n">{used.length}</span>}
          </button>
        )}
        {!words && menu.showing("menu") && (
          <div className={`seek-panel seek-filters ${menu.panel("menu")}`} role="group" aria-label={t("jobs.filters.menu")}>
            {filters.map((f) => <FilterChoice key={f.key} filter={f} value={value[f.key]} onPick={set(f.key)} />)}
          </div>
        )}
      </div>
      {words && (
        <div className="list-words">
          {filters.map((f) => (
            <div key={f.key} className="list-word-slot">
              <button type="button" className={`list-word ${used.includes(f) ? "on" : ""}`} aria-expanded={menu.open === f.key} onClick={() => menu.toggle(f.key)}>
                {f.label}{used.includes(f) && <b>{nameOf(f)}</b>}<Icon name="down" />
              </button>
              {menu.showing(f.key) && (
                <div className={`seek-panel seek-filters list-word-panel ${menu.panel(f.key)}`} role="group" aria-label={f.label}>
                  <FilterChoice filter={f} value={value[f.key]} onPick={(v) => { set(f.key)(v); menu.close(); }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {(used.length > 0 || value.q) && (
        <div className="list-found">
          <span>{t("jobs.filters.left", { n: shown, all: total })}</span>
          {!words && used.map((f) => (
            <button key={f.key} type="button" className="result-chip list-used" onClick={() => set(f.key)(base[f.key])}>{nameOf(f)}<Icon name="close" /></button>
          ))}
          <button type="button" className="list-clear" onClick={() => onChange({ ...base })}>{t("jobs.filters.clear")}</button>
        </div>
      )}
    </div>
  );
}

// Nothing left once filtered: what to do about it.
function NoneLeft({ onClear }: { onClear: () => void }) {
  const { t } = useApp();
  return (
    <div className="list-none">
      <strong>{t("jobs.filters.noneTitle")}</strong>
      <button type="button" className="seek-pill" onClick={onClear}>{t("jobs.filters.clear")}</button>
    </div>
  );
}

// The jobs the user saved, filtered, newest saved first unless posted is asked for, more as the list is scrolled
// down, each led by its company's initial and saying how long ago it was posted; one taken off stays, faded, until
// the page is left.
function MineList({ f, onClear }: { f: Filters; onClear: () => void }) {
  const { s, t } = useApp();
  const { isSaved } = useSave();
  const all = useKeptList(s.saved ?? []);
  const shown = filterMine(all, f);
  const at = useMore(shown.length, JOBS_STEP, JSON.stringify(f));
  if (!all.length) return <MineEmpty />;
  return (
    <>
      {!shown.length ? <NoneLeft onClear={onClear} /> : (
        <div className="results">
          {shown.slice(0, at.shown).map((job, i) => {
            const off = !isSaved(job.url);
            return (
              <JobRow key={job.url} job={{ ...job, tier: "" }} index={rising(i)} faded={off} lead={<Initial name={job.company || job.title || "?"} />} chips={<>
                {off && <span className="result-chip">{t("jobs.flags.removed")}</span>}
                {job.date && <span className="result-chip">{postedAgo(job.date, t)}</span>}
              </>} />
            );
          })}
        </div>
      )}
      <div ref={at.end} className="more-end" aria-hidden="true" />
    </>
  );
}

// A job of Pip's ranked on its own, its button turning from the click until its score is in: the server ranks one
// run at a time and puts a job asked for meanwhile next (server.ts), so the button turns while any ranking runs, or
// for a moment after the click before that ranking shows. A job that couldn't be ranked (its page wouldn't open)
// stops turning once no ranking runs. Kept for the visit, so leaving the page and coming back keeps it turning.
const rankAsked = new Map<string, number>();
function useRankOne() {
  const { s, refresh, err, say } = useApp();
  const [, redraw] = useState(0);
  const running = s.sessions.some((x) => x.title === RANK && x.status === "running");
  const busy = (key: string) => {
    const at = rankAsked.get(key);
    return at !== undefined && (running || Date.now() - at < 8000);
  };
  // Asked once more, so the moment after the click ends and the button settles, as no refresh may come by then.
  useEffect(() => {
    if (!rankAsked.size) return;
    const timer = setTimeout(() => redraw((n) => n + 1), 8200);
    return () => clearTimeout(timer);
  });
  const rank = (key: string) => {
    rankAsked.set(key, Date.now());
    redraw((n) => n + 1);
    api("rank", { keys: [key] }).then(() => refresh()).catch((e) => {
      rankAsked.delete(key);
      redraw((n) => n + 1);
      say(err(e), "confused");
    });
  };
  return { busy, rank };
}

// The jobs Pip found, filtered, more as the list is scrolled down: by fit, in groups by how well they fit, each led
// by its score once ranked, best first, each group with jobs shown under its name, which counts the group as
// filtered; by date, one list, newest first. Over them, while some wait to be ranked, the ranking.
function FoundList({ f, onClear }: { f: Filters; onClear: () => void }) {
  const { s, t } = useApp();
  const found = pipFound(s.jobs) as Found[];
  const searching = s.sessions.some((x) => x.title === SMART && x.status === "running");
  const fresh = useFreshScores(found);
  const rankOne = useRankOne();
  const list = filterFound(found, f);
  const grouped = f.sort === "fit";
  const groups = grouped ? GROUPS.map((g) => [g, list.filter((j) => groupOf(j) === g)] as const).filter(([, l]) => l.length > 0) : [["all", list] as const];
  const ordered = groups.flatMap(([group, l]) => l.map((job) => [group, job] as const));
  const at = useMore(ordered.length, JOBS_STEP, JSON.stringify(f));
  if (!found.length) return <FoundEmpty searching={searching} />;
  const shown = ordered.slice(0, at.shown);
  let index = 0;
  const row = (job: Found) => (
    <JobRow key={job.key} job={job} index={rising(index++)} chips={<FoundChips job={job} />}
      rank={typeof job.score === "number" ? undefined : { busy: rankOne.busy(job.key), onRank: () => rankOne.rank(job.key) }}
      lead={typeof job.score === "number"
        ? <Score score={job.score} fresh={fresh.has(job.key)} out={Boolean(job.veto)} />
        : <Initial name={job.company || job.title || "?"} />} />
  );
  return (
    <>
      {!list.length && <NoneLeft onClear={onClear} />}
      {grouped ? groups.filter(([group]) => shown.some(([g]) => g === group)).map(([group, l]) => (
        <section key={group} className="saved-group" aria-labelledby={`saved-group-${group}`}>
          <h2 id={`saved-group-${group}`} className="saved-group-head">
            {t(`jobs.groups.${group}`)}<span className="saved-group-count">{l.length}</span>
          </h2>
          <div className="results">{shown.filter(([g]) => g === group).map(([, job]) => row(job))}</div>
        </section>
      )) : list.length > 0 && <div className="results">{shown.map(([, job]) => row(job))}</div>}
      <div ref={at.end} className="more-end" aria-hidden="true" />
    </>
  );
}

// My jobs, a tab of their own in the sidebar, in the jobs page's look: the forest rainbow's moving sky behind a
// question-sized title, and under it the two lists, Pip's haul and the jobs the user saved, as two glass buttons that
// say how many each has, the open one in ink; then the open list's search and filters (ListBar), and the list, as
// wide as the search's results. The open list is the page's own, not the address's (which stays /saved): Pip's,
// unless an address from a link names the saved one, and changed only by the two buttons, so saving or removing a job
// never switches it. The arrow keys go from one button to the other. Opened, a list's rows rise in.
export function SavedJobs() {
  const { s, t, arg } = useApp();
  const mine = s.saved ?? [];
  const found = pipFound(s.jobs) as Found[];
  const [tab, setTab] = useState<"found" | "mine">(arg === "mine" ? "mine" : "found");
  const [, redraw] = useState(0);
  const f = filtersKept[tab];
  const change = (next: Filters) => { filtersKept[tab] = next; redraw((n) => n + 1); };
  const clear = () => change({ ...(tab === "mine" ? MINE_DEFAULT : NO_FILTERS) });
  const filters = useFilters(tab, found);
  const shown = tab === "found" ? filterFound(found, f).length : filterMine(mine, f).length;
  useLayoutEffect(() => { if (location.pathname !== "/saved") history.replaceState(null, "", "/saved"); }, []);
  const keys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const other = tab === "mine" ? "found" : "mine";
    setTab(other);
    requestAnimationFrame(() => document.getElementById(`saved-tab-${other}`)?.focus());
  };
  const tabButton = (id: "mine" | "found", label: string, n: number) => (
    <button
      type="button" role="tab" id={`saved-tab-${id}`} aria-controls="saved-panel" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
      className={`seek-pill saved-tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}
    >
      {label}<span className="saved-count">{n}</span>
    </button>
  );
  const bar = (tab === "mine" ? mine.length : found.length) > 0 && (
    <ListBar key={tab} tab={tab} filters={filters} value={f} onChange={change} shown={shown} total={tab === "mine" ? mine.length : found.length} />
  );
  return (
    <div className={`page jobs-page saved-page look-${LOOK}`}>
      <div className="saved-top">
        <Sky />
        <h1 className="saved-title">{t("jobs.savedTitle")}</h1>
        <div className="saved-row">
          <div className="saved-tabs" role="tablist" aria-label={t("jobs.savedTitle")} onKeyDown={keys}>
            {tabButton("found", t("jobs.tabFound"), found.length)}
            {tabButton("mine", t("jobs.tabMine"), mine.length)}
          </div>
          {LOOK === "q3" && bar}
        </div>
      </div>
      <div id="saved-panel" key={tab} role="tabpanel" aria-labelledby={`saved-tab-${tab}`} className="saved-panel">
        {LOOK !== "q3" && bar}
        {tab === "mine" ? <MineList f={f} onClear={clear} /> : <FoundList f={f} onClear={clear} />}
      </div>
    </div>
  );
}
