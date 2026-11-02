import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { friendlyTitle, useApp } from "../app";
import { api, Badge, Btn, Markdown } from "../kit";
import { Pip } from "../pip";
import { SESSION_TONE } from "./home";

type Ev = Record<string, any> & { t: string };

function Threads({ id }: { id: string }) {
  const { s, t } = useApp();
  return (
    <div className="threads">
      <a className="btn primary" href="#/chat/new">{t("chat.new")}</a>
      {s.sessions.map((c) => (
        <a key={c.id} className="thread" href={`#/chat/${c.id}`} aria-current={c.id === id ? "true" : undefined}>
          <span className="ellipsis" dir="auto">{friendlyTitle(c.title, t)}</span>
          <Badge tone={SESSION_TONE[c.status]}>{t(`session.${c.status}`)}</Badge>
        </a>
      ))}
    </div>
  );
}

function NewConversation() {
  const { t, start, draft } = useApp();
  const [text, setText] = useState(() => { const d = draft.current; draft.current = ""; return d; });
  const [model, setModel] = useState("");
  const go = () => {
    const raw = text.trim();
    if (raw) start(/^https?:\/\/\S+$/.test(raw) ? `/apply ${raw}` : raw, model || undefined);
  };
  return (
    <div className="page narrow">
      <div className="new-chat">
        <Pip mood="wave" className="new-chat-pip" />
        <div>
          <h1>{t("chat.newTitle")}</h1>
          <p className="sub">{t("chat.newSub")}</p>
        </div>
      </div>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <textarea rows={4} value={text} placeholder={t("chat.newPlaceholder")} aria-label={t("chat.newTitle")} dir="auto" autoFocus
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }} />
        <div className="row spread">
          <select aria-label="model" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">{t("chat.models.default")}</option>
            <option value="claude-opus-5-5">{t("chat.models.opus")}</option>
            <option value="claude-sonnet-5-5">{t("chat.models.sonnet")}</option>
            <option value="claude-haiku-5-5">{t("chat.models.haiku")}</option>
          </select>
          <Btn kind="cta" type="submit">{t("chat.start")}</Btn>
        </div>
      </form>
    </div>
  );
}

function Permission({ ev, sessionId }: { ev: Ev; sessionId: string }) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const send = (body: Record<string, unknown>) => { setBusy(true); api(`sessions/${sessionId}/respond`, { requestId: ev.requestId, ...body }).catch(() => setBusy(false)); };
  return (
    <section className="ask" role="group" aria-label={t("chat.permission", { tool: ev.tool })}>
      <div className="ask-head"><Pip mood="ask" className="ask-pip" /><span className="ask-title">{t("chat.permission", { tool: ev.tool })}</span></div>
      <pre className="pre">{ev.input}</pre>
      <div className="row">
        <Btn kind="primary" disabled={busy} onClick={() => send({ allow: true })}>{t("chat.allow")}</Btn>
        {ev.canRemember && <Btn disabled={busy} onClick={() => send({ allow: true, remember: true })}>{t("chat.allowFolder")}</Btn>}
        <Btn kind="danger" disabled={busy} onClick={() => send({ allow: false })}>{t("chat.deny")}</Btn>
      </div>
    </section>
  );
}

function Question({ ev, sessionId }: { ev: Ev; sessionId: string }) {
  const { t } = useApp();
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (qi: number, label: string, multi: boolean) => setPicked((p) => {
    const cur = p[qi] ?? [];
    return { ...p, [qi]: multi ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label] };
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const answers = ev.questions.map((q: any, qi: number) => [q.question, [...(picked[qi] ?? []), ...(other[qi]?.trim() ? [other[qi].trim()] : [])].join(", ")]);
    if (answers.some(([, a]: string[]) => !a)) { setError(t("chat.answerAll")); return; }
    setBusy(true);
    api(`sessions/${sessionId}/respond`, { requestId: ev.requestId, answers: Object.fromEntries(answers) }).catch(() => setBusy(false));
  };
  return (
    <form className="ask" onSubmit={submit}>
      <div className="ask-head"><Pip mood="ask" className="ask-pip" /></div>
      {ev.questions.map((q: any, qi: number) => (
        <fieldset key={qi} className="stack">
          <legend className="ask-title" dir="auto">{q.question}</legend>
          {q.options.map((o: any) => (
            <label key={o.label} className="option">
              <input type={q.multiSelect ? "checkbox" : "radio"} name={`q${qi}`} checked={(picked[qi] ?? []).includes(o.label)} onChange={() => toggle(qi, o.label, q.multiSelect)} />
              <span dir="auto">{o.label}{o.description && <small>{o.description}</small>}</span>
            </label>
          ))}
          <input type="text" placeholder={t("chat.other")} aria-label={t("chat.other")} dir="auto" value={other[qi] ?? ""} onChange={(e) => setOther({ ...other, [qi]: e.target.value })} />
        </fieldset>
      ))}
      {error && <p className="error-line" role="alert">{error}</p>}
      <div><Btn kind="primary" type="submit" disabled={busy}>{t("chat.answer")}</Btn></div>
    </form>
  );
}

function ToolLine({ ev, result }: { ev: Ev; result?: Ev }) {
  const { t } = useApp();
  const template = t(`chat.tools.${ev.name}`);
  const label = ev.label ?? (template.startsWith("chat.tools.") ? (ev.target || ev.name) : t(`chat.tools.${ev.name}`, { target: ev.target ?? "" }));
  return (
    <details className={`tool ${ev.nested ? "nested" : ""} ${result ? (result.isError ? "failed" : "done") : ""}`}>
      <summary><span className="ellipsis" dir="auto">{label}</span></summary>
      {result?.preview && <pre className="pre">{result.preview}</pre>}
    </details>
  );
}

function Conversation({ id }: { id: string }) {
  const { s, t, refresh } = useApp();
  const session = s.sessions.find((c) => c.id === id);
  const [events, setEvents] = useState<Ev[]>([]);
  const [live, setLive] = useState("");
  const [status, setStatus] = useState(session?.status ?? "idle");
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const source = new EventSource(`/api/sessions/${id}/events`);
    source.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      if (e.t === "hello") { setEvents(e.events); setStatus(e.session.status); setLive(""); stick.current = true; return; }
      if (e.t === "delta") { setLive((l) => l + e.text); return; }
      if (e.t === "status") { setStatus(e.status); refresh().catch(() => {}); return; }
      if (e.t === "text") setLive("");
      setEvents((list) => [...list, e]);
    };
    return () => source.close();
  }, [id, refresh]);

  useLayoutEffect(() => {
    if (stick.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [events, live]);

  const resolved = useMemo(() => new Map(events.filter((e) => e.t === "resolved").map((e) => [e.requestId, e])), [events]);
  const results = useMemo(() => new Map(events.filter((e) => e.t === "tool_result").map((e) => [e.id, e])), [events]);

  const send = async () => {
    const message = text.trim();
    if (!message) return;
    setText("");
    stick.current = true;
    await api(`sessions/${id}/message`, { text: message });
  };

  const settled = (e: Ev) => {
    const r = resolved.get(e.requestId)!;
    return <div key={e.requestId} className="ask settled" dir="auto">{r.code ? t(`chat.resolved.${r.code}`) : r.answer}</div>;
  };

  return (
    <div className="convo">
      <div className="chat-head">
        <span className="ellipsis" dir="auto">{session ? friendlyTitle(session.title, t) : ""}</span>
        <div className="row">
          <Badge tone={SESSION_TONE[status]}>{t(`session.${status}`)}</Badge>
          {(status === "running" || status === "waiting") && <Btn kind="danger" onClick={() => api(`sessions/${id}/interrupt`, {})}>{t("chat.stop")}</Btn>}
        </div>
      </div>
      <div className="log" ref={log} role="log" aria-live="polite" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {events.map((e, i) => {
          switch (e.t) {
            case "user": return <div key={i} className="msg-user" dir="auto">{e.text}</div>;
            case "text": return <div key={i} className="msg-pip"><Pip mood="idle" className="msg-avatar" /><Markdown src={e.text} className="md msg-text" /></div>;
            case "tool": return <ToolLine key={i} ev={e} result={results.get(e.id)} />;
            case "permission": return resolved.has(e.requestId) ? settled(e) : <Permission key={i} ev={e} sessionId={id} />;
            case "question": return resolved.has(e.requestId) ? settled(e) : <Question key={i} ev={e} sessionId={id} />;
            case "result": return <p key={i} className="done-line">{e.ok ? t("chat.done") : t("chat.doneError")}{e.cost >= 0.01 ? t("chat.cost", { cost: e.cost.toFixed(2) }) : ""}</p>;
            case "error": return <p key={i} className="error-line" role="alert" dir="auto">{e.code ? t(`chat.errors.${e.code}`, { detail: e.text ?? "" }) : e.text}</p>;
            default: return null;
          }
        })}
        {live && <div className="msg-pip"><Pip mood="work" className="msg-avatar" /><Markdown src={live} className="md msg-text" /></div>}
        {!live && status === "running" && <div className="msg-pip typing"><Pip mood="work" className="msg-avatar" /><span className="dots" aria-hidden="true"><i /><i /><i /></span></div>}
      </div>
      <div className="composer">
        <form onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea rows={1} value={text} placeholder={t("chat.message")} aria-label={t("chat.message")} dir="auto"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <Btn kind="primary" type="submit">{t("chat.send")}</Btn>
        </form>
      </div>
    </div>
  );
}

export function Chat({ id }: { id: string }) {
  const { s, t, loaded } = useApp();
  const exists = id !== "new" && s.sessions.some((c) => c.id === id);
  if (!loaded) return <div className="chat"><Threads id={id} /></div>;
  return (
    <div className="chat">
      <Threads id={id} />
      {id === "new" ? <NewConversation /> : exists ? <Conversation key={id} id={id} /> : <div className="empty">{s.sessions.length ? t("chat.notFound") : <NewConversation />}</div>}
    </div>
  );
}
