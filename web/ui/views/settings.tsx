import React, { useEffect, useState } from "react";
import { LANGUAGES_ON, THEMES_ON, useApp } from "../app";
import { AREA_NAMES_EN, type Lang } from "../i18n";
import { api, Btn, Card, External, Field, Icon, Page, Spinner } from "../kit";
import { SaveNote, useAutoSave } from "../autosave";
import { Select } from "../select";
import { fromList, listedRole, matchListed, ROLE_FIELDS, roleQuery } from "../../roles";

const COUNTRY_CODES = "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NZ OM PA PE PG PH PK PL PR PS PT PY QA RO RS RU RW SA SC SD SE SG SI SK SL SN SO SR SV SY SZ TD TG TH TJ TM TN TR TT TW TZ UA UG US UY UZ VE VN YE ZA ZM ZW".split(" ");
const TIERS = ["near", "ok", "edge", "far"];

const regionName = (code: string, lang: Lang) => { try { return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code; } catch { return code; } };

// Country names come from the code, so they follow the interface language whatever was saved.
export const marketLabel = (m: { code: string; label?: string }, lang: Lang, t: (k: string) => string) => (m.code === "REMOTE" ? t("settings.remote") : regionName(m.code, lang));
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
// note that that is the most, and that removing one makes room.
const MAX_MARKETS = 3;

export function MarketsEditor({ draft, update, title }: { draft: any; update: Update; title: React.ReactNode }) {
  const { t, lang } = useApp();
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
            <Icon name="plus" />{t("settings.addRemote")}
          </button>
        )}
      </div>
      {draft.markets.length ? (
        <div className="chips">
          {draft.markets.map((m: any) => (
            <span key={m.code} className="tag place-tag"><Icon name="pin" />{m.city ? `${m.city}, ` : ""}{marketLabel(m, lang, t)}
              <button type="button" className="tag-x" aria-label={`${t("common.remove")} ${marketLabel(m, lang, t)}`} onClick={() => update((d) => { d.markets = d.markets.filter((x: any) => x.code !== m.code); })}><Icon name="close" /></button>
            </span>
          ))}
        </div>
      ) : <p className="error-line">{t("settings.noMarket")}</p>}
      {full ? <p className="note" role="status">{t("settings.marketsFull", { n: MAX_MARKETS })}</p> : (
        <div className="add-row">
          <button type="button" className="add-go" aria-label={t("common.add")} disabled={!country} onClick={add}><Icon name="plus" /></button>
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
const AI_IDS = ["claude", "openai"];
const AI_NAMES: Record<string, string> = { claude: "Claude", openai: "ChatGPT" };

// The AI the site works with (ai.ts): which one is primary, of those connected, and under it which takes over when
// it fails; then each one's connection, with a mark of whether it is connected. Claude's is this computer's Claude
// Code login, with nothing to set. ChatGPT signs in with the account the same way, through Codex (clis.ts): a
// button opens Codex's sign-in in a window of its own, and the card sees it a few seconds after. An API key is the
// other way, folded under it (chatbots.ts); like the mail account it is apart from the settings form, kept once
// its box is left, or Enter pressed, and OpenAI took it; only whether one is saved comes back.
function AiKeys({ primary, onPrimary }: { primary: string; onPrimary: (id: string) => void }) {
  const { s, t, err, refresh } = useApp();
  const logins = (s.aiLogins ?? {}) as Record<string, boolean>;
  const connected = (id: string) => id === "claude" || Boolean(s.aiKeys[id] || logins[id]);
  const first = connected(primary) ? primary : "claude";
  const order = [first, ...AI_IDS.filter((id) => id !== first && connected(id))].map((id) => AI_NAMES[id]);
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
  const signIn = (p: (typeof AI_PROVIDERS)[number]) => {
    setStatus([t("settings.ai.signingIn", { name: p.name }), false]);
    api("ai-login", { provider: p.id }).catch((e) => setStatus([err(e), true]));
  };
  return (
    <Card className="stack">
      <h2>{t("settings.ai.title")}</h2>
      <p className="note">{t("settings.ai.note")}</p>
      <div className="field">
        <span className="field-label">{t("settings.ai.primary")}</span>
        <div className="segmented" role="group" aria-label={t("settings.ai.primary")}>
          {AI_IDS.map((id) => (
            <button key={id} type="button" aria-pressed={first === id} disabled={!connected(id)} onClick={() => onPrimary(id)}>{AI_NAMES[id]}</button>
          ))}
        </div>
        <small className="note">{order.length > 1 ? t("settings.ai.order", { first: order[0], rest: order.slice(1).join(", ") }) : t("settings.ai.alone", { first: order[0] })}</small>
      </div>
      <div className="ai-list">
        <div className="ai-row">
          <div className="ai-row-head"><strong>Claude</strong><span className="ai-state on">{t("settings.ai.on")}</span></div>
          <p className="note">{t("settings.ai.claude")}</p>
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
              {/* The other way, a key, folded unless one is saved. */}
              <details className="ai-key" open={Boolean(s.aiKeys[p.id]) || undefined}>
                <summary>{t("settings.ai.orKey")}</summary>
                <div className="key-row">
                  {/* Empty, the box takes the page's direction, so the hint starts on the page's side. */}
                  <input type="password" dir={value ? "ltr" : undefined} autoComplete="off" spellCheck={false} aria-label={t(`settings.ai.${p.id}`)}
                    placeholder={t(s.aiKeys[p.id] ? "settings.ai.saved" : "settings.ai.paste")} value={value} disabled={busy === p.id}
                    onChange={(e) => setTyped((cur) => ({ ...cur, [p.id]: e.target.value }))} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
                  {s.aiKeys[p.id] && <Btn kind="ghost" disabled={Boolean(busy)} onClick={() => keep(p, "")}>{t("settings.ai.remove")}</Btn>}
                </div>
                <External url={p.keys} className="key-link">{t("settings.ai.get")}<Icon name="open" /></External>
              </details>
            </div>
          );
        })}
      </div>
      {status[0] && <p className={status[1] ? "error-line" : "note"} role="status" dir="auto">{status[0]}</p>}
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

      <Card className="stack daily">
        <h2>{t("settings.daily")}</h2>
        <p className="note">{t("settings.dailyNote")}</p>
        <p className="warn-line">{t("settings.dailyWarn")}</p>
        <label className="check"><input type="checkbox" checked={draft.automation.enabled} onChange={(e) => setAuto("enabled", e.target.checked)} />{t("settings.enable")}</label>
        <div className="fields">
          <Field label={t("settings.email")}><input type="email" dir="ltr" value={draft.automation.email} onChange={(e) => setAuto("email", e.target.value)} /></Field>
          {number(t("settings.perDay"), draft.automation.maxPerDay, (n) => setAuto("maxPerDay", n))}
          {number(t("settings.minScore"), draft.automation.minScore, (n) => setAuto("minScore", n))}
          <Field label={t("settings.runAt")}><input type="time" dir="ltr" value={draft.automation.runAt} onChange={(e) => setAuto("runAt", e.target.value)} /></Field>
        </div>
        <Runner />
      </Card>
    </Page>
  );
}
