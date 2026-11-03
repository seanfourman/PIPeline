import React, { useEffect, useState } from "react";
import { useApp } from "../app";
import { AREA_NAMES_EN, type Lang } from "../i18n";
import { api, Btn, Card, External, Field, Icon, Page, Spinner } from "../kit";
import { fromList, listedRole, matchListed, ROLE_FIELDS, roleQuery } from "../../roles";

const COUNTRY_CODES = "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NZ OM PA PE PG PH PK PL PR PS PT PY QA RO RS RU RW SA SC SD SE SG SI SK SL SN SO SR SV SY SZ TD TG TH TJ TM TN TR TT TW TZ UA UG US UY UZ VE VN YE ZA ZM ZW".split(" ");
const TIERS = ["near", "ok", "edge", "far"];

const regionName = (code: string, lang: Lang) => { try { return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code; } catch { return code; } };

// Country names come from the code, so they follow the interface language whatever was saved.
export const marketLabel = (m: { code: string; label?: string }, lang: Lang, t: (k: string) => string) => (m.code === "REMOTE" ? t("settings.remote") : regionName(m.code, lang));
export const areaName = (name: string, lang: Lang) => (lang === "en" ? AREA_NAMES_EN[name] ?? name : name);

function TierSelect({ value, onChange, unset }: { value: string; onChange: (v: string) => void; unset?: boolean }) {
  const { t } = useApp();
  return (
    <select aria-label={t("settings.areaTier")} value={value} onChange={(e) => onChange(e.target.value)}>
      {unset && <option value="">{t("tiers.unset")}</option>}
      {TIERS.map((v) => <option key={v} value={v}>{t(`tiers.${v}`)}</option>)}
    </select>
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
  return (
    <div className="stack">
      <h3 className="sub-title">{t("settings.account")}</h3>
      <p className="note">{before}<External url="https://myaccount.google.com/apppasswords" className="">{t("settings.appPassword")}</External>{after}</p>
      <div className="row">
        <input type="email" dir="ltr" placeholder="you@gmail.com" aria-label={t("settings.gmail")} value={user} onChange={(e) => setUser(e.target.value)} />
        <input type="password" dir="ltr" autoComplete="off" aria-label={t("settings.appPassword")} placeholder={info?.mailUser ? t("settings.passwordSaved") : t("settings.appPassword")} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="row">
        <Btn onClick={() => attempt(async () => { setInfo(await api("automation/mail", { user, password })); setPassword(""); setStatus([t("settings.accountSaved"), false]); })}>{t("settings.saveAccount")}</Btn>
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

export function Settings() {
  const { s, t, lang, setLang, theme, setTheme, err, say, refresh } = useApp();
  const [draft, setDraft] = useState(() => structuredClone(s.settings));
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [areaInput, setAreaInput] = useState("");
  const [areaTier, setAreaTier] = useState("near");
  const [roleInput, setRoleInput] = useState("");
  // The first state can arrive after this screen opens.
  useEffect(() => { if (!draft.markets && s.settings.markets) setDraft(structuredClone(s.settings)); }, [s.settings]);
  if (!draft.markets) return <Page title={t("settings.title")}><Spinner /></Page>;

  const update = (fn: (d: any) => void) => { const next = structuredClone(draft); fn(next); setDraft(next); };
  const set = (key: string, value: unknown) => update((d) => { d[key] = value; });
  const setAuto = (key: string, value: unknown) => update((d) => { d.automation[key] = value; });
  const countries = COUNTRY_CODES.map((code) => ({ code, label: regionName(code, lang), country: regionName(code, "en") })).sort((a, b) => a.label.localeCompare(b.label, lang));
  const presets = draft.markets.flatMap((m: any) => s.presets[m.code] ?? []);
  const presetNames = new Set(presets.map((p: any) => p.name));
  const custom = draft.areas.filter((a: any) => !presetNames.has(a.name));
  const full = draft.markets.length >= 3;
  const ownRoles = draft.roles.filter((r: any) => !listedRole(r.id));

  const save = async () => {
    try {
      const saved = await api("settings", { ...draft, language: lang });
      setDraft(saved);
      await refresh();
      setStatus([t("settings.saved"), false]);
      say(t("pip.noted"), "happy", 4000);
    } catch (e) {
      setStatus([t("common.saveFailed", { error: err(e) }), true]);
    }
  };
  const number = (label: string, value: number, onChange: (n: number) => void) => (
    <Field label={label}><input type="number" min={0} step={1} dir="ltr" value={value || ""} onChange={(e) => onChange(Number(e.target.value))} /></Field>
  );
  const saveBar = <div className="row"><Btn kind="primary" onClick={save}>{t("common.save")}</Btn>{status[0] && <span className={status[1] ? "error-line" : "note"} role="status">{status[0]}</span>}</div>;

  return (
    <Page title={t("settings.title")} sub={t("settings.sub")} actions={<Btn kind="primary" onClick={save}>{t("common.save")}</Btn>}>
      {/* Language and theme apply at once and stay in this browser, so they need no saving. */}
      <Card className="stack">
        <h2>{t("settings.display")}</h2>
        <p className="note">{t("settings.displayNote")}</p>
        <div className="fields">
          <div className="field">
            <span className="field-label">{t("settings.uiLanguage")}</span>
            <div className="segmented" role="group" aria-label={t("settings.uiLanguage")}>
              <button type="button" lang="he" aria-pressed={lang === "he"} onClick={() => setLang("he")}>עברית</button>
              <button type="button" lang="en" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t("settings.uiTheme")}</span>
            <div className="segmented" role="group" aria-label={t("settings.uiTheme")}>
              {([["light", "sun", "themeLight"], ["dark", "moon", "themeDark"], ["", "", "themeSystem"]] as const).map(([mode, icon, key]) => (
                <button key={key} type="button" aria-pressed={theme === mode} onClick={() => setTheme(mode)}>{icon && <Icon name={icon} />}{t(`settings.${key}`)}</button>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <Card className="stack">
        <h2>{t("settings.markets")}</h2>
        <p className="note">{t("settings.marketsNote")}</p>
        {draft.markets.length ? (
          <div className="chips">
            {draft.markets.map((m: any) => (
              <span key={m.code} className="tag">{m.city ? `${m.city}, ` : ""}{marketLabel(m, lang, t)}
                <button type="button" className="tag-x" aria-label={`${t("common.remove")} ${marketLabel(m, lang, t)}`} onClick={() => update((d) => { d.markets = d.markets.filter((x: any) => x.code !== m.code); })}>×</button>
              </span>
            ))}
          </div>
        ) : <p className="error-line">{t("settings.noMarket")}</p>}
        <div className="row">
          <select aria-label={t("settings.country")} value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">{t("settings.country")}</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <input type="text" placeholder={t("settings.city")} aria-label={t("settings.city")} dir="auto" value={city} onChange={(e) => setCity(e.target.value)} />
          <Btn disabled={full || !country} onClick={() => {
            const picked = countries.find((c) => c.code === country);
            if (!picked) return;
            update((d) => { d.markets = [...d.markets.filter((m: any) => m.code !== picked.code), { code: picked.code, country: picked.country, city: city.trim(), label: picked.label }]; });
            setCity("");
          }}>{t("common.add")}</Btn>
          {!draft.markets.some((m: any) => m.code === "REMOTE") && (
            <Btn disabled={full} onClick={() => update((d) => { d.markets.push({ code: "REMOTE", country: "", city: "", label: "Remote" }); })}>{t("settings.addRemote")}</Btn>
          )}
        </div>
      </Card>

      <Card className="stack">
        <h2>{t("settings.areas")}</h2>
        <p className="note">{t("settings.areasNote")}</p>
        {presets.map((p: any) => (
          <div key={p.name} className="area-row">
            <span>{areaName(p.name, lang)}</span>
            <TierSelect unset value={draft.areas.find((a: any) => a.name === p.name)?.tier ?? ""} onChange={(v) => update((d) => {
              d.areas = d.areas.filter((a: any) => a.name !== p.name);
              if (v) d.areas.push({ name: p.name, places: p.places, tier: v });
            })} />
          </div>
        ))}
        {custom.map((a: any) => (
          <div key={a.name} className="area-row">
            <span dir="auto">{a.name}</span>
            <div className="row">
              <TierSelect value={a.tier} onChange={(v) => update((d) => { d.areas.find((x: any) => x.name === a.name).tier = v; })} />
              <Btn onClick={() => update((d) => { d.areas = d.areas.filter((x: any) => x.name !== a.name); })}>{t("common.remove")}</Btn>
            </div>
          </div>
        ))}
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          const name = areaInput.trim();
          if (!name) return;
          update((d) => { d.areas = [...d.areas.filter((a: any) => a.name !== name), { name, places: [name.toLowerCase()], tier: areaTier }]; });
          setAreaInput("");
        }}>
          <input type="text" placeholder={t("settings.areaName")} aria-label={t("settings.areaName")} dir="auto" value={areaInput} onChange={(e) => setAreaInput(e.target.value)} />
          <TierSelect value={areaTier} onChange={setAreaTier} />
          <Btn type="submit">{t("settings.addArea")}</Btn>
        </form>
      </Card>

      <Card className="stack">
        <h2>{t("settings.prefs")}</h2>
        <div className="fields">
          <Field label={t("settings.displayName")}><input type="text" dir="auto" value={draft.displayName} onChange={(e) => set("displayName", e.target.value)} /></Field>
          <Field label={t("settings.home")}><input type="text" dir="auto" value={draft.home} onChange={(e) => set("home", e.target.value)} /></Field>
          <Field label={t("settings.workMode")}>
            <select value={draft.workMode} onChange={(e) => set("workMode", e.target.value)}>{["any", "remote", "hybrid", "onsite"].map((v) => <option key={v} value={v}>{t(`modes.${v}`)}</option>)}</select>
          </Field>
          <Field label={t("settings.seniority")} hint={t("settings.seniorityHint")}>
            <select value={draft.seniority} onChange={(e) => update((d) => {
              d.seniority = e.target.value;
              d.roles = d.roles.map((r: any) => (listedRole(r.id) ? fromList(listedRole(r.id)!, d.seniority) : r));
            })}>{["any", "junior", "middle", "senior"].map((v) => <option key={v} value={v}>{t(`settings.levels.${v}`)}</option>)}</select>
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
            <select value={draft.studentJobs} onChange={(e) => set("studentJobs", e.target.value)}>{["normal", "low", "exclude"].map((v) => <option key={v} value={v}>{t(`settings.studentOptions.${v}`)}</option>)}</select>
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
      {saveBar}
    </Page>
  );
}
