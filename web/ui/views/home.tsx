import React, { useLayoutEffect, useRef, useState } from "react";
import { companionLine, useApp, type AppState } from "../app";
import { paintStill } from "../intro";
import { Btn } from "../kit";
import { Pip, PipAsleep, pixelPath } from "../pip";

// Small one-colour drawings in the banner's pixel blocks rather than a font's or an icon set's: the tick on a
// stage passed, the numbers, and the pictures on the signs under the banner.
const PixelArt = ({ rows, className }: { rows: string[]; className: string }) => (
  <svg className={className} viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true">
    <path d={pixelPath(rows)} fill="currentColor" />
  </svg>
);

const Tick = () => <PixelArt className="tick" rows={[".....X", "....XX", "X..XX.", "XXXX..", ".XX..."]} />;

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
};
// A number in those digits, a block apart. It is only a picture: the list numbers the stages for screen readers,
// and a sign's link says its number.
function Digits({ n }: { n: number }) {
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

export const SESSION_TONE: Record<string, string> = { running: "live", waiting: "warn", idle: "good", error: "bad" };

export function nextStep(s: AppState, t: ReturnType<typeof useApp>["t"], start: (p: string) => void) {
  const go = (hash: string) => () => { location.hash = hash; };
  const step = (name: string, run: () => void, params = {}) => ({
    title: t(`next.${name}Title`, params), text: t(`next.${name}Text`, params), label: t(`next.${name}Label`, params), run,
  });
  const status = (a: Record<string, any>) => String(a.status ?? "").toLowerCase();
  const waiting = s.sessions.find((x) => x.status === "waiting");
  if (waiting) return step("waiting", go(`#/chat/${waiting.id}`));
  if (!s.profileReady) return step("profile", () => start("/setup"));
  if (!s.settings.markets?.length) return step("markets", go("#/settings"));
  const interview = s.applications.find((a) => status(a) === "interview");
  if (interview) return step("interview", () => start(`/interview ${interview.company} ${interview.role}`), { company: interview.company });
  const drafted = s.applications.find((a) => status(a) === "drafted");
  if (drafted) return step("drafted", go("#/apps"), { company: drafted.company });
  const top = s.jobs.filter((j) => j.status === "ranked" && j.score !== null && j.tier !== "far" && j.url).sort((a, b) => b.score - a.score)[0];
  if (top) return step("top", () => start(`/apply ${top.url}`), { title: top.title, company: top.company, score: top.score });
  const fresh = s.jobs.filter((j) => j.status === "new" || j.status === "unreachable").length;
  if (fresh) return step("fresh", () => start("/rank"), { n: fresh });
  return step("start", go("#/jobs"));
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
    stage("meet", 0, ready, "#/profile", t("home.stages.meetReady")),
    stage("find", s.jobs.length, s.jobs.length > 0, "#/jobs"),
    stage("cv", made, made > 0, "#/apps"),
    stage("send", st.sent, st.sent > 0, "#/apps"),
    stage("interview", st.interview, st.interview > 0, "#/apps"),
    stage("offer", st.offer, st.offer > 0, "#/apps"),
  ];
  const furthest = stages.reduce((last, x, i) => (x.reached ? i : last), -1);
  return { stages, current: Math.min(furthest + 1, stages.length - 1), finished: st.offer > 0 };
}

function Hero() {
  const { s, t, view, start } = useApp();
  const settingsName = String(s.settings.displayName ?? "");
  const next = nextStep(s, t, start);
  const { stages, current, finished } = journey(s, t);
  const line = companionLine(s, view, t);
  const mood = finished ? "happy" : line.mood === "idle" ? "wave" : line.mood;
  return (
    <section className="hero">
      <Forest />
      <div className="hero-card">
        <p className="hero-hi">{settingsName ? t("home.hi", { name: settingsName }) : t("home.hiNoName")} {t("home.intro")}</p>
        <h1 dir="auto">{next.title}</h1>
        <p className="hero-text" dir="auto">{next.text}</p>
        <Btn kind="cta" onClick={next.run}>{next.label}</Btn>
      </div>
      <ol className="stations" aria-label={t("home.journey")}>
        {stages.map((stage, i) => {
          const passed = i < current || (finished && i === current);
          const here = i === current;
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
const Sprite = ({ rows, colors, className }: { rows: string[]; colors: Record<string, string>; className: string }) => (
  <svg className={className} viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true">
    {Object.entries(colors).map(([ch, fill]) => (
      <path key={ch} d={pixelPath(rows.map((row) => [...row].map((c) => (c === ch ? "X" : ".")).join("")))} fill={fill} />
    ))}
  </svg>
);

// What sits in a shelf's empty places. The cobweb is drawn for a top left corner and turned round as needed.
const WEB = [
  "XXXXXXXXXXXXXXXXX", "X.XX..X....X....X", "XX..XXX....X....X", "XX...XXX..X....X.", "X.X.X...XXX....X.",
  "X.XX......X....X.", "XXXX.....X.XX.X..", "X..X....X....XX..", "X...X..X.....X...", "X...X.X.....X....",
  "X..XXX.....X.....", "XXX...X...X......", "X.....X..X.......", "X......XX........", "X.....XX.........",
  "X..XXX...........", "XXX..............",
];
const SPIDER = [
  "...G...", "...G...", "...G...", "...G...", "...G...", "...G...", "...G...", "...G...", "...G...", "...G...",
  "X..X..X", ".XXXXX.", "XXEXEXX", "XXXXXXX", ".XXXXX.", "X.X.X.X",
];
const DUST = ["....X.....X.....", "..XXXX...XXXX...", ".XXXXXX.XXXXXXX.", "XX.XX.XXX.XX.XXX", "XXXXXXXXXXXXXXXX", ".XXXXXX..XXXXXX."];
const MUSHROOM = ["...cccc....", ".cccsccccc.", "ccssccccscc", "cccccccccc.", "....tt.....", "...tttt....", "..tttttt..."];
type Prop = "web" | "spider" | "dust" | "mushroom";
// The place beside the shelf's end post gets the cobweb; the others take these in turn.
const LITTER: Prop[] = ["dust", "spider", "mushroom"];

const PropArt = ({ kind }: { kind: Prop }) => {
  if (kind === "web") return <Sprite className="prop prop-web" rows={WEB} colors={{ X: "currentColor" }} />;
  // A grey-purple spider, seen on a white page and a black one alike.
  if (kind === "spider") return <Sprite className="prop prop-spider" rows={SPIDER} colors={{ G: "currentColor", X: "#5A5870", E: "#FFFFFF" }} />;
  if (kind === "dust") return <Sprite className="prop prop-dust" rows={DUST} colors={{ X: "currentColor" }} />;
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

// The best jobs as squares on wooden shelves, like a bookcase: a board on top, a post each side, a shelf under
// each row. The last shelf's empty places hold a cobweb, a spider, dust or a mushroom; with no jobs at all there
// is one empty shelf with Pip asleep on it.
function Shelves({ jobs }: { jobs: Job[] }) {
  const [ref, cols] = useColumns();
  const count = Math.max(cols, Math.ceil(jobs.length / cols) * cols);
  const places: Place[] = Array.from({ length: count }, (_, i) => {
    if (i < jobs.length) return { job: jobs[i] };
    if (i === count - 1) return { prop: "web" };
    return { prop: LITTER[(i - jobs.length) % LITTER.length] };
  });
  if (!jobs.length) places[Math.floor((cols - 1) / 2)] = { pip: true };
  const rows = Array.from({ length: count / cols }, (_, r) => places.slice(r * cols, r * cols + cols));
  return (
    <div className="bookcase">
      <div className="shelf-plank" />
      <div className="shelves" ref={ref}>
        {rows.map((row, r) => (
          <div className="shelf" key={r}>
            <div className="shelf-places" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {row.map((place, i) => ("job" in place ? <Item key={i} job={place.job} /> : (
                <div key={i} className="place">{"pip" in place ? <PipAsleep className="shelf-pip" /> : <PropArt kind={place.prop} />}</div>
              )))}
            </div>
            <div className="shelf-plank" />
          </div>
        ))}
      </div>
    </div>
  );
}

// One job as a square on the shelf: its score in a lit pixel flag, the title, the company, the place.
function Item({ job }: { job: Job }) {
  return (
    <a className="item" href="#/jobs/saved" aria-label={`${job.score}: ${job.title}, ${job.company}`}>
      <span className="item-score"><Digits n={job.score} /></span>
      {/* Each line keeps to the page's side; the words inside it run in their own language's direction. */}
      <strong className="item-title"><bdi dir="auto">{job.title}</bdi></strong>
      <span className="item-company"><bdi dir="auto">{job.company}</bdi></span>
      {job.location && <span className="item-place"><bdi dir="auto">{job.location}</bdi></span>}
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
          {stat("fresh", fresh, "#/jobs/saved")}
          {stat("sent", st.sent, "#/apps")}
          {stat("interview", st.interview, "#/apps")}
          {stat("offer", st.offer, "#/apps")}
        </section>
        <section className="best">
          <div className="best-head">
            <h2>{t("home.topJobs")}</h2>
            <PixelArt className="best-ledge" rows={LEDGE} />
            {top.length > 0 && <a className="best-all" href="#/jobs/saved">{t("home.allJobs")}</a>}
          </div>
          <Shelves jobs={top} />
          {!top.length && (
            <div className="best-empty">
              <p>{t("home.noJobs")}</p>
              <a className="btn pixel" href="#/jobs">{t("home.toJobs")}</a>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
