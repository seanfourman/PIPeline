// The portals page: every place the system follows for jobs (portals.ts), how each one is covered, its last check,
// and a switch to stop following it; the industries and the low-tech setting; and the user's own portals. The
// switches, like everything on the settings, save on their own.
import React, { useEffect, useState } from "react";
import { useApp } from "../app";
import { SaveNote, useAutoSave } from "../autosave";
import { api, Btn, Card, External, goTo, Icon, Page, Spinner } from "../kit";
import { Select } from "../select";
import { employersToRead, INDUSTRIES, portalOn, PORTALS, webPortals, type How, type OwnPortal, type Portal } from "../../portals";

type Check = { checked: string; found: number; kept: number; error?: string };
type Update = (fn: (d: any) => void) => void;

// The industries to search and the low-tech switch, here and on the settings screen; the introduction has tiles of its
// own for both (IndustryTiles in welcome.tsx).
export function IndustryPicker({ draft, update }: { draft: any; update: Update }) {
  const { t, lang } = useApp();
  const chosen: string[] = draft.industries ?? [];
  return (
    <div className="stack">
      <h2>{t("settings.industries")}</h2>
      <p className="note">{t("settings.industriesNote")}</p>
      <div className="chips">
        {INDUSTRIES.map((i) => {
          const on = chosen.includes(i.id);
          return (
            <button key={i.id} type="button" className="role-pick" aria-pressed={on} onClick={() => update((d) => {
              d.industries = on ? (d.industries ?? []).filter((x: string) => x !== i.id) : [...(d.industries ?? []), i.id];
            })}>{i[lang]}</button>
          );
        })}
      </div>
      <div className="low-tech">
        <div className="stack tight">
          <span className="field-label">{t("settings.lowTech")}</span>
          <p className="note">{t("settings.lowTechNote")}</p>
        </div>
        <div className="segmented" role="group" aria-label={t("settings.lowTech")}>
          <button type="button" aria-pressed={draft.lowTech !== false} onClick={() => update((d) => { d.lowTech = true; })}>{t("settings.lowTechOn")}</button>
          <button type="button" aria-pressed={draft.lowTech === false} onClick={() => update((d) => { d.lowTech = false; })}>{t("settings.lowTechOff")}</button>
        </div>
      </div>
    </div>
  );
}

// "Checked today: 3 jobs for your roles, 1 new", from a portal's last check.
function checkLine(check: Check | undefined, t: (key: string, params?: Record<string, string | number>) => any) {
  if (!check) return t("portals.never");
  const days = Math.max(0, Math.round((Date.now() - Date.parse(check.checked)) / 86_400_000));
  const when = days === 0 ? t("portals.today") : days === 1 ? t("portals.yesterday") : t("portals.daysAgo", { n: days });
  if (check.error) return t("portals.failed", { when });
  if (!check.found) return t("portals.none", { when });
  return check.kept ? t("portals.foundKept", { when, found: check.found, kept: check.kept }) : t("portals.found", { when, found: check.found });
}

// on is the user's own choice, the switch; active is whether the system goes there now, which the settings can stop
// too (the low-tech switch, the industries), and a row that isn't is faded.
function Row({ name, url, how, on, active = on, toggle, status, note, remove }: {
  name: string; url: string; how: How; on: boolean; active?: boolean; toggle?: () => void; status?: string; note?: string; remove?: () => void;
}) {
  const { t } = useApp();
  return (
    <li className={`portal-row ${active ? "" : "off"}`}>
      <div className="portal-main">
        <div className="portal-head">
          <span className="portal-name" dir="auto">{name}</span>
          <span className={`portal-how ${how}`}>{t(`portals.how.${how}`)}</span>
        </div>
        {status && <span className="portal-status">{status}</span>}
        {note && <span className="portal-status">{note}</span>}
      </div>
      <div className="portal-actions">
        <External url={url} className="btn ghost portal-open"><Icon name="open" />{t("portals.open")}</External>
        {toggle && <input type="checkbox" className="switch" checked={on} onChange={toggle} aria-label={t("portals.follow", { name })} />}
        {remove && <button type="button" className="tag-x" aria-label={t("portals.remove", { name })} onClick={remove}>×</button>}
      </div>
    </li>
  );
}

export function Portals() {
  const { s, t, lang, refresh, loaded, err, say } = useApp();
  const [draft, setDraft] = useState<any>(() => (loaded ? structuredClone(s.settings) : null));
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState({ name: "", url: "", kind: "page" as OwnPortal["kind"] });
  const [badUrl, setBadUrl] = useState(false);
  useEffect(() => { if (!draft && loaded) setDraft(structuredClone(s.settings)); }, [loaded, s.settings]);
  useEffect(() => {
    api("portals").then((r) => { setChecks(r.checks ?? {}); setBusy(Boolean(r.busy)); }).catch(() => {});
  }, []);
  const saving = useAutoSave(draft, async (next) => {
    await api("settings", { ...next, language: lang });
    await refresh();
  }, { ready: Boolean(draft) });
  if (!draft) return <Page title={t("portals.title")}><Spinner /></Page>;

  const update: Update = (fn) => { const next = structuredClone(draft); fn(next); setDraft(next); };
  const picks = { industries: draft.industries ?? [], lowTech: draft.lowTech !== false, portals: draft.portals ?? { off: [], mine: [] } };
  const off: string[] = picks.portals.off;
  const toggle = (id: string) => () => update((d) => {
    d.portals ??= { off: [], mine: [] };
    d.portals.off = off.includes(id) ? off.filter((x) => x !== id) : [...off, id];
  });
  const name = (p: Portal) => (lang === "he" ? p.he : p.en);
  const row = (p: Portal) => {
    const followed = p.how !== "link";
    const reason = p.lowTech && !picks.lowTech ? t("portals.lowTechIsOff") : p.kind === "employer" && picks.industries.length && !picks.industries.includes(p.industry) ? t("portals.notIndustry") : "";
    return (
      <Row key={p.id} name={name(p)} url={p.url} how={p.how} on={!off.includes(p.id)} active={portalOn(p, picks)} toggle={followed ? toggle(p.id) : undefined}
        status={p.how === "read" ? (reason || checkLine(checks[p.id], t)) : reason} note={p.note?.[lang]} />
    );
  };
  const mine: OwnPortal[] = picks.portals.mine;
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    let url = "";
    try { url = new URL(adding.url.trim()).href; } catch { /* not a link */ }
    if (!/^https?:\/\//.test(url)) { setBadUrl(true); return; }
    setBadUrl(false);
    const id = `own-${Math.random().toString(36).slice(2, 10)}`;
    update((d) => {
      d.portals ??= { off: [], mine: [] };
      d.portals.mine = [...(d.portals.mine ?? []), { id, name: adding.name.trim() || new URL(url).hostname.replace(/^www\./, ""), url, kind: adding.kind }];
    });
    setAdding({ name: "", url: "", kind: adding.kind });
  };
  const check = async () => {
    try {
      const session = await api("portals/scan", {});
      await refresh();
      goTo(`/chat/${session.id}`);
    } catch (e) {
      say(err(e), "worried");
      setBusy(false);
    }
  };

  const boards = PORTALS.filter((p) => p.kind === "board");
  const platforms = PORTALS.filter((p) => p.kind === "platform");
  const community = PORTALS.filter((p) => p.kind === "community");
  const counts = {
    search: boards.filter((p) => p.how === "search" && portalOn(p, picks)).length,
    read: employersToRead(picks).length + mine.filter((p) => p.kind === "page" && !off.includes(p.id)).length,
    web: webPortals(picks).length,
  };
  return (
    <Page title={t("portals.title")} sub={t("portals.sub")} actions={<>
      <SaveNote state={saving} />
      <Btn kind="primary" disabled={busy} onClick={() => { setBusy(true); check(); }}><Icon name="refresh" />{t("portals.check")}</Btn>
    </>}>
      <p className="note">{t("portals.summary", counts)} {t("portals.checkNote")}</p>

      <Card className="stack">
        <IndustryPicker draft={draft} update={update} />
      </Card>

      <Card className="stack">
        <h2>{t("portals.boards")}</h2>
        <p className="note">{t("portals.boardsNote")}</p>
        <ul className="portal-list">{boards.map(row)}</ul>
      </Card>

      <Card className="stack">
        <h2>{t("portals.platforms")}</h2>
        <p className="note">{t("portals.platformsNote")}</p>
        <ul className="portal-list">{platforms.map(row)}</ul>
      </Card>

      <Card className="stack">
        <h2>{t("portals.employers")}</h2>
        <p className="note">{t("portals.employersNote")}</p>
        {!picks.lowTech && (
          <p className="warn-line portal-off">{t("portals.lowTechIsOff")}
            <Btn kind="ghost" onClick={() => update((d) => { d.lowTech = true; })}>{t("portals.turnOn")}</Btn>
          </p>
        )}
        {INDUSTRIES.map((i) => {
          const here = PORTALS.filter((p) => p.kind === "employer" && p.industry === i.id);
          if (!here.length) return null;
          return (
            <div key={i.id} className="portal-group">
              <h3 className="role-field-name">{i[lang]}</h3>
              <ul className="portal-list tiles">{here.map(row)}</ul>
            </div>
          );
        })}
      </Card>

      <Card className="stack">
        <h2>{t("portals.community")}</h2>
        <p className="note">{t("portals.communityNote")}</p>
        <ul className="portal-list">{community.map(row)}</ul>
      </Card>

      <Card className="stack">
        <h2>{t("portals.mine")}</h2>
        <p className="note">{t("portals.mineNote")}</p>
        {mine.length > 0 && (
          <ul className="portal-list">
            {mine.map((p) => (
              <Row key={p.id} name={p.name} url={p.url} how={p.kind === "page" ? "read" : "link"} on={!off.includes(p.id)}
                toggle={p.kind === "page" ? toggle(p.id) : undefined} status={p.kind === "page" ? checkLine(checks[p.id], t) : t(`portals.kinds.${p.kind}`)}
                remove={() => update((d) => { d.portals.mine = d.portals.mine.filter((x: OwnPortal) => x.id !== p.id); d.portals.off = d.portals.off.filter((x: string) => x !== p.id); })} />
            ))}
          </ul>
        )}
        <form className="portal-add" onSubmit={add}>
          <input type="text" dir="auto" placeholder={t("portals.namePlaceholder")} aria-label={t("portals.name")} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          <input type="url" dir="ltr" placeholder="https://" aria-label={t("portals.url")} value={adding.url} onChange={(e) => { setAdding({ ...adding, url: e.target.value }); setBadUrl(false); }} />
          <Select value={adding.kind} label={t("portals.kind")} onChange={(v) => setAdding({ ...adding, kind: v as OwnPortal["kind"] })}
            options={(["page", "group", "link"] as const).map((k) => ({ value: k, label: t(`portals.kinds.${k}`) }))} />
          <Btn type="submit" disabled={!adding.url.trim()}><Icon name="plus" />{t("portals.add")}</Btn>
        </form>
        {badUrl && <p className="error-line" role="alert">{t("portals.badUrl")}</p>}
      </Card>
    </Page>
  );
}
