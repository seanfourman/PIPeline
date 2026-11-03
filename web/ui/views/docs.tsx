import React, { useEffect, useState } from "react";
import { COMMANDS, useApp } from "../app";
import { api, Btn, Card, Field, Markdown, Page, Spinner } from "../kit";

const Loading = () => { const { t } = useApp(); return <div className="row note"><Spinner />{t("common.loading")}</div>; };

export function Tools() {
  const { t, start } = useApp();
  const [args, setArgs] = useState<Record<string, string>>({});
  return (
    <Page title={t("tools.title")} sub={t("tools.sub")}>
      {COMMANDS.map(({ group, items }) => (
        <React.Fragment key={group}>
          <h2 className="group-title">{t(`tools.groups.${group}`)}</h2>
          <div className="grid">
            {items.map((c) => {
              const [title, desc, hint] = t(`tools.commands.${c.id}`) as string[];
              const run = () => start(`/${c.id} ${args[c.id] ?? ""}`.trim());
              return (
                <form key={c.id} className="card cmd" onSubmit={(e) => { e.preventDefault(); run(); }}>
                  <div className="row spread"><h3>{title}</h3><code>/{c.id}</code></div>
                  <p>{desc}</p>
                  {c.arg && <input type="text" placeholder={hint} aria-label={hint} dir="auto" value={args[c.id] ?? ""} onChange={(e) => setArgs({ ...args, [c.id]: e.target.value })} />}
                  <div><Btn kind={c.danger ? "danger" : ""} type="submit">{t("common.run")}</Btn></div>
                </form>
              );
            })}
          </div>
        </React.Fragment>
      ))}
    </Page>
  );
}

type Doc = { text: string; version: string; markdown: string };

// The profile or the rules: read as a page, or edited in place.
function DocumentCard({ kind }: { kind: "profile" | "rules" }) {
  const { t, err, say } = useApp();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api(kind).then(setDoc).catch((e) => setError(err(e))); }, [kind]);
  const save = async () => {
    try {
      setDoc(await api(kind, { text: editing, base: doc!.version }));
      setEditing(null);
      setError("");
      say(t("pip.noted"), "happy", 4000);
    } catch (e) {
      setError(err(e));
    }
  };
  if (!doc) return <Card>{error ? <p className="error-line">{error}</p> : <Loading />}</Card>;
  if (editing !== null) {
    return (
      <Card className="stack">
        <textarea className="code-box" rows={30} dir="ltr" value={editing} onChange={(e) => setEditing(e.target.value)} aria-label={t(`docs.${kind}Title`)} autoFocus />
        <div className="row">
          <Btn kind="primary" onClick={save}>{t("common.save")}</Btn>
          <Btn onClick={() => { setEditing(null); setError(""); }}>{t("common.cancel")}</Btn>
          {error && <span className="error-line" role="alert" dir="auto">{error}</span>}
        </div>
      </Card>
    );
  }
  return (
    <Card className="stack">
      <div><Btn onClick={() => setEditing(doc.text)}>{t("common.editDirect")}</Btn></div>
      <Markdown src={doc.markdown} className="md doc-text" dir="ltr" />
    </Card>
  );
}

function ViaChat({ draftKey }: { draftKey: string }) {
  const { t, draft } = useApp();
  return <Btn onClick={() => { draft.current = t(draftKey); location.hash = "#/chat/new"; }}>{t("common.viaChat")}</Btn>;
}

export function Profile() {
  const { t } = useApp();
  return <Page title={t("docs.profileTitle")} sub={t("docs.profileSub")} actions={<ViaChat draftKey="docs.profileDraft" />}><DocumentCard kind="profile" /></Page>;
}

const LIMITS: [string, number, number][] = [["summaryLines", 1, 8], ["summaryFill", 0, 100], ["skillLines", 1, 10], ["skillItems", 1, 40]];

function Checks() {
  const { t, err, say } = useApp();
  const [draft, setDraft] = useState<{ limits: Record<string, number | string>; banned: { reason: string; phrases: string[] }[] } | null>(null);
  const [adding, setAdding] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  useEffect(() => { api("checks").then(setDraft).catch((e) => setStatus([err(e), true])); }, []);
  if (!draft) return <Card>{status[0] ? <p className="error-line">{status[0]}</p> : <Loading />}</Card>;
  const update = (fn: (d: NonNullable<typeof draft>) => void) => { const next = structuredClone(draft); fn(next); setDraft(next); };
  const save = async () => {
    try {
      setDraft(await api("checks", draft));
      setStatus([t("docs.checksSaved"), false]);
      say(t("pip.noted"), "happy", 4000);
    } catch (e) {
      setStatus([t("common.saveFailed", { error: err(e) }), true]);
    }
  };
  return (
    <Card className="stack">
      <h2>{t("docs.checksTitle")}</h2>
      <p className="note">{t("docs.checksNote")}</p>
      <div className="fields">
        {LIMITS.map(([name, min, max]) => (
          <Field key={name} label={t(`docs.limits.${name}`)}>
            <input type="number" min={min} max={max} step={1} value={draft.limits[name]} onChange={(e) => update((d) => { d.limits[name] = e.target.value; })} />
          </Field>
        ))}
      </div>
      <h2>{t("docs.banned")}</h2>
      <p className="note">{t("docs.bannedNote")}</p>
      {draft.banned.map((group, gi) => {
        const add = () => {
          const phrase = (adding[gi] ?? "").trim().toLowerCase();
          if (!phrase) return;
          update((d) => { if (!d.banned[gi].phrases.includes(phrase)) d.banned[gi].phrases.push(phrase); });
          setAdding({ ...adding, [gi]: "" });
        };
        return (
          <div key={gi} className="stack banned-group">
            <p className="field-label" dir="ltr">{group.reason}</p>
            {group.phrases.length > 0 && (
              <div className="chips" dir="ltr">
                {group.phrases.map((p) => (
                  <span key={p} className="tag">{p}<button type="button" className="tag-x" aria-label={`${t("common.remove")} ${p}`} onClick={() => update((d) => { d.banned[gi].phrases = d.banned[gi].phrases.filter((x) => x !== p); })}>×</button></span>
                ))}
              </div>
            )}
            <form className="row" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <input type="text" dir="ltr" placeholder={t("docs.newPhrase")} aria-label={`${t("docs.newPhrase")}: ${group.reason}`} value={adding[gi] ?? ""} onChange={(e) => setAdding({ ...adding, [gi]: e.target.value })} />
              <Btn type="submit">{t("common.add")}</Btn>
            </form>
          </div>
        );
      })}
      <div className="row">
        <Btn kind="primary" onClick={save}>{t("docs.saveChecks")}</Btn>
        {status[0] && <span className={status[1] ? "error-line" : "note"} role="status" dir="auto">{status[0]}</span>}
      </div>
    </Card>
  );
}

function AtsTerms() {
  const { t, err } = useApp();
  const [terms, setTerms] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  return (
    <details className="card" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !terms) api("ats-terms").then((d) => setTerms(d.terms)).catch((x) => setError(err(x))); }}>
      <summary>{t("docs.terms")}</summary>
      <p className="note term-note">{t("docs.termsNote")}</p>
      {error ? <p className="error-line">{error}</p> : terms ? <div className="chips" dir="ltr">{terms.map((x) => <span key={x} className="tag plain">{x}</span>)}</div> : <Loading />}
    </details>
  );
}

export function Rules() {
  const { t } = useApp();
  return (
    <Page title={t("docs.rulesTitle")} sub={t("docs.rulesSub")} actions={<ViaChat draftKey="docs.rulesDraft" />}>
      <Checks />
      <AtsTerms />
      <DocumentCard kind="rules" />
    </Page>
  );
}

const CODE_FILE = /\.(sty|cls|py|tex)$/;

function FileEditor({ file }: { file: string }) {
  const { t, err } = useApp();
  const [doc, setDoc] = useState<{ text: string; version: string; readOnly: boolean } | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  useEffect(() => {
    setDoc(null);
    setStatus(["", false]);
    api(`file?path=${encodeURIComponent(file)}`).then((d) => { setDoc(d); setText(d.text); }).catch((e) => setStatus([err(e), true]));
  }, [file]);
  if (!doc) return <Card>{status[0] ? <p className="error-line">{status[0]}</p> : <Loading />}</Card>;
  const save = async () => {
    try {
      setDoc(await api("file", { path: file, text, base: doc.version }));
      setStatus([t("files.saved"), false]);
    } catch (e) {
      setStatus([err(e), true]);
    }
  };
  return (
    <Card className="stack">
      <h2 dir="ltr" className="file-name">{file}</h2>
      {doc.readOnly && <p className="note">{t("files.readOnly")}</p>}
      {!doc.readOnly && CODE_FILE.test(file) && <p className="warn-line">{t("files.code")}</p>}
      {file === "CLAUDE.md" && <p className="note">{t("files.claude")}</p>}
      <textarea className="code-box" rows={30} dir="ltr" spellCheck={false} readOnly={doc.readOnly} aria-label={file} value={text} onChange={(e) => setText(e.target.value)} />
      {!doc.readOnly && (
        <div className="row">
          <Btn kind="primary" onClick={save}>{t("common.save")}</Btn>
          {status[0] && <span className={status[1] ? "error-line" : "note"} role="status" dir="auto">{status[0]}</span>}
        </div>
      )}
    </Card>
  );
}

export function Files() {
  const { t, err } = useApp();
  const [groups, setGroups] = useState<{ title: string; files: string[] }[] | null>(null);
  const [sources, setSources] = useState<{ kind: string; name: string }[] | null>(null);
  const [open, setOpen] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api("files").then((d) => setGroups(d.groups)).catch((e) => setError(err(e)));
    api("sources").then((d) => setSources(d.sources)).catch(() => setSources([]));
  }, []);
  return (
    <Page title={t("files.title")} sub={t("files.sub")}>
      <Card>
        <h2>{t("files.sources")}</h2>
        {!sources ? <Loading /> : sources.length ? sources.map((x) => (
          <div key={`${x.kind}/${x.name}`} className="list-link">
            <a className="ellipsis" dir="ltr" href={`#/${x.kind}/${x.name}`}>{x.name}</a>
            <span className="note">{x.kind === "cv" ? t("apps.cv") : t("apps.letter")}</span>
          </div>
        )) : <p className="note">{t("files.noSources")}</p>}
      </Card>
      <div className="files">
        <nav className="card file-list" aria-label={t("files.title")}>
          <a className="file-link" href="#/rules">{t("files.links.rules")}</a>
          <a className="file-link" href="#/profile">{t("files.links.profile")}</a>
          <a className="file-link" href="#/settings">{t("files.links.settings")}</a>
          {error && <p className="error-line">{error}</p>}
          {groups?.map((g) => (
            <React.Fragment key={g.title}>
              <h3 className="file-group">{t(`files.groups.${g.title}`)}</h3>
              {g.files.map((f) => (
                <button key={f} type="button" className="file-link" dir="ltr" aria-current={open === f ? "true" : undefined} onClick={() => setOpen(f)}>{f.split("/").pop()}</button>
              ))}
            </React.Fragment>
          ))}
        </nav>
        {open ? <FileEditor file={open} /> : <Card><p className="note">{t("files.pick")}</p></Card>}
      </div>
    </Page>
  );
}

export function Editor({ kind, name }: { kind: string; name: string }) {
  const { t, err, say } = useApp();
  const [doc, setDoc] = useState<{ source: string; version: string; pdf: string | null; ats: { score: number | null } | null } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<[string, boolean]>(["", false]);
  const [output, setOutput] = useState("");
  const [stamp, setStamp] = useState(Date.now());
  const endpoint = `sources/${kind}/${name}`;
  useEffect(() => { api(endpoint).then((d) => { setDoc(d); setText(d.source); }).catch((e) => setStatus([err(e), true])); }, [endpoint]);
  const build = async () => {
    setBusy(true);
    setStatus([t("editor.building"), false]);
    try {
      const result = await api(endpoint, { source: text, base: doc!.version });
      setDoc(result);
      setOutput(kind === "letter" && result.ok ? "" : result.output);
      if (result.ok) {
        setStamp(Date.now());
        setStatus([`${t("editor.built")} ${result.ats ? t("editor.ats", { score: result.ats.score ?? "–" }) : ""}`, false]);
        say(t("pip.built"), "happy");
      } else {
        setStatus([t("editor.stopped"), true]);
        say(t("pip.buildFailed"), "worried");
      }
    } catch (e) {
      setStatus([err(e), true]);
      say(t("pip.saveFailed"), "worried");
    }
    setBusy(false);
  };
  return (
    <Page wide title={t(kind === "cv" ? "editor.cvTitle" : "editor.letterTitle")} sub={t(kind === "cv" ? "editor.cvSub" : "editor.letterSub")}
      actions={<><a className="btn" href="#/files">{t("editor.back")}</a><Btn kind="primary" disabled={busy || !doc} onClick={build}>{t("editor.build")}</Btn></>}>
      <p className="note" dir="ltr">{name}</p>
      {status[0] && <p className={status[1] ? "error-line" : "note"} role="status" dir="auto">{status[0]}</p>}
      {doc && (
        <div className="cv-edit">
          <textarea className="code-box" dir="ltr" spellCheck={false} aria-label={t("editor.text")} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="cv-preview">
            {doc.pdf ? <iframe title={t("editor.preview")} src={`/file?path=${encodeURIComponent(doc.pdf)}&v=${stamp}`} /> : <p className="empty">{t("editor.noPdf")}</p>}
          </div>
        </div>
      )}
      {output && <pre className="pre build-output">{output}</pre>}
    </Page>
  );
}
