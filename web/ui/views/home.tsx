import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { store, stored, useApp, type AppState } from "../app";
import { paintStill } from "../intro";
import { Btn, goTo } from "../kit";
import { Pip, PipAsleep, pixelPath } from "../pip";

// Small one-colour drawings in the banner's pixel blocks rather than a font's or an icon set's: the tick on a
// stage passed, the numbers, and the pictures on the signs under the banner.
export const PixelArt = ({ rows, className }: { rows: string[]; className: string }) => (
  <svg className={className} viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true">
    <path d={pixelPath(rows)} fill="currentColor" />
  </svg>
);

export const Tick = () => <PixelArt className="tick" rows={[".....X", "....XX", "X..XX.", "XXXX..", ".XX..."]} />;

// The line under the best jobs' heading, like the edge of a cave's mouth: a rocky ridge in the middle with points
// hanging under it, and only a short thin stretch at each end.
const LEDGE = [
  ".............XX...XXX..X...............",
  "..........XXXXXX.XXXXXXXXX.XX..........",
  ".......XXXXXXXXXXXXXXXXXXXXXXXXX.......",
  "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "..XX..XXXX.XXXXXXXXXXXXXXXXX.XXXX..XX..",
  "...X...XX...XXX.XXXXXXX.XXX...XX...X...",
  "........X....X...XXXXX...X.....X.......",
  ".................XXX...................",
  "..................X....................",
];

// A star for new jobs, an envelope for applications sent, a speech bubble for interviews, a cup for offers.
const SIGNS: Record<string, string[]> = {
  fresh: ["....X....", "...XXX...", "XXXXXXXXX", ".XXXXXXX.", "..XXXXX..", ".XXX.XXX.", ".X.....X."],
  sent: ["XXXXXXXXX", "XX.....XX", "X.X...X.X", "X..X.X..X", "X...X...X", "X.......X", "XXXXXXXXX"],
  interview: [".XXXXXXX.", "XXXXXXXXX", "XX.X.X.XX", "XXXXXXXXX", ".XXXXXXX.", "..XX.....", ".X......."],
  offer: ["XXXXXXXXX", "X.XXXXX.X", ".XXXXXXX.", "..XXXXX..", "...XXX...", "....X....", "..XXXXX.."],
};

const DIGITS: Record<string, string[]> = {
  0: [".XX.", "X..X", "X..X", "X..X", "X..X", ".XX."],
  1: [".X.", "XX.", ".X.", ".X.", ".X.", "XXX"],
  2: [".XX.", "X..X", "...X", "..X.", ".X..", "XXXX"],
  3: ["XXX.", "...X", ".XX.", "...X", "...X", "XXX."],
  4: ["..X.", ".XX.", "X.X.", "XXXX", "..X.", "..X."],
  5: ["XXXX", "X...", "XXX.", "...X", "...X", "XXX."],
  6: [".XX.", "X...", "XXX.", "X..X", "X..X", ".XX."],
  7: ["XXXX", "...X", "..X.", "..X.", ".X..", ".X.."],
  8: [".XX.", "X..X", ".XX.", "X..X", "X..X", ".XX."],
  9: [".XX.", "X..X", "X..X", ".XXX", "...X", ".XX."],
  ":": [".", "X", ".", ".", "X", "."],
};
// A number in those digits, a block apart, or a time with its colon. It is only a picture: the list numbers the
// stages for screen readers, and a sign's link says its number.
export function Digits({ n }: { n: number | string }) {
  const glyphs = [...String(n)].map((d) => DIGITS[d]);
  return <PixelArt className="digits" rows={glyphs[0].map((_, y) => glyphs.map((g) => g[y]).join("."))} />;
}

// The login's forest, at rest, behind the home page's card: morning or night with the theme, repainted when
// the banner changes size. The sun or moon sits off to the side, clear of the card in the middle.
function Forest() {
  const { dark } = useApp();
  const ref = useRef<HTMLCanvasElement>(null);
  // Painted before the banner is first on screen, so it never shows as bare sky.
  useLayoutEffect(() => {
    const c = ref.current!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The fade into the page below: its height and the page's colour, both from the stylesheet.
    const paint = () => {
      const css = getComputedStyle(c);
      paintStill(c, dark, 0.15, { height: parseFloat(css.getPropertyValue("--fade")) || 0, color: css.getPropertyValue("--bg").trim() });
    };
    paint();
    let size = "";
    const watch = new ResizeObserver(() => {
      const next = `${c.clientWidth}x${c.clientHeight}`;
      if (next === size) return;
      const firstTime = !size;
      size = next;
      if (firstTime) return;
      clearTimeout(timer);
      timer = setTimeout(paint, 150);
    });
    watch.observe(c);
    return () => { clearTimeout(timer); watch.disconnect(); };
  }, [dark]);
  return <canvas ref={ref} className="hero-forest" aria-hidden="true" />;
}

const SENT = ["applied", "rejected", "no_response", "no response", "withdrawn", "interview", "offer", "hired", "offer_declined", "offer declined"];
const INTERVIEW = ["interview", "offer", "hired", "offer_declined", "offer declined"];
const OFFER = ["offer", "hired", "offer_declined", "offer declined"];

export function appStats(s: AppState) {
  const reached = (set: string[]) => s.applications.filter((a) => set.includes(String(a.status ?? "").toLowerCase())).length;
  return { drafted: reached(["drafted"]), sent: reached(SENT), interview: reached(INTERVIEW), offer: reached(OFFER) };
}


export function nextStep(s: AppState, t: ReturnType<typeof useApp>["t"], start: (p: string) => void) {
  const go = (path: string) => () => goTo(path);
  const step = (name: string, run: () => void, params = {}) => ({
    title: t(`next.${name}Title`, params), text: t(`next.${name}Text`, params), label: t(`next.${name}Label`, params), run,
  });
  const status = (a: Record<string, any>) => String(a.status ?? "").toLowerCase();
  const waiting = s.sessions.find((x) => x.status === "waiting");
  if (waiting) return step("waiting", go(`/chat/${waiting.id}`));
  // The introduction builds the profile; put aside, it opens again from here.
  if (!s.profileReady) return step("profile", go("/welcome"));
  if (!s.settings.markets?.length) return step("markets", go("/settings"));
  const interview = s.applications.find((a) => status(a) === "interview");
  if (interview) return step("interview", () => start(`/interview ${interview.company} ${interview.role}`), { company: interview.company });
  const drafted = s.applications.find((a) => status(a) === "drafted");
  if (drafted) return step("drafted", go("/apps"), { company: drafted.company });
  const top = s.jobs.filter((j) => j.status === "ranked" && j.score !== null && j.tier !== "far" && j.url).sort((a, b) => b.score - a.score)[0];
  if (top) return step("top", () => start(`/apply ${top.url}`), { title: top.title, company: top.company, score: top.score });
  const fresh = s.jobs.filter((j) => j.status === "new" || j.status === "unreachable").length;
  if (fresh) return step("fresh", () => start("/rank"), { n: fresh });
  return step("start", go("/jobs"));
}

// A later stage counts the earlier ones as passed, because someone can apply to a job they found on their own.
function journey(s: AppState, t: ReturnType<typeof useApp>["t"]) {
  const st = appStats(s);
  const ready = s.profileReady && s.settings.markets?.length > 0;
  const made = st.drafted + st.sent;
  const stage = (key: string, n: number, reached: boolean, href: string, done?: string) => ({
    label: t(`home.stages.${key}`), hint: reached ? (done ?? t(`home.stages.${key}Done`, { n })) : t(`home.stages.${key}Todo`), reached, href,
  });
  const stages = [
    stage("meet", 0, ready, "/profile", t("home.stages.meetReady")),
    stage("find", s.jobs.length, s.jobs.length > 0, "/jobs"),
    stage("cv", made, made > 0, "/apps"),
    stage("send", st.sent, st.sent > 0, "/apps"),
    stage("interview", st.interview, st.interview > 0, "/apps"),
    stage("offer", st.offer, st.offer > 0, "/apps"),
  ];
  const furthest = stages.reduce((last, x, i) => (x.reached ? i : last), -1);
  return { stages, current: Math.min(furthest + 1, stages.length - 1), finished: st.offer > 0 };
}

// Pip's walk along the journey. The stage it was last seen on here is kept in the browser, so a stage reached
// while you were on another page shows, when you come back, as Pip hopping on from where you left it, a stage at
// a time, each sign it leaves turning to a tick. The first time, and with reduced motion, it is simply there.
const SEEN = "pip-stage";
// A hop's time and height; the gap to the next stage takes a hop per 100 pixels or so. Before the first hop the
// page finishes fading in, and between stages Pip stops for a moment.
const HOP_MS = 300;
const HOP_PX = 18;
const SETTLE_MS = 700;
const REST_MS = 250;

function useWalk(current: number, list: React.RefObject<HTMLOListElement>) {
  const { shown } = useApp();
  const [at, setAt] = useState<number | null>(null);
  const from = useRef<DOMRect | null>(null);
  const busyUntil = useRef(0);
  const calm = useRef(matchMedia("(prefers-reduced-motion: reduce)").matches).current;
  const pip = () => list.current?.querySelector<SVGSVGElement>(".station-pip") ?? null;

  // Where it starts, once the page is on screen: the stage last seen, if that is behind the one reached now.
  useLayoutEffect(() => {
    if (!shown || at !== null) return;
    const seen = Number(stored(SEEN) ?? NaN);
    setAt(!calm && Number.isInteger(seen) && seen >= 0 && seen < current ? seen : current);
  }, [shown]);

  // A hop, from the sign it stood on to the next one's, in hard steps like a sprite's, and the line between the
  // two filling in under Pip as it goes: the new stage's ::after, across the banner, or down the list on a phone.
  useLayoutEffect(() => {
    if (at === null) return;
    store(SEEN, String(at));
    const start = from.current;
    const el = pip();
    from.current = null;
    if (!start || !el) return;
    const end = el.getBoundingClientRect();
    const dx = start.left - end.left;
    const dy = start.top - end.top;
    const hops = Math.max(1, Math.round(Math.hypot(dx, dy) / 100));
    const ms = hops * HOP_MS;
    const frames = Math.round(ms / 40);
    const line = el.closest(".station");
    const side = Math.abs(dx) >= Math.abs(dy) ? "width" : "height";
    const length = line ? parseFloat(getComputedStyle(line, "::after")[side]) || 0 : 0;
    const walk: Keyframe[] = [];
    const drawn: Keyframe[] = [];
    for (let f = 0; f <= frames; f++) {
      const k = f / frames;
      const phase = (k * hops) % 1;
      walk.push({ translate: `${Math.round(dx * (1 - k))}px ${Math.round(dy * (1 - k) - HOP_PX * 4 * phase * (1 - phase))}px`, easing: "steps(1, end)" });
      drawn.push({ [side]: `${Math.round(length * k)}px`, easing: "steps(1, end)" });
    }
    el.animate(walk, { duration: ms });
    line?.animate(drawn, { duration: ms, pseudoElement: "::after" });
    busyUntil.current = performance.now() + ms;
  }, [at]);

  // On to the next stage while Pip is behind the one reached; straight back if a stage was undone.
  useEffect(() => {
    if (at === null || at === current) return;
    if (at > current || calm) { setAt(current); return; }
    const wait = busyUntil.current ? Math.max(REST_MS, busyUntil.current - performance.now() + REST_MS) : SETTLE_MS;
    const timer = setTimeout(() => { from.current = pip()?.getBoundingClientRect() ?? null; setAt(at + 1); }, wait);
    return () => clearTimeout(timer);
  }, [at, current]);

  return at ?? current;
}

function Hero() {
  const { s, t, start } = useApp();
  const settingsName = String(s.settings.displayName ?? "");
  const next = nextStep(s, t, start);
  const { stages, current, finished } = journey(s, t);
  const list = useRef<HTMLOListElement>(null);
  const place = useWalk(current, list);
  const walking = place !== current;
  // Pip waves on the journey, whatever it is doing elsewhere: nothing here says what it is working on or that a
  // conversation waits for an answer, so neither its working dots nor its blinking "!" would make sense.
  const mood = walking ? "idle" : finished ? "happy" : "wave";
  return (
    <section className="hero">
      <Forest />
      <div className="hero-card">
        <p className="hero-hi">{settingsName ? t("home.hi", { name: settingsName }) : t("home.hiNoName")} {t("home.intro")}</p>
        <h1 dir="auto">{next.title}</h1>
        {/* Each sentence on a line of its own. */}
        <p className="hero-text" dir="auto">{next.text.split(/(?<=[.!?])\s+/).map((line, i) => <span key={i} className="hero-line">{line}</span>)}</p>
        <Btn kind="cta" onClick={next.run}>{next.label}</Btn>
      </div>
      <ol ref={list} className="stations" aria-label={t("home.journey")}>
        {stages.map((stage, i) => {
          const passed = i < place || (finished && !walking && i === place);
          const here = i === place;
          return (
            <li key={i} className={`station ${passed ? "done" : ""} ${here ? "here" : ""}`} aria-current={here ? "step" : undefined}>
              {here && <Pip mood={mood} className="station-pip" />}
              <a href={stage.href}>
                <span className="flag">{passed ? <Tick /> : <Digits n={i + 1} />}</span>
                <span className="station-text"><strong>{stage.label}</strong><small>{stage.hint}</small></span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------- the shelves ----------

// A drawing in several colours: each letter of the rows is one of `colors`, a dot draws nothing.
export const Sprite =({ rows, colors, className }: { rows: string[]; colors: Record<string, string>; className: string }) => (
  <svg className={className} viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true">
    {Object.entries(colors).map(([ch, fill]) => (
      <path key={ch} d={pixelPath(rows.map((row) => [...row].map((c) => (c === ch ? "X" : ".")).join("")))} fill={fill} />
    ))}
  </svg>
);

// A cobweb for under the end of the last shelf, drawn for a top left corner and turned round as needed.
const WEB = [
  "XXXXXXXXXXXXXXXXX", "X.XX..X....X....X", "XX..XXX....X....X", "XX...XXX..X....X.", "X.X.X...XXX....X.",
  "X.XX......X....X.", "XXXX.....X.XX.X..", "X..X....X....XX..", "X...X..X.....X...", "X...X.X.....X....",
  "X..XXX.....X.....", "XXX...X...X......", "X.....X..X.......", "X......XX........", "X.....XX.........",
  "X..XXX...........", "XXX..............",
];

// What sits in a shelf's empty places: dust bunnies, a mushroom, a snail.
const DUST = ["....X.....X.....", "..XXXX...XXXX...", ".XXXXXX.XXXXXXX.", "XX.XX.XXX.XX.XXX", "XXXXXXXXXXXXXXXX", ".XXXXXX..XXXXXX."];
const MUSHROOM = ["...cccc....", ".cccsccccc.", "ccssccccscc", "cccccccccc.", "....tt.....", "...tttt....", "..tttttt..."];
const SNAIL = ["........b..b", "..SSSS...b.b", ".SsssSS..bbb", "SsSSssS.bbbb", "SsSssSSbbbb.", "bbbbbbbbbb.."];
type Prop = "dust" | "mushroom" | "snail";
const LITTER: Prop[] = ["dust", "mushroom", "snail"];

const PropArt = ({ kind }: { kind: Prop }) => {
  if (kind === "dust") return <Sprite className="prop prop-dust" rows={DUST} colors={{ X: "currentColor" }} />;
  if (kind === "snail") return <Sprite className="prop prop-snail" rows={SNAIL} colors={{ S: "#A8602A", s: "#E8A25A", b: "#A9AEB6" }} />;
  return <Sprite className="prop prop-mushroom" rows={MUSHROOM} colors={{ c: "#D94A3A", s: "#FFFFFF", t: "#F3E6CF" }} />;
};


// How many squares fit across a shelf: as many as are at least ITEM_MIN wide, and never fewer than two.
const ITEM_MIN = 180;
function useColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  useLayoutEffect(() => {
    const el = ref.current!;
    const fit = () => setCols(Math.max(2, Math.floor(el.clientWidth / ITEM_MIN)));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, cols] as const;
}

type Job = Record<string, any>;
type Place = { job: Job } | { prop: Prop } | { pip: true };

// The best jobs as squares on wooden shelves with no sides: just a plank under each row. The last shelf's empty
// places hold dust, a mushroom or a snail, with a cobweb under its end; with no jobs at all there is one low shelf
// with Pip asleep on it.
function Shelves({ jobs }: { jobs: Job[] }) {
  const [ref, cols] = useColumns();
  const count = Math.max(cols, Math.ceil(jobs.length / cols) * cols);
  // Pip naps in the middle of an empty shelf; the things go round him in turn.
  const pipAt = jobs.length ? -1 : Math.floor((cols - 1) / 2);
  let litter = 0;
  const places: Place[] = Array.from({ length: count }, (_, i) => {
    if (i < jobs.length) return { job: jobs[i] };
    if (i === pipAt) return { pip: true };
    return { prop: LITTER[litter++ % LITTER.length] };
  });
  const rows = Array.from({ length: count / cols }, (_, r) => places.slice(r * cols, r * cols + cols));
  const gaps = count > jobs.length;
  return (
    <div className="shelves" ref={ref}>
      {rows.map((row, r) => (
        <div className="shelf" key={r}>
          <div className="shelf-places" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {row.map((place, i) => ("job" in place ? <Item key={i} job={place.job} /> : (
              <div key={i} className="place">{"pip" in place ? <PipAsleep className="shelf-pip" /> : <PropArt kind={place.prop} />}</div>
            )))}
          </div>
          <div className="shelf-plank" />
          {gaps && r === rows.length - 1 && <Sprite className="shelf-web" rows={WEB} colors={{ X: "currentColor" }} />}
        </div>
      ))}
    </div>
  );
}

// A map pin for the place a job is in.
const PIN = [".XXX.", "XX.XX", "XX.XX", ".XXX.", "..X.."];

// One job as a square on the shelf, everything together in its middle: the score in a pixel badge, the title, the
// company, and the place by a pin.
function Item({ job }: { job: Job }) {
  return (
    <a className="item" href="/saved/found" aria-label={`${job.score}: ${job.title}, ${job.company}`}>
      <span className="item-score"><Digits n={job.score} /></span>
      {/* The words run in their own language's direction inside each line. */}
      <strong className="item-title"><bdi dir="auto">{job.title}</bdi></strong>
      <span className="item-company"><bdi dir="auto">{job.company}</bdi></span>
      {job.location && <span className="item-place"><PixelArt className="item-pin" rows={PIN} /><bdi dir="auto">{job.location}</bdi></span>}
    </a>
  );
}

export function Home() {
  const { s, t } = useApp();
  const st = appStats(s);
  // Every job with a score, best first; a long list runs on down the page.
  const top = s.jobs.filter((j) => j.score !== null && j.tier !== "far").sort((a, b) => b.score - a.score);
  const fresh = s.jobs.filter((j) => j.status === "new").length;
  // A plain card in the banner's colours: a pixel picture, the number in pixel digits, the words.
  const stat = (key: "sent" | "interview" | "offer" | "fresh", n: number, href: string) => (
    <a className="stat" href={href} aria-label={`${n} ${t(`home.tiles.${key}`)}`}>
      <PixelArt className="stat-sign" rows={SIGNS[key]} />
      <span className="stat-text"><Digits n={n} /><span className="stat-label">{t(`home.tiles.${key}`)}</span></span>
    </a>
  );
  // The banner runs the whole width beside the menu; the rest sits in the page's column below it. The signs run
  // in the journey's order, new jobs first.
  return (
    <>
      <Hero />
      <div className="page home">
        <section className="stats" aria-label={t("home.glance")}>
          {stat("fresh", fresh, "/saved/found")}
          {stat("sent", st.sent, "/apps")}
          {stat("interview", st.interview, "/apps")}
          {stat("offer", st.offer, "/apps")}
        </section>
        <section className="best">
          <div className="best-head">
            <h2>{t("home.topJobs")}</h2>
            <PixelArt className="best-ledge" rows={LEDGE} />
            {top.length > 0 && <a className="best-all" href="/saved/found">{t("home.allJobs")}</a>}
          </div>
          <Shelves jobs={top} />
          {!top.length && (
            <div className="best-empty">
              <p>{t("home.noJobs")}</p>
              <a className="btn pixel" href="/jobs">{t("home.toJobs")}</a>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
