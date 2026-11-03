import React, { useLayoutEffect, useRef } from "react";
import { companionLine, friendlyTitle, useApp, type AppState } from "../app";
import { paintStill } from "../intro";
import { Badge, Btn, Card } from "../kit";
import { Pip } from "../pip";

// The login's forest, at rest, behind the home page's card: morning or night with the theme, repainted when
// the banner changes size. The sun or moon sits off to the side, clear of the card in the middle.
function Forest() {
  const { dark } = useApp();
  const ref = useRef<HTMLCanvasElement>(null);
  // Painted before the banner is first on screen, so it never shows as bare sky.
  useLayoutEffect(() => {
    const c = ref.current!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const paint = () => paintStill(c, dark, 0.15);
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
                <span className="flag">{passed ? "✓" : i + 1}</span>
                <span className="station-text"><strong>{stage.label}</strong><small>{stage.hint}</small></span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Home() {
  const { s, t } = useApp();
  const st = appStats(s);
  const top = s.jobs.filter((j) => j.score !== null && j.tier !== "far").sort((a, b) => b.score - a.score).slice(0, 5);
  const fresh = s.jobs.filter((j) => j.status === "new").length;
  const tile = (n: number, label: string, href: string) => <a className="card tile" href={href}><span className="num">{n}</span><span className="lbl">{label}</span></a>;
  // The banner runs the whole width beside the menu; the rest sits in the page's column below it.
  return (
    <>
      <Hero />
      <div className="page home">
        <div className="tiles">
          {tile(st.sent, t("home.tiles.sent"), "#/apps")}
          {tile(st.interview, t("home.tiles.interview"), "#/apps")}
          {tile(st.offer, t("home.tiles.offer"), "#/apps")}
          {tile(fresh, t("home.tiles.fresh"), "#/jobs/saved")}
        </div>
        <div className="two">
          <Card>
            <h2>{t("home.topJobs")}</h2>
            {top.length ? top.map((j) => (
              <a key={j.key} className="list-link" href="#/jobs/saved"><span className="ellipsis" dir="auto">{j.title}, {j.company}</span><strong className="score">{j.score}</strong></a>
            )) : <div className="empty">{t("home.noJobs")}<a className="btn" href="#/jobs">{t("home.toJobs")}</a></div>}
          </Card>
          <Card>
            <h2>{t("home.recent")}</h2>
            {s.sessions.length ? s.sessions.slice(0, 4).map((c) => (
              <a key={c.id} className="list-link" href={`#/chat/${c.id}`}><span className="ellipsis" dir="auto">{friendlyTitle(c.title, t)}</span><Badge tone={SESSION_TONE[c.status]}>{t(`session.${c.status}`)}</Badge></a>
            )) : <div className="empty">{t("home.noChats")}<a className="btn" href="#/chat/new">{t("home.startChat")}</a></div>}
          </Card>
        </div>
      </div>
    </>
  );
}
