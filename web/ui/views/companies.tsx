// Companies hiring now (Sean 2026-11-12, after Sequoia's jobs board and JobSpace's companies): what Pip found, by
// company. In the look of "המשרות שלי": the moving sky behind a title that says how many companies are hiring, a
// search by name, and a grid of cards, the companies with the most jobs first, each with its mark, its name, how many
// jobs and its best fit. A company opened shows what it does and where (its industry when Pip reads it, portals.ts),
// a link to its own jobs page, and its jobs as the found list's rows. All read from the jobs found: no AI.
import React, { useMemo, useState } from "react";
import { useApp } from "../app";
import { External, Icon } from "../kit";
import { FoundEmpty, FoundRow, type Found, Initial, pipFound, Score, scoreKind, type ScoreKind, shownScore, Sky, useFreshScores, useRankOne } from "./jobs";
import { INDUSTRIES, PORTALS, type Portal } from "../../portals";

type Company = { key: string; name: string; jobs: Found[]; best: { score: number; kind: ScoreKind } | null; places: string[]; portal?: Portal };

// A company's name as compared: lower case, letters and digits only, without a country or a company form after it, so
// "NVIDIA Israel" is "NVIDIA" and "monday.com" is "mondaycom" either way.
const plain = (name: string) => name.toLowerCase().replace(/\b(israel|ltd|inc|il|group)\b/g, "").replace(/[^\p{L}\p{N}]/gu, "");
// The employers Pip reads (portals.ts), by name in either language, for a company's industry and its own jobs page.
const EMPLOYERS = new Map(PORTALS.filter((p) => p.kind === "employer").flatMap((p) => [[plain(p.en), p], [plain(p.he), p]] as [string, Portal][]));

// The jobs found by company: each company's jobs as found (the best scored first), its best score (the AI's or the
// automatic one, and whose), the places its jobs are in, and its entry in the portals; the companies with the most jobs
// first, then the best fit, then by name.
function byCompany(found: Found[]): Company[] {
  const groups = new Map<string, Found[]>();
  for (const job of found) {
    const key = plain(job.company || "");
    if (key) groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.entries()].map(([key, jobs]) => {
    const top = jobs.filter((j) => !j.veto).reduce<Found | null>((best, j) => ((shownScore(j) ?? -1) > (best ? shownScore(best) ?? -1 : -1) ? j : best), null);
    const places = [...new Set(jobs.map((j) => String(j.location ?? "").split(",")[0].trim()).filter(Boolean))];
    const best = top && shownScore(top) !== null ? { score: shownScore(top)!, kind: scoreKind(top) } : null;
    return { key, name: jobs[0].company, jobs, best, places, portal: EMPLOYERS.get(key) };
  }).sort((a, b) => b.jobs.length - a.jobs.length || (b.best?.score ?? -1) - (a.best?.score ?? -1) || a.name.localeCompare(b.name));
}

export function Companies() {
  const { s, t } = useApp();
  const found = useMemo(() => pipFound(s.jobs) as Found[], [s.jobs]);
  const companies = useMemo(() => byCompany(found), [found]);
  const [query, setQuery] = useState("");
  // The company open, the page's own (not an address), as the tabs of "המשרות שלי" are.
  const [open, setOpen] = useState("");
  const company = companies.find((c) => c.key === open);
  const searching = s.sessions.some((x) => x.title === "/job-scraper" && x.status === "running");
  const q = plain(query);
  const shown = q ? companies.filter((c) => plain(c.name).includes(q)) : companies;
  const jobs = companies.reduce((n, c) => n + c.jobs.length, 0);
  const title = !companies.length ? t("nav.companies") : companies.length === 1 ? t("companies.titleOne") : t("companies.title", { n: companies.length });
  return (
    <div className="page jobs-page saved-page companies-page">
      <div className="saved-top">
        <Sky />
        <h1 className="saved-title">{title}</h1>
        {companies.length > 0 && <p className="companies-sub">{jobs === 1 ? t("companies.subOne") : t("companies.sub", { n: jobs })}</p>}
        {companies.length > 0 && !company && (
          <label className="seek-pill companies-search">
            <Icon name="find" />
            <input type="search" value={query} placeholder={t("companies.search")} aria-label={t("companies.search")} dir={query ? "auto" : undefined} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}
      </div>
      {!companies.length ? <FoundEmpty searching={searching} />
        : company ? <CompanyJobs company={company} found={found} onBack={() => setOpen("")} />
        : shown.length ? <div className="companies-grid">{shown.map((c) => <CompanyCard key={c.key} company={c} onOpen={() => setOpen(c.key)} />)}</div>
        : <p className="companies-none">{t("companies.none")}</p>}
    </div>
  );
}

// A company as a card: its mark, its name, how many jobs, and its best fit in the corner (the found list's tile).
function CompanyCard({ company, onOpen }: { company: Company; onOpen: () => void }) {
  const { t } = useApp();
  const n = company.jobs.length;
  return (
    <button type="button" className="company-card" onClick={onOpen}>
      {company.best !== null && <span className="company-fit"><Score score={company.best.score} kind={company.best.kind} /></span>}
      <span className="company-mark"><Initial name={company.name} /></span>
      <strong className="company-name"><bdi>{company.name}</bdi></strong>
      <span className="company-count">{n === 1 ? t("companies.oneJob") : t("companies.jobs", { n })}</span>
    </button>
  );
}

// A company opened: back to all of them, its mark and name, what it does and where, its own jobs page, and its jobs.
function CompanyJobs({ company, found, onBack }: { company: Company; found: Found[]; onBack: () => void }) {
  const { t, lang } = useApp();
  const fresh = useFreshScores(found);
  const rankOne = useRankOne();
  const industry = company.portal ? INDUSTRIES.find((i) => i.id === company.portal!.industry) : undefined;
  return (
    <section className="company-view" aria-labelledby="company-name">
      <button type="button" className="company-back" onClick={onBack}><Icon name="back" />{t("companies.back")}</button>
      <header className="company-head">
        <span className="company-mark big"><Initial name={company.name} /></span>
        <div className="company-head-text">
          <h2 id="company-name"><bdi>{company.name}</bdi></h2>
          <div className="company-tags">
            {industry && <span className="company-tag">{lang === "en" ? industry.en : industry.he}</span>}
            {company.places.slice(0, 4).map((place) => <span key={place} className="company-tag"><bdi>{place}</bdi></span>)}
          </div>
        </div>
        {company.portal?.url && <External url={company.portal.url} className="company-site">{t("companies.site")}<Icon name="open" /></External>}
      </header>
      <div className="results">{company.jobs.map((job, i) => <FoundRow key={job.key} job={job} index={i} fresh={fresh.has(job.key)} rankOne={rankOne} />)}</div>
    </section>
  );
}
