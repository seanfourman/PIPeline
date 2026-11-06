import React, { useEffect, useRef, useState } from "react";
import { LANGUAGES_ON, THEMES_ON, useApp } from "../app";
import { AREA_NAMES_EN, type Lang } from "../i18n";
import { api, Btn, Card, External, Field, Icon, Page, Spinner } from "../kit";
import { SaveNote, useAutoSave } from "../autosave";
import { Select } from "../select";
import { fromList, listedRole, matchListed, ROLE_FIELDS, roleQuery } from "../../roles";
import { readBase64 } from "./chat";
import { PixelArt, Tick } from "./home";
import { IndustryPicker } from "./portals";

const COUNTRY_CODES = "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NZ OM PA PE PG PH PK PL PR PS PT PY QA RO RS RU RW SA SC SD SE SG SI SK SL SN SO SR SV SY SZ TD TG TH TJ TM TN TR TT TW TZ UA UG US UY UZ VE VN YE ZA ZM ZW".split(" ");
const TIERS = ["near", "ok", "edge", "far"];
// The daily run's times, up to three a day as settings.ts keeps them; one added takes the first of these not taken.
const RUN_TIMES = 3;
const nextTime = (times: string[]) => ["13:00", "17:00", "21:00", "09:00"].find((t) => !times.includes(t)) ?? "12:00";

const regionName = (code: string, lang: Lang) => { try { return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code; } catch { return code; } };

// The daily run's times, here and in the introduction's step for the email: a field for each, with a × once there
// are two, and a button for another while there are fewer than RUN_TIMES.
export function RunTimes({ times, onChange }: { times: string[]; onChange: (times: string[]) => void }) {
  const { t } = useApp();
  return (
    <span className="run-times">
      {times.map((time, i) => (
        <span key={i} className="run-time">
          <input type="time" dir="ltr" value={time} aria-label={t("settings.runTime", { n: i + 1 })}
            onChange={(e) => onChange(times.map((x, j) => (j === i ? e.target.value : x)))} />
          {times.length > 1 && (
            <button type="button" className="tag-x" aria-label={t("settings.removeTime", { time })} onClick={() => onChange(times.filter((_, j) => j !== i))}>×</button>
          )}
        </span>
      ))}
      {times.length < RUN_TIMES && <Btn kind="ghost" onClick={() => onChange([...times, nextTime(times)])}>{t("settings.addTime")}</Btn>}
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

export function MarketsEditor({ draft, update, title, bare = false }: { draft: any; update: Update; title: React.ReactNode; bare?: boolean }) {
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
      ) : <p className="error-line">{t("settings.noMarket")}</p>}
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

type Run = { started: string; finished?: string; steps: { step: string; company?: string; ok: boolean; note?: string }[]; drafted: string[]; mail: { status: string; detail?: string } | null };

// Apart from the settings form, which a half-typed password would otherwise ride along with.
function Runner() {
  const { t, lang, err } = useApp();
  const [info, setInfo] = useState<{ running: boolean; runs: Run[]; mailUser: string } | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  const load = () => api("automation").then((d) => { setInfo(d); setUser((u) => u || d.mailUser); }).catch(() => {});
  useEffect(() => { load(); const timer = setInterval(load, 10_000); return () => clearInterval(timer); }, []);
  const attempt = async (work: () => Promise<void>) => { try { await work(); } catch (e) { setStatus([err(e), true]); } };
  const mailText = (m: Run["mail"]) => (m ? t(`settings.mail.${m.status}`, { detail: m.detail ?? "" }) : "");
  const [before, after] = String(t("settings.accountNote")).split("{link}");
  // The account saves itself once both are filled and the password's box is left (or Enter pressed), never while
  // a password is half typed.
  const saveAccount = () => {
    if (!user.trim() || !password) return;
    attempt(async () => { setInfo(await api("automation/mail", { user, password })); setPassword(""); setStatus([t("settings.accountSaved"), false]); });
  };
  return (
    <div className="stack">
      <h3 className="sub-title">{t("settings.account")}</h3>
      <p className="note">{before}<External url="https://myaccount.google.com/apppasswords" className="">{t("settings.appPassword")}</External>{after}</p>
      <div className="row">
        <input type="email" dir="ltr" placeholder="you@gmail.com" aria-label={t("settings.gmail")} value={user} onChange={(e) => setUser(e.target.value)} onBlur={saveAccount} />
        <input type="password" dir="ltr" autoComplete="off" aria-label={t("settings.appPassword")} placeholder={info?.mailUser ? t("settings.passwordSaved") : t("settings.appPassword")} value={password}
          onChange={(e) => setPassword(e.target.value)} onBlur={saveAccount} onKeyDown={(e) => { if (e.key === "Enter") saveAccount(); }} />
      </div>
      <div className="row">
        <Btn onClick={() => attempt(async () => { setStatus([t("settings.sending"), false]); const { result } = await api("automation/test", {}); setStatus([mailText(result), result.status !== "sent"]); })}>{t("settings.test")}</Btn>
        <Btn onClick={() => attempt(async () => { if (!confirm(t("settings.confirm"))) return; setInfo(await api("automation/run", {})); setStatus([t("settings.started"), false]); })}>{t("settings.runNow")}</Btn>
      </div>
      {status[0] && <p className={status[1] ? "error-line" : "note"} role="status" dir="auto">{status[0]}</p>}
      <h3 className="sub-title">{t("settings.runs")}</h3>
      {info?.running && <div className="row note"><Spinner />{t("settings.runningNow")}</div>}
      {info && !info.running && !info.runs.length && <p className="note">{t("settings.noRuns")}</p>}
      {info?.runs.slice(0, 5).map((run) => (
        <div key={run.started} className="run-row">
          <span dir="ltr">{new Date(run.started).toLocaleString(lang === "he" ? "he-IL" : "en-GB")}</span>
          <span>{run.finished ? t("settings.cvs", { n: run.drafted.length }) : t("settings.inProgress")}</span>
          <span className="note" dir="auto">{mailText(run.mail)}</span>
          {run.steps.filter((x) => !x.ok).map((x, i) => (
            <span key={i} className="error-line" dir="auto">{t(`settings.steps.${x.step}`)}{x.company ? ` ${x.company}` : ""}: {x.note ?? t("settings.unfinished")}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

const AI_PROVIDERS = [{ id: "openai", name: "ChatGPT", keys: "https://platform.openai.com/api-keys" }];
// Where to get a key, inside the introduction's board: a key and the arrow out to another site, in its pixels.
const KEY = [".XX.....", "X..XXXXX", "X..X.X.X", ".XX....."];
const OUT = [".XXX", "..XX", ".X.X", "X..."];
const AI_IDS = ["claude", "openai"];
const AI_NAMES: Record<string, string> = { claude: "Claude", openai: "ChatGPT" };

// The AI the site works with (ai.ts): which one is primary, of those connected, and under it which takes over when
// it fails; then each one's connection, with a mark of whether it is connected. Claude's is this computer's Claude
// Code login, and ChatGPT's its Codex one (clis.ts): a button opens the sign-in in a window of its own, and the card
// sees it a few seconds after. For ChatGPT an API key is the other way, folded under it (chatbots.ts); like the mail
// account it is apart from the settings form, kept once its box is left, or Enter pressed, and OpenAI took it; only
// whether one is saved comes back. bare: inside the introduction's board, which has its own heading.
export function AiKeys({ primary, onPrimary, bare = false }: { primary: string; onPrimary: (id: string) => void | Promise<void>; bare?: boolean }) {
  const { s, t, err, refresh } = useApp();
  const logins = (s.aiLogins ?? {}) as Record<string, boolean>;
  const connected = (id: string) => Boolean(s.aiKeys[id] || logins[id]);
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
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  const keep = async (provider: (typeof AI_PROVIDERS)[number], key: string) => {
    if (busy) return;
    setBusy(provider.id);
    setStatus(key ? [t("settings.ai.checking"), false] : ["", false]);
    try {
      await api("ai-keys", { provider: provider.id, key });
      await refresh();
      setTyped((cur) => ({ ...cur, [provider.id]: "" }));
      setStatus([t(key ? "settings.ai.savedNote" : "settings.ai.removed", { name: provider.name }), false]);
    } catch (e) {
      setStatus([err(e), true]);
    }
    setBusy("");
  };
  const signIn = (p: { id: string; name: string }) => {
    setStatus([t("settings.ai.signingIn", { name: p.name }), false]);
    api("ai-login", { provider: p.id }).catch((e) => setStatus([err(e), true]));
  };
  const Frame = bare ? "div" : Card;
  // The mark of a saved key: the board's pixel tick inside the introduction, the site's check elsewhere.
  const Mark = () => (bare ? <Tick /> : <Icon name="check" />);
  return (
    <Frame className={bare ? "stack ai-setup" : "stack"}>
      {!bare && <h2>{t("settings.ai.title")}</h2>}
      {!bare && <p className="note">{t("settings.ai.note")}</p>}
      <div className="field">
        <span className="field-label">{t("settings.ai.primary")}</span>
        <div className={moved ? "segmented moved" : "segmented"} role="group" aria-label={t("settings.ai.primary")}>
          {AI_IDS.map((id) => (
            <button key={id} type="button" aria-pressed={first === id && connected(id)} disabled={!connected(id)} onClick={() => pick(id)}>{AI_NAMES[id]}</button>
          ))}
        </div>
      </div>
      <div className="ai-list">
        <div className="ai-row">
          <div className="ai-row-head"><strong>Claude</strong><span className={`ai-state ${logins.claude ? "on" : ""}`}>{t(logins.claude ? "settings.ai.on" : "settings.ai.off")}</span></div>
          {logins.claude
            ? <p className="note">{t("settings.ai.claude")}</p>
            : <div className="ai-sign-in"><Btn onClick={() => signIn({ id: "claude", name: "Claude" })}>{t("settings.ai.signIn")}</Btn><small className="note">{t("settings.ai.claudeHow")}</small></div>}
        </div>
        {AI_PROVIDERS.map((p) => {
          const value = typed[p.id] ?? "";
          const save = () => { if (value.trim()) keep(p, value.trim()); };
          return (
            <div key={p.id} className="ai-row">
              <div className="ai-row-head">
                <strong>{p.name}</strong>
                <span className={`ai-state ${connected(p.id) ? "on" : ""}`}>{t(connected(p.id) ? "settings.ai.on" : "settings.ai.off")}</span>
              </div>
              {logins[p.id]
                ? <p className="note">{t(`settings.ai.${p.id}Login`)}</p>
                : <div className="ai-sign-in"><Btn onClick={() => signIn(p)}>{t("settings.ai.signIn")}</Btn><small className="note">{t(`settings.ai.${p.id}How`)}</small></div>}
              {/* The other way, a key, folded until opened; inside, whether one is saved, and only then is there a
                  key to remove. */}
              <details className="ai-key">
                <summary>{t("settings.ai.orKey")}</summary>
                {s.aiKeys[p.id] && (
                  <div className="key-saved-row">
                    <span className="key-saved"><Mark />{t("settings.ai.keyOn")}</span>
                    <Btn kind="danger" disabled={Boolean(busy)} onClick={() => keep(p, "")}>{t("settings.ai.removeKey")}</Btn>
                  </div>
                )}
                <div className="key-row">
                  {/* Empty, the box takes the page's direction, so the hint starts on the page's side. */}
                  <input type="password" dir={value ? "ltr" : undefined} autoComplete="off" spellCheck={false} aria-label={t(`settings.ai.${p.id}`)}
                    placeholder={t(s.aiKeys[p.id] ? "settings.ai.replace" : "settings.ai.paste")} value={value} disabled={busy === p.id}
                    onChange={(e) => setTyped((cur) => ({ ...cur, [p.id]: e.target.value }))} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
                </div>
                {bare
                  ? <External url={p.keys} className="key-link"><PixelArt className="key-icon" rows={KEY} />{t("settings.ai.get")}<PixelArt className="key-out" rows={OUT} /></External>
                  : <External url={p.keys} className="key-link">{t("settings.ai.get")}<Icon name="open" /></External>}
              </details>
            </div>
          );
        })}
      </div>
      {status[0] && <p className={status[1] ? "error-line" : "note"} role="status" dir="auto">{status[0]}</p>}
    </Frame>
  );
}

// Phone access (remote.ts): the site's address, and linking this computer there under the account's name; once
// linked, where to go on the phone, as whom, and whether the computer is connected to the site right now.
function Remote() {
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
  const problem = error || (r.linked && r.state !== "on" && r.error ? err(Object.assign(new Error(r.error), { code: r.error })) : "");
  return (
    <Card className="stack">
      <h2>{t("settings.remote.title")}</h2>
      <p className="note">{t("settings.remote.note")}</p>
      {r.linked ? (
        <>
          <div className="ai-row-head">
            <strong dir="ltr">{host}</strong>
            <span className={`ai-state ${r.state === "on" ? "on" : ""}`}>{t(`settings.remote.${r.state}`)}</span>
          </div>
          <p className="note">{t("settings.remote.how", { site: host, name: r.name })}</p>
          <div className="row">
            <Btn kind="ghost" disabled={busy} onClick={() => { if (confirm(t("settings.remote.confirm"))) run("remote/unlink", {}); }}>{t("settings.remote.unlink")}</Btn>
          </div>
        </>
      ) : (
        <form className="row" onSubmit={(e) => { e.preventDefault(); run("remote/link", { site }); }}>
          <input type="text" dir="ltr" placeholder="pip.example.com" aria-label={t("settings.remote.site")} value={site} onChange={(e) => setSite(e.target.value)} />
          <Btn type="submit" disabled={busy || !site.trim()}>{t("settings.remote.link")}</Btn>
        </form>
      )}
      {problem && <p className="error-line" role="alert" dir="auto">{problem}</p>}
    </Card>
  );
}

// Where the grade sheet opens, as the server serves it (data.ts).
export const TRANSCRIPT_FILE = `/file?path=${encodeURIComponent("user/documents/diplomas/transcript.pdf")}`;

// The grade sheet (transcript.ts), kept here once for the jobs that ask for one: the applications page offers it
// beside their CV, on its own and joined to it in one file. A PDF; a new one takes the old one's place, and one
// locked against copying is said to go on its own only.
function Transcript() {
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
    <Card className="stack">
      <h2>{t("settings.transcript.title")}</h2>
      <p className="note">{t("settings.transcript.note")}</p>
      {kept && <a href={TRANSCRIPT_FILE} target="_blank" rel="noopener">{t("settings.transcript.open")}</a>}
      {kept && !kept.joinable && <p className="warn-line">{t("settings.transcript.locked")}</p>}
      <div className="row">
        <Btn disabled={busy} onClick={() => picker.current?.click()}>{t(kept ? "settings.transcript.replace" : "settings.transcript.upload")}</Btn>
        {kept && <Btn kind="ghost" disabled={busy} onClick={() => { if (confirm(t("settings.transcript.confirm"))) run(() => api("transcript/remove", {})); }}>{t("common.remove")}</Btn>}
        {busy && <Spinner />}
      </div>
      <input ref={picker} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
      {error && <p className="error-line" role="alert" dir="auto">{error}</p>}
    </Card>
  );
}

export function Settings() {
  const { s, t, lang, setLang, theme, setTheme, refresh, loaded } = useApp();
  // The screen can open before the first state is in, as when the page is reloaded here; until then it has no
  // draft, so the app's empty stand-in is never shown, nor saved over the real settings.
  const [draft, setDraft] = useState<any>(() => (loaded ? structuredClone(s.settings) : null));
  const [roleInput, setRoleInput] = useState("");
  useEffect(() => { if (!draft && loaded) setDraft(structuredClone(s.settings)); }, [loaded, s.settings]);
  // Every change saves itself a moment later; the form keeps what was typed, the saved settings come back through
  // the app's state. The note at the top says how it went.
  const saving = useAutoSave(draft, async (next) => {
    await api("settings", { ...next, language: lang });
    await refresh();
  }, { ready: Boolean(draft) });
  if (!draft) return <Page title={t("settings.title")}><Spinner /></Page>;

  const update = (fn: (d: any) => void) => { const next = structuredClone(draft); fn(next); setDraft(next); };
  const set = (key: string, value: unknown) => update((d) => { d[key] = value; });
  const setAuto = (key: string, value: unknown) => update((d) => { d.automation[key] = value; });
  const times: string[] = draft.automation.runTimes?.length ? draft.automation.runTimes : ["09:00"];
  const ownRoles = draft.roles.filter((r: any) => !listedRole(r.id));
  const later = !LANGUAGES_ON && !THEMES_ON;

  const number = (label: string, value: number, onChange: (n: number) => void) => (
    <Field label={label}><input type="number" min={0} step={1} dir="ltr" value={value || ""} onChange={(e) => onChange(Number(e.target.value))} /></Field>
  );

  return (
    <Page title={t("settings.title")} sub={t("settings.sub")} actions={<SaveNote state={saving} />}>
      {/* Language and theme apply at once and stay in this browser, so they need no saving. While the English
          version and the dark theme are both off (app.tsx), the whole card is marked as coming soon, everything
          in it faded and unpressable; while only one is, just its buttons are unpressable. */}
      <Card className="stack">
        <h2 className="soon-title">{t("settings.display")}{later && <span className="soon">{t("common.soon")}</span>}</h2>
        <div className={`stack ${later ? "later" : ""}`}>
          <p className="note">{t("settings.displayNote")}</p>
          <div className="fields">
            <div className="field">
              <span className="field-label">{t("settings.uiLanguage")}</span>
              <div className="segmented" role="group" aria-label={t("settings.uiLanguage")}>
                <button type="button" lang="he" aria-pressed={lang === "he"} disabled={later} onClick={() => setLang("he")}>עברית</button>
                <button type="button" lang="en" aria-pressed={lang === "en"} disabled={!LANGUAGES_ON} onClick={() => setLang("en")}>English</button>
              </div>
            </div>
            <div className="field">
              <span className="field-label">{t("settings.uiTheme")}</span>
              <div className="segmented" role="group" aria-label={t("settings.uiTheme")}>
                {([["light", "sun", "themeLight"], ["dark", "moon", "themeDark"], ["", "", "themeSystem"]] as const).map(([mode, icon, key]) => (
                  <button key={key} type="button" aria-pressed={theme === mode} disabled={later || (!THEMES_ON && mode !== "light")} onClick={() => setTheme(mode)}>{icon && <Icon name={icon} />}{t(`settings.${key}`)}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>
      <AiKeys primary={draft.aiPrimary} onPrimary={(id) => set("aiPrimary", id)} />
      <Remote />

      <Card className="stack">
        <MarketsEditor draft={draft} update={update} title={<h2>{t("settings.markets")}</h2>} />
      </Card>

      <Card className="stack">
        <h2>{t("settings.areas")}</h2>
        <AreasEditor draft={draft} update={update} />
      </Card>

      <Card className="stack">
        <h2>{t("settings.prefs")}</h2>
        <div className="fields">
          <Field label={t("settings.displayName")}><input type="text" dir="auto" value={draft.displayName} onChange={(e) => set("displayName", e.target.value)} /></Field>
          <Field label={t("settings.home")}><input type="text" dir="auto" value={draft.home} onChange={(e) => set("home", e.target.value)} /></Field>
          <Field label={t("settings.workMode")}>
            <Select value={draft.workMode} onChange={(v) => set("workMode", v)} options={["any", "remote", "hybrid", "onsite"].map((v) => ({ value: v, label: t(`modes.${v}`) }))} />
          </Field>
          <Field label={t("settings.seniority")} hint={t("settings.seniorityHint")}>
            <Select value={draft.seniority} onChange={(v) => update((d) => {
              d.seniority = v;
              d.roles = d.roles.map((r: any) => (listedRole(r.id) ? fromList(listedRole(r.id)!, d.seniority) : r));
            })} options={["any", "junior", "middle", "senior"].map((v) => ({ value: v, label: t(`settings.levels.${v}`) }))} />
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={draft.relocate} onChange={(e) => set("relocate", e.target.checked)} />{t("settings.relocate")}</label>
      </Card>

      {/* Roles from the ready-made list, by field, chosen with a click; the search adds the level to each (roles.ts).
          Below them, any typed in by hand. */}
      <Card className="stack">
        <h2>{t("settings.roles")}</h2>
        <p className="note">{t("settings.rolesNote")}</p>
        {ROLE_FIELDS.map((field) => (
          <div key={field.id} className="role-field">
            <h3 className="role-field-name">{field[lang]}</h3>
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
        <div className="role-field">
          <h3 className="role-field-name">{t("settings.ownRoles")}</h3>
          {ownRoles.length > 0 && (
            <div className="chips">
              {ownRoles.map((r: any) => (
                <span key={r.query} className="tag" dir="auto">{r.label}
                  <button type="button" className="tag-x" aria-label={`${t("common.remove")} ${r.label}`} onClick={() => update((d) => { d.roles = d.roles.filter((x: any) => x.query !== r.query); })}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <form className="row" onSubmit={(e) => {
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
        }}>
          <input type="text" placeholder={t("settings.role")} aria-label={t("settings.role")} dir="auto" value={roleInput} onChange={(e) => setRoleInput(e.target.value)} />
          <Btn type="submit">{t("settings.addRole")}</Btn>
        </form>
        <p className="note">{t("settings.rolesLevel", { example: roleQuery(listedRole("backend")!, draft.seniority) })}</p>
      </Card>

      {/* Which industries to search and whether employers outside high-tech are read; the portals page lists them all. */}
      <Card className="stack">
        <IndustryPicker draft={draft} update={update} />
        <a className="portal-link" href="#/portals">{t("settings.toPortals")}</a>
      </Card>

      <Card className="stack">
        <h2>{t("settings.applying")}</h2>
        <p className="note">{t("settings.applyingNote")}</p>
        <div className="fields">
          {number(t("settings.salaryFrom"), draft.salaryMin, (n) => set("salaryMin", n))}
          {number(t("settings.salaryTo"), draft.salaryMax, (n) => set("salaryMax", n))}
          <Field label={t("settings.currency")}><input type="text" dir="ltr" placeholder="ILS" value={draft.salaryCurrency} onChange={(e) => set("salaryCurrency", e.target.value)} /></Field>
          <Field label={t("settings.student")}>
            <Select value={draft.studentJobs} onChange={(v) => set("studentJobs", v)} options={["normal", "low", "exclude"].map((v) => ({ value: v, label: t(`settings.studentOptions.${v}`) }))} />
          </Field>
        </div>
        <Field label={t("settings.fields")} hint={t("settings.fieldsHint")}>
          <input type="text" dir="auto" placeholder="All fields, including defense companies" value={draft.fields} onChange={(e) => set("fields", e.target.value)} />
        </Field>
      </Card>
      <Transcript />

      <Card className="stack daily">
        <h2>{t("settings.daily")}</h2>
        <p className="note">{t("settings.dailyNote")}</p>
        <p className="warn-line">{t("settings.dailyWarn")}</p>
        <label className="check"><input type="checkbox" checked={draft.automation.enabled} onChange={(e) => setAuto("enabled", e.target.checked)} />{t("settings.enable")}</label>
        <div className="fields">
          <Field label={t("settings.email")}><input type="email" dir="ltr" value={draft.automation.email} onChange={(e) => setAuto("email", e.target.value)} /></Field>
          {number(t("settings.perDay"), draft.automation.maxPerDay, (n) => setAuto("maxPerDay", n))}
          {number(t("settings.minScore"), draft.automation.minScore, (n) => setAuto("minScore", n))}
        </div>
        {/* A row of its own, so the times and the button for another stay on one line. */}
        <Field label={t("settings.runTimes")} hint={t("settings.runTimesNote")}>
          <RunTimes times={times} onChange={(next) => setAuto("runTimes", next)} />
        </Field>
        <p className="note">{t("settings.dailyTip")}</p>
        <Runner />
      </Card>
    </Page>
  );
}
