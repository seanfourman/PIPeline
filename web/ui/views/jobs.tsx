import React, { useState } from "react";
import { useApp } from "../app";
import { api, Badge, Btn, Card, External, Page, safeUrl, Spinner } from "../kit";
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

function Quick() {
  const { s, t, lang, err } = useApp();
  const [, paint] = useState(0);
  const repaint = () => paint((n) => n + 1);
  const { markets = [], roles = [], workMode = "any", areas: myAreas = [] } = s.settings;
  search.q ??= roles[0]?.query ?? "";
  const [q, setQ] = useState(search.q ?? "");
  if (!markets.length) return <Card className="empty">{t("jobs.needMarket")}<a className="btn primary" href="#/settings">{t("jobs.toSettings")}</a></Card>;
  search.mode ||= workMode;
  if (search.market !== "all" && !markets.some((m: any) => m.code === search.market)) search.market = "all";

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

  return (
    <div className="stack">
      <form className="searchbar" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <input type="search" value={q} aria-label={t("jobs.query")} dir="auto" onChange={(e) => { setQ(e.target.value); search.q = e.target.value; }} />
        <select aria-label={t("jobs.where")} value={search.market} onChange={set("market")}>
          {markets.length > 1 && <option value="all">{t("jobs.allMarkets")}</option>}
          {markets.map((m: any) => <option key={m.code} value={m.code}>{marketLabel(m, lang, t)}</option>)}
        </select>
        <select aria-label={t("jobs.mode")} value={search.mode} onChange={set("mode")}>
          {["any", "remote", "hybrid", "onsite"].map((v) => <option key={v} value={v}>{t(`modes.${v}`)}</option>)}
        </select>
        <select aria-label={t("jobs.posted")} value={search.days} onChange={set("days")}>
          {["1", "7", "14", "30"].map((v) => <option key={v} value={v}>{t(`jobs.days.d${v}`)}</option>)}
        </select>
        {myAreas.length > 0 && (
          <select aria-label={t("jobs.areaFilter")} value={search.areas} onChange={set("areas")}>
            {["relevant", "listed", "all"].map((v) => <option key={v} value={v}>{t(`jobs.areas.${v}`)}</option>)}
          </select>
        )}
        <Btn kind="primary" type="submit" disabled={search.busy}>{t("jobs.search")}</Btn>
      </form>
      <div className="chips">
        {roles.map((r: any) => <button key={r.query} type="button" className="chip" dir="auto" onClick={() => run(r.query)}>{r.label}</button>)}
      </div>
      {search.busy && <div className="row note" role="status"><Spinner />{t("jobs.searching")}</div>}
      {search.failed.length > 0 && <p className="error-line">{t("jobs.failed", { list: search.failed.join(", ") })}</p>}
      {search.results === null && !search.busy && <p className="note">{t("jobs.hint")}</p>}
      {search.results !== null && !search.busy && (
        <>
          <p className="note" role="status">{t("jobs.count", { n: shown.length })}{hidden ? t("jobs.hiddenCount", { n: hidden }) : ""}</p>
          {shown.length > 0 && <Card className="joblist">{shown.map((j) => <JobRow key={j.id ?? j.url} job={j} />)}</Card>}
        </>
      )}
    </div>
  );
}

export function Jobs({ tab }: { tab?: string }) {
  const { s, t, lang, start } = useApp();
  const saved = tab === "saved";
  const { markets = [], areas = [] } = s.settings;
  const excluded = areas.filter((a: any) => a.tier === "far").map((a: any) => areaName(a.name, lang));
  const summary = markets.length
    ? markets.map((m: any) => (m.city ? `${m.city}, ${marketLabel(m, lang, t)}` : marketLabel(m, lang, t))).join(" · ") + (excluded.length ? `. ${t("jobs.hidden", { names: excluded.join(", ") })}` : "")
    : t("jobs.noMarket");
  return (
    <Page
      title={t("jobs.title")}
      sub={<>{summary} <a href="#/settings">{t("jobs.change")}</a></>}
      actions={<>
        <Btn onClick={() => start("/rank")}>{t("jobs.rank")}</Btn>
        <Btn kind="primary" onClick={() => start("/job-scraper")}>{t("jobs.smart")}</Btn>
      </>}
    >
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={!saved} onClick={() => { location.hash = "#/jobs"; }}>{t("jobs.quick")}</button>
        <button className="tab" role="tab" aria-selected={saved} onClick={() => { location.hash = "#/jobs/saved"; }}>{t("jobs.saved", { n: s.jobs.length })}</button>
      </div>
      {saved ? <Saved /> : <Quick />}
    </Page>
  );
}
