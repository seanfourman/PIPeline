// A job's own page at /job/<id>, like the page a careers site has for it: what the job is, whether the user applied,
// how well it fits (Pip's score, the reasons for it and what's missing), its facts, the skills it asks for, and the
// posting in its own words, divided as it divides (postings.ts reads it and keeps it). A job's row opens it.
import React, { useEffect, useLayoutEffect, useState } from "react";
import { useApp } from "../app";
import { AiSky, api, goTo, Icon, safeUrl, Spaced } from "../kit";
import { Pip } from "../pip";
import { JOB_ID, jobId } from "../jobid";
import { AiAction, bandOf, daysTo, Initial, JobActions, postedAgo, Sky } from "./jobs";

export type Basics = { url: string; title: string; company: string; location: string; date?: string };
type Section = { title: string; from: number; to: number; list: boolean };
type Skill = { name: string; must: boolean; have: boolean };
type Salary = { text?: string; min?: number; max?: number; currency?: string; unit?: string };
type Facts = { employment?: string; workMode?: string; officeDays?: number; experience?: [number | null, number | null]; level?: string; posted?: string; deadline?: string; salary?: Salary; jobNumber?: string };
export type View = {
  id: string; reading: "page" | "ai" | null; aiError: string;
  job: { url: string; title: string; company: string; location: string; key: string; portal: string; status: string };
  match: { score: number; verdict: string; location: string; language: string; languageNote: string; strengths: string[]; gaps: string[]; at: string } | null;
  // Whether it is above the level searched for (a Pip from before has none).
  level?: { verdict: "PASS" | "FAIL"; why?: "senior" | "years"; years?: number };
  posting: { status: "read" | "unreachable" | "expired" | null; error: string; source: string; guard: string; at: string; lines: string[]; sections: Section[]; skills: Skill[]; facts: Facts };
  applied: { status: string; date: string } | null;
};
type T = (key: string, params?: Record<string, string | number>) => string;

// While the job is being read, the page asks how it stands this often.
const POLL_MS = 1200;
// A page that isn't read by the AI shows this many of its lines until asked for all of them.
const RAW_LINES = 14;

// Jobs opened on this visit: what their list knew of them (a page loaded again asks by its id alone), and the last
// answer, so a job opened again shows at once while it is asked again.
const basicsOf = new Map<string, Basics>();
const views = new Map<string, View>();

// The list page a job's page was opened from, and how far down it was, to go back to.
let cameFrom: { path: string; top: number } | null = null;

// A job opened from its row: its page.
export function openJob(job: Basics) {
  const id = jobId(job.url);
  if (!id) return;
  basicsOf.set(id, job);
  cameFrom = { path: location.pathname, top: document.getElementById("main")?.scrollTop ?? 0 };
  goTo(`/job/${id}`);
}
// A job opened in a new tab: told to the server now, so its page has it there.
export function sendOpen(job: Basics) {
  const id = jobId(job.url);
  if (!id) return;
  basicsOf.set(id, job);
  api("job/open", job).catch(() => {});
}

// The job's page as the server has it: opened (read if it needs to be, with no AI), then asked again while it is read.
// again reads a page that wouldn't open again; analyze has the AI read the job, only when the user asks.
function useJobView(id: string) {
  const { err } = useApp();
  const [view, setView] = useState<View | null>(() => views.get(id) ?? null);
  const [error, setError] = useState("");
  // The Pip on the computer is from before job pages (it has nowhere to open one): until it is started again.
  const [outdated, setOutdated] = useState(false);
  const [round, setRound] = useState<{ n: number; what: "again" | "ai" }>({ n: 0, what: "again" });
  useEffect(() => {
    let on = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let misses = 0;
    setError("");
    const take = (v: View) => {
      if (!on) return;
      views.set(id, v);
      setView(v);
      if (v.reading) timer = setTimeout(ask, POLL_MS);
    };
    const fail = (e: unknown, opening = false) => {
      if (!on) return;
      const missing = (e as { status?: number })?.status === 404;
      if (missing && opening) { setOutdated(true); return; }
      // A page opened in a new tab can ask before the job reaches the server; it asks twice more.
      if (missing && misses++ < 2) { timer = setTimeout(ask, 1000); return; }
      setError(err(e));
    };
    const ask = () => api<View>(`job/${id}`).then(take, (e) => fail(e));
    const basics = basicsOf.get(id);
    if (round.n) api<View>(`job/${id}/${round.what}`, {}).then(take, (e) => fail(e));
    else if (basics) api<View>("job/open", basics).then(take, (e) => fail(e, true));
    else ask();
    return () => { on = false; clearTimeout(timer); };
  }, [id, round]);
  return { view, error, outdated, again: () => setRound((r) => ({ n: r.n + 1, what: "again" })), analyze: () => setRound((r) => ({ n: r.n + 1, what: "ai" })) };
}

const fullDate = (iso: string | undefined, lang: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  const date = new Date(+m[1], +m[2] - 1, +m[3]);
  return new Intl.DateTimeFormat(lang === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "long", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }).format(date);
};

function experienceText([min, max]: [number | null, number | null], t: T) {
  if (!min && !max) return t("job.experience.none");
  if (min !== null && max !== null) return min === max ? t("job.experience.exact", { n: min }) : t("job.experience.range", { min, max });
  if (min !== null) return min === 1 ? t("job.experience.oneUp") : t("job.experience.min", { min });
  return t("job.experience.max", { max: max ?? 0 });
}

const CURRENCY: Record<string, string> = { ILS: "₪", NIS: "₪", USD: "$", EUR: "€", GBP: "£" };
function salaryText(s: Salary, t: T, lang: string) {
  if (s.text) return s.text;
  const n = (v: number) => new Intl.NumberFormat(lang === "he" ? "he-IL" : "en-GB").format(v);
  const sign = CURRENCY[String(s.currency ?? "").toUpperCase()] ?? s.currency ?? "";
  // A range kept left to right inside Hebrew, so its low end stays first.
  const amount = s.min && s.max && s.min !== s.max ? `\u2066${n(s.min)}–${n(s.max)}\u2069` : n(s.min ?? s.max ?? 0);
  const per = s.unit && ["hour", "day", "week", "month", "year"].includes(s.unit) ? ` ${t(`job.per.${s.unit}`)}` : "";
  return `${sign}${amount}${per}`;
}

// Where Pip found the job: the job site's name, or the employer's own site.
const SITES: Record<string, string> = { "linkedin-search": "LinkedIn", "alljobs-search": "AllJobs", "jobmaster-search": "JobMaster", "freehire-search": "freehire", "drushim-search": "drushim" };
function sourceName(portal: string, url: string, t: T) {
  if (portal === "drushim-search") return t("job.sites.drushim");
  if (SITES[portal]) return SITES[portal];
  if (portal.startsWith("telegram")) return t("job.sites.telegram");
  if (portal === "careers-page") return t("job.sites.careers");
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// ---------- the parts of the page ----------

// The job, as its row has it: the company's initial, the title, the company and place, when it was posted and
// whether it closes soon, and its buttons.
function Head({ view, basics }: { view: View | null; basics?: Basics }) {
  const { t } = useApp();
  const job = view?.job ?? { ...basics!, key: "", portal: "", status: "" };
  const posted = view?.posting.facts.posted ?? basics?.date;
  const days = daysTo(view?.posting.facts.deadline);
  return (
    <header className="job-head">
      <Initial name={job.company || job.title || "?"} />
      <div className="job-head-text">
        <h1 className="job-title" dir="auto">{job.title}</h1>
        <p className="result-meta"><Spaced parts={[job.company, job.location].filter(Boolean)} /></p>
        <div className="result-chips">
          {days !== null && days >= 0 && days <= 7 && (
            <span className="result-chip warn">{days === 0 ? t("jobs.flags.closesToday") : days === 1 ? t("jobs.flags.closesTomorrow") : t("jobs.flags.closesIn", { n: days })}</span>
          )}
          {posted && <span className="result-chip">{postedAgo(posted, t)}</span>}
        </div>
      </div>
      <JobActions job={{ url: job.url, title: job.title, company: job.company, location: job.location, date: basics?.date ?? posted ?? "" }} />
    </header>
  );
}

// That the user applied, or has a draft for it, from the applications; it leads to them.
function Applied({ applied }: { applied: NonNullable<View["applied"]> }) {
  const { t, lang } = useApp();
  const draft = applied.status === "drafted";
  const date = fullDate(applied.date, lang);
  return (
    <a className={`job-applied ${draft ? "draft" : ""}`} href="/apps">
      <Icon name={draft ? "file" : "check"} />
      <span className="job-applied-text">{draft ? t("job.applied.draft") : date ? t("job.applied.on", { date }) : t("job.applied.done")}</span>
      {!draft && applied.status && applied.status !== "applied" && <span className="result-chip">{t(`status.${applied.status}`)}</span>}
      <span className="job-applied-go">{t("job.applied.see")}<Icon name="onward" /></span>
    </a>
  );
}

// How well it fits, the AI's work and in its colours: the score on the AI's sky, its band in words, the location and
// language checks when one didn't pass, why it fits and what's missing. Not scored yet, the AI's button has the AI read
// the job: the page itself is read with no AI, and the AI only when asked.
function Match({ view, onAnalyze }: { view: View; onAnalyze: () => void }) {
  const { t } = useApp();
  const m = view.match;
  if (!m) {
    const said = view.aiError ? t(`job.aiErrors.${view.aiError}`) : "";
    const why = said && !said.startsWith("job.") ? said : view.aiError ? t("job.aiErrors.other") : "";
    return <section className="job-match none"><AiAction title={t(view.aiError ? "job.match.again" : "job.match.rank")} note={why || t("job.match.rankNote")} onClick={onAnalyze} /></section>;
  }
  const band = bandOf(m.score);
  const gate = (which: "location" | "language", verdict: string) => verdict !== "PASS" && (
    <span className={`result-chip ${verdict === "FAIL" ? "bad" : "warn"}`}>
      {t(`job.gates.${which}${verdict === "FAIL" ? "" : "Flag"}`)}{which === "language" && m.languageNote ? `: ${m.languageNote}` : ""}
    </span>
  );
  return (
    <section className={`job-match ${band}`} aria-label={t("job.match.title")}>
      <div className="match-top">
        <span className="match-orb" role="img" aria-label={t("jobs.score", { n: m.score })}><AiSky orb /><b>{m.score}</b></span>
        <div className="match-head">
          <h2 className="match-verdict">{t(`job.bands.${band}`)}</h2>
          <p className="match-note">{t("job.match.note")}</p>
        </div>
      </div>
      {(m.location !== "PASS" || m.language !== "PASS") && <div className="result-chips">{gate("location", m.location)}{gate("language", m.language)}</div>}
      {(m.strengths.length > 0 || m.gaps.length > 0) && (
        <div className="match-lists">
          {/* Written in the page's language, so in its direction even when a line starts with an English name. */}
          {m.strengths.length > 0 && (
            <div className="match-list good"><h3>{t("job.match.why")}</h3><ul>{m.strengths.map((x, i) => <li key={i}><Icon name="check" /><span><Words text={x} /></span></li>)}</ul></div>
          )}
          {m.gaps.length > 0 && (
            <div className="match-list gap"><h3>{t("job.match.gaps")}</h3><ul>{m.gaps.map((x, i) => <li key={i}><Icon name="minus" /><span><Words text={x} /></span></li>)}</ul></div>
          )}
        </div>
      )}
    </section>
  );
}

// The job's facts as a careers page lists them, each that the posting gives: its type, where it is worked, the
// experience and level it asks for, when it was posted and closes, the pay, its number, and where Pip found it.
function FactsGrid({ view }: { view: View }) {
  const { t, lang } = useApp();
  const f = view.posting.facts;
  const rows: [string, string][] = [];
  if (f.employment) rows.push([t("job.facts.employment"), t(`job.employment.${f.employment}`)]);
  if (f.workMode) rows.push([t("job.facts.workMode"), f.workMode === "hybrid" && f.officeDays ? t("job.workMode.days", { n: f.officeDays }) : t(`job.workMode.${f.workMode}`)]);
  if (f.experience) rows.push([t("job.facts.experience"), experienceText(f.experience, t)]);
  if (f.level) rows.push([t("job.facts.level"), t(`job.level.${f.level}`)]);
  if (f.posted) rows.push([t("job.facts.posted"), fullDate(f.posted, lang)]);
  if (f.deadline) rows.push([t("job.facts.deadline"), fullDate(f.deadline, lang)]);
  if (f.salary) rows.push([t("job.facts.salary"), salaryText(f.salary, t, lang)]);
  if (f.jobNumber && f.jobNumber.length <= 24) rows.push([t("job.facts.jobNumber"), f.jobNumber]);
  const source = sourceName(view.job.portal, view.job.url, t);
  if (source) rows.push([t("job.facts.source"), source]);
  if (!rows.length) return null;
  return (
    <dl className="job-facts">
      {rows.map(([name, value]) => <div key={name}><dt>{name}</dt><dd dir="auto">{value}</dd></div>)}
    </dl>
  );
}

// The skills it asks for, as it names them: a tick on those the profile shows, the required ones in ink, the ones
// it counts an advantage marked so.
function Skills({ skills }: { skills: Skill[] }) {
  const { t } = useApp();
  if (!skills.length) return null;
  return (
    <section className="job-skills">
      <h2 className="job-part-title">{t("job.skills.title")}</h2>
      <ul className="skill-chips">
        {skills.map((k) => (
          <li key={k.name} className={`skill-chip ${k.have ? "have" : ""} ${k.must ? "must" : ""}`}>
            {k.have && <Icon name="check" />}<bdi>{k.name}</bdi>{!k.must && <small>{t("job.skills.plus")}</small>}
          </li>
        ))}
      </ul>
      {skills.some((k) => k.have) && <p className="skill-key"><Icon name="check" />{t("job.skills.key")}</p>}
    </section>
  );
}

// Hebrew words with English names among them: each name kept whole in its own direction, so "C++" at a line's start
// doesn't show as "++C", nor ".NET" as "NET.".
const NAME = /(\.?[A-Za-z][A-Za-z0-9]*(?:[.\-/][A-Za-z0-9]+)*[+#]*)/;
function Words({ text }: { text: string }) {
  if (!/[֐-׿]/.test(text)) return <>{text}</>;
  return <>{text.split(NAME).map((part, i) => (i % 2 ? <bdi key={i}>{part}</bdi> : part))}</>;
}

// A line of the posting as it is written; a web address written out in it can be followed, in a new tab.
const LINK = /(https?:\/\/[^\s<>"')\]]+)/;
function Linked({ text }: { text: string }) {
  return <>{text.split(LINK).map((part, i) => (i % 2 && safeUrl(part) ? <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow">{part}</a> : <Words key={i} text={part} />))}</>;
}

// Lines as the page has them: a "## " line a heading, "• " lines a list (every line, in a part that is a list), the
// rest a paragraph each. A heading or paragraph takes its own direction; a list keeps the posting's, so its bullets
// stay on one side.
function Blocks({ lines, list = false }: { lines: string[]; list?: boolean }) {
  const out: React.ReactNode[] = [];
  let items: string[] = [];
  const flush = (at: number) => {
    if (items.length) out.push(<ul key={`list-${at}`}>{items.map((item, i) => <li key={i}><Linked text={item} /></li>)}</ul>);
    items = [];
  };
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) { flush(i); out.push(<h4 key={i} dir="auto">{line.slice(3)}</h4>); return; }
    if (list || line.startsWith("• ")) { items.push(line.replace(/^• /, "")); return; }
    flush(i);
    out.push(<p key={i} dir="auto"><Linked text={line} /></p>);
  });
  flush(lines.length);
  return <>{out}</>;
}

// The posting in its own words: its parts as the AI found them, each under its heading. Before the AI has read it,
// the page's words as they came, which on a page with no data of its own have the site's menus round them: so many
// lines, then the rest on asking.
function Description({ posting }: { posting: View["posting"] }) {
  const { t } = useApp();
  const [all, setAll] = useState(false);
  const { lines, sections } = posting;
  if (!lines.length) return null;
  const raw = !sections.length && posting.source === "page";
  const shown = raw && !all ? lines.slice(0, RAW_LINES) : lines;
  // The posting in its own language's direction, its lists' bullets on their side; a line in the other language
  // keeps its own (dir="auto").
  const words = sections.length ? sections.flatMap((s) => lines.slice(s.from, s.to + 1)) : lines;
  const first = words.join(" ").match(/[A-Za-z֐-׿؀-ۿ]/)?.[0] ?? "";
  const dir = /[A-Za-z]/.test(first) ? "ltr" : first ? "rtl" : undefined;
  return (
    <section className="job-desc">
      <h2 className="job-part-title">{t("job.about")}</h2>
      {raw && <p className="job-raw-note">{t("job.rawNote")}</p>}
      <div dir={dir}>
        {sections.length ? sections.map((s, i) => (
          <section key={i} className="job-desc-part">
            {s.title && <h3 dir="auto">{s.title.replace(/\s*[:：]\s*$/, "")}</h3>}
            <Blocks lines={lines.slice(s.from, s.to + 1)} list={s.list} />
          </section>
        )) : <div className="job-desc-part"><Blocks lines={shown} /></div>}
      </div>
      {raw && !all && lines.length > RAW_LINES && <button type="button" className="btn job-raw-more" onClick={() => setAll(true)}>{t("job.rawMore", { n: lines.length - RAW_LINES })}</button>}
    </section>
  );
}

// While the job is read: Pip at work, saying what he is doing, over the AI's sky moving in a thin line.
function Reading({ stage }: { stage: "page" | "ai" }) {
  const { t } = useApp();
  return (
    <section className="job-reading" aria-live="polite">
      <Pip mood="work" className="job-reading-pip" />
      <div className="job-reading-text">
        <strong>{t(`job.reading.${stage}`)}</strong>
        <small>{t("job.reading.note")}</small>
      </div>
      <span className="job-reading-bar" aria-hidden="true"><AiSky /></span>
    </section>
  );
}

// A posting that couldn't be read, or is closed: why, the way to its page on its site, and a try again.
function NotRead({ view, onAgain }: { view: View; onAgain: () => void }) {
  const { t } = useApp();
  const closed = view.posting.status === "expired";
  const error = view.posting.error;
  const code = /HTTP (\d{3})/.exec(error)?.[1];
  const why = closed ? "" : /robots/i.test(error) ? t("job.notRead.robots") : code ? t("job.notRead.http", { code }) : /no text|no posting/i.test(error) ? t("job.notRead.empty") : "";
  return (
    <section className="job-notread">
      <Pip mood={closed ? "sad" : "confused"} className="job-notread-pip" />
      <div className="job-notread-text">
        <strong>{t(closed ? "job.notRead.closed" : "job.notRead.title")}</strong>
        {why && <small>{why}</small>}
        <div className="job-notread-acts">
          {safeUrl(view.job.url) && <a className="btn primary" href={view.job.url} target="_blank" rel="noopener noreferrer">{t("job.notRead.open")}</a>}
          {!closed && <button type="button" className="btn" onClick={onAgain}>{t("job.notRead.again")}</button>}
        </div>
      </div>
    </section>
  );
}

function Missing() {
  const { t } = useApp();
  return (
    <section className="job-notread">
      <Pip mood="confused" className="job-notread-pip" />
      <div className="job-notread-text"><strong>{t("job.missing")}</strong></div>
    </section>
  );
}

// The Pip on the computer from before job pages: what to do, and the job on its site meanwhile.
function Outdated({ url }: { url: string }) {
  const { t } = useApp();
  return (
    <section className="job-notread">
      <Pip mood="tired" className="job-notread-pip" />
      <div className="job-notread-text">
        <strong>{t("job.outdated")}</strong>
        {safeUrl(url) && <div className="job-notread-acts"><a className="btn primary" href={url} target="_blank" rel="noopener noreferrer">{t("job.notRead.open")}</a></div>}
      </div>
    </section>
  );
}

// Above the level searched for: a junior search's job asking for three years or more, or a senior one (experience.ts),
// which is why it isn't on the list.
function Above({ level }: { level: View["level"] }) {
  const { t } = useApp();
  if (level?.verdict !== "FAIL") return null;
  return <p className="job-above" role="note"><Icon name="minus" />{level.why === "senior" ? t("job.above.senior") : t("job.above.years", { n: level.years ?? 3 })}</p>;
}

// The page's body: the job, then each part as it comes.
function JobView({ id }: { id: string }) {
  const { view, error, outdated, again, analyze } = useJobView(id);
  const basics = basicsOf.get(id);
  if (!view && !basics) return error ? <Missing /> : <Reading stage="page" />;
  return (
    <article className="job-view" aria-busy={!view || Boolean(view.reading)}>
      <Head view={view} basics={basics} />
      {view?.applied && <Applied applied={view.applied} />}
      {!view && outdated ? <Outdated url={basics?.url ?? ""} />
        : !view || view.reading ? <Reading stage={view?.reading ?? "page"} />
        : view.posting.status !== "read" ? <NotRead view={view} onAgain={again} />
        : (
          <div className="job-body">
            <Above level={view.level} />
            <Match view={view} onAnalyze={analyze} />
            <FactsGrid view={view} />
            <Skills skills={view.posting.skills} />
            <Description posting={view.posting} />
          </div>
        )}
      {error && view && <p className="error-line" role="alert">{error}</p>}
    </article>
  );
}

// The page at /job/<id>, under the jobs' moving sky, with the way back to the list it was opened from, as far down as
// it was.
export function JobPage() {
  const { arg, t } = useApp();
  const id = arg && JOB_ID.test(arg) ? arg : "";
  useLayoutEffect(() => { document.getElementById("main")?.scrollTo({ top: 0 }); }, [id]);
  const back = () => {
    const to = cameFrom;
    if (!to) { goTo("/saved"); return; }
    cameFrom = null;
    history.back();
    // The list draws its rows again first.
    setTimeout(() => document.getElementById("main")?.scrollTo({ top: to.top }), 60);
  };
  return (
    <div className="page job-page">
      <div className="job-page-top">
        <Sky />
        <button type="button" className="job-back" onClick={back}><Icon name="back" />{t("job.back")}</button>
      </div>
      {id ? <JobView key={id} id={id} /> : <Missing />}
    </div>
  );
}
