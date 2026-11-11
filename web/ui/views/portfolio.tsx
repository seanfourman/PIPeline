import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../app";
import { ActLabel, AiSky, api, Icon, safeUrl, useGoSlot } from "../kit";
import { MAKERS, useFirstAi } from "./chat";
import { AiAction, Empty, Sky, tint } from "./jobs";
import type { PortfolioProject, PortfolioState } from "../../portfolio";

// The portfolio page: the projects worth showing that /portfolio picked and wrote up (.claude/skills/portfolio), read
// from user/portfolio/portfolio.json (portfolio.ts), in the saved jobs page's look.

// A conversation's title as the server makes it from what was asked (createSession in agent.ts).
const titled = (prompt: string) => prompt.replace(/\s+/g, " ").trim().slice(0, 70);
// The whole portfolio's work, the skill's own conversation: building it, adding a project, rebuilding its site.
const BUILDING = /^\/portfolio(?! video\b)(\s|$)/;
const media = (rel: string) => `/api/portfolio/media?path=${encodeURIComponent(rel)}`;
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Opening the site is for this computer's own browser (server.ts), not the phone's.
const onComputer = () => ["127.0.0.1", "localhost"].includes(location.hostname);
// The site's own words (a chip's, a button's name) run the site's way, inside a card that may run the other way.
const uiDir = (lang: string) => (lang === "he" ? "rtl" : "ltr");

// What the page shows, read again every few seconds while the AI works on it, so it fills as it is written.
function usePortfolio(working: boolean) {
  const [state, setState] = useState<PortfolioState | null>(null);
  const [error, setError] = useState("");
  const { err } = useApp();
  useEffect(() => {
    let live = true;
    const read = () => api<PortfolioState>("portfolio").then((d) => { if (live) { setState(d); setError(""); } }).catch((e) => { if (live) setError(err(e)); });
    read();
    const timer = working ? setInterval(read, 4000) : undefined;
    return () => { live = false; clearInterval(timer); };
  }, [working]);
  return { state, error };
}

// A project's moving picture, or its still one: its video, playing without sound while half of it is in sight, and
// stopped by its button; else its reel; else its cover; else its initial on a tile in its forest colour. With less
// motion asked for, a video waits for its button and a reel gives way to the cover.
function Reel({ project }: { project: PortfolioProject }) {
  const { t } = useApp();
  const { video, poster, cover, reel } = project.media;
  const player = useRef<HTMLVideoElement>(null);
  const stopped = useRef(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = player.current;
    if (!el || still()) return;
    const seen = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !stopped.current) el.play().catch(() => {});
      else if (!e.isIntersecting) el.pause();
    }, { threshold: 0.5 });
    seen.observe(el);
    return () => seen.disconnect();
  }, [video]);
  if (video) {
    const toggle = () => {
      const el = player.current;
      if (!el) return;
      stopped.current = !el.paused;
      if (el.paused) el.play().catch(() => {});
      else el.pause();
    };
    return (
      <div className="pf-media">
        <video ref={player} src={media(video)} poster={poster || cover ? media(poster || cover) : undefined} muted loop playsInline preload="metadata"
          aria-label={project.name} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        <button type="button" className="pf-play" aria-label={playing ? t("portfolio.pause") : t("portfolio.play")} onClick={toggle}>
          <Icon name={playing ? "pause" : "play"} />
        </button>
      </div>
    );
  }
  const picture = (!still() && reel) || cover || reel;
  if (picture) return <div className="pf-media"><img src={media(picture)} alt="" loading="lazy" decoding="async" /></div>;
  const initial = [...project.name].find((ch) => /[\p{L}\p{N}]/u.test(ch))?.toUpperCase() ?? "?";
  return <div className="pf-media none" aria-hidden="true" style={{ "--tint": tint(project.name) } as React.CSSProperties}><span>{initial}</span></div>;
}

// A round button that sets the AI to work on one project, as applying is on a job's row: a white circle with the AI's
// colours as a soft light along the inside of its rim. While that work runs, the ranking's thin ring turns round it
// and it opens that work's conversation instead.
function AiButton({ icon, label, prompt, name }: { icon: string; label: string; prompt: string; name: string }) {
  const { s, t, start, lang } = useApp();
  const working = s.sessions.find((x) => x.title === titled(prompt) && (x.status === "running" || x.status === "waiting"));
  const inside = <><span className="apply-rim" aria-hidden="true" />{working && <span className="rank-ring" aria-hidden="true" />}<Icon name={icon} /><ActLabel dir={uiDir(lang)}>{working ? t("pip.toChat") : label}</ActLabel></>;
  return working
    ? <a className="result-act ai-act busy" href={`/chat/${working.id}`} aria-label={`${t("pip.toChat")}: ${label}, ${name}`}>{inside}</a>
    : <button type="button" className="result-act ai-act" aria-label={`${label}: ${name}`} onClick={() => start(prompt)}>{inside}</button>;
}

// A project's links and the AI's two offers: its code and its live site, a new README (/readme, on its folder or its
// repository), and a launch video (/portfolio video).
function Actions({ project }: { project: PortfolioProject }) {
  const { t, lang } = useApp();
  const repo = safeUrl(project.links.repo);
  const live = safeUrl(project.links.live);
  const watch = safeUrl(project.links.video);
  const target = project.source.path || repo;
  const link = (href: string, icon: string, label: string) => (
    <a className="result-act" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label}: ${project.name}`}>
      <Icon name={icon} /><ActLabel dir={uiDir(lang)}>{label}</ActLabel>
    </a>
  );
  return (
    <div className="result-actions">
      {repo && link(repo, "repo", t("portfolio.repo"))}
      {live && link(live, "open", t("portfolio.live"))}
      {watch && !project.media.video && link(watch, "play", t("portfolio.watchVideo"))}
      {target && <AiButton icon="readme" label={t("portfolio.readme")} prompt={`/readme ${target}`} name={project.name} />}
      <AiButton icon="video" label={t("portfolio.video")} prompt={`/portfolio video ${project.slug}`} name={project.name} />
    </div>
  );
}

// What a project is made with, when it was made, and how its README stands, as chips; brief, on a small card, only the
// first three of what it is made with, and its README.
function Facts({ project, brief = false }: { project: PortfolioProject; brief?: boolean }) {
  const { t, lang } = useApp();
  const { from, to } = project.timeline;
  const when = from && to && from !== to ? `${from} – ${to}` : from || to;
  const tone = { strong: "good", generated: "good", thin: "warn", missing: "bad", "": "" }[project.readme.status];
  return (
    <div className="result-chips">
      {project.stack.slice(0, brief ? 3 : 14).map((s) => <span key={s} className="result-chip" dir="ltr">{s}</span>)}
      {when && !brief && <span className="result-chip" dir="ltr">{when}</span>}
      {project.role && !brief && <span className="result-chip">{project.role}</span>}
      {project.readme.status && <span className={`result-chip ${tone}`} dir={uiDir(lang)}>{t(`portfolio.readmeState.${project.readme.status}`)}</span>}
    </div>
  );
}

// The way a project's card runs: its words' own, the portfolio's language (English unless the user asked otherwise),
// so an English card reads left to right on a Hebrew page, its chips and buttons with it.
const cardDir = (p: PortfolioProject) => (/\p{Script=Hebrew}|\p{Script=Arabic}/u.test(p.tagline || p.summary || p.name) ? "rtl" : "ltr");

// A Featured project, large: its reel across the list's width, then its name, tagline and story on one side and
// what stands out in it on the other, its chips and its buttons under them.
function Featured({ project, index }: { project: PortfolioProject; index: number }) {
  return (
    <article className="pf-card pf-featured" dir={cardDir(project)} style={{ "--i": index } as React.CSSProperties}>
      <Reel project={project} />
      <div className="pf-body">
        <div className="pf-story">
          <h3 className="pf-name">{project.name}</h3>
          {project.tagline && <p className="pf-tagline">{project.tagline}</p>}
          {project.summary && <p className="pf-summary">{project.summary}</p>}
        </div>
        {project.highlights.length > 0 && (
          <ul className="pf-highlights">{project.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
        )}
      </div>
      <div className="pf-foot">
        <Facts project={project} />
        <Actions project={project} />
      </div>
    </article>
  );
}

// One of the rest, smaller, two to a row: its picture, name and tagline, and a few chips beside its buttons.
function Showcase({ project, index }: { project: PortfolioProject; index: number }) {
  return (
    <article className="pf-card pf-showcase" dir={cardDir(project)} style={{ "--i": index } as React.CSSProperties}>
      <Reel project={project} />
      <div className="pf-story">
        <h3 className="pf-name">{project.name}</h3>
        {project.tagline && <p className="pf-tagline">{project.tagline}</p>}
      </div>
      <div className="pf-foot">
        <Facts project={project} brief />
        <Actions project={project} />
      </div>
    </article>
  );
}

// The box a project is added from, a folder on this computer or a GitHub link, in the jobs search's round box: its go
// button rolls in once something is typed, and the cross puts it away.
function AddBox({ onClose }: { onClose: () => void }) {
  const { t, start } = useApp();
  const [target, setTarget] = useState("");
  const row = useRef<HTMLDivElement>(null);
  const typing = target.trim().length > 0;
  const slotOpen = useGoSlot(typing, row, ".seek-icon");
  return (
    <form className={`seek-box pf-add ${typing ? "typing" : ""} ${slotOpen ? "slot-open" : ""}`}
      onSubmit={(e) => { e.preventDefault(); if (typing) start(`/portfolio add ${target.trim()}`); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="seek-field">
        <input type="text" value={target} placeholder={t("portfolio.addHint")} aria-label={t("portfolio.add")} dir={target ? "auto" : undefined} autoFocus
          onChange={(e) => setTarget(e.target.value)} />
      </div>
      <div className="seek-tools" ref={row}>
        <button type="button" className="seek-icon" aria-label={t("common.close")} onClick={onClose}><Icon name="close" /></button>
        <span className="seek-go-slot">
          <button type="submit" className="seek-go" aria-label={t("portfolio.addGo")} aria-hidden={!typing} tabIndex={typing ? undefined : -1} disabled={!typing}><Icon name="plus" /></button>
        </span>
      </div>
    </form>
  );
}

// No portfolio yet: Pip lying on the AI's button that builds one, which opens its conversation, since it asks which
// GitHub account and folders to go over, and which projects to keep. Under it what it takes, and adding one project.
function NoPortfolio({ onAdd }: { onAdd: () => void }) {
  const { t, start } = useApp();
  const ai = MAKERS[useFirstAi()].name;
  return (
    <Empty title={t("portfolio.emptyTitle")} text={t("portfolio.empty")} after={<>
      <small className="saved-empty-note">{t("jobs.aiQuota", { ai })}</small>
      <p className="pf-or">{t("portfolio.or")} <button type="button" className="pf-text-btn" onClick={onAdd}>{t("portfolio.addOne")}</button></p>
    </>}>
      <button type="button" className="ai-pill" onClick={() => start("/portfolio")}>
        <span className="ai-glow" aria-hidden="true" />
        <AiSky />
        <Icon name="ai" />
        <span>{t("portfolio.build")}</span>
      </button>
    </Empty>
  );
}

// The portfolio being built before any of it is written: Pip lying on the AI's button, at work, which opens the
// conversation, where Pip asks before each choice; under it, once the scan is done, how many projects it found.
function Building({ session, scanned }: { session: { id: string; status: string }; scanned: PortfolioState["scanned"] }) {
  const { t } = useApp();
  const waiting = session.status === "waiting";
  return (
    <Empty title={t(waiting ? "portfolio.waiting" : "portfolio.building")} text={t(waiting ? "portfolio.waitingNote" : "portfolio.buildingNote")}
      after={scanned ? <small className="saved-empty-note">{t("portfolio.scanned", { n: scanned.count })}</small> : undefined}>
      <a className={`ai-pill ${waiting ? "" : "busy"}`} href={`/chat/${session.id}`}>
        <span className="ai-glow" aria-hidden="true" />
        <AiSky />
        <Icon name="ai" />
        <span>{t("pip.toChat")}</span>
      </a>
    </Empty>
  );
}

// The portfolio, a tab of its own in the sidebar's More: the forest rainbow's moving sky behind the title and, once
// there is a portfolio, its owner's line and two glass buttons, adding a project (the box takes their place) and its
// website, opened on this computer or built; not while Pip is at work on it, which happens in its conversation. Under them the AI's pill: the conversation at work on it, or updating it;
// then the Featured projects large, the rest two to a row, and those left out, folded, with why.
export function Portfolio() {
  const { s, t, start, err } = useApp();
  const ai = MAKERS[useFirstAi()].name;
  const session = s.sessions.find((x) => BUILDING.test(x.title) && (x.status === "running" || x.status === "waiting"));
  const { state, error } = usePortfolio(Boolean(session));
  const [adding, setAdding] = useState(false);
  const [siteError, setSiteError] = useState("");
  const portfolio = state?.portfolio ?? null;
  const featured = portfolio?.projects.filter((p) => p.tier === "featured") ?? [];
  const rest = portfolio?.projects.filter((p) => p.tier !== "featured") ?? [];
  const skipped = portfolio?.skipped ?? [];
  const owner = portfolio ? [portfolio.owner.name, portfolio.owner.headline].filter(Boolean).join(", ") : "";
  const openSite = () => { setSiteError(""); api("portfolio/site", {}).catch((e) => setSiteError(err(e))); };
  const pill = session
    ? portfolio && <AiAction busy title={t(session.status === "waiting" ? "portfolio.waiting" : "portfolio.building")}
        note={t(session.status === "waiting" ? "portfolio.waitingNote" : "portfolio.buildingNote")}
        chat={{ id: session.id, label: t("pip.toChat") }} />
    : portfolio && <AiAction title={t("portfolio.update")} note={`${t("portfolio.updateNote")} ${t("jobs.aiQuota", { ai })}`} onClick={() => start("/portfolio")} />;
  return (
    <div className="page jobs-page saved-page portfolio-page">
      <div className="saved-top">
        <Sky />
        <h1 className="saved-title">{t("portfolio.title")}</h1>
        {owner && <p className="pf-owner" dir="auto">{owner}</p>}
        {adding
          ? <AddBox onClose={() => setAdding(false)} />
          : portfolio && !session && (
            <div className="saved-tabs">
              <button type="button" className="seek-pill saved-tab" onClick={() => setAdding(true)}><Icon name="plus" />{t("portfolio.add")}</button>
              {portfolio.site && onComputer()
                ? <button type="button" className="seek-pill saved-tab" onClick={openSite}><Icon name="site" />{t("portfolio.siteOpen")}</button>
                : !portfolio.site && <button type="button" className="seek-pill saved-tab" onClick={() => start("/portfolio site")}><Icon name="site" />{t("portfolio.siteBuild")}</button>}
            </div>
          )}
        {siteError && <small className="error-line" role="alert">{siteError}</small>}
      </div>
      <div className="saved-panel portfolio-panel">
        {pill}
        {error && <p className="error-line" role="alert">{error}</p>}
        {state && !portfolio && (session ? <Building session={session} scanned={state.scanned} /> : <NoPortfolio onAdd={() => setAdding(true)} />)}
        {featured.length > 0 && (
          <section className="saved-group" aria-labelledby="pf-featured">
            <h2 id="pf-featured" className="saved-group-head">{t("portfolio.featured")}<span className="saved-group-count">{featured.length}</span></h2>
            <div className="pf-list">{featured.map((p, i) => <Featured key={p.slug} project={p} index={i} />)}</div>
          </section>
        )}
        {rest.length > 0 && (
          <section className="saved-group" aria-labelledby="pf-showcase">
            <h2 id="pf-showcase" className="saved-group-head">{t("portfolio.showcase")}<span className="saved-group-count">{rest.length}</span></h2>
            <div className="pf-grid">{rest.map((p, i) => <Showcase key={p.slug} project={p} index={featured.length + i} />)}</div>
          </section>
        )}
        {skipped.length > 0 && (
          <details className="pf-skipped">
            <summary className="saved-group-head">
              <Icon name="down" />{skipped.length === 1 ? t("portfolio.skippedOne") : t("portfolio.skipped", { n: skipped.length })}
            </summary>
            <ul>{skipped.map((x) => <li key={x.name} dir="auto"><strong>{x.name}</strong>{x.why && <span>{x.why}</span>}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}
