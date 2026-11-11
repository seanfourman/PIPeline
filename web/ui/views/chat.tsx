// The conversations with Pip, laid out like a chat app's: the open conversation in the middle, its messages in
// one column over a round box to write in, and the list of conversations on the page's far side, as wide as the
// sidebar, so the page is even. In a narrower window the list opens over the page from a button at the top.
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { friendlyTitle, PopMenu, useApp } from "../app";
import { answerParts, type Card, docKind, type DocKind, docOwner, docPath, docSlug, placeDocs, type TurnItem, turnItems, writingKind } from "../answer-parts";
import { ActLabel, AiSky, api, Btn, goTo, Icon, Markdown, ThinBar, useGoSlot } from "../kit";
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
  return primary !== "claude" && s.aiLogins?.[primary] ? primary : "claude";
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

type Thread = ReturnType<typeof useApp>["s"]["sessions"][number];
type Project = NonNullable<ReturnType<typeof useApp>["s"]["projects"]>[number];

// A conversation's place in the list changed (threads.ts on the server), or the conversation deleted; the list asked
// again either way.
function useThreadActions(current: string) {
  const { refresh } = useApp();
  const meta = (id: string, change: Record<string, unknown>) => api(`sessions/${id}/meta`, change).then(() => refresh()).catch(() => {});
  const remove = (id: string) => api(`sessions/${id}/delete`, {}).then(() => { if (id === current) goTo("/chat/new"); return refresh(); }).catch(() => {});
  return { meta, remove };
}

// A conversation's ⋯: rename, pin or unpin, move to a project (the menu's second level, with a new project made right
// there), archive or bring back, and delete. Its words are the menu's (PopMenu, near).
function ThreadMenu({ thread, projects, onRename, onDelete }: { thread: Thread; projects: Project[]; onRename: () => void; onDelete: () => void }) {
  const { t, refresh } = useApp();
  const [level, setLevel] = useState<"main" | "projects" | "new">("main");
  const [name, setName] = useState("");
  const { meta } = useThreadActions("");
  const move = (project: string) => meta(thread.id, { project });
  const makeAndMove = async () => {
    const made = await api<{ id: string }>("projects", { name }).catch(() => null);
    if (made) { await meta(thread.id, { project: made.id }); await refresh(); }
  };
  return (
    <PopMenu className="thread-more" near label={t("chat.menu")} face={<Icon name="dots" />} onToggle={(open) => { if (!open) { setLevel("main"); setName(""); } }}>
      {level === "main" ? <>
        <button type="button" onClick={onRename}><Icon name="edit" />{t("chat.rename")}</button>
        {!thread.archived && <button type="button" onClick={() => meta(thread.id, { pinned: !thread.pinned })}><Icon name={thread.pinned ? "unpin" : "thread-pin"} />{t(thread.pinned ? "chat.unpin" : "chat.pin")}</button>}
        <button type="button" data-keep="" onClick={() => setLevel("projects")}><Icon name="move" /><span className="menu-grow">{t("chat.moveTo")}</span><Icon name="onward" /></button>
        <button type="button" onClick={() => meta(thread.id, { archived: !thread.archived })}><Icon name={thread.archived ? "unarchive" : "archive"} />{t(thread.archived ? "chat.unarchive" : "chat.archive")}</button>
        <hr />
        <button type="button" className="danger" onClick={onDelete}><Icon name="trash" />{t("chat.delete")}</button>
      </> : level === "projects" ? <>
        <button type="button" data-keep="" onClick={() => setLevel("main")}><Icon name="back" />{t("chat.back")}</button>
        <hr />
        <button type="button" aria-checked={!thread.project} role="menuitemradio" onClick={() => move("")}><Icon name={!thread.project ? "check" : "minus"} />{t("chat.noProject")}</button>
        {projects.map((p) => (
          <button key={p.id} type="button" aria-checked={thread.project === p.id} role="menuitemradio" onClick={() => move(p.id)}>
            <Icon name={thread.project === p.id ? "check" : "folder"} /><bdi className="menu-grow">{p.name}</bdi>
          </button>
        ))}
        <button type="button" data-keep="" onClick={() => setLevel("new")}><Icon name="folder-plus" />{t("chat.newProject")}</button>
      </> : <>
        <button type="button" data-keep="" onClick={() => setLevel("projects")}><Icon name="back" />{t("chat.back")}</button>
        <form className="menu-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { void makeAndMove(); (e.currentTarget.closest("[popover]") as HTMLElement | null)?.hidePopover(); } }}>
          <input autoFocus value={name} maxLength={80} placeholder={t("chat.projectName")} aria-label={t("chat.projectName")} onChange={(e) => setName(e.target.value)} dir="auto" />
          <button type="submit" className="menu-ok" disabled={!name.trim()} aria-label={t("chat.newProject")}><Icon name="check" /></button>
        </form>
      </>}
    </PopMenu>
  );
}

// One conversation in the list: its title leading to it, a dot while it works, waits or stopped, and its ⋯. Renaming,
// the title becomes a field (Enter or leaving it saves, Escape keeps the old one); deleting, the row asks first.
function ThreadRow({ thread, current, projects, onPick }: { thread: Thread; current: string; projects: Project[]; onPick: () => void }) {
  const { t } = useApp();
  const { meta, remove } = useThreadActions(current);
  const [mode, setMode] = useState<"" | "rename" | "delete">("");
  const [name, setName] = useState(thread.title);
  const title = friendlyTitle(thread.title, t);
  const save = () => { const next = name.trim(); if (next && next !== thread.title) void meta(thread.id, { title: next }); setMode(""); };
  if (mode === "rename") return (
    <div className="thread editing">
      <input autoFocus value={name} maxLength={200} aria-label={t("chat.rename")} dir="auto" onChange={(e) => setName(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setName(thread.title); setMode(""); } }} />
    </div>
  );
  if (mode === "delete") return (
    <div className="thread asking" role="alertdialog" aria-label={t("chat.deleteAsk")}>
      <span className="thread-title">{t("chat.deleteAsk")}</span>
      <button type="button" className="thread-yes" onClick={() => { setMode(""); void remove(thread.id); }}>{t("chat.delete")}</button>
      <button type="button" className="thread-no" onClick={() => setMode("")}>{t("chat.cancel")}</button>
    </div>
  );
  return (
    <div className={`thread ${thread.id === current ? "current" : ""}`}>
      <a className="thread-link" href={`/chat/${thread.id}`} aria-current={thread.id === current ? "page" : undefined} onClick={onPick}>
        <span className="thread-title" dir="auto">{title}</span>
      </a>
      {thread.status !== "idle" && <span className={`thread-dot ${thread.status}`} role="img" aria-label={t(`session.${thread.status}`)} />}
      <ThreadMenu thread={thread} projects={projects} onRename={() => { setName(thread.title); setMode("rename"); }} onDelete={() => setMode("delete")} />
    </div>
  );
}

// A project in the list: its folder, its name and how many conversations it holds, opening to show them; its ⋯ renames
// or deletes it (its conversations only leave it). Renaming and deleting ask in the row, as a conversation's do.
function ProjectRow({ project, threads, open, onToggle, current, projects, onPick }: {
  project: Project; threads: Thread[]; open: boolean; onToggle: () => void; current: string; projects: Project[]; onPick: () => void;
}) {
  const { t, refresh } = useApp();
  const [mode, setMode] = useState<"" | "rename" | "delete">("");
  const [name, setName] = useState(project.name);
  const save = () => { const next = name.trim(); if (next && next !== project.name) void api(`projects/${project.id}`, { name: next }).then(() => refresh()).catch(() => {}); setMode(""); };
  return (
    <div className="project">
      {mode === "rename" ? (
        <div className="thread editing">
          <input autoFocus value={name} maxLength={80} aria-label={t("chat.rename")} dir="auto" onChange={(e) => setName(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setName(project.name); setMode(""); } }} />
        </div>
      ) : mode === "delete" ? (
        <div className="thread asking" role="alertdialog" aria-label={t("chat.deleteProjectAsk")}>
          <span className="thread-title">{t("chat.deleteProjectAsk")}</span>
          <button type="button" className="thread-yes" onClick={() => { setMode(""); void api(`projects/${project.id}/delete`, {}).then(() => refresh()).catch(() => {}); }}>{t("chat.delete")}</button>
          <button type="button" className="thread-no" onClick={() => setMode("")}>{t("chat.cancel")}</button>
        </div>
      ) : (
        <div className="thread project-row">
          <button type="button" className="thread-link" aria-expanded={open} onClick={onToggle}>
            <Icon name={open ? "folder-open" : "folder"} />
            <bdi className="thread-title">{project.name}</bdi>
            <span className="project-count">{threads.length}</span>
          </button>
          <PopMenu className="thread-more" near label={t("chat.projectMenu")} face={<Icon name="dots" />}>
            <button type="button" onClick={() => { setName(project.name); setMode("rename"); }}><Icon name="edit" />{t("chat.rename")}</button>
            <hr />
            <button type="button" className="danger" onClick={() => setMode("delete")}><Icon name="trash" />{t("chat.delete")}</button>
          </PopMenu>
        </div>
      )}
      {open && (
        <div className="project-threads">
          {threads.length ? threads.map((c) => <ThreadRow key={c.id} thread={c} current={current} projects={projects} onPick={onPick} />)
            : <p className="project-empty">{t("chat.projectEmpty")}</p>}
        </div>
      )}
    </div>
  );
}

// The list of conversations, as a chat app's: a new one and a search on top; the pinned ones; the projects, each
// opening to its conversations, and a new project made in place; the rest newest first under the day they began;
// and the archive at the foot, opened in place. A search shows what it finds instead: titles at once, and the words
// inside conversations as the server finds them. hide hides the list (Chat).
// folded: the list hidden beside the conversation, as a narrow rail at its side, as a chat app's is (ChatGPT's): the
// button that opens it again, a new conversation, and the search, which opens it with its search box ready.
function Threads({ id, onPick, onHide, folded, onOpen }: { id: string; onPick: () => void; onHide: () => void; folded: boolean; onOpen: () => void }) {
  const { s, t, refresh } = useApp();
  const list = useRef<HTMLDivElement>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<string[]>([]);
  const [archive, setArchive] = useState(false);
  const [making, setMaking] = useState(false);
  const [newName, setNewName] = useState("");
  const projects = s.projects ?? [];
  const current = s.sessions.find((c) => c.id === id);
  const [opened, setOpened] = useState<Set<string>>(() => new Set(current?.project ? [current.project] : []));
  const toggle = (p: string) => setOpened((o) => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const q = query.trim();
  useEffect(() => {
    if (!q) { setFound([]); return; }
    const timer = setTimeout(() => api<{ ids: string[] }>(`sessions-search?q=${encodeURIComponent(q)}`).then((r) => setFound(r.ids)).catch(() => {}), 220);
    return () => clearTimeout(timer);
  }, [q]);
  const live = s.sessions.filter((c) => !c.archived);
  const pinned = live.filter((c) => c.pinned).sort((a, b) => (b.pinned ?? 0) - (a.pinned ?? 0));
  const known = new Set(projects.map((p) => p.id));
  const inProject = (c: Thread) => Boolean(c.project && known.has(c.project));
  const loose = live.filter((c) => !c.pinned && !inProject(c));
  const archived = s.sessions.filter((c) => c.archived);
  const results = q ? s.sessions.filter((c) => friendlyTitle(c.title, t).toLowerCase().includes(q.toLowerCase()) || found.includes(c.id)) : [];
  const row = (c: Thread) => <ThreadRow key={c.id} thread={c} current={id} projects={projects} onPick={onPick} />;
  const makeProject = () => {
    const name = newName.trim();
    setMaking(false);
    setNewName("");
    if (name) void api("projects", { name }).then(() => refresh()).catch(() => {});
  };
  const side = document.documentElement.dir === "rtl" ? "panel-left" : "panel-right";
  if (folded) {
    return (
      <nav className="threads folded" aria-label={t("chat.list")}>
        <button type="button" className="threads-icon" aria-label={t("chat.showList")} onClick={onOpen}>
          <Icon name={side} /><ActLabel>{t("chat.showList")}</ActLabel>
        </button>
        <a className="threads-icon" href="/chat/new" aria-label={t("chat.new")} onClick={onPick}>
          <Icon name="plus" /><ActLabel>{t("chat.new")}</ActLabel>
        </a>
        <button type="button" className="threads-icon" aria-label={t("chat.search")} onClick={() => { setSearching(true); setQuery(""); onOpen(); }}>
          <Icon name="find" /><ActLabel>{t("chat.search")}</ActLabel>
        </button>
      </nav>
    );
  }
  return (
    <nav className="threads" aria-label={t("chat.list")}>
      <div className="threads-head">
        <a className="thread-new" href="/chat/new" onClick={onPick}><Icon name="plus" /><span>{t("chat.new")}</span></a>
        <button type="button" className="threads-icon" aria-label={t("chat.search")} aria-pressed={searching} onClick={() => { setSearching(!searching); setQuery(""); }}>
          <Icon name="find" /><ActLabel>{t("chat.search")}</ActLabel>
        </button>
        <button type="button" className="threads-icon threads-hide" aria-label={t("chat.hideList")} onClick={onHide}>
          <Icon name={side} /><ActLabel>{t("chat.hideList")}</ActLabel>
        </button>
      </div>
      {searching && (
        <label className="threads-search">
          <Icon name="find" />
          <input autoFocus value={query} placeholder={t("chat.search")} aria-label={t("chat.search")} dir="auto" onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setSearching(false); setQuery(""); } }} />
        </label>
      )}
      <div className="threads-scroll">
        <div ref={list} className="threads-list">
          {q ? (
            <section className="thread-group">
              <h2>{t("chat.results")}</h2>
              {results.length ? results.map(row) : <p className="project-empty">{t("chat.searchNone")}</p>}
            </section>
          ) : archive ? (
            <section className="thread-group">
              <h2 className="threads-back"><button type="button" onClick={() => setArchive(false)}><Icon name="back" />{t("chat.archived", { n: archived.length })}</button></h2>
              {archived.length ? archived.map(row) : <p className="project-empty">{t("chat.archiveEmpty")}</p>}
            </section>
          ) : <>
            {pinned.length > 0 && <section className="thread-group"><h2>{t("chat.pinned")}</h2>{pinned.map(row)}</section>}
            <section className="thread-group">
              <h2 className="thread-group-head">{t("chat.projects")}
                <button type="button" className="threads-add" aria-label={t("chat.newProject")} onClick={() => setMaking(true)}><Icon name="folder-plus" /><ActLabel>{t("chat.newProject")}</ActLabel></button>
              </h2>
              {making && (
                <div className="thread editing">
                  <input autoFocus value={newName} maxLength={80} placeholder={t("chat.projectName")} aria-label={t("chat.projectName")} dir="auto"
                    onChange={(e) => setNewName(e.target.value)} onBlur={makeProject} onKeyDown={(e) => { if (e.key === "Enter") makeProject(); if (e.key === "Escape") { setMaking(false); setNewName(""); } }} />
                </div>
              )}
              {projects.map((p) => (
                <ProjectRow key={p.id} project={p} threads={live.filter((c) => c.project === p.id && !c.pinned)} open={opened.has(p.id)} onToggle={() => toggle(p.id)}
                  current={id} projects={projects} onPick={onPick} />
              ))}
              {!projects.length && !making && <button type="button" className="thread project-first" onClick={() => setMaking(true)}><Icon name="folder-plus" /><span className="thread-title">{t("chat.newProject")}</span></button>}
            </section>
            {GROUPS.map((g) => {
              const items = loose.filter((c) => groupOf(c.createdAt) === g);
              return items.length > 0 && <section key={g} className="thread-group"><h2>{t(`chat.groups.${g}`)}</h2>{items.map(row)}</section>;
            })}
          </>}
        </div>
        <ThinBar target={list} />
      </div>
      {!q && !archive && archived.length > 0 && (
        <button type="button" className="threads-archive" onClick={() => setArchive(true)}><Icon name="archive" />{t("chat.archived", { n: archived.length })}</button>
      )}
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
  return <button type="button" className="chat-lists" aria-label={t("chat.openList")} onClick={onList}><Icon name={document.documentElement.dir === "rtl" ? "panel-left" : "panel-right"} /></button>;
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
      <div className="ask-card-head"><Icon name="access-ask" /><strong>{t("chat.permission", { tool: ev.tool })}</strong></div>
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

// What a step is aimed at, short: a path as its file's name (with its folder when the name alone says little, as a
// skill's SKILL.md), anything else as it is.
function shortTarget(raw: unknown) {
  const target = String(raw ?? "").trim();
  if (/\s/.test(target) || !/[\\/]/.test(target)) return target;
  const parts = target.split(/[\\/]+/).filter(Boolean);
  const name = parts[parts.length - 1] ?? target;
  return /^(skill|readme|index)\b/i.test(name) && parts.length > 1 ? `${parts[parts.length - 2]}/${name}` : name;
}

// What a step did, in the page's direction: the tool's words in the page's language, with what it was aimed at, or
// the AI's own description of a command, set apart (<bdi>), so a path, a pattern or an English sentence keeps its
// own order without turning the row around.
// Cut short past a few lines' worth, so one long description doesn't fill the list.
const clip = (s: string) => (s.length > 140 ? `${s.slice(0, 139).trimEnd()}…` : s);
function useToolLabel() {
  const { t } = useApp();
  return (ev: Ev): React.ReactNode => {
    if (ev.label) return <bdi>{clip(String(ev.label))}</bdi>;
    const target = clip(shortTarget(ev.target));
    if (String(t(`chat.tools.${ev.name}`)).startsWith("chat.tools.")) return <bdi>{target || ev.name}</bdi>;
    const [before, after = ""] = String(t(`chat.tools.${ev.name}`, { target: "\u0000" })).split("\u0000");
    return <>{before}{target && <bdi>{target}</bdi>}{after}</>;
  };
}

// Each tool's icon, by what it does; its family gives its colour (styles.css .step-icon): the web blue, files grey,
// writing mint, judging amber, keeping pink.
const TOOL_ICONS: Record<string, string> = {
  FetchPosting: "site", WebFetch: "site", WebSearch: "find", SearchRole: "find", ReadPortal: "portals", Read: "file", Glob: "files", Grep: "find",
  Write: "edit", Edit: "edit", NotebookEdit: "edit", Bash: "tools", DraftCv: "edit", ReviewCv: "rules", BuildCv: "apps", EvaluateFit: "gauge",
  FitCheck: "gauge", RankJob: "gauge", SaveJobs: "saved", SaveApplication: "saved", Skill: "readme", Agent: "ai", Task: "ai", TodoWrite: "rules",
  AskUserQuestion: "chat",
};
const FAMILIES: Record<string, string> = { site: "web", find: "web", portals: "web", edit: "write", apps: "write", rules: "judge", gauge: "judge", ai: "judge", chat: "judge", saved: "keep" };
const toolIcon = (ev: Ev) => TOOL_ICONS[ev.name] ?? "tools";
const ToolMark = ({ ev }: { ev: Ev }) => <span className={`step-icon ${FAMILIES[toolIcon(ev)] ?? "file"}`}><Icon name={toolIcon(ev)} /></span>;

// How long a run took, in the words a person would use: seconds under a minute, then minutes.
function useDuration() {
  const { t } = useApp();
  return (ms: number) => {
    const secs = Math.max(1, Math.round(ms / 1000));
    if (secs < 60) return secs === 1 ? t("chat.second") : t("chat.secs", { n: secs });
    const mins = Math.round(secs / 60);
    return mins === 1 ? t("chat.minute") : t("chat.mins", { n: mins });
  };
}

// The steps as a tree, as files under a folder (Sean, 2026-11-11): a step a helper ran inside another step hangs
// under that step (its parent, agent.ts), or, in a run from before steps said which, under the helper's step just
// above it. One whose step isn't among these stands in line with the rest, not set in under nothing.
type StepRow = { ev: Ev; place: "" | "parent" | "child" | "child last" };
function stepTree(tools: Ev[]): StepRow[] {
  const top = new Map(tools.filter((x) => !x.nested).map((x) => [x.id, x]));
  const kids = new Map<string, Ev[]>();
  const rows: Ev[] = [];
  let helper: string | null = null;
  for (const ev of tools) {
    const parent = ev.nested ? (ev.parent ? (top.has(ev.parent) ? ev.parent : null) : helper) : null;
    if (parent) { kids.set(parent, [...(kids.get(parent) ?? []), ev]); continue; }
    rows.push(ev);
    if (!ev.nested) helper = ev.name === "Agent" || ev.name === "Task" ? ev.id : null;
  }
  return rows.flatMap((ev): StepRow[] => {
    const children = kids.get(ev.id) ?? [];
    return [{ ev, place: children.length ? "parent" : "" }, ...children.map((c, k): StepRow => ({ ev: c, place: k === children.length - 1 ? "child last" : "child" }))];
  });
}

// One tool call, a row of the steps: how it went at the row's start (the AI's orb while it works, then a tick or a
// cross; Sean, 2026-11-11), a little apart from its icon, then what it did; what came back, when there is something,
// folds out under it (.fold). place: where it stands in the tree; fresh: it came while the steps were on the page,
// so it grows into place instead of jumping in.
function ToolLine({ ev, result, working, place = "", fresh = false }: { ev: Ev; result?: Ev; working: boolean; place?: StepRow["place"]; fresh?: boolean }) {
  const label = useToolLabel();
  const [open, setOpen] = useState(false);
  const body = useId();
  const state = result ? (result.isError ? "failed" : "done") : working ? "working" : "done";
  const mark = state === "working"
    ? <span className="steps-orb" aria-hidden="true"><AiSky orb /></span>
    : <span className={`step-state ${state}`}><Icon name={state === "failed" ? "close" : "check"} /></span>;
  const row = <>{mark}<ToolMark ev={ev} /><span className="step-text">{label(ev)}</span></>;
  return (
    <li className={`tool ${state} ${place}${fresh ? " fresh" : ""}`}>
      <div className="tool-in">
        {result?.preview ? <>
          <button type="button" className="tool-row" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>{row}</button>
          <div className={`fold${open ? " open" : ""}`} id={body}><div><pre className="pre">{result.preview}</pre></div></div>
        </> : <div className="tool-row">{row}</div>}
      </div>
    </li>
  );
}

// The tool calls between two messages as a chat app's work line (OpenAI's "Worked for 44s", Sean's pick,
// 2026-11-11): shut, the kinds of steps as a stack of coloured icons, how many there were and, after a run's last
// steps, how long it took (took), over a line across the column; opened, it grows to show each step as a row. At
// work, the AI's orb, the step under way with a light passing over its words, its number, and the AI's colours
// running along the line.
function ToolSteps({ tools, results, working, took }: { tools: Ev[]; results: Map<string, Ev>; working: boolean; took?: number }) {
  const { t } = useApp();
  const label = useToolLabel();
  const duration = useDuration();
  const [open, setOpen] = useState(false);
  const body = useId();
  // The steps there when it first showed; any that come after them grow into place.
  const first = useRef<Set<string>>();
  const known = (first.current ??= new Set(tools.map((x) => x.id)));
  const tree = useMemo(() => stepTree(tools), [tools]);
  const top = tree.filter((r) => !r.place.startsWith("child")).length || tools.length;
  const busy = working && tools.some((x) => !results.has(x.id));
  const now = busy ? tools.find((x) => !results.has(x.id)) ?? tools[tools.length - 1] : null;
  const failed = tools.some((x) => results.get(x.id)?.isError);
  const kinds = [...new Map(tools.map((x) => [toolIcon(x), x])).values()].slice(0, 4);
  return (
    <div className={`steps${busy ? " working" : ""}${failed ? " failed" : ""}`}>
      <button type="button" className="steps-head" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
        {now
          ? <span className="steps-orb" aria-hidden="true"><AiSky orb /></span>
          : <span className="steps-stack" aria-hidden="true">{kinds.map((x) => <ToolMark key={x.id} ev={x} />)}</span>}
        <span className="steps-title">
          {now
            ? <span className="steps-now">{label(now)}</span>
            : <><strong>{top === 1 ? t("chat.step") : t("chat.steps", { n: top })}</strong>{took ? <span>, {duration(took)}</span> : null}</>}
        </span>
        {now && <span className="steps-count">{t("chat.stepN", { n: tools.indexOf(now) + 1 })}</span>}
        {failed && !now && <Icon name="warn" />}
        <Icon name="down" />
      </button>
      {/* Every step shown, however many: the list grows with them, never a scroll of its own. */}
      <div className={`fold${open ? " open" : ""}`} id={body}>
        <div className="steps-body">
          <ol>{tree.map((r) => <ToolLine key={r.ev.id} ev={r.ev} result={results.get(r.ev.id)} working={working} place={r.place} fresh={!known.has(r.ev.id)} />)}</ol>
        </div>
      </div>
      {now && <span className="steps-bar" aria-hidden="true" />}
    </div>
  );
}

// A page in small, drawn rather than read, in the shape of what it is: a CV's name over its sections, a letter's
// date, greeting and paragraphs, a report's title and figures. live: still being written, its last line growing.
const PAGES: Record<DocKind, (string | number)[]> = {
  cv: ["name", "sub", "sec", 94, 82, "sec", 96, 76, 88, "sec", 68, 84],
  letter: ["date", "gap", 38, "gap", 96, 90, 94, 58, "gap", 92, 88, 66, "gap", 30],
  report: ["title", "gap", 96, 86, "chart", 92, 74],
  doc: ["title", "gap", 96, 86, 92, 80, 94, 70],
};
function DocPage({ kind, owner, live }: { kind: DocKind; owner: string; live: boolean }) {
  const rows = live ? PAGES[kind].slice(0, Math.ceil(PAGES[kind].length * 0.6)) : PAGES[kind];
  return (
    <span className={`doc-page ${live ? "live" : ""}`} dir="ltr">
      {rows.map((row, k) => {
        if (row === "name") return owner ? <b key={k} className="dp-name">{owner}</b> : <i key={k} className="dp-title" />;
        if (row === "chart") return <span key={k} className="dp-chart"><i /><i /><i /><i /></span>;
        return <i key={k} className={typeof row === "number" ? "dp-line" : `dp-${row}`} style={typeof row === "number" ? { width: `${row}%` } : undefined} />;
      })}
    </span>
  );
}

// A document the conversation made, as what it is: its page in small, what kind it is, its name, the job it is for
// when it belongs to an application, and buttons to open it or save it. ghost: one being written now, its page still
// filling, with nothing to open yet.
function DocCard({ doc, ghost }: { doc?: Doc; ghost?: DocKind }) {
  const { s, t } = useApp();
  const kind = ghost ?? docKind(doc!.path, doc!.name);
  const slug = doc ? docSlug(doc.path) : "";
  const app = slug ? s.applications.find((a) => docPath(String(a.cv_file ?? "")).includes(`/main_${slug}.`)) : undefined;
  const about = app ? [app.role, app.company].filter(Boolean).join(", ") : "";
  const owner = doc ? docOwner(doc.name) : "";
  const href = doc ? `/file?path=${encodeURIComponent(doc.path)}` : "";
  return (
    <div className={`doc-card ${kind} ${ghost ? "ghost" : ""}`}>
      <span className="doc-tile" aria-hidden="true"><DocPage kind={kind} owner={owner} live={Boolean(ghost)} /></span>
      <span className="doc-text">
        <span className="doc-kind">{t(`chat.doc.${kind}`)}</span>
        <strong className="doc-name" dir="auto">{doc ? doc.name : t("chat.doc.writing")}</strong>
        {about && <span className="doc-about" dir="auto">{about}</span>}
        {doc && (
          <span className="doc-acts">
            <a className="chat-file-act" href={href} target="_blank" rel="noopener noreferrer"><Icon name="open" /><span>{t("chat.open")}</span></a>
            <a className="chat-file-act" href={`${href}&download=1`} download><Icon name="download" /><span>{t("chat.download")}</span></a>
          </span>
        )}
      </span>
    </div>
  );
}

// Questions to prepare, each a card: the question on its face, how to answer it on its back; a click, Enter or the
// space bar turns it over, and again turns it back.
function QuestionCards({ cards }: { cards: Card[] }) {
  const { t } = useApp();
  const [turned, setTurned] = useState<number[]>([]);
  const turn = (k: number) => setTurned((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  return (
    <div className="q-cards">
      {cards.map((card, k) => {
        const over = turned.includes(k);
        return (
          <div key={k} className={`q-card ${over ? "turned" : ""}`} role="button" tabIndex={0} aria-pressed={over}
            onClick={() => turn(k)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); turn(k); } }}>
            <span className="q-face front" aria-hidden={over}>
              <span className="q-num">{k + 1}</span>
              <strong className="q-question" dir="auto">{card.q}</strong>
              <span className="q-turn"><Icon name="refresh" />{t("chat.cards.turn")}</span>
            </span>
            <span className="q-face back" aria-hidden={!over}>
              <span className="q-label">{t("chat.cards.how")}</span>
              <Markdown src={card.a} className="md q-answer" />
              <span className="q-turn"><Icon name="refresh" />{t("chat.cards.back")}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Pip's answer: his words, a run of questions to prepare among them as cards (answer-parts.ts).
function Answer({ src }: { src: string }) {
  const parts = useMemo(() => answerParts(src), [src]);
  return (
    <div className="msg-pip">
      {parts.map((part, k) => ("cards" in part ? <QuestionCards key={k} cards={part.cards} /> : <Markdown key={k} src={part.md} className="md msg-text" />))}
    </div>
  );
}

type Item = TurnItem<Ev>;

// bare: inside another page (the introduction's), which has its own heading, so no header of its own.
// An AI that couldn't start (agent.ts): its sign-in refused (claude_login, openai_login, or Claude's server's words
// in a conversation from before Pip knew them), or the one chosen not signed in at all (no_agent). The AI it is about
// is the one that failed, or else the one chosen first in the settings; what to do is sign in to it, in a window of
// its own on the computer (clis.ts openLogin). Once it is signed in, the next message starts the conversation again
// (agent.ts send), and the block says so instead.
const CLAUDE_REFUSED = /^Failed to authenticate\b/;
type Login = "claude" | "openai";
const LOGIN_NAMES: Record<Login, string> = { claude: "Claude", openai: "ChatGPT" };
function AgentLogin({ code }: { code: "claude_login" | "openai_login" | "no_agent" }) {
  const { s, t, err } = useApp();
  const chosen: Login = s.settings?.aiPrimary === "openai" ? "openai" : "claude";
  const which: Login = code === "openai_login" ? "openai" : code === "claude_login" && chosen === "claude" ? "claude" : chosen;
  const expired = (code === "claude_login" && which === "claude") || code === "openai_login";
  const ready = Boolean(s.aiLogins?.[which]);
  const name = LOGIN_NAMES[which];
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState("");
  const open = () => {
    setError("");
    api("ai-login", { provider: which }).then(() => setOpened(true), (x) => setError(err(x)));
  };
  return (
    <div className="chat-login" role="alert">
      <p className={ready ? "note" : "error-line"} dir="auto">{t(ready ? "chat.errors.agent_ready" : expired ? "chat.errors.login_expired" : "chat.errors.no_agent", { name })}</p>
      {!ready && (opened ? <p className="note" dir="auto">{t("chat.loginOpened")}</p>
        : <div className="chat-login-ways"><Btn kind="primary" onClick={open}>{t(expired ? "chat.loginAgain" : "chat.loginTo", { name })}</Btn></div>)}
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
  // Each turn's steps in one block at its top, its words after it (turnItems).
  const items = useMemo(() => turnItems(events), [events]);

  const working = status === "running" || status === "waiting";
  // How long each turn took, on its block: its runs' durationMs together (one AI handing over to the next is two).
  const took = useMemo(() => {
    const out = new Map<string, number>();
    let block: string | null = null;
    for (const item of items) {
      if (item.kind === "tools") block = item.key;
      else if (item.ev.t === "user") block = null;
      else if (item.ev.t === "result" && block && typeof item.ev.durationMs === "number") out.set(block, (out.get(block) ?? 0) + item.ev.durationMs);
    }
    return out;
  }, [items]);
  // The block of the turn under way: the last one, unless a message of yours came after it.
  const current = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "tools") return item;
      if (item.ev.t === "user") return null;
    }
    return null;
  }, [items]);
  // The documents shown after the answers that brought them, and the one being written now, if one is.
  const placed = useMemo(() => placeDocs(events, files), [events, files]);
  const writing = useMemo(() => (working && current ? writingKind(current.tools, (id) => results.has(id)) : null), [current, results, working]);
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
      case "text": return CLAUDE_REFUSED.test(e.text) ? <AgentLogin key={key} code="claude_login" /> : <Answer key={key} src={e.text} />;
      case "permission": return resolved.has(e.requestId) ? settled(e) : <Permission key={key} ev={e} sessionId={id} />;
      case "question": return resolved.has(e.requestId) ? settled(e) : <Question key={key} ev={e} sessionId={id} />;
      // A run's end is said only when it has something to say: that it failed, or what it cost on a key.
      case "result": return !e.ok || e.cost >= 0.01
        ? <p key={key} className="done-line">{e.ok ? t("chat.done") : t("chat.doneError")}{e.cost >= 0.01 ? t("chat.cost", { cost: e.cost.toFixed(2) }) : ""}</p> : null;
      case "error": return e.code === "claude_login" || e.code === "openai_login" || e.code === "no_agent" ? <AgentLogin key={key} code={e.code} />
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
            {items.map((item) => (item.kind === "tools"
              ? <ToolSteps key={item.key} tools={item.tools} results={results} working={working && item === current} took={took.get(item.key)} />
              : (
                <React.Fragment key={item.key}>
                  {render(item.ev, item.key)}
                  {placed.after.get(Number(item.key))?.map((d) => <DocCard key={d.path} doc={d} />)}
                </React.Fragment>
              )))}
            {writing && <DocCard ghost={writing} />}
            {live && <div className="msg-pip live"><Markdown src={live} className="md msg-text" /></div>}
            {!live && status === "running" && (stopping || items[items.length - 1]?.kind !== "tools") && (
              <div className="working-line"><span className="steps-orb" aria-hidden="true"><AiSky orb /></span><span className="typing-text">{t(stopping ? "session.stopping" : "chat.working")}</span></div>
            )}
            {placed.end.map((d) => <DocCard key={d.path} doc={d} />)}
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

// Whether the window is narrow enough for the list to slide over the page (styles.css, 1100px) instead of standing
// beside it.
const narrow = () => matchMedia("(max-width: 1100px)").matches;

// Whether the window is narrow (narrow()), kept up to date as it is resized.
function useNarrow() {
  const [is, setIs] = useState(narrow);
  useEffect(() => {
    const query = matchMedia("(max-width: 1100px)");
    const change = () => setIs(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return is;
}

export function Chat({ id }: { id: string }) {
  const { s, t, loaded } = useApp();
  const [lists, setLists] = useState(false);
  const isNarrow = useNarrow();
  // The list hidden beside the conversation (its button at the list's top), remembered on this computer: folded to a
  // rail at its side, whose top button brings it back. In a narrow window the list opens over the page instead.
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem("pip-threads-hidden") === "1"; } catch { return false; } });
  const hide = (h: boolean) => { setHidden(h); try { localStorage.setItem("pip-threads-hidden", h ? "1" : "0"); } catch { /* kept for this visit */ } };
  const exists = id !== "new" && s.sessions.some((c) => c.id === id);
  useEffect(() => {
    if (!lists) return;
    const shut = (e: KeyboardEvent) => { if (e.key === "Escape") setLists(false); };
    addEventListener("keydown", shut);
    return () => removeEventListener("keydown", shut);
  }, [lists]);
  const open = () => { if (narrow()) setLists(true); else hide(false); };
  return (
    <div className={`chat ${lists ? "lists-open" : ""} ${hidden ? "threads-hidden" : ""}`}>
      <div className="chat-main">
        {!loaded ? null
          : id === "new" || !s.sessions.length ? <NewConversation onList={open} />
          : exists ? <Conversation key={id} id={id} onList={open} />
          : <div className="empty">{t("chat.notFound")}</div>}
      </div>
      <Threads id={id} onPick={() => setLists(false)} onHide={() => { if (narrow()) setLists(false); else hide(true); }} folded={hidden && !isNarrow} onOpen={() => hide(false)} />
      {lists && <button type="button" className="threads-shade" aria-label={t("chat.closeList")} onClick={() => setLists(false)} />}
    </div>
  );
}
