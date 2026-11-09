// The conversations with Pip, laid out like a chat app's: the open conversation in the middle, its messages in
// one column over a round box to write in, and the list of conversations on the page's far side, as wide as the
// sidebar, so the page is even. In a narrower window the list opens over the page from a button at the top.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { friendlyTitle, useApp } from "../app";
import { api, Btn, Icon, Markdown, ThinBar, useGoSlot } from "../kit";
import { Pip } from "../pip";
import { Select } from "../select";
import { useVoiceTyping, VoiceGlow, VoiceTypingButton } from "../voice";

type Ev = Record<string, any> & { t: string };
type Access = "ask" | "auto" | "full";
type Doc = { path: string; name: string };

const ACCESS: Access[] = ["ask", "auto", "full"];
const MODELS: [string, string][] = [["", "default"], ["claude-opus-5-5", "opus"], ["claude-sonnet-5-5", "sonnet"], ["claude-haiku-5-5", "haiku"]];
// Which AI the settings put first (ai.ts): the primary while it is connected, Claude otherwise. With ChatGPT first
// on a key alone, a new conversation is a plain one, chat only, unless its message is a command.
export const MAKERS: Record<string, { name: string; company: string }> = { claude: { name: "Claude", company: "Anthropic" }, openai: { name: "ChatGPT", company: "OpenAI" } };
export function useFirstAi() {
  const { s } = useApp();
  const primary = String(s.settings.aiPrimary ?? "claude");
  return primary !== "claude" && (s.aiKeys[primary] || s.aiLogins?.[primary]) ? primary : "claude";
}
// The commands a new conversation offers as a start; one that needs more, a link or a company, goes into the box
// to finish there.
const STARTS: [string, boolean][] = [["job-scraper", false], ["rank", false], ["apply", true], ["interview", true]];
const GROUPS = ["today", "yesterday", "week", "earlier"] as const;
const DAY_MS = 86_400_000;
// The box grows with what is written, up to this, then scrolls.
const BOX_MAX = 220;
// What can be attached to a message, as uploads.ts takes it: images up to 5 MB, PDFs and text up to 20 MB, five
// at a time.
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp"];
const FILE_EXT = ["pdf", "txt", "md", "csv", "json", "tex"];
const MB = 1024 * 1024;
const MAX_FILES = 5;
const ACCEPT = [...IMAGE_EXT, ...FILE_EXT].map((e) => `.${e}`).join(",");
type Attached = { key: string; name: string; kind: string; size: number; id?: string; error?: string };
type Sent = { id: string; name: string; kind: string; size: number };

const sizeText = (n: number) => (n < MB ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / MB).toFixed(1)} MB`);
export const readBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

function groupOf(createdAt: number): (typeof GROUPS)[number] {
  const midnight = new Date().setHours(0, 0, 0, 0);
  if (createdAt >= midnight) return "today";
  if (createdAt >= midnight - DAY_MS) return "yesterday";
  return createdAt >= midnight - 7 * DAY_MS ? "week" : "earlier";
}

// The list of conversations, newest first under the day they began, with a dot by one that is working, waits for
// you or stopped, and a button for a new one on top.
function Threads({ id, onPick }: { id: string; onPick: () => void }) {
  const { s, t } = useApp();
  const list = useRef<HTMLDivElement>(null);
  return (
    <nav className="threads" aria-label={t("chat.list")}>
      <a className="thread-new" href="/chat/new" onClick={onPick}><Icon name="plus" /><span>{t("chat.new")}</span></a>
      <div className="threads-scroll">
        <div ref={list} className="threads-list">
          <div>
            {GROUPS.map((g) => {
              const items = s.sessions.filter((c) => groupOf(c.createdAt) === g);
              return items.length > 0 && (
                <section key={g} className="thread-group">
                  <h2>{t(`chat.groups.${g}`)}</h2>
                  {items.map((c) => (
                    <a key={c.id} className="thread" href={`/chat/${c.id}`} aria-current={c.id === id ? "page" : undefined} onClick={onPick}>
                      <span className="thread-title" dir="auto">{friendlyTitle(c.title, t)}</span>
                      {c.status !== "idle" && <span className={`thread-dot ${c.status}`} role="img" aria-label={t(`session.${c.status}`)} />}
                    </a>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
        <ThinBar target={list} />
      </div>
    </nav>
  );
}

// The round box to write in, like the jobs search's: one pill-shaped row, a + for attaching at its start, then
// the words, and at its end the pickers (tools) as round buttons and the place of the round go button, which
// rolls in once there is something to send (or while Pip works, to stop it), as the search's does (useGoSlot).
// A second line, or anything attached, opens the box up, the words over a row of the buttons, until it is empty
// again. Enter sends and Shift+Enter starts a new line; empty, it takes the page's direction, so the hint starts
// on the page's side. Images and files come in by the +, by pasting, or dropped on the box; each is sent up as
// it comes and shows over the words, with a mark while it goes up and an × to take it off. onSend gets their ids.
// Under it, warn is a warning and hint a quieter line. glow: the shape of voice typing's glow behind it, a halo
// round a box in the middle of the page or rising behind one at its foot (VoiceGlow).
function Composer({ text, setText, onSend, onStop, working = false, placeholder, tools, warn, hint, input, autoFocus, glow = "rise" }: {
  text: string; setText: (v: string) => void; onSend: (files: string[]) => void; onStop?: () => void; working?: boolean; placeholder: string;
  tools?: React.ReactNode; warn?: React.ReactNode; hint?: React.ReactNode; input?: React.RefObject<HTMLTextAreaElement>; autoFocus?: boolean;
  glow?: "halo" | "rise";
}) {
  const { t } = useApp();
  const own = useRef<HTMLTextAreaElement>(null);
  const box = input ?? own;
  const frame = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<Attached[]>([]);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState("");
  const [tall, setTall] = useState(false);
  // One line keeps the pill; a second one, or a file, opens the box, and once open it grows with the words.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!text && !files.length) { setTall(false); el.style.height = ""; return; }
    if (!tall) {
      if (files.length || text.includes("\n") || el.scrollHeight > el.clientHeight + 2) setTall(true);
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, BOX_MAX)}px`;
  }, [text, files.length, tall]);

  const add = (list: FileList | File[] | null) => {
    const incoming = [...(list ?? [])];
    if (!incoming.length) return;
    setNote(files.length + incoming.length > MAX_FILES ? t("chat.upload.many", { n: MAX_FILES }) : "");
    for (const file of incoming.slice(0, Math.max(0, MAX_FILES - files.length))) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const kind = IMAGE_EXT.includes(ext) ? "image" : FILE_EXT.includes(ext) ? (ext === "pdf" ? "pdf" : "text") : "";
      const item: Attached = { key: crypto.randomUUID(), name: file.name, kind: kind || "text", size: file.size };
      const max = kind === "image" ? 5 : 20;
      if (!kind) item.error = t("chat.upload.type", { name: file.name });
      else if (file.size > max * MB) item.error = t("chat.upload.size", { name: file.name, max });
      setFiles((cur) => [...cur, item]);
      if (item.error) continue;
      const done = (change: Partial<Attached>) => setFiles((cur) => cur.map((x) => (x.key === item.key ? { ...x, ...change } : x)));
      readBase64(file)
        .then((data) => api<Sent>("uploads", { name: file.name, data }))
        .then((up) => done({ id: up.id, name: up.name }))
        .catch((e) => done({ error: t(e?.code === "upload_type" ? "chat.upload.type" : e?.code === "upload_size" ? "chat.upload.size" : "chat.upload.failed", { name: file.name, max }) }));
    }
  };
  // Voice typing (voice.tsx): what is said is written into the box, to send like anything typed.
  const voice = useVoiceTyping(text, setText, box);
  const going = files.some((f) => !f.id && !f.error);
  const ready = (text.trim() !== "" || files.some((f) => f.id)) && !going;
  const send = () => {
    if (!ready) return;
    voice.stop();
    onSend(files.flatMap((f) => (f.id ? [f.id] : [])));
    setFiles([]);
    setNote("");
  };
  const errors = [note, ...files.flatMap((f) => (f.error ? [f.error] : []))].filter(Boolean);
  const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");
  const stopping = working && !ready && !going && Boolean(onStop);
  const slotOpen = useGoSlot(ready || stopping, row, ".select.circle, .voice-go, .voice-lang");

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <VoiceGlow v={voice} shape={glow} box={frame} />
      <div
        ref={frame}
        className={`composer-box ${tall ? "tall" : ""} ${ready || stopping ? "typing" : ""} ${slotOpen ? "slot-open" : ""} ${over ? "over" : ""}`}
        onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
        onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      >
        {files.length > 0 && (
          <div className="composer-files">
            {files.map((f) => (
              <div key={f.key} className={`attached ${f.kind === "image" && f.id ? "image" : "file"} ${f.error ? "failed" : ""}`}>
                {f.kind === "image" && f.id
                  ? <img src={`/api/uploads/${f.id}`} alt={f.name} />
                  : <>
                    <span className="attached-mark">{!f.id && !f.error ? <span className="spinner" aria-hidden="true" /> : <Icon name={f.error ? "warn" : "file"} />}</span>
                    <span className="attached-name"><span dir="auto">{f.name}</span><small dir="ltr">{sizeText(f.size)}</small></span>
                  </>}
                <button type="button" className="attached-x" aria-label={t("chat.upload.remove", { name: f.name })} onClick={() => setFiles((cur) => cur.filter((x) => x.key !== f.key))}><Icon name="close" /></button>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="composer-attach" aria-label={t("chat.upload.attach")} onClick={() => picker.current?.click()}><Icon name="plus" /></button>
        <input ref={picker} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <textarea
          ref={box} rows={1} value={text} placeholder={placeholder} aria-label={placeholder} dir={text ? "auto" : undefined} autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); add(e.clipboardData.files); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        />
        <div className="composer-tools" ref={row}>
          {tools}
          <VoiceTypingButton v={voice} />
          <span className="seek-go-slot">
            {stopping
              ? <button type="button" className="seek-go stop" aria-label={t("chat.stop")} onClick={onStop}><Icon name="stop" /></button>
              : <button type="submit" className="seek-go" aria-label={t("chat.send")} aria-hidden={!ready} tabIndex={ready ? undefined : -1} disabled={!ready}><Icon name="send" /></button>}
          </span>
        </div>
      </div>
      {errors.map((line) => <p key={line} className="composer-error" role="alert"><Icon name="warn" /><span>{line}</span></p>)}
      {warn && <p className="composer-warn" role="note"><Icon name="warn" /><span>{warn}</span></p>}
      {hint && <p className="composer-hint" role="note">{hint}</p>}
    </form>
  );
}

// How much the conversation may do without asking (policy.ts): a round button with the access's icon, opening
// the three, each with its icon and a line on what it means.
function AccessPicker({ value, onChange }: { value: Access; onChange: (a: Access) => void }) {
  const { t } = useApp();
  return (
    <Select
      compact className={`circle access-${value}`} label={t("chat.access.label")} value={value} onChange={(v) => onChange(v as Access)}
      options={ACCESS.map((a) => ({ value: a, label: t(`chat.access.${a}`), note: t(`chat.access.${a}Note`), icon: `access-${a}` }))}
    />
  );
}

// Claude's model, the same way: a round button with the model's icon.
function ModelPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const { t } = useApp();
  return <Select compact className="circle" label={t("chat.model")} value={value} onChange={onChange} options={MODELS.map(([m, key]) => ({ value: m, label: t(`chat.models.${key}`), icon: `model-${key}` }))} />;
}

// The list button, for a window too narrow to show the list beside the conversation.
const ListButton = ({ onList }: { onList: () => void }) => {
  const { t } = useApp();
  return <button type="button" className="chat-lists" aria-label={t("chat.openList")} onClick={onList}><Icon name="chat" /></button>;
};

// A new conversation. With ChatGPT first in the settings on a key alone it is a plain one: no access or model to pick,
// and a line under the box says so; the starts and any message that is a command still go to Claude.
function NewConversation({ onList }: { onList: () => void }) {
  const { s, t, start, draft } = useApp();
  const [text, setText] = useState(() => { const d = draft.current; draft.current = ""; return d; });
  const [model, setModel] = useState("");
  const [access, setAccess] = useState<Access>("ask");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const first = useFirstAi();
  // ChatGPT signed in with its account works in the project as Claude does, through Codex (codex.ts), with the same
  // access to pick; only Claude has models to pick from.
  const codex = first === "openai" && Boolean(s.aiLogins?.openai);
  const plain = !codex && first !== "claude" && !text.trim().startsWith("/");
  const go = (raw = text.trim(), files: string[] = []) => {
    if ((!raw && !files.length) || busy) return;
    setBusy(true);
    const prompt = !files.length && /^https?:\/\/\S+$/.test(raw) ? `/apply ${raw}` : raw;
    return start(prompt, model || undefined, access, files).catch((err) => { setBusy(false); throw err; });
  };
  const begin = (command: string, more: boolean) => {
    if (!more) { go(`/${command}`)?.catch(() => {}); return; }
    setText(`/${command} `);
    requestAnimationFrame(() => input.current?.focus());
  };
  return (
    <div className="chat-new">
      <div className="chat-top"><ListButton onList={onList} /></div>
      <div className="chat-new-body">
        <div className="chat-new-head">
          <Pip mood="wave" className="chat-new-pip" />
          <h1>{t("chat.newTitle")}</h1>
        </div>
        <Composer
          text={text} setText={setText} onSend={(files) => { go(text.trim(), files)?.catch(() => {}); }} placeholder={t("chat.newPlaceholder")} input={input} autoFocus glow="halo"
          tools={plain ? null : <><AccessPicker value={access} onChange={setAccess} />{!codex && <ModelPicker value={model} onChange={setModel} />}</>}
          warn={!plain && access === "full" ? t("chat.access.fullWarn") : ""} hint={codex ? t("chat.ai.codex", MAKERS[first]) : plain ? t("chat.ai.plain", MAKERS[first]) : ""}
        />
        <div className="chat-starts" role="group" aria-label={t("chat.suggest")}>
          {STARTS.map(([command, more]) => (
            <button key={command} type="button" className="chat-start" disabled={busy} onClick={() => begin(command, more)}>{t(`tools.commands.${command}`)[0]}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Permission({ ev, sessionId }: { ev: Ev; sessionId: string }) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const send = (body: Record<string, unknown>) => { setBusy(true); api(`sessions/${sessionId}/respond`, { requestId: ev.requestId, ...body }).catch(() => setBusy(false)); };
  return (
    <section className="ask-card" role="group" aria-label={t("chat.permission", { tool: ev.tool })}>
      <div className="ask-card-head"><Pip mood="idle" className="ask-pip" /><strong>{t("chat.permission", { tool: ev.tool })}</strong></div>
      <pre className="pre" dir="ltr">{ev.input}</pre>
      <div className="row">
        <Btn kind="primary" disabled={busy} onClick={() => send({ allow: true })}>{t("chat.allow")}</Btn>
        {ev.canRemember && <Btn disabled={busy} onClick={() => send({ allow: true, remember: true })}>{t("chat.allowFolder")}</Btn>}
        <Btn kind="danger" disabled={busy} onClick={() => send({ allow: false })}>{t("chat.deny")}</Btn>
      </div>
      <p className="ask-hint">{t("chat.access.hint")}</p>
    </section>
  );
}

// Pip's questions, each with its options as rows to pick, and a line for an answer of your own.
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
    <form className="ask-card" onSubmit={submit}>
      <div className="ask-card-head"><Pip mood="idle" className="ask-pip" /></div>
      {ev.questions.map((q: any, qi: number) => (
        <fieldset key={qi} className="ask-question">
          <legend dir="auto">{q.question}</legend>
          {q.options.map((o: any) => (
            <label key={o.label} className="ask-option">
              <input type={q.multiSelect ? "checkbox" : "radio"} name={`q${qi}`} checked={(picked[qi] ?? []).includes(o.label)} onChange={() => toggle(qi, o.label, q.multiSelect)} />
              <span dir="auto"><strong>{o.label}</strong>{o.description && <small>{o.description}</small>}</span>
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

function useToolLabel() {
  const { t } = useApp();
  return (ev: Ev) => {
    const template = t(`chat.tools.${ev.name}`);
    return ev.label ?? (template.startsWith("chat.tools.") ? (ev.target || ev.name) : t(`chat.tools.${ev.name}`, { target: ev.target ?? "" }));
  };
}

// One tool call: a mark of how it went (working, done or failed), what it did, and what came back, folded.
function ToolLine({ ev, result, working }: { ev: Ev; result?: Ev; working: boolean }) {
  const label = useToolLabel();
  const state = result ? (result.isError ? "failed" : "done") : working ? "working" : "done";
  const mark = state === "working" ? <span className="spinner" aria-hidden="true" /> : <Icon name={state === "failed" ? "close" : "check"} />;
  return (
    <li className={`tool ${state} ${ev.nested ? "nested" : ""}`}>
      {result?.preview
        ? <details><summary>{mark}<span className="ellipsis" dir="auto">{label(ev)}</span></summary><pre className="pre">{result.preview}</pre></details>
        : <div className="tool-row">{mark}<span className="ellipsis" dir="auto">{label(ev)}</span></div>}
    </li>
  );
}

// The tool calls between two messages as one folded line, like a chat app's steps: while Pip works it shows the
// step under way, then how many there were; opened, each one.
function ToolSteps({ tools, results, working }: { tools: Ev[]; results: Map<string, Ev>; working: boolean }) {
  const { t } = useApp();
  const label = useToolLabel();
  const top = tools.filter((x) => !x.nested).length || tools.length;
  const busy = working && tools.some((x) => !results.has(x.id));
  const failed = tools.some((x) => results.get(x.id)?.isError);
  return (
    <details className={`steps ${busy ? "working" : ""} ${failed ? "failed" : ""}`}>
      <summary>
        {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name={failed ? "warn" : "check"} />}
        <span className="ellipsis" dir="auto">{busy ? label(tools[tools.length - 1]) : top === 1 ? t("chat.step") : t("chat.steps", { n: top })}</span>
        <Icon name="down" />
      </summary>
      <ol>{tools.map((x) => <ToolLine key={x.id} ev={x} result={results.get(x.id)} working={working} />)}</ol>
    </details>
  );
}

// The documents the conversation made, each to open in a new tab or save, right here.
function Files({ files }: { files: Doc[] }) {
  const { t } = useApp();
  return (
    <section className="chat-files" aria-label={t("chat.files")}>
      <h2>{t("chat.files")}</h2>
      {files.map((f) => {
        const href = `/file?path=${encodeURIComponent(f.path)}`;
        return (
          <div key={f.path} className="chat-file">
            <span className="chat-file-mark"><Icon name="file" /></span>
            <span className="chat-file-name"><span dir="auto">{f.name}</span><small dir="ltr">{f.path.split("/").slice(0, -1).join("/")}</small></span>
            <a className="chat-file-act" href={href} target="_blank" rel="noopener noreferrer"><Icon name="open" /><span>{t("chat.open")}</span></a>
            <a className="chat-file-act" href={`${href}&download=1`} download><Icon name="download" /><span>{t("chat.download")}</span></a>
          </div>
        );
      })}
    </section>
  );
}

type Item = { kind: "tools"; key: string; tools: Ev[] } | { kind: "event"; key: string; ev: Ev };

// bare: inside another page (the introduction's), which has its own heading, so no header of its own.
// Claude's sign-in refused before it could answer (agent.ts), or its server's words for it in a conversation from
// before Pip knew it: what happened, and the way to sign in again, Claude Code's own window on the computer
// (clis.ts openLogin). After it, a message goes on with the conversation.
const CLAUDE_REFUSED = /^Failed to authenticate\b/;
function ClaudeLogin() {
  const { t, err } = useApp();
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState("");
  const open = () => {
    setError("");
    api("ai-login", { provider: "claude" }).then(() => setOpened(true), (x) => setError(err(x)));
  };
  return (
    <div className="chat-login" role="alert">
      <p className="error-line" dir="auto">{t("chat.errors.claude_login")}</p>
      {opened ? <p className="note" dir="auto">{t("chat.loginOpened")}</p> : <Btn onClick={open}>{t("chat.loginAgain")}</Btn>}
      {error && <p className="error-line" dir="auto">{error}</p>}
    </div>
  );
}

export function Conversation({ id, onList, bare = false }: { id: string; onList?: () => void; bare?: boolean }) {
  const { s, t, refresh } = useApp();
  const session = s.sessions.find((c) => c.id === id);
  const [events, setEvents] = useState<Ev[]>([]);
  const [live, setLive] = useState("");
  const [status, setStatus] = useState(session?.status ?? "idle");
  const [text, setText] = useState("");
  const [access, setAccessState] = useState<Access>(ACCESS.includes(session?.access as Access) ? (session!.access as Access) : "ask");
  const [files, setFiles] = useState<Doc[]>([]);
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // A plain conversation has no access to pick; the name of the AI that answered it last stands by the title.
  const plain = Boolean(session?.plain);

  const loadFiles = useCallback(() => { api(`sessions/${id}/files`).then((d) => setFiles(d.files)).catch(() => {}); }, [id]);
  useEffect(loadFiles, [loadFiles]);

  useEffect(() => {
    const source = new EventSource(`/api/sessions/${id}/events`);
    source.onmessage = (msg) => {
      const e = JSON.parse(msg.data);
      if (e.t === "hello") { setEvents(e.events); setStatus(e.session.status); setLive(""); stick.current = true; return; }
      if (e.t === "delta") { setLive((l) => l + e.text); return; }
      if (e.t === "status") { setStatus(e.status); refresh().catch(() => {}); if (e.status !== "running") loadFiles(); return; }
      // A switch to the next AI drops what the one that failed had begun to write.
      if (e.t === "text" || e.t === "switched") setLive("");
      if (e.t === "tool_result") loadFiles();
      setEvents((list) => [...list, e]);
    };
    return () => source.close();
  }, [id, refresh, loadFiles]);

  useLayoutEffect(() => {
    if (stick.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [events, live, files]);

  const resolved = useMemo(() => new Map(events.filter((e) => e.t === "resolved").map((e) => [e.requestId, e])), [events]);
  const results = useMemo(() => new Map(events.filter((e) => e.t === "tool_result").map((e) => [e.id, e])), [events]);
  // Tool calls in a row become one item, the rest one each; results and answers are found from their calls.
  const items = useMemo(() => {
    const out: Item[] = [];
    events.forEach((e, i) => {
      if (e.t === "tool_result" || e.t === "resolved") return;
      const last = out[out.length - 1];
      if (e.t === "tool" && last?.kind === "tools") last.tools.push(e);
      else out.push(e.t === "tool" ? { kind: "tools", key: `tools-${i}`, tools: [e] } : { kind: "event", key: String(i), ev: e });
    });
    return out;
  }, [events]);

  const working = status === "running" || status === "waiting";
  // Stop pressed: said at once, as what is under way takes a moment to be killed, until the conversation stops.
  const [stopping, setStopping] = useState(false);
  useEffect(() => { if (!working) setStopping(false); }, [working]);
  const stop = () => { setStopping(true); api(`sessions/${id}/interrupt`, {}).catch(() => setStopping(false)); };
  const send = async (files: string[]) => {
    const message = text.trim();
    if (!message && !files.length) return;
    setText("");
    stick.current = true;
    await api(`sessions/${id}/message`, { text: message, files });
  };
  const changeAccess = (next: Access) => {
    setAccessState(next);
    api(`sessions/${id}/access`, { access: next }).then(() => refresh()).catch(() => {});
  };

  const settled = (e: Ev) => {
    const r = resolved.get(e.requestId)!;
    const ok = r.code === "allowed" || !r.code;
    return <p key={e.requestId} className={`settled ${ok ? "" : "no"}`} dir="auto"><Icon name={ok ? "check" : "close"} />{r.code ? t(`chat.resolved.${r.code}`) : r.answer}</p>;
  };
  const render = (e: Ev, key: string) => {
    switch (e.t) {
      case "user": return (
        <div key={key} className="msg-user">
          {/* What was attached, over the words: images as pictures, other files as cards; each opens in a new tab. */}
          {e.files?.length > 0 && (
            <div className="msg-files">
              {e.files.map((f: Sent) => (
                <a key={f.id} className={f.kind === "image" ? "msg-image" : "msg-file"} href={`/api/uploads/${f.id}`} target="_blank" rel="noopener noreferrer">
                  {f.kind === "image" ? <img src={`/api/uploads/${f.id}`} alt={f.name} /> : <>
                    <span className="attached-mark"><Icon name="file" /></span>
                    <span className="attached-name"><span dir="auto">{f.name}</span><small dir="ltr">{sizeText(f.size)}</small></span>
                  </>}
                </a>
              ))}
            </div>
          )}
          {e.text && <div className="msg-bubble" dir="auto">{e.text}</div>}
        </div>
      );
      case "text": return CLAUDE_REFUSED.test(e.text) ? <ClaudeLogin key={key} />
        : <div key={key} className="msg-pip"><Pip mood="idle" className="msg-avatar" /><Markdown src={e.text} className="md msg-text" /></div>;
      case "permission": return resolved.has(e.requestId) ? settled(e) : <Permission key={key} ev={e} sessionId={id} />;
      case "question": return resolved.has(e.requestId) ? settled(e) : <Question key={key} ev={e} sessionId={id} />;
      case "result": return <p key={key} className="done-line">{e.ok ? t("chat.done") : t("chat.doneError")}{e.cost >= 0.01 ? t("chat.cost", { cost: e.cost.toFixed(2) }) : ""}</p>;
      case "error": return e.code === "claude_login" ? <ClaudeLogin key={key} />
        : <p key={key} className="error-line" role="alert" dir="auto">{e.code ? t(`chat.errors.${e.code}`, { detail: e.text ?? "" }) : e.text}</p>;
      case "switched": return <p key={key} className="switched-line" dir="auto"><Icon name="warn" />{t("chat.switched", { from: e.from, to: e.to })}</p>;
      default: return null;
    }
  };

  return (
    <div className="convo">
      {!bare && (
        <header className="chat-top">
          {onList && <ListButton onList={onList} />}
          <h1 className="chat-title" dir="auto">{session ? friendlyTitle(session.title, t) : ""}</h1>
          {(plain || (session?.agent && session.agent !== "claude")) && session?.engine && <span className="chat-model"><bdi>{session.engine}</bdi></span>}
          {status !== "idle" && <span className={`chat-state ${status}`}>{t(stopping ? "session.stopping" : `session.${status}`)}</span>}
        </header>
      )}
      <div className="log-frame">
        <div className="log" ref={log} role="log" aria-live="polite" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          <div className="log-column">
            {items.map((item, i) => (item.kind === "tools"
              ? <ToolSteps key={item.key} tools={item.tools} results={results} working={working && i === items.length - 1} />
              : render(item.ev, item.key)))}
            {live && <div className="msg-pip"><Pip mood="idle" className="msg-avatar" /><Markdown src={live} className="md msg-text" /></div>}
            {!live && status === "running" && (stopping || items[items.length - 1]?.kind !== "tools") && (
              <div className="msg-pip typing"><Pip mood="work" className="msg-avatar" /><span className="typing-text">{t(stopping ? "session.stopping" : "chat.working")}</span></div>
            )}
            {files.length > 0 && <Files files={files} />}
          </div>
        </div>
        <ThinBar target={log} />
      </div>
      <Composer
        text={text} setText={setText} onSend={send} onStop={stop} working={working} placeholder={t("chat.message")}
        tools={plain ? null : <AccessPicker value={access} onChange={changeAccess} />}
        warn={!plain && access === "full" ? t("chat.access.fullWarn") : ""}
      />
    </div>
  );
}

export function Chat({ id }: { id: string }) {
  const { s, t, loaded } = useApp();
  const [lists, setLists] = useState(false);
  const exists = id !== "new" && s.sessions.some((c) => c.id === id);
  useEffect(() => {
    if (!lists) return;
    const shut = (e: KeyboardEvent) => { if (e.key === "Escape") setLists(false); };
    addEventListener("keydown", shut);
    return () => removeEventListener("keydown", shut);
  }, [lists]);
  const open = () => setLists(true);
  return (
    <div className={`chat ${lists ? "lists-open" : ""}`}>
      <div className="chat-main">
        {!loaded ? null
          : id === "new" || !s.sessions.length ? <NewConversation onList={open} />
          : exists ? <Conversation key={id} id={id} onList={open} />
          : <div className="empty">{t("chat.notFound")}</div>}
      </div>
      <Threads id={id} onPick={() => setLists(false)} />
      {lists && <button type="button" className="threads-shade" aria-label={t("chat.closeList")} onClick={() => setLists(false)} />}
    </div>
  );
}
