import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LANGUAGES_ON, THEMES_ON, useApp } from "../app";
import { AREA_NAMES_EN, type Lang } from "../i18n";
import { api, Btn, Card, External, Icon, Spinner } from "../kit";
import { SaveNote, useAutoSave } from "../autosave";
import { Select } from "../select";
import { HOME_COUNTS, HOME_DAYS, HOME_ORDERS, homeJobsFrom } from "../home-jobs";
import { fromList, listedRole, matchListed, ROLE_FIELDS, roleQuery } from "../../roles";
import { INDUSTRIES } from "../../portals";
import { readBase64 } from "./chat";
import { PixelArt } from "./home";

const COUNTRY_CODES = "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NZ OM PA PE PG PH PK PL PR PS PT PY QA RO RS RU RW SA SC SD SE SG SI SK SL SN SO SR SV SY SZ TD TG TH TJ TM TN TR TT TW TZ UA UG US UY UZ VE VN YE ZA ZM ZW".split(" ");
const TIERS = ["near", "ok", "edge", "far"];
// The daily run's times, up to one an hour as settings.ts keeps them, though more than RUN_TIMES_ADVISED a day spend
// Claude's quota on searches that mostly find nothing new, and a note says so; one added takes the first of these
// not taken, then the first whole hour not taken.
export const RUN_TIMES = 24;
export const RUN_TIMES_ADVISED = 3;
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
const nextTime = (times: string[]) => ["13:00", "17:00", "21:00", "09:00", ...HOURS].find((t) => !times.includes(t)) ?? "12:00";

const regionName = (code: string, lang: Lang) => { try { return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code; } catch { return code; } };

// The daily run's times on the settings screen (the introduction's step for the email has its strip of hours, HourStrip
// in welcome.tsx): a field for each, with a × once there are two, and a light link for another while there are fewer
// than RUN_TIMES.
function RunTimes({ times, onChange }: { times: string[]; onChange: (times: string[]) => void }) {
  const { t } = useApp();
  return (
    <span className="run-times">
      {times.map((time, i) => (
        <span key={i} className="run-time">
          <input type="time" dir="ltr" value={time} aria-label={t("settings.runTime", { n: i + 1 })}
            onChange={(e) => onChange(times.map((x, j) => (j === i ? e.target.value : x)))} />
          {times.length > 1 && (
            <button type="button" className="run-time-x" aria-label={t("settings.removeTime", { time })} onClick={() => onChange(times.filter((_, j) => j !== i))}><Icon name="close" /></button>
          )}
        </span>
      ))}
      {times.length < RUN_TIMES && <button type="button" className="add-link" onClick={() => onChange([...times, nextTime(times)])}><Icon name="plus" />{t("settings.addTime")}</button>}
    </span>
  );
}

// Country names come from the code, so they follow the interface language whatever was saved.
export const marketLabel = (m: { code: string; label?: string }, lang: Lang, t: (k: string) => string) => (m.code === "REMOTE" ? t("settings.remoteMarket") : regionName(m.code, lang));
export const areaName = (name: string, lang: Lang) => (lang === "en" ? AREA_NAMES_EN[name] ?? name : name);

// An area's rating, as a list to drop down: a round button in the rating's colour, with its dot, and the ratings
// in the list each with theirs (green, teal, amber, red; grey for none).
function TierSelect({ value, onChange, unset, label }: { value: string; onChange: (v: string) => void; unset?: boolean; label?: string }) {
  const { t } = useApp();
  return (
    <Select
      className={`tier tone-${value || "unset"}`} label={label ? `${t("settings.areaTier")}: ${label}` : t("settings.areaTier")} value={value} onChange={onChange}
      options={(unset ? ["", ...TIERS] : TIERS).map((v) => ({ value: v, label: t(`tiers.${v || "unset"}`), tone: v || "unset" }))}
    />
  );
}

type Update = (fn: (d: any) => void) => void;

// Where to search, up to 3 markets (a country, with a city or not, or remote), on a settings draft: the settings
// screen's, and the jobs page's window for changing it there. Its heading (title) with a light link for remote
// work at the line's end, the markets chosen as round tags with a pin and an ×, and a row to add one, a country
// to find in a list and a city, with a round + at its start. With 3 chosen, the link and the row give way to a
// note that that is the most, and that removing one makes room. bare: on the introduction's board, whose pins, ×
// and + are drawn in its pixels.
const MAX_MARKETS = 3;
const PLACE_PIN = ["..XXXXX..", ".XX...XX.", "XX..X..XX", "XX.XXX.XX", "XX..X..XX", ".XX...XX.", "..XX.XX..", "...XXX...", "....X...."];
const PLACE_X = ["XX...XX", "XXX.XXX", ".XXXXX.", "..XXX..", ".XXXXX.", "XXX.XXX", "XX...XX"];
const PLACE_PLUS = ["..XX..", "..XX..", "XXXXXX", "XXXXXX", "..XX..", "..XX.."];

// quiet holds back the word that no country is chosen yet, for the introduction, until its way on was tried.
export function MarketsEditor({ draft, update, title, bare = false, quiet = false }: { draft: any; update: Update; title: React.ReactNode; bare?: boolean; quiet?: boolean }) {
  const { t, lang } = useApp();
  const plus = bare ? <PixelArt className="place-plus" rows={PLACE_PLUS} /> : <Icon name="plus" />;
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const countries = COUNTRY_CODES.map((code) => ({ code, label: regionName(code, lang), country: regionName(code, "en") })).sort((a, b) => a.label.localeCompare(b.label, lang));
  const full = draft.markets.length >= MAX_MARKETS;
  const add = () => {
    const picked = countries.find((c) => c.code === country);
    if (!picked || full) return;
    update((d) => { d.markets = [...d.markets.filter((m: any) => m.code !== picked.code), { code: picked.code, country: picked.country, city: city.trim(), label: picked.label }]; });
    setCity("");
    setCountry("");
  };
  return (
    <>
      <div className="section-head">
        {title}
        {!full && !draft.markets.some((m: any) => m.code === "REMOTE") && (
          <button type="button" className="add-link" onClick={() => update((d) => { d.markets.push({ code: "REMOTE", country: "", city: "", label: "Remote" }); })}>
            {plus}{t("settings.addRemote")}
          </button>
        )}
      </div>
      {draft.markets.length ? (
        <div className="chips">
          {draft.markets.map((m: any) => (
            <span key={m.code} className="tag place-tag">{bare ? <PixelArt className="place-pin" rows={PLACE_PIN} /> : <Icon name="pin" />}{m.city ? `${m.city}, ` : ""}{marketLabel(m, lang, t)}
              <button type="button" className="tag-x" aria-label={`${t("common.remove")} ${marketLabel(m, lang, t)}`} onClick={() => update((d) => { d.markets = d.markets.filter((x: any) => x.code !== m.code); })}>
                {bare ? <PixelArt className="place-x" rows={PLACE_X} /> : <Icon name="close" />}
              </button>
            </span>
          ))}
        </div>
      ) : !quiet && <p className="error-line" role="alert">{t("settings.noMarket")}</p>}
      {full ? <p className="note" role="status">{t("settings.marketsFull", { n: MAX_MARKETS })}</p> : (
        <div className="add-row">
          <button type="button" className="add-go" aria-label={t("common.add")} disabled={!country} onClick={add}>{plus}</button>
          {/* Found by its name in either language, or its code. */}
          <Select className="country" label={t("settings.country")} placeholder={t("settings.country")} value={country} onChange={setCountry}
            options={countries.map((c) => ({ value: c.code, label: c.label, keywords: `${c.country} ${c.code}` }))} />
          {/* Empty, the box takes the page's direction, so the hint starts on the page's side; a city typed takes its own. */}
          <input type="text" placeholder={t("settings.city")} aria-label={t("settings.city")} dir={city ? "auto" : undefined} value={city} onChange={(e) => setCity(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        </div>
      )}
    </>
  );
}

// The areas' ratings, the ready-made ones for the markets chosen and any added by hand, on a settings draft: a
// note, how to type a name on its own line in bold; each a row with its name and its rating to drop down
// (TierSelect), one added by hand with an × to take it off; and a row to add one, a round + first, its name and its rating.
export function AreasEditor({ draft, update }: { draft: any; update: Update }) {
  const { s, t, lang } = useApp();
  const [areaInput, setAreaInput] = useState("");
  const [areaTier, setAreaTier] = useState("near");
  const presets = draft.markets.flatMap((m: any) => s.presets[m.code] ?? []);
  const presetNames = new Set(presets.map((p: any) => p.name));
  const custom = draft.areas.filter((a: any) => !presetNames.has(a.name));
  return (
    <>
      <p className="note">{t("settings.areasNote")}<br /><strong>{t("settings.areasHint")}</strong></p>
      <div className="area-list">
        {presets.map((p: any) => (
          <div key={p.name} className="area-row">
            <span>{areaName(p.name, lang)}</span>
            <TierSelect unset label={areaName(p.name, lang)} value={draft.areas.find((a: any) => a.name === p.name)?.tier ?? ""} onChange={(v) => update((d) => {
              d.areas = d.areas.filter((a: any) => a.name !== p.name);
              if (v) d.areas.push({ name: p.name, places: p.places, tier: v });
            })} />
          </div>
        ))}
        {custom.map((a: any) => (
          <div key={a.name} className="area-row">
            <span dir="auto">{a.name}</span>
            <div className="area-end">
              <TierSelect label={a.name} value={a.tier} onChange={(v) => update((d) => { d.areas.find((x: any) => x.name === a.name).tier = v; })} />
              <button type="button" className="area-x" aria-label={`${t("common.remove")} ${a.name}`} onClick={() => update((d) => { d.areas = d.areas.filter((x: any) => x.name !== a.name); })}><Icon name="close" /></button>
            </div>
          </div>
        ))}
      </div>
      <form className="add-row" onSubmit={(e) => {
        e.preventDefault();
        const name = areaInput.trim();
        if (!name) return;
        update((d) => { d.areas = [...d.areas.filter((a: any) => a.name !== name), { name, places: [name.toLowerCase()], tier: areaTier }]; });
        setAreaInput("");
      }}>
        <button type="submit" className="add-go" aria-label={t("settings.addArea")} disabled={!areaInput.trim()}><Icon name="plus" /></button>
        <input type="text" placeholder={t("settings.areaName")} aria-label={t("settings.areaName")} dir={areaInput ? "auto" : undefined} value={areaInput} onChange={(e) => setAreaInput(e.target.value)} />
        <TierSelect value={areaTier} onChange={setAreaTier} />
      </form>
    </>
  );
}

const AI_PROVIDERS = [{ id: "openai", name: "ChatGPT" }];
const AI_IDS = ["claude", "openai"];
const AI_NAMES: Record<string, string> = { claude: "Claude", openai: "ChatGPT" };

// The AI the site works with (ai.ts), on the introduction's board (bare) and wherever else a card of it is wanted; the
// settings screen has rows of its own for it (AiRows). Which one is primary, of those connected, and under it which
// takes over when it fails; then each one's connection, with a mark of whether it is connected. Claude's is this
// computer's Claude Code login, and ChatGPT's its Codex one (clis.ts): a button opens the sign-in in a window of its
// own, and the card sees it a few seconds after. bare: inside the introduction's board, which has its own heading.
export function AiKeys({ primary, onPrimary, bare = false }: { primary: string; onPrimary: (id: string) => void | Promise<void>; bare?: boolean }) {
  const { s, t, err } = useApp();
  const logins = (s.aiLogins ?? {}) as Record<string, boolean>;
  const connected = (id: string) => Boolean(logins[id]);
  // A pick shows at once, while it is saved; then the saved one shows, as it was if the save failed. moved: a pick
  // has moved the switch, and from then on the introduction's board plays its landing (styles.css), never as the
  // step comes in.
  const [picked, setPicked] = useState("");
  const [moved, setMoved] = useState(false);
  const want = picked || primary;
  const first = connected(want) ? want : AI_IDS.find(connected) ?? "claude";
  const pick = (id: string) => {
    if (id !== first) setMoved(true);
    setPicked(id);
    Promise.resolve(onPrimary(id)).finally(() => setPicked(""));
  };
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  const signIn = (p: { id: string; name: string }) => {
    setStatus([t("settings.ai.signingIn", { name: p.name }), false]);
    api("ai-login", { provider: p.id }).catch((e) => setStatus([err(e), true]));
  };
  const Frame = bare ? "div" : Card;
  return (
    <Frame className={bare ? "stack ai-setup" : "stack"}>
      {!bare && <h2>{t("settings.ai.title")}</h2>}
      {!bare && <p className="note">{t("settings.ai.note")}</p>}
      {/* Which one goes first, once there is a choice: in the introduction only with both connected, for the board to
          hold the rest without scrolling. */}
      {(!bare || AI_IDS.filter(connected).length > 1) && (
        <div className="field">
          <span className="field-label">{t("settings.ai.primary")}</span>
          <div className={moved ? "segmented moved" : "segmented"} role="group" aria-label={t("settings.ai.primary")}>
            {AI_IDS.map((id) => (
              <button key={id} type="button" aria-pressed={first === id && connected(id)} disabled={!connected(id)} onClick={() => pick(id)}>{AI_NAMES[id]}</button>
            ))}
          </div>
        </div>
      )}
      <div className="ai-list">
        <div className="ai-row">
          <div className="ai-row-head"><strong>Claude</strong><span className={`ai-state ${logins.claude ? "on" : ""}`}>{t(logins.claude ? "settings.ai.on" : "settings.ai.off")}</span></div>
          {logins.claude
            ? <p className="note">{t("settings.ai.claude")}</p>
            : <div className="ai-sign-in"><Btn onClick={() => signIn({ id: "claude", name: "Claude" })}>{t("settings.ai.signIn")}</Btn><small className="note">{t("settings.ai.claudeHow")}</small></div>}
        </div>
        {/* ChatGPT, through the account only (Codex): there is no key to paste (Sean, 2026-11-09). */}
        {AI_PROVIDERS.map((p) => (
          <div key={p.id} className="ai-row">
            <div className="ai-row-head">
              <strong>{p.name}</strong>
              <span className={`ai-state ${connected(p.id) ? "on" : ""}`}>{t(connected(p.id) ? "settings.ai.on" : "settings.ai.off")}</span>
            </div>
            {logins[p.id]
              ? <p className="note">{t(`settings.ai.${p.id}Login`)}</p>
              : <div className="ai-sign-in"><Btn onClick={() => signIn(p)}>{t("settings.ai.signIn")}</Btn><small className="note">{t(`settings.ai.${p.id}How`)}</small></div>}
          </div>
        ))}
      </div>
      {status[0] && <p className={status[1] ? "error-line" : "note"} role="status" dir="auto">{status[0]}</p>}
    </Frame>
  );
}

// Where the grade sheet opens, as the server serves it (data.ts).
export const TRANSCRIPT_FILE = `/file?path=${encodeURIComponent("user/documents/diplomas/transcript.pdf")}`;

/* ------------------------------------------------------------------------------------------------------------------
   The settings screen (Sean, 2026-11-23, "תעצב מחדש לגמרי"): one topic at a time. A list of the topics down the
   page's side, its highlight sliding to the one open, and that topic's settings as rows in a few framed groups: each
   row its name and a short line on what it does at the start, its control at the end. On and off are switches, the
   actions borderless pills or light links, never the boxed buttons. The topic open is in the address (#daily), so a
   reload keeps it, and the home page's link to its jobs (#home-jobs) opens the general topic at that group.
   ------------------------------------------------------------------------------------------------------------------ */

type Section = "place" | "roles" | "applying" | "daily" | "alerts" | "connections" | "general";
const SECTIONS: { id: Section; icon: string }[] = [
  { id: "place", icon: "pin" }, { id: "roles", icon: "companies" }, { id: "applying", icon: "apply" }, { id: "daily", icon: "runs" },
  { id: "alerts", icon: "bell" }, { id: "connections", icon: "link" }, { id: "general", icon: "filters" },
];
// The topics that can carry a dot, which is always there and grows in and out (styles.css).
const DOTTED = { daily: 1, alerts: 1, connections: 1 };
const sectionFromHash = (): Section => {
  const h = location.hash.slice(1);
  if (h === "home-jobs") return "general";
  return SECTIONS.find((x) => x.id === h)?.id ?? "place";
};

type Sent = { status: string; detail?: string } | null;
type Run = { started: string; finished?: string; steps: { step: string; company?: string; ok: boolean; note?: string }[]; drafted: string[]; mail: Sent; telegram?: Sent };
// The Telegram bot as the server shows it (telegram-bot.ts tgSaved): whether a token is saved, the bot's name, and
// whether it knows the user's chat. Never the token.
type TgInfo = { token: boolean; bot: string; chat: boolean; user: string };
type LinkStep = { text: string; link?: string; url?: string };
type Automation = {
  running: boolean; runs: Run[]; mailUser: string; telegram?: TgInfo;
  alerts?: { last: string; lastTold: string; told: number; running: boolean } | null;
};

// The daily run's and the alerts' state from the server (server.ts automationStatus): the runs, the Gmail account's
// address, the bot, the alerts' last check. Asked again every 10 seconds while the screen is open, and given back by
// whatever changes it (the account saved, the bot's token, a run started).
function useAutomation() {
  const [info, setInfo] = useState<Automation | null>(null);
  useEffect(() => {
    const load = () => api("automation").then(setInfo).catch(() => {});
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, []);
  return [info, setInfo] as const;
}

// A row: its name, and a short line on it, at the start; its control at the end. toggle: the whole row is the
// switch's label, so a click anywhere on it flips it. wide: the control goes under the words, across the row.
function Row({ label, hint, children, toggle = false, wide = false, className = "" }: {
  label: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode; toggle?: boolean; wide?: boolean; className?: string;
}) {
  const Tag = toggle ? "label" : "div";
  return (
    <Tag className={`set-row${wide ? " wide" : ""}${toggle ? " toggle" : ""} ${className}`}>
      <span className="set-text"><span className="set-label">{label}</span>{hint && <span className="set-hint">{hint}</span>}</span>
      {children && <span className="set-control">{children}</span>}
    </Tag>
  );
}

// A framed group of rows, with a heading and a line about it above the frame, or neither.
function Group({ title, note, id, children }: { title?: React.ReactNode; note?: React.ReactNode; id?: string; children: React.ReactNode }) {
  return (
    <section className="set-group" id={id}>
      {(title || note) && (
        <header className="set-group-head">
          {title && <h3>{title}</h3>}
          {note && <p>{note}</p>}
        </header>
      )}
      <div className="set-frame">{children}</div>
    </section>
  );
}

// On or off: a round track whose knob slides across, green while on.
function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label?: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="set-switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}><span className="set-switch-knob" /></button>;
}

// A borderless pill for an action (go: the mint one, for the main action of its group), and a line under it saying
// how the action went.
function Act({ go = false, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { go?: boolean }) {
  return <button type="button" className={`set-act${go ? " go" : ""} ${className}`} {...rest} />;
}
const Status = ({ status }: { status: [string, boolean] }) =>
  status[0] ? <p key={status[0]} className={`set-status${status[1] ? " bad" : ""}`} role="status" dir="auto">{status[0]}</p> : null;
// A connection's state: a round mark, green while connected, amber while it waits for something.
const State = ({ tone, children }: { tone: "on" | "wait" | "off"; children: React.ReactNode }) => <span className={`set-state ${tone}`}>{children}</span>;

// The topics down the side (along the top on a narrow screen): each its icon and name, a dot on the daily run and the
// alerts while they are on, and on the connections while one the delivery needs is missing. The highlight is one
// shape that slides to the topic open; the arrow keys go from topic to topic.
function SectionNav({ value, onChange, dots }: { value: Section; onChange: (id: Section) => void; dots: Partial<Record<Section, "on" | "warn">> }) {
  const { t } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const place = () => {
      const el = nav.querySelector<HTMLElement>(`[data-id="${value}"]`);
      if (el) setMark({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    place();
    // Along the top of a narrow screen, the topic open is brought into view, sliding sideways.
    const el = nav.querySelector<HTMLElement>(`[data-id="${value}"]`);
    if (el && nav.scrollWidth > nav.clientWidth) el.scrollIntoView({ inline: "center", block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const watch = new ResizeObserver(place);
    watch.observe(nav);
    return () => watch.disconnect();
  }, [value]);
  const keys = (e: React.KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1, ArrowLeft: 1, ArrowRight: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const dir = document.documentElement.dir === "ltr" && (e.key === "ArrowLeft" || e.key === "ArrowRight") ? -step : step;
    const at = SECTIONS.findIndex((x) => x.id === value);
    const next = SECTIONS[(at + dir + SECTIONS.length) % SECTIONS.length].id;
    onChange(next);
    ref.current?.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus();
  };
  return (
    <div className="set-nav" ref={ref} role="tablist" aria-orientation="vertical" aria-label={t("settings.nav.label")} onKeyDown={keys}>
      {mark && <span className="set-nav-mark" aria-hidden="true" style={{ width: mark.w, height: mark.h, transform: `translate(${mark.x}px, ${mark.y}px)` }} />}
      {SECTIONS.map((x) => (
        <button key={x.id} type="button" role="tab" id={`set-tab-${x.id}`} data-id={x.id} aria-selected={value === x.id} aria-controls="set-panel" tabIndex={value === x.id ? 0 : -1}
          onClick={() => onChange(x.id)}>
          <Icon name={x.icon} />
          <span className="set-nav-name">{t(`settings.nav.${x.id}`)}</span>
          {x.id in DOTTED && <span className={`set-nav-dot ${dots[x.id] ?? ""}`} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

const numberBox = (label: string, value: number, onChange: (n: number) => void) => (
  <input type="number" className="set-num" min={0} step={1} dir="ltr" aria-label={label} value={value || ""} onChange={(e) => onChange(Number(e.target.value))} />
);

// Where: the markets, the home city, the kind of work and moving for one, and the areas' ratings.
function PlaceSection({ draft, update, set }: { draft: any; update: Update; set: (key: string, value: unknown) => void }) {
  const { t } = useApp();
  return (
    <>
      <Group>
        <div className="set-block"><MarketsEditor draft={draft} update={update} title={<span className="set-label">{t("settings.markets")}</span>} /></div>
      </Group>
      <Group>
        <Row label={t("settings.home")}><input type="text" dir="auto" aria-label={t("settings.home")} value={draft.home} onChange={(e) => set("home", e.target.value)} /></Row>
        <Row label={t("settings.workMode")}>
          <Select label={t("settings.workMode")} value={draft.workMode} onChange={(v) => set("workMode", v)} options={["any", "remote", "hybrid", "onsite"].map((v) => ({ value: v, label: t(`modes.${v}`) }))} />
        </Row>
        <Row toggle label={t("settings.relocate")}><Switch on={draft.relocate} onChange={(on) => set("relocate", on)} /></Row>
      </Group>
      <Group title={t("settings.areas")}>
        <div className="set-block"><AreasEditor draft={draft} update={update} /></div>
      </Group>
    </>
  );
}

// What: the level, the roles from the list by field and any typed in, the industries and employers outside
// high-tech, and the fields that interest the user.
function RolesSection({ draft, update, set }: { draft: any; update: Update; set: (key: string, value: unknown) => void }) {
  const { t, lang } = useApp();
  const [roleInput, setRoleInput] = useState("");
  const ownRoles = draft.roles.filter((r: any) => !listedRole(r.id));
  const industries: string[] = draft.industries ?? [];
  const addRole = (e: React.FormEvent) => {
    e.preventDefault();
    const query = roleInput.trim();
    if (!query) return;
    // A title that is one from the list, at this level, is chosen there instead.
    const listed = matchListed(query, draft.seniority);
    update((d) => {
      if (d.roles.some((x: any) => x.query.toLowerCase() === query.toLowerCase() || (listed && x.id === listed.id))) return;
      d.roles.push(listed ? fromList(listed, d.seniority) : { label: query, query });
    });
    setRoleInput("");
  };
  return (
    <>
      <Group>
        <Row label={t("settings.seniority")} hint={t("settings.seniorityHint")}>
          <Select label={t("settings.seniority")} value={draft.seniority} onChange={(v) => update((d) => {
            d.seniority = v;
            d.roles = d.roles.map((r: any) => (listedRole(r.id) ? fromList(listedRole(r.id)!, d.seniority) : r));
          })} options={["any", "junior", "middle", "senior"].map((v) => ({ value: v, label: t(`settings.levels.${v}`) }))} />
        </Row>
      </Group>
      {/* Roles from the ready-made list, by field, chosen with a click; the search adds the level to each (roles.ts).
          Below them, any typed in by hand. */}
      <Group title={t("settings.roles")} note={t("settings.rolesNote")}>
        <div className="set-block">
          {ROLE_FIELDS.map((field) => (
            <div key={field.id} className="role-field">
              <h4 className="role-field-name">{field[lang]}</h4>
              <div className="chips">
                {field.roles.map((r) => {
                  const on = draft.roles.some((x: any) => x.id === r.id);
                  return (
                    <button key={r.id} type="button" className="role-pick" dir="auto" aria-pressed={on} onClick={() => update((d) => {
                      d.roles = on ? d.roles.filter((x: any) => x.id !== r.id) : [...d.roles, fromList(r, d.seniority)];
                    })}>{r[lang]}</button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="set-block">
          <h4 className="role-field-name">{t("settings.ownRoles")}</h4>
          {ownRoles.length > 0 && (
            <div className="chips">
              {ownRoles.map((r: any) => (
                <span key={r.query} className="tag" dir="auto">{r.label}
                  <button type="button" className="tag-x" aria-label={`${t("common.remove")} ${r.label}`} onClick={() => update((d) => { d.roles = d.roles.filter((x: any) => x.query !== r.query); })}><Icon name="close" /></button>
                </span>
              ))}
            </div>
          )}
          <form className="add-row" onSubmit={addRole}>
            <button type="submit" className="add-go" aria-label={t("settings.addRole")} disabled={!roleInput.trim()}><Icon name="plus" /></button>
            <input type="text" placeholder={t("settings.role")} aria-label={t("settings.role")} dir="auto" value={roleInput} onChange={(e) => setRoleInput(e.target.value)} />
          </form>
          <p className="set-hint">{t("settings.rolesLevel", { example: roleQuery(listedRole("backend")!, draft.seniority) })}</p>
        </div>
      </Group>
      {/* Which industries to search and whether employers outside high-tech are read; the portals page lists them all
          (and has the same choices, IndustryPicker in portals.tsx). */}
      <Group title={t("settings.industries")} note={t("settings.industriesNote")}>
        <div className="set-block">
          <div className="chips">
            {INDUSTRIES.map((i) => {
              const on = industries.includes(i.id);
              return (
                <button key={i.id} type="button" className="role-pick" aria-pressed={on} onClick={() => update((d) => {
                  d.industries = on ? (d.industries ?? []).filter((x: string) => x !== i.id) : [...(d.industries ?? []), i.id];
                })}>{i[lang]}</button>
              );
            })}
          </div>
        </div>
        <Row toggle label={t("settings.lowTech")} hint={t("settings.lowTechNote")}><Switch on={draft.lowTech !== false} onChange={(on) => set("lowTech", on)} /></Row>
        <div className="set-foot"><a className="set-link" href="/portals">{t("settings.toPortals")}<Icon name="onward" /></a></div>
      </Group>
      <Group>
        <Row wide label={t("settings.fields")} hint={t("settings.fieldsHint")}>
          <input type="text" dir="auto" aria-label={t("settings.fields")} placeholder="All fields, including defense companies" value={draft.fields} onChange={(e) => set("fields", e.target.value)} />
        </Row>
      </Group>
    </>
  );
}

// The grade sheet (transcript.ts), kept here once for the jobs that ask for one: the applications page offers it
// beside their CV, on its own and joined to it in one file. A PDF; a new one takes the old one's place, and one
// locked against copying is said to go on its own only.
function TranscriptRow() {
  const { s, t, err, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const kept = s.transcript;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(err(e));
    }
    setBusy(false);
  };
  const take = (file?: File) => { if (file) run(async () => api("transcript", { data: await readBase64(file) })); };
  return (
    <>
      <Row label={t("settings.transcript.title")} hint={t("settings.transcript.note")}>
        {busy && <Spinner />}
        <Act disabled={busy} onClick={() => picker.current?.click()}><Icon name={kept ? "refresh" : "upload"} />{t(kept ? "settings.transcript.replace" : "settings.transcript.upload")}</Act>
      </Row>
      <input ref={picker} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
      {(kept || error) && (
        <div className="set-foot">
          {kept && <a className="set-link" href={TRANSCRIPT_FILE} target="_blank" rel="noopener"><Icon name="file" />{t("settings.transcript.open")}</a>}
          {kept && <button type="button" className="set-link quiet" disabled={busy} onClick={() => { if (confirm(t("settings.transcript.confirm"))) run(() => api("transcript/remove", {})); }}>{t("common.remove")}</button>}
          {kept && !kept.joinable && <p className="set-status warn">{t("settings.transcript.locked")}</p>}
          {error && <p className="set-status bad" role="alert" dir="auto">{error}</p>}
        </div>
      )}
    </>
  );
}

// Applying: the Wolf Pack that tries to reject each CV, the salary for forms and interviews, student positions, and
// the grade sheet.
function ApplyingSection({ draft, set }: { draft: any; set: (key: string, value: unknown) => void }) {
  const { t } = useApp();
  return (
    <>
      <Group>
        <Row toggle className="lead" label={t("settings.wolfPack")} hint={t("settings.wolfPackHint")}>
          <Switch on={draft.wolfPack === true} onChange={(on) => set("wolfPack", on)} />
        </Row>
      </Group>
      <Group>
        <Row label={t("settings.salary")} hint={t("settings.salaryHint")}>
          <span className="set-range">
            {numberBox(t("settings.salaryFrom"), draft.salaryMin, (n) => set("salaryMin", n))}
            <span className="set-range-word">{t("settings.salaryTo")}</span>
            {numberBox(t("settings.salaryTo"), draft.salaryMax, (n) => set("salaryMax", n))}
            <input type="text" className="set-currency" dir="ltr" placeholder="ILS" aria-label={t("settings.currency")} value={draft.salaryCurrency} onChange={(e) => set("salaryCurrency", e.target.value)} />
          </span>
        </Row>
        <Row label={t("settings.student")}>
          <Select label={t("settings.student")} value={draft.studentJobs} onChange={(v) => set("studentJobs", v)} options={["normal", "low", "exclude"].map((v) => ({ value: v, label: t(`settings.studentOptions.${v}`) }))} />
        </Row>
      </Group>
      <Group><TranscriptRow /></Group>
    </>
  );
}

// The daily run: on or off (turned on here, it runs here: an account on several computers runs it on one of them,
// accounts.ts, and one that runs it elsewhere says so, with the way to run it here instead), when and how much, where
// the CVs go and whether that way is connected, and the last runs with a way to run one now.
function DailySection({ draft, update, setAuto, auto, setAutoInfo, go }: {
  draft: any; update: Update; setAuto: (key: string, value: unknown) => void; auto: Automation | null; setAutoInfo: (a: Automation) => void; go: (id: Section) => void;
}) {
  const { s, t, lang, err } = useApp();
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  const times: string[] = draft.automation.runTimes?.length ? draft.automation.runTimes : ["09:00"];
  const delivery: string = draft.automation.delivery ?? "telegram";
  const bot = auto?.telegram;
  const elsewhere = draft.automation.enabled && draft.automation.computer && s.computer && draft.automation.computer !== s.computer;
  const mailText = (m: Sent | undefined) => (m ? t(`settings.mail.${m.status}`, { detail: m.detail ?? "" }) : "");
  const botText = (m: Sent | undefined) => (m ? t(`settings.telegram.result.${m.status}`, { detail: m.detail ?? "" }) : "");
  const runNow = async () => {
    try {
      if (!confirm(t("settings.confirm"))) return;
      setAutoInfo(await api("automation/run", {}));
      setStatus([t("settings.started"), false]);
    } catch (e) { setStatus([err(e), true]); }
  };
  return (
    <>
      <Group>
        <Row toggle className="lead" label={t("settings.enable")} hint={t("settings.dailyCost")}>
          <Switch on={draft.automation.enabled} onChange={(on) => update((d) => { d.automation.enabled = on; if (on) d.automation.computer = s.computer ?? ""; })} />
        </Row>
        {elsewhere && (
          <div className="set-foot">
            <p className="set-status warn">{t("settings.dailyElsewhere")}</p>
            <button type="button" className="set-link" onClick={() => setAuto("computer", s.computer)}>{t("settings.dailyHere")}</button>
          </div>
        )}
        <div className="set-foot"><p className="set-status warn"><Icon name="warn" />{t("settings.dailyWarn")}</p></div>
      </Group>
      <Group>
        {/* The times on a row of their own, its note saying what more than RUN_TIMES_ADVISED a day cost once there are more. */}
        <Row wide label={t("settings.runTimes")} hint={times.length > RUN_TIMES_ADVISED
          ? <><b>{t("settings.runTimesManyTitle")}</b>: {t("settings.runTimesManyWhy")} <b>{t("settings.runTimesManyQuota")}</b></> : t("settings.runTimesNote")}>
          <RunTimes times={times} onChange={(next) => setAuto("runTimes", next)} />
        </Row>
        <Row label={t("settings.perDay")}>{numberBox(t("settings.perDay"), draft.automation.maxPerDay, (n) => setAuto("maxPerDay", n))}</Row>
        <Row label={t("settings.minScore")}>{numberBox(t("settings.minScore"), draft.automation.minScore, (n) => setAuto("minScore", n))}</Row>
      </Group>
      {/* Where the CVs go: the user's Telegram bot by default (Sean, 2026-11-23), email, or both; whether the way chosen
          is connected, with a link to the connections where it isn't. */}
      <Group title={t("settings.delivery")} note={t("settings.deliveryNote")}>
        <Row label={t("settings.deliveryWay")}>
          <div className="segmented" role="group" aria-label={t("settings.delivery")}>
            {(["telegram", "email", "both"] as const).map((d) => (
              <button key={d} type="button" aria-pressed={delivery === d} onClick={() => setAuto("delivery", d)}>{t(`settings.deliveries.${d}`)}</button>
            ))}
          </div>
        </Row>
        <Row label={t("settings.email")}><input type="email" dir="ltr" aria-label={t("settings.email")} value={draft.automation.email} onChange={(e) => setAuto("email", e.target.value)} /></Row>
        {auto && (
          <div className="set-foot ready">
            {delivery !== "email" && (bot?.chat
              ? <State tone="on">{t("settings.botReady", { bot: `⁦@${bot.bot}⁩` })}</State>
              : <><State tone="wait">{t("settings.botMissing")}</State><button type="button" className="set-link" onClick={() => go("connections")}>{t("settings.toConnect")}<Icon name="onward" /></button></>)}
            {delivery !== "telegram" && (auto.mailUser
              ? <State tone="on">{t("settings.mailReady", { user: `⁦${auto.mailUser}⁩` })}</State>
              : <><State tone="wait">{t("settings.mailMissing")}</State><button type="button" className="set-link" onClick={() => go("connections")}>{t("settings.toConnect")}<Icon name="onward" /></button></>)}
          </div>
        )}
      </Group>
      <Group title={t("settings.runs")}>
        <div className="set-runs-head">
          {auto?.running ? <span className="set-status"><Spinner />{t("settings.runningNow")}</span> : <span className="set-hint">{t("settings.runsNote")}</span>}
          <Act go onClick={runNow} disabled={auto?.running}><Icon name="play" />{t("settings.runNow")}</Act>
        </div>
        <Status status={status} />
        {auto && !auto.runs.length && !auto.running && <p className="set-empty">{t("settings.noRuns")}</p>}
        {auto?.runs.slice(0, 5).map((run) => (
          <div key={run.started} className="set-run">
            <span className="set-run-when" dir="ltr">{new Date(run.started).toLocaleString(lang === "he" ? "he-IL" : "en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
            <span className="set-run-what">
              <strong>{run.finished ? t("settings.cvs", { n: run.drafted.length }) : t("settings.inProgress")}</strong>
              {run.telegram && <span dir="auto">{botText(run.telegram)}</span>}
              {run.mail && <span dir="auto">{mailText(run.mail)}</span>}
              {run.steps.filter((x) => !x.ok).map((x, i) => (
                <span key={i} className="bad" dir="auto">{t(`settings.steps.${x.step}`)}{x.company ? ` ${x.company}` : ""}: {x.note ?? t("settings.unfinished")}</span>
              ))}
            </span>
          </div>
        ))}
      </Group>
      <p className="set-tip">{t("settings.dailyTip")}</p>
    </>
  );
}

// The live alerts (alerts.ts): the search watched with no AI every few minutes, each new job told on this computer
// and by email (to the daily run's address, through its Gmail account), the high-tech and known companies' marked apart.
function AlertsSection({ draft, update, auto }: { draft: any; update: Update; auto: Automation | null }) {
  const { t, err } = useApp();
  const alerts = draft.alerts ?? { enabled: false, email: true, telegram: true, desktop: true, every: 15 };
  const last = auto?.alerts ?? null;
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  const set = (key: string, value: unknown) => update((d) => { d.alerts = { ...alerts, [key]: value }; });
  // The test says how each way went; Telegram's only when the bot is connected and chosen (null otherwise).
  const test = async () => {
    try {
      setStatus([t("settings.sending"), false]);
      const r = await api("automation/alert-test", {});
      const tg = r.telegram ? t(`settings.telegram.result.${r.telegram.status}`, { detail: r.telegram.detail ?? "" }) + "." : "";
      const failed = !r.desktop || r.mail.status !== "sent" || (r.telegram && r.telegram.status !== "sent");
      setStatus([[r.desktop ? t("settings.alertDesktopShown") : t("settings.alertDesktopFailed"), t(`settings.mail.${r.mail.status}`, { detail: r.mail.detail ?? "" }), tg].filter(Boolean).join(" "), failed]);
    } catch (e) { setStatus([err(e), true]); }
  };
  const time = (iso: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
  return (
    <>
      <Group>
        <Row toggle className="lead" label={t("settings.alertsOn")} hint={t("settings.alertsWhen")}><Switch on={alerts.enabled} onChange={(on) => set("enabled", on)} /></Row>
        {alerts.enabled && last && (
          <div className="set-foot">
            <p className="set-status" role="status">
              {last.running ? t("settings.alertsRunning") : last.last ? t("settings.alertsLast", { time: time(last.last) }) : t("settings.alertsSoon")}
              {last.told ? ` ${t("settings.alertsTold", { n: last.told, time: time(last.lastTold) })}` : ""}
            </p>
          </div>
        )}
      </Group>
      <Group title={t("settings.alertsHow")}>
        <Row toggle label={t("settings.alertsDesktop")}><Switch on={alerts.desktop} onChange={(on) => set("desktop", on)} /></Row>
        <Row toggle label={t("settings.alertsEmail")}><Switch on={alerts.email} onChange={(on) => set("email", on)} /></Row>
        <Row toggle label={t("settings.alertsTelegram")} hint={auto && !auto.telegram?.chat ? t("settings.alertsTelegramOff") : undefined}>
          <Switch on={alerts.telegram !== false} onChange={(on) => set("telegram", on)} />
        </Row>
        <Row label={t("settings.alertsEvery")} hint={t("settings.alertsEveryNote")}>
          <Select label={t("settings.alertsEvery")} value={String(alerts.every)} onChange={(v) => set("every", Number(v))} options={[5, 10, 15, 30, 60].map((n) => ({ value: String(n), label: t("settings.alertsMinutes", { n }) }))} />
        </Row>
        <div className="set-foot">
          <Act onClick={test}><Icon name="apply" />{t("settings.alertTest")}</Act>
          <Status status={status} />
        </div>
      </Group>
      <p className="set-tip">{t("settings.alertsMarked")}</p>
    </>
  );
}

// The AI the site works with (ai.ts) as rows: which one is primary, of those connected (if it fails the next one
// connected takes over), and each one's connection, signed in from here in a window of its own (clis.ts).
function AiRows({ primary, onPrimary }: { primary: string; onPrimary: (id: string) => void }) {
  const { s, t, err } = useApp();
  const logins = (s.aiLogins ?? {}) as Record<string, boolean>;
  const connected = (id: string) => Boolean(logins[id]);
  const [picked, setPicked] = useState("");
  const want = picked || primary;
  const first = connected(want) ? want : AI_IDS.find(connected) ?? "claude";
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  const signIn = (id: string) => {
    setStatus([t("settings.ai.signingIn", { name: AI_NAMES[id] }), false]);
    api("ai-login", { provider: id }).catch((e) => setStatus([err(e), true]));
  };
  return (
    <Group title={t("settings.ai.title")} note={t("settings.ai.note")}>
      <Row label={t("settings.ai.primary")}>
        <div className="segmented" role="group" aria-label={t("settings.ai.primary")}>
          {AI_IDS.map((id) => (
            <button key={id} type="button" aria-pressed={first === id && connected(id)} disabled={!connected(id)} onClick={() => { setPicked(id); onPrimary(id); }}>{AI_NAMES[id]}</button>
          ))}
        </div>
      </Row>
      {AI_IDS.map((id) => (
        <Row key={id} label={AI_NAMES[id]} hint={connected(id) ? t(id === "claude" ? "settings.ai.claude" : "settings.ai.openaiLogin") : t(`settings.ai.${id}How`)}>
          {connected(id) ? <State tone="on">{t("settings.ai.on")}</State> : <Act onClick={() => signIn(id)}><Icon name="login" />{t("settings.ai.signIn")}</Act>}
        </Row>
      ))}
      {status[0] && <div className="set-foot"><Status status={status} /></div>}
    </Group>
  );
}

// The CVs on the user's own Telegram bot (telegram-bot.ts): whom it writes to once the user pressed Start (the server
// looks for their chat while this screen asks), how to make one with @BotFather while it isn't connected, folding away
// once it is, the box for its token, saved as the box is left, and a test message.
function TelegramRows({ info, onInfo }: { info: TgInfo | null; onInfo: (a: Automation) => void }) {
  const { t, err } = useApp();
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  const attempt = async (work: () => Promise<void>) => { try { await work(); } catch (e) { setStatus([err(e), true]); } };
  const save = () => {
    if (!token.trim()) return;
    attempt(async () => { setStatus([t("settings.telegram.saving"), false]); onInfo(await api("automation/telegram", { token })); setToken(""); setStatus(["", false]); });
  };
  const steps = t("settings.telegram.steps") as LinkStep[];
  const [before, after] = String(t("settings.telegram.waitStart")).split("{link}");
  const connected = Boolean(info?.chat);
  const waiting = Boolean(info?.token && info.bot && !info.chat);
  return (
    <Group title={t("settings.telegram.title")} note={t("settings.telegram.note")}>
      <Row label={t("settings.telegram.bot")} hint={connected
        ? t("settings.telegram.connected", { bot: `⁦@${info!.bot}⁩` })
        : waiting ? <>{before}<bdi dir="ltr"><External url={`https://t.me/${info!.bot}`} className="">@{info!.bot}</External></bdi>{after}</> : t("settings.telegram.none")}>
        {connected ? <State tone="on">{t("settings.ai.on")}</State> : waiting ? <State tone="wait"><Spinner />{t("settings.telegram.waiting")}</State> : <State tone="off">{t("settings.ai.off")}</State>}
      </Row>
      <div className={`set-fold${connected ? "" : " open"}`} aria-hidden={connected} {...(connected ? { inert: "" } : {})}>
        <div>
          <ol className="set-steps">
            {steps.map((step, i) => {
              const [head, tail] = step.text.split("{link}");
              return <li key={i}><span className="set-step-n" aria-hidden="true">{i + 1}</span><span>{head}{step.link && step.url && <External url={step.url} className="">{step.link}</External>}{tail}</span></li>;
            })}
          </ol>
        </div>
      </div>
      <Row label={t("settings.telegram.token")}>
        <input type="password" dir="ltr" autoComplete="off" aria-label={t("settings.telegram.token")} placeholder={info?.token ? t("settings.telegram.tokenSaved") : "123456789:AA..."} value={token}
          onChange={(e) => setToken(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      </Row>
      <div className="set-foot">
        <Act disabled={!connected} onClick={() => attempt(async () => { setStatus([t("settings.sending"), false]); const { result } = await api("automation/telegram-test", {}); setStatus([t(`settings.telegram.result.${result.status}`, { detail: result.detail ?? "" }), result.status !== "sent"]); })}>
          <Icon name="apply" />{t("settings.telegram.test")}
        </Act>
        <Status status={status} />
      </div>
    </Group>
  );
}

// The Gmail account the CVs and the alerts are sent through, apart from the settings form, which a half-typed password
// would otherwise ride along with: it saves itself once both are filled and the password's box is left (or Enter
// pressed), never while a password is half typed; only the address comes back.
function MailRows({ mailUser, onInfo }: { mailUser: string; onInfo: (a: Automation) => void }) {
  const { t, err } = useApp();
  const [user, setUser] = useState(mailUser);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  useEffect(() => { setUser((u) => u || mailUser); }, [mailUser]);
  const attempt = async (work: () => Promise<void>) => { try { await work(); } catch (e) { setStatus([err(e), true]); } };
  const save = () => {
    if (!user.trim() || !password) return;
    attempt(async () => { onInfo(await api("automation/mail", { user, password })); setPassword(""); setStatus([t("settings.accountSaved"), false]); });
  };
  const [before, after] = String(t("settings.accountNote")).split("{link}");
  return (
    <Group title={t("settings.account")} note={<>{before}<External url="https://myaccount.google.com/apppasswords" className="">{t("settings.appPassword")}</External>{after}</>}>
      <Row label={t("settings.gmail")}>
        {mailUser && <State tone="on">{t("settings.ai.on")}</State>}
        <input type="email" dir="ltr" placeholder="you@gmail.com" aria-label={t("settings.gmail")} value={user} onChange={(e) => setUser(e.target.value)} onBlur={save} />
      </Row>
      <Row label={t("settings.appPasswordLabel")}>
        <input type="password" dir="ltr" autoComplete="off" aria-label={t("settings.appPassword")} placeholder={mailUser ? t("settings.passwordSaved") : t("settings.appPassword")} value={password}
          onChange={(e) => setPassword(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      </Row>
      <div className="set-foot">
        <Act onClick={() => attempt(async () => { setStatus([t("settings.sending"), false]); const { result } = await api("automation/test", {}); setStatus([result ? t(`settings.mail.${result.status}`, { detail: result.detail ?? "" }) : "", result?.status !== "sent"]); })}>
          <Icon name="mail" />{t("settings.test")}
        </Act>
        <Status status={status} />
      </div>
    </Group>
  );
}

// Phone access (remote.ts): the site's address, and linking this computer there under the account's name; once
// linked, where to go on the phone, as whom, and whether the computer is connected to the site right now.
function RemoteRows() {
  const { s, t, err, refresh } = useApp();
  const r = s.remote ?? { linked: false, site: "", name: "", state: "off", error: "" };
  const [site, setSite] = useState(r.site);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const host = r.site.replace(/^https?:\/\//, "");
  const run = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      await api(path, body);
      await refresh();
    } catch (e) {
      setError(err(e));
    }
    setBusy(false);
  };
  // The connection's trouble while it is down, and a name the site wouldn't take at any time: signing in there needs it.
  const shown = r.linked && r.error && (r.state !== "on" || r.error.startsWith("remote_name"));
  const problem = error || (shown ? err(Object.assign(new Error(r.error), { code: r.error })) : "");
  return (
    <Group title={t("settings.remote.title")} note={t("settings.remote.note")}>
      {r.linked ? (
        <>
          <Row label={<bdi dir="ltr">{host}</bdi>} hint={r.name ? t("settings.remote.how", { site: host, name: r.name }) : undefined}>
            <State tone={r.state === "on" ? "on" : r.state === "connecting" ? "wait" : "off"}>{t(`settings.remote.${r.state}`)}</State>
          </Row>
          <div className="set-foot">
            <button type="button" className="set-link quiet" disabled={busy} onClick={() => { if (confirm(t("settings.remote.confirm"))) run("remote/unlink", {}); }}>{t("settings.remote.unlink")}</button>
          </div>
        </>
      ) : (
        <form className="set-row wide" onSubmit={(e) => { e.preventDefault(); run("remote/link", { site }); }}>
          <span className="set-text"><span className="set-label">{t("settings.remote.site")}</span></span>
          <span className="set-control set-inline">
            <input type="text" dir="ltr" placeholder="pip.example.com" aria-label={t("settings.remote.site")} value={site} onChange={(e) => setSite(e.target.value)} />
            <Act go type="submit" disabled={busy || !site.trim()}>{busy ? <Spinner /> : <Icon name="phone" />}{t("settings.remote.link")}</Act>
          </span>
        </form>
      )}
      {problem && <div className="set-foot"><p className="set-status bad" role="alert" dir="auto">{problem}</p></div>}
    </Group>
  );
}

// General: the name shown, the language and theme (they apply at once and stay in this browser, so they need no
// saving; while the English version or the dark theme is off, app.tsx, its row is marked as coming soon and its
// buttons can't be pressed), and which jobs the home page shows (ui/home-jobs.ts). The home page's line under its
// heading links to that group (#home-jobs), and the screen comes to it.
function GeneralSection({ draft, update, set }: { draft: any; update: Update; set: (key: string, value: unknown) => void }) {
  const { t, lang, setLang, theme, setTheme } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const choice = homeJobsFrom(draft.homeJobs);
  const setHome = (key: string, value: unknown) => update((d) => { d.homeJobs = { ...choice, [key]: value }; });
  useEffect(() => { if (location.hash === "#home-jobs") ref.current?.scrollIntoView({ block: "start" }); }, []);
  const soon = <span className="soon">{t("common.soon")}</span>;
  return (
    <>
      <Group>
        <Row label={t("settings.displayName")}><input type="text" dir="auto" aria-label={t("settings.displayName")} value={draft.displayName} onChange={(e) => set("displayName", e.target.value)} /></Row>
        <Row label={<>{t("settings.uiLanguage")}{!LANGUAGES_ON && soon}</>} hint={t("settings.displayNote")}>
          <div className="segmented" role="group" aria-label={t("settings.uiLanguage")}>
            <button type="button" lang="he" aria-pressed={lang === "he"} disabled={!LANGUAGES_ON} onClick={() => setLang("he")}>עברית</button>
            <button type="button" lang="en" aria-pressed={lang === "en"} disabled={!LANGUAGES_ON} onClick={() => setLang("en")}>English</button>
          </div>
        </Row>
        <Row label={<>{t("settings.uiTheme")}{!THEMES_ON && soon}</>}>
          <div className="segmented" role="group" aria-label={t("settings.uiTheme")}>
            {([["light", "sun", "themeLight"], ["dark", "moon", "themeDark"], ["", "", "themeSystem"]] as const).map(([mode, icon, key]) => (
              <button key={key} type="button" aria-pressed={theme === mode} disabled={!THEMES_ON} onClick={() => setTheme(mode)}>{icon && <Icon name={icon} />}{t(`settings.${key}`)}</button>
            ))}
          </div>
        </Row>
      </Group>
      <div ref={ref} id="home-jobs" className="set-anchor">
        <Group title={t("settings.homeJobs.title")} note={t("settings.homeJobs.note")}>
          <Row label={t("settings.homeJobs.days")} hint={choice.days === 1 ? t("settings.homeJobs.dayHint") : undefined}>
            <Select label={t("settings.homeJobs.days")} value={String(choice.days)} onChange={(v) => setHome("days", Number(v))} options={HOME_DAYS.map((n) => ({ value: String(n), label: t(`settings.homeJobs.dayOptions.${n}`) }))} />
          </Row>
          <Row label={t("settings.homeJobs.count")}>
            <Select label={t("settings.homeJobs.count")} value={String(choice.count)} onChange={(v) => setHome("count", Number(v))} options={HOME_COUNTS.map((n) => ({ value: String(n), label: t("settings.homeJobs.countOption", { n }) }))} />
          </Row>
          <Row label={t("settings.homeJobs.order")}>
            <Select label={t("settings.homeJobs.order")} value={choice.order} onChange={(v) => setHome("order", v)} options={HOME_ORDERS.map((o) => ({ value: o, label: t(`settings.homeJobs.orders.${o}`) }))} />
          </Row>
        </Group>
      </div>
    </>
  );
}

export function Settings() {
  const { s, t, lang, refresh, loaded } = useApp();
  // The screen can open before the first state is in, as when the page is reloaded here; until then it has no
  // draft, so the app's empty stand-in is never shown, nor saved over the real settings.
  const [draft, setDraft] = useState<any>(() => (loaded ? structuredClone(s.settings) : null));
  const [section, setSection] = useState<Section>(sectionFromHash);
  const [auto, setAutoInfo] = useAutomation();
  useEffect(() => { if (!draft && loaded) setDraft(structuredClone(s.settings)); }, [loaded, s.settings]);
  // Every change saves itself a moment later; the form keeps what was typed, the saved settings come back through
  // the app's state. The note at the top says how it went.
  const saving = useAutoSave(draft, async (next) => {
    await api("settings", { ...next, language: lang });
    await refresh();
  }, { ready: Boolean(draft) });

  const go = (id: Section) => {
    if (id === section) return;
    setSection(id);
    history.replaceState(history.state, "", `${location.pathname}${location.search}#${id}`);
    document.querySelector("main")?.scrollTo({ top: 0 });
  };
  const head = (
    <header className="page-head">
      <div><h1>{t("settings.title")}</h1><p className="sub">{t("settings.sub")}</p></div>
      <div className="row"><SaveNote state={saving} /></div>
    </header>
  );
  if (!draft) return <div className="page settings">{head}<Spinner /></div>;

  const update = (fn: (d: any) => void) => { const next = structuredClone(draft); fn(next); setDraft(next); };
  const set = (key: string, value: unknown) => update((d) => { d[key] = value; });
  const setAuto = (key: string, value: unknown) => update((d) => { d.automation[key] = value; });
  const delivery: string = draft.automation.delivery ?? "telegram";
  const missing = auto && ((delivery !== "email" && !auto.telegram?.chat) || (delivery !== "telegram" && !auto.mailUser));
  const dots: Partial<Record<Section, "on" | "warn">> = {
    daily: draft.automation.enabled ? "on" : undefined,
    alerts: draft.alerts?.enabled ? "on" : undefined,
    connections: draft.automation.enabled && missing ? "warn" : undefined,
  };

  return (
    <div className="page settings">
      {head}
      <div className="set-layout">
        <SectionNav value={section} onChange={go} dots={dots} />
        <div key={section} id="set-panel" className="set-panel" role="tabpanel" aria-labelledby={`set-tab-${section}`}>
          <header className="set-panel-head">
            <h2>{t(`settings.nav.${section}`)}</h2>
            <p>{t(`settings.intro.${section}`)}</p>
          </header>
          {section === "place" && <PlaceSection draft={draft} update={update} set={set} />}
          {section === "roles" && <RolesSection draft={draft} update={update} set={set} />}
          {section === "applying" && <ApplyingSection draft={draft} set={set} />}
          {section === "daily" && <DailySection draft={draft} update={update} setAuto={setAuto} auto={auto} setAutoInfo={setAutoInfo} go={go} />}
          {section === "alerts" && <AlertsSection draft={draft} update={update} auto={auto} />}
          {section === "connections" && (
            <>
              <AiRows primary={draft.aiPrimary} onPrimary={(id) => set("aiPrimary", id)} />
              <TelegramRows info={auto?.telegram ?? null} onInfo={setAutoInfo} />
              <MailRows mailUser={auto?.mailUser ?? ""} onInfo={setAutoInfo} />
              <RemoteRows />
            </>
          )}
          {section === "general" && <GeneralSection draft={draft} update={update} set={set} />}
        </div>
      </div>
    </div>
  );
}
