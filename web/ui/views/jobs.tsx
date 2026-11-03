import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../app";
import { api, Badge, Btn, Card, External, Icon, Page, safeUrl, Spinner } from "../kit";
import { PipLying } from "../pip";
import { areaName, marketLabel } from "./settings";

type Job = { id?: string; key?: string; title: string; company: string; location: string; tier: string; date: string; url: string; score?: number | null; verdict?: string; status?: string };

// Kept between visits to the screen, so leaving and coming back does not lose the results.
const search = { q: null as string | null, days: "14", market: "all", mode: "", areas: "relevant", results: null as Job[] | null, failed: [] as string[], busy: false };

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

// Where a role's pill lands, tossed under the box: a small tilt and a nudge off its place, from its own words, so
// it lands the same way on every visit.
function toss(text: string) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  const part = (shift: number) => (((h >>> shift) & 255) / 255) * 2 - 1;
  return { "--tilt": `${(part(0) * 6).toFixed(1)}deg`, "--nx": `${Math.round(part(8) * 9)}px`, "--ny": `${Math.round(part(16) * 6)}px` };
}

// The search, plain like a chat app's first screen: a question, one round box with Pip lying on its top edge,
// and the roles from the settings as pills tossed under it, over the sky above. At the box's end, a menu of where
// and how to search, and the sparkles, for Pip's two jobs that use Claude; once something is typed, the search
// button flies in past them.
function Quick() {
  const { s, t, lang, err, start } = useApp();
  const [, paint] = useState(0);
  const repaint = () => paint((n) => n + 1);
  const [menu, setMenu] = useState<"" | "filters" | "ai">("");
  const menuBox = useRef<HTMLDivElement>(null);
  const { markets = [], roles = [], workMode = "any", areas: myAreas = [] } = s.settings;
  search.q ??= "";
  const [q, setQ] = useState(search.q ?? "");
  const typing = q.trim() !== "";
  const toggle = (which: "filters" | "ai") => setMenu(menu === which ? "" : which);
  // A menu closes on a click outside the box's end, or on Escape.
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!menuBox.current?.contains(e.target as Node)) setMenu(""); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(""); };
    addEventListener("pointerdown", away);
    addEventListener("keydown", escape);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", escape); };
  }, [menu]);
  const noMarket = !markets.length;
  const hint = useHint(t("jobs.hint"), roles.map((r: any) => String(r.query)));
  search.mode ||= workMode;
  if (search.market !== "all" && !markets.some((m: any) => m.code === search.market)) search.market = "all";
  const excluded = myAreas.filter((a: any) => a.tier === "far").map((a: any) => areaName(a.name, lang));
  const where = noMarket ? t("jobs.noMarket")
    : markets.map((m: any) => (m.city ? `${m.city}, ${marketLabel(m, lang, t)}` : marketLabel(m, lang, t))).join(", ") + (excluded.length ? `. ${t("jobs.hidden", { names: excluded.join(", ") })}` : "");

  const run = async (query = q) => {
    search.q = query;
    setQ(query);
    search.busy = true;
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
  const set = (key: "days" | "market" | "mode" | "areas") => (e: React.ChangeEvent<HTMLSelectElement>) => { search[key] = e.target.value; repaint(); };
  const results = search.results ?? [];
  const shown = results.filter((j) => {
    if (search.areas === "all") return true;
    if (search.areas === "listed" && myAreas.length) return ["near", "ok", "edge"].includes(j.tier);
    return j.tier !== "far";
  });
  const hidden = results.length - shown.length;

  const asked = search.results !== null || search.busy;
  return (
    <div className={`seek ${asked ? "asked" : ""}`}>
      <Sky />
      <h1 className="seek-title">{t("jobs.prompt")}</h1>
      <form className={`seek-box ${typing ? "typing" : ""}`} onSubmit={(e) => { e.preventDefault(); setMenu(""); if (typing) run(); }}>
        <PipLying className="seek-pip" />
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
          {menu === "filters" && (
            <div className="seek-panel" role="group" aria-label={t("jobs.menu")}>
              <p className="seek-where">{where} <a href="#/settings">{t("jobs.change")}</a></p>
              {!noMarket && <>
                <label className="field"><span className="field-label">{t("jobs.where")}</span>
                  <select value={search.market} onChange={set("market")}>
                    {markets.length > 1 && <option value="all">{t("jobs.allMarkets")}</option>}
                    {markets.map((m: any) => <option key={m.code} value={m.code}>{marketLabel(m, lang, t)}</option>)}
                  </select>
                </label>
                <label className="field"><span className="field-label">{t("jobs.mode")}</span>
                  <select value={search.mode} onChange={set("mode")}>
                    {["any", "remote", "hybrid", "onsite"].map((v) => <option key={v} value={v}>{t(`modes.${v}`)}</option>)}
                  </select>
                </label>
                <label className="field"><span className="field-label">{t("jobs.posted")}</span>
                  <select value={search.days} onChange={set("days")}>
                    {["1", "7", "14", "30"].map((v) => <option key={v} value={v}>{t(`jobs.days.d${v}`)}</option>)}
                  </select>
                </label>
                {myAreas.length > 0 && (
                  <label className="field"><span className="field-label">{t("jobs.areaFilter")}</span>
                    <select value={search.areas} onChange={set("areas")}>
                      {["relevant", "listed", "all"].map((v) => <option key={v} value={v}>{t(`jobs.areas.${v}`)}</option>)}
                    </select>
                  </label>
                )}
              </>}
            </div>
          )}
          {menu === "ai" && (
            <div className="seek-panel" role="group" aria-label={t("jobs.ai")}>
              <p className="seek-more">{t("jobs.more")}</p>
              <button type="button" className="seek-action" onClick={() => start("/job-scraper")}><strong>{t("jobs.smart")}</strong><small>{t("jobs.smartNote")}</small></button>
              <button type="button" className="seek-action" onClick={() => start("/rank")}><strong>{t("jobs.rank")}</strong><small>{t("jobs.rankNote")}</small></button>
            </div>
          )}
        </div>
      </form>
      {noMarket ? (
        <p className="seek-note">{t("jobs.needMarket")} <a href="#/settings">{t("jobs.toSettings")}</a></p>
      ) : (
        // Each pill floats on its own beat, so they never bob together.
        <div className="seek-pills">
          {roles.map((r: any, i: number) => (
            <button
              key={r.query} type="button" className="seek-pill" dir="auto" onClick={() => run(r.query)}
              style={{ ...toss(r.query), animationDuration: `${4.2 + (i % 3) * 0.7}s`, animationDelay: `${-i * 1.3}s` } as React.CSSProperties}
            >{r.label}</button>
          ))}
        </div>
      )}
      {search.busy && <div className="row note seek-status" role="status"><Spinner />{t("jobs.searching")}</div>}
      {search.failed.length > 0 && <p className="error-line">{t("jobs.failed", { list: search.failed.join(", ") })}</p>}
      {search.results !== null && !search.busy && (
        <div className="seek-results">
          <p className="note" role="status">{t("jobs.count", { n: shown.length })}{hidden ? t("jobs.hiddenCount", { n: hidden }) : ""}</p>
          {shown.length > 0 && <Card className="joblist">{shown.map((j) => <JobRow key={j.id ?? j.url} job={j} />)}</Card>}
        </div>
      )}
    </div>
  );
}

// The search on its own page, with no title.
export const Jobs = () => <div className="page"><Quick /></div>;

// The saved jobs, a tab of their own in the sidebar.
export function SavedJobs() {
  const { s, t } = useApp();
  return <Page title={t("jobs.saved", { n: s.jobs.length })}><Saved /></Page>;
}
