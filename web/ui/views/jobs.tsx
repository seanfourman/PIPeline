import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../app";
import { api, Badge, Btn, Card, External, Icon, Page, safeUrl, Spinner } from "../kit";
import { PipLying } from "../pip";
import { roleLabel, type Role } from "../../roles";
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

// The search, plain like a chat app's first screen: a question, one round box with Pip lying on its top edge,
// and the first few roles in a row of glass buttons, with a + that unfolds the rest. At the box's end, a menu of where
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
  // When the search button's place opens or closes (at once, in the CSS), the settings and the sparkles slide
  // over by its width, 44 pixels and a gap, rather than jump.
  const wasTyping = useRef(typing);
  useLayoutEffect(() => {
    if (wasTyping.current === typing) return;
    wasTyping.current = typing;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const out = document.documentElement.dir === "rtl" ? -1 : 1;
    for (const el of menuBox.current?.querySelectorAll<HTMLElement>(".seek-icon, .seek-ai") ?? []) {
      el.animate([{ translate: `${(typing ? 50 : -50) * out}px 0` }, { translate: "0 0" }], { duration: 350, easing: "cubic-bezier(0.22, 0.8, 0.3, 1)" });
    }
  }, [typing]);
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
        <RoleSuggestions onPick={run} />
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
