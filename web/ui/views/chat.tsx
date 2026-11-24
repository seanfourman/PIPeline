// The conversations with Pip, laid out like a chat app's: the open conversation in the middle, its messages in
// one column over a round box to write in, and the list of conversations on the page's far side, as wide as the
// sidebar, so the page is even. In a narrower window the list opens over the page from a button at the top.
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { commandWords, friendlyTitle, PopMenu, useApp } from "../app";
import { answerParts, type Card, type Change, docKind, type DocKind, docOwner, docPath, docSlug, hasSteering, placeDocs, readChange, revealSteering, type TurnItem, turnItems, writingKind } from "../answer-parts";
import { ActLabel, AiSky, api, goTo, HEBREW, Icon, langDir, Markdown, ThinBar, useGoSlot, Words } from "../kit";
import { grounded, takeOff, useLanding } from "../launch";
import { Select } from "../select";
import { useVoiceTyping, VoiceGlow, VoiceTypingButton } from "../voice";
import { ChatBackdrop, ThemePicker, useChatTheme } from "../chat-theme";

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
const START_ICONS: Record<string, string> = { "job-scraper": "find", rank: "gauge", apply: "apply", interview: "chat" };
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

// The ⋯ menu's level before a delete (Sean 2026-11-23, after the row turned pink to ask: "אחד המכוערים"): the question,
// what would go under it in the quieter ink, and the two ways out, as the menu's own rows, rising in as they do. Cancel
// takes the focus, so a key pressed by habit deletes nothing; either closes the menu.
function DeleteAsk({ ask, what, note = "", onDelete }: { ask: string; what: string; note?: string; onDelete: () => void }) {
  const { t } = useApp();
  return (
    <>
      <div className="menu-ask"><strong>{ask}</strong><bdi>{what}</bdi>{note && <span>{note}</span>}</div>
      <hr />
      <button type="button" className="danger" onClick={onDelete}><Icon name="trash" />{t("chat.delete")}</button>
      <button type="button" autoFocus><Icon name="close" />{t("chat.cancel")}</button>
    </>
  );
}
// A menu's level goes back to its first once the menu has shrunk away, not while it still shows.
const MENU_GONE_MS = 200;
// How long a deleted row takes to fade and fold away (thread-leave in styles.css) before it is deleted.
const LEAVE_MS = 300;

// A conversation's ⋯: pin or unpin, rename, move to a project (the menu's second level, with a new project made right
// there), archive or bring back, and delete, asked first in the menu (DeleteAsk). Its words are the menu's (PopMenu,
// near).
function ThreadMenu({ thread, projects, onRename, onDelete }: { thread: Thread; projects: Project[]; onRename: () => void; onDelete: () => void }) {
  const { t, refresh } = useApp();
  const [level, setLevel] = useState<"main" | "projects" | "new" | "delete">("main");
  const [name, setName] = useState("");
  const { meta } = useThreadActions("");
  const move = (project: string) => meta(thread.id, { project });
  const makeAndMove = async () => {
    const made = await api<{ id: string }>("projects", { name }).catch(() => null);
    if (made) { await meta(thread.id, { project: made.id }); await refresh(); }
  };
  return (
    <PopMenu className="thread-more" near label={t("chat.menu")} face={<Icon name="dots" />} onToggle={(open) => { if (!open) setTimeout(() => { setLevel("main"); setName(""); }, MENU_GONE_MS); }}>
      {level === "main" ? <>
        {/* Pinning first (Sean 2026-11-23), as the row's own pin beside the ⋯ is. */}
        {!thread.archived && <button type="button" onClick={() => meta(thread.id, { pinned: !thread.pinned })}><Icon name={thread.pinned ? "unpin" : "thread-pin"} />{t(thread.pinned ? "chat.unpin" : "chat.pin")}</button>}
        <button type="button" onClick={onRename}><Icon name="edit" />{t("chat.rename")}</button>
        <button type="button" data-keep="" onClick={() => setLevel("projects")}><Icon name="move" /><span className="menu-grow">{t("chat.moveTo")}</span><Icon name="onward" /></button>
        <button type="button" onClick={() => meta(thread.id, { archived: !thread.archived })}><Icon name={thread.archived ? "unarchive" : "archive"} />{t(thread.archived ? "chat.unarchive" : "chat.archive")}</button>
        <hr />
        <button type="button" className="danger" data-keep="" onClick={() => setLevel("delete")}><Icon name="trash" />{t("chat.delete")}</button>
      </> : level === "delete" ? (
        <DeleteAsk ask={t("chat.deleteAsk")} what={friendlyTitle(thread.title, t)} onDelete={onDelete} />
      ) : level === "projects" ? <>
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

// What a conversation in the list shows while it isn't done: a thin ring turning in Pip's green while he works (Sean
// went back to it from the paw prints on 2026-11-23, "אני מעדיף את הסימן המסתובב"), one paw waving while he waits for
// your answer, a red dot when it stopped.
const PAW = "M2 0h2v2h-2zM5 0h2v2h-2zM0 2h2v2h-2zM7 2h2v2h-2zM3 3h3v1h-3zM2 4h5v1h-5zM1 5h7v2h-7zM2 7h2v1h-2zM5 7h2v1h-2z";
const Paw = () => <svg viewBox="0 0 9 8" shapeRendering="crispEdges" aria-hidden="true"><path d={PAW} fill="currentColor" /></svg>;
function ThreadMark({ status, label }: { status: string; label: string }) {
  if (status === "running") return <span className="thread-mark ring" role="img" aria-label={label} />;
  if (status === "waiting") return <span className="thread-mark wave" role="img" aria-label={label}><Paw /></span>;
  return <span className={`thread-dot ${status}`} role="img" aria-label={label} />;
}

// One conversation in the list: its title leading to it, and at its very end a mark while it works, waits or stopped,
// which under the pointer gives its place to the ⋯, with a pin beside it (Sean 2026-11-23). Renaming, the title becomes
// a field (Enter or leaving it saves, Escape keeps the old one); deleted, once its menu has asked, it fades and folds
// away (styles.css, .leaving) before it is gone, the rows under it closing up. If the delete fails, it comes back.
// A title with what was searched for marked in it, wherever it falls, in any case of letters.
function Marked({ text, q }: { text: string; q: string }) {
  const at = q ? text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</>;
}

// mark: what a search looked for, marked in the title.
function ThreadRow({ thread, current, projects, onPick, mark = "" }: { thread: Thread; current: string; projects: Project[]; onPick: () => void; mark?: string }) {
  const { t } = useApp();
  const { meta, remove } = useThreadActions(current);
  const [mode, setMode] = useState<"" | "rename">("");
  const [name, setName] = useState(thread.title);
  const [leaving, setLeaving] = useState(false);
  const title = friendlyTitle(thread.title, t);
  const save = () => { const next = name.trim(); if (next && next !== thread.title) void meta(thread.id, { title: next }); setMode(""); };
  const drop = () => { setLeaving(true); setTimeout(() => { void remove(thread.id).finally(() => setLeaving(false)); }, LEAVE_MS); };
  if (mode === "rename") return (
    <div className="thread editing">
      <input autoFocus value={name} maxLength={200} aria-label={t("chat.rename")} dir="auto" onChange={(e) => setName(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setName(thread.title); setMode(""); } }} />
    </div>
  );
  return (
    <div className={`thread thread-row ${thread.id === current ? "current" : ""} ${leaving ? "leaving" : ""}`}>
      <a className="thread-link" href={`/chat/${thread.id}`} aria-current={thread.id === current ? "page" : undefined} onClick={onPick}>
        <span className="thread-title" dir="auto"><Marked text={title} q={mark} /></span>
      </a>
      {!thread.archived && (
        <button type="button" className="thread-pin" aria-pressed={Boolean(thread.pinned)} aria-label={t(thread.pinned ? "chat.unpin" : "chat.pin")} onClick={() => void meta(thread.id, { pinned: !thread.pinned })}>
          <Icon name={thread.pinned ? "unpin" : "thread-pin"} />
        </button>
      )}
      <span className="thread-end">
        {thread.status !== "idle" && <ThreadMark status={thread.status} label={t(`session.${thread.status}`)} />}
        <ThreadMenu thread={thread} projects={projects} onRename={() => { setName(thread.title); setMode("rename"); }} onDelete={drop} />
      </span>
    </div>
  );
}
// A project in the list: its folder, its name and how many conversations it holds, opening to show them; its ⋯ renames
// or deletes it (its conversations only leave it). Renaming is in the row, as a conversation's; deleting is asked in
// the menu (DeleteAsk), and the project then fades and folds away, as a conversation does.
function ProjectRow({ project, threads, open, onToggle, current, projects, onPick }: {
  project: Project; threads: Thread[]; open: boolean; onToggle: () => void; current: string; projects: Project[]; onPick: () => void;
}) {
  const { t, refresh } = useApp();
  const [mode, setMode] = useState<"" | "rename">("");
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [name, setName] = useState(project.name);
  const save = () => { const next = name.trim(); if (next && next !== project.name) void api(`projects/${project.id}`, { name: next }).then(() => refresh()).catch(() => {}); setMode(""); };
  const drop = () => {
    setLeaving(true);
    setTimeout(() => { void api(`projects/${project.id}/delete`, {}).then(() => refresh()).catch(() => {}).finally(() => setLeaving(false)); }, LEAVE_MS);
  };
  return (
    <div className={`project ${leaving ? "leaving" : ""}`}>
      {mode === "rename" ? (
        <div className="thread editing">
          <input autoFocus value={name} maxLength={80} aria-label={t("chat.rename")} dir="auto" onChange={(e) => setName(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setName(project.name); setMode(""); } }} />
        </div>
      ) : (
        <div className="thread project-row">
          <button type="button" className="thread-link" aria-expanded={open} onClick={onToggle}>
            <Icon name={open ? "folder-open" : "folder"} />
            <bdi className="thread-title">{project.name}</bdi>
            <span className="project-count">{threads.length}</span>
          </button>
          <PopMenu className="thread-more" near label={t("chat.projectMenu")} face={<Icon name="dots" />} onToggle={(on) => { if (!on) setTimeout(() => setAsking(false), MENU_GONE_MS); }}>
            {asking ? <DeleteAsk ask={t("chat.deleteProject")} what={project.name} note={t("chat.projectStays")} onDelete={drop} /> : <>
              <button type="button" onClick={() => { setName(project.name); setMode("rename"); }}><Icon name="edit" />{t("chat.rename")}</button>
              <hr />
              <button type="button" className="danger" data-keep="" onClick={() => setAsking(true)}><Icon name="trash" />{t("chat.delete")}</button>
            </>}
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
  // A drawer open in place of the list: the archive, or the daily run's conversations.
  const [shelf, setShelf] = useState<"" | "archive" | "runs">(() => (s.sessions.find((c) => c.id === id)?.auto ? "runs" : ""));
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
  // A temporary conversation is never listed: it leaves no trace (agent.ts Session.temporary). The daily run's
  // (Session.auto) aren't the user's, so they wait in a drawer of their own at the foot (Sean 2026-11-14).
  const kept = s.sessions.filter((c) => !c.temporary && !c.auto);
  const runs = s.sessions.filter((c) => c.auto);
  const live = kept.filter((c) => !c.archived);
  const pinned = live.filter((c) => c.pinned).sort((a, b) => (b.pinned ?? 0) - (a.pinned ?? 0));
  const known = new Set(projects.map((p) => p.id));
  const inProject = (c: Thread) => Boolean(c.project && known.has(c.project));
  const loose = live.filter((c) => !c.pinned && !inProject(c));
  const archived = kept.filter((c) => c.archived);
  const results = q ? kept.filter((c) => friendlyTitle(c.title, t).toLowerCase().includes(q.toLowerCase()) || found.includes(c.id)) : [];
  const row = (c: Thread) => <ThreadRow key={c.id} thread={c} current={id} projects={projects} onPick={onPick} />;
  const makeProject = () => {
    const name = newName.trim();
    setMaking(false);
    setNewName("");
    if (name) void api("projects", { name }).then(() => refresh()).catch(() => {});
  };
  const side = document.documentElement.dir === "rtl" ? "panel-left" : "panel-right";
  // The list's buttons say what they are by their icons alone, with no names floating by (Sean 2026-11-17: "לא חושב
  // שצריך שם TOOLTIP בכלל"); screen readers still hear their names.
  // The search opens out of its round button: the pill is clipped to the button's circle and the clip widens to the
  // whole head, and closing it narrows back into the button before the button returns (Sean 2026-11-18: "תוסיף
  // אנימציה על הלחיצה שלו"). from is the button's place in the head as that clip; empty, as when the folded rail's
  // search opens the list, the pill just shows and goes.
  const head = useRef<HTMLDivElement>(null);
  const finder = useRef<HTMLButtonElement>(null);
  const finding = useRef<HTMLLabelElement>(null);
  const from = useRef("");
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PILL = "inset(0px 0px 0px 0px round 23px)";
  const openSearch = () => {
    const h = head.current?.getBoundingClientRect();
    const b = finder.current?.getBoundingClientRect();
    from.current = h && b ? `inset(${b.top - h.top}px ${h.right - b.right}px ${h.bottom - b.bottom}px ${b.left - h.left}px round ${b.height / 2}px)` : "";
    setSearching(true);
    setQuery("");
  };
  // What is in the pill fades in as it widens and out as it narrows: in the button's small circle the hint's last
  // word showed through, filmed.
  useLayoutEffect(() => {
    const el = finding.current;
    if (!searching || !el || !from.current || still()) return;
    el.animate([{ clipPath: from.current }, { clipPath: PILL }], { duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    for (const kid of el.children) kid.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: 60, easing: "ease-out", fill: "backwards" });
  }, [searching]);
  const closeSearch = () => {
    setQuery("");
    const el = finding.current;
    if (!el || !from.current || still()) { setSearching(false); return; }
    const done = () => setSearching(false);
    for (const kid of el.children) kid.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: "ease-out", fill: "forwards" });
    el.animate([{ clipPath: PILL }, { clipPath: from.current }], { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" }).finished.then(done, done);
  };
  if (folded) {
    return (
      <nav className="threads folded" aria-label={t("chat.list")}>
        <button type="button" className="threads-icon" aria-label={t("chat.showList")} onClick={onOpen}><Icon name={side} /></button>
        <a className="threads-icon" href="/chat/new" aria-label={t("chat.new")} onClick={onPick}><Icon name="plus" /></a>
        <button type="button" className="threads-icon" aria-label={t("chat.search")} onClick={() => { from.current = ""; setSearching(true); setQuery(""); onOpen(); }}><Icon name="find" /></button>
      </nav>
    );
  }
  // The daily run's row: when it last ran at its end, or Pip's paw prints while one is at work.
  const lastRun = runs.length ? runs.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)) : undefined;
  const runDay = lastRun ? groupOf(lastRun.createdAt) : undefined;
  const runWhen = !lastRun ? "" : runDay === "today" ? new Date(lastRun.createdAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : runDay === "yesterday" ? t("chat.groups.yesterday")
    : new Date(lastRun.createdAt).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
  const runBusy = runs.some((c) => c.status === "running" || c.status === "waiting");
  return (
    <nav className="threads" aria-label={t("chat.list")}>
      {/* The head: the search's round button and the one that hides the list, at its end. The search opens out of its
          button into a pill across the head, and closes back into it (openSearch, closeSearch). */}
      <div ref={head} className="threads-head">
        {searching ? (
          <label ref={finding} className="threads-search">
            <Icon name="find" />
            <input autoFocus value={query} placeholder={t("chat.search")} aria-label={t("chat.search")} dir="auto" onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }} />
            <button type="button" className="threads-search-x" aria-label={t("chat.closeSearch")} onClick={closeSearch}><Icon name="close" /></button>
          </label>
        ) : <>
          <button ref={finder} type="button" className="threads-icon" aria-label={t("chat.search")} onClick={openSearch}><Icon name="find" /></button>
          <button type="button" className="threads-icon threads-hide" aria-label={t("chat.hideList")} onClick={onHide}><Icon name={side} /></button>
        </>}
      </div>
      {/* Under it, rows of places, as ChatGPT's, each its icon and its name (Sean 2026-11-18, with ChatGPT's New chat,
          Scheduled, Library: "תשים שם כזה דבר עם הריצה היומית או משהו רק עם דברים שרלוונטים לנו"; the search stays in
          the head: "החיפוש צריך להשאר רגיל ... ואת שאר הדברים תשים מתחת"). A new conversation; the daily run's
          conversations; and the files and the tools, the two pages a conversation makes and starts from. The AI's
          button for a new conversation is in the sidebar (kit.tsx AiNewChat). */}
      <div className="threads-places">
        <a className="thread threads-place" href="/chat/new" onClick={onPick}><Icon name="compose" /><span className="thread-title">{t("chat.new")}</span></a>
        <button type="button" className={`thread threads-place ${shelf === "runs" ? "current" : ""}`} aria-pressed={shelf === "runs"} onClick={() => setShelf(shelf === "runs" ? "" : "runs")}>
          <Icon name="runs" />
          <span className="thread-title">{t("chat.runsTitle")}</span>
          {runBusy ? <ThreadMark status="running" label={t("session.running")} /> : runWhen && <span className="threads-place-when" dir="ltr">{runWhen}</span>}
        </button>
        <a className="thread threads-place" href="/files"><Icon name="files" /><span className="thread-title">{t("nav.files")}</span></a>
        <a className="thread threads-place" href="/tools"><Icon name="tools" /><span className="thread-title">{t("nav.tools")}</span></a>
      </div>
      <div className="threads-scroll">
        <div ref={list} className="threads-list">
          {q ? (
            <section className="thread-group">
              <h2>{t("chat.results")}{results.length > 0 && <span className="thread-group-count">{results.length}</span>}</h2>
              {results.length ? results.map((c) => <ThreadRow key={c.id} thread={c} current={id} projects={projects} onPick={onPick} mark={q} />)
                : <p className="threads-none"><Icon name="find" />{t("chat.searchNone")}</p>}
            </section>
          ) : shelf === "archive" ? (
            <section className="thread-group">
              <h2 className="threads-back"><button type="button" onClick={() => setShelf("")}><Icon name="back" />{t("chat.archived", { n: archived.length })}</button></h2>
              {archived.length ? archived.map(row) : <p className="project-empty">{t("chat.archiveEmpty")}</p>}
            </section>
          ) : shelf === "runs" ? (
            <>
              <section className="thread-group"><h2 className="threads-back"><button type="button" onClick={() => setShelf("")}><Icon name="back" />{t("chat.runs", { n: runs.length })}</button></h2></section>
              {GROUPS.map((g) => {
                const items = runs.filter((c) => groupOf(c.createdAt) === g);
                return items.length > 0 && <section key={g} className="thread-group"><h2>{t(`chat.groups.${g}`)}</h2>{items.map(row)}</section>;
              })}
              {!runs.length && <p className="project-empty">{t("chat.runsEmpty")}</p>}
            </>
          ) : <>
            {pinned.length > 0 && <section className="thread-group"><h2>{t("chat.pinned")}</h2>{pinned.map(row)}</section>}
            {/* Projects as ChatGPT lists them: a new one first, as a row of its own, then each project, its folder and how
                many conversations it holds. */}
            <section className="thread-group">
              <h2>{t("chat.projects")}</h2>
              {making ? (
                <div className="thread editing">
                  <input autoFocus value={newName} maxLength={80} placeholder={t("chat.projectName")} aria-label={t("chat.projectName")} dir="auto"
                    onChange={(e) => setNewName(e.target.value)} onBlur={makeProject} onKeyDown={(e) => { if (e.key === "Enter") makeProject(); if (e.key === "Escape") { setMaking(false); setNewName(""); } }} />
                </div>
              ) : (
                <button type="button" className="thread project-new" onClick={() => setMaking(true)}><Icon name="folder-plus" /><span className="thread-title">{t("chat.newProject")}</span></button>
              )}
              {projects.map((p) => (
                <ProjectRow key={p.id} project={p} threads={live.filter((c) => c.project === p.id && !c.pinned)} open={opened.has(p.id)} onToggle={() => toggle(p.id)}
                  current={id} projects={projects} onPick={onPick} />
              ))}
            </section>
            {GROUPS.map((g) => {
              const items = loose.filter((c) => groupOf(c.createdAt) === g);
              return items.length > 0 && <section key={g} className="thread-group"><h2>{t(`chat.groups.${g}`)}</h2>{items.map(row)}</section>;
            })}
          </>}
        </div>
        <ThinBar target={list} />
      </div>
      {!q && !shelf && archived.length > 0 && (
        <button type="button" className="threads-archive" onClick={() => setShelf("archive")}><Icon name="archive" />{t("chat.archived", { n: archived.length })}</button>
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
// Under it, warn is full access's note (FullWarn), shown while warnOn, and hint a quieter line. The note keeps its
// place under the box while hidden, so turning full access on or off moves nothing (Sean 2026-11-24); it fades in
// and out there. glow: the shape of voice typing's glow
// behind it, a halo round a box in the middle of the page or rising behind one at its foot (VoiceGlow).
// temporary: a temporary conversation's box, whose attachments go where nothing syncs (uploads.ts TEMP_UPLOADS).
function Composer({ text, setText, onSend, onStop, working = false, placeholder, tools, warn, warnOn = false, hint, input, autoFocus, glow = "rise", temporary = false }: {
  text: string; setText: (v: string) => void; onSend: (files: string[]) => void; onStop?: () => void; working?: boolean; placeholder: string;
  tools?: React.ReactNode; warn?: React.ReactNode; warnOn?: boolean; hint?: React.ReactNode; input?: React.RefObject<HTMLTextAreaElement>; autoFocus?: boolean;
  glow?: "halo" | "rise"; temporary?: boolean;
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
        .then((data) => api<Sent>("uploads", { name: file.name, data, ...(temporary ? { temporary: true } : {}) }))
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
        className={`composer-box ${tall ? "tall" : ""} ${ready || stopping ? "typing" : ""} ${slotOpen ? "slot-open" : ""} ${over ? "over" : ""} ${temporary ? "temp" : ""}`}
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
      {warn && <p className={`composer-warn ${warnOn ? "on" : ""}`} role="note" aria-hidden={!warnOn}><Icon name="access-full" /><span>{warn}</span></p>}
      {hint && <p className="composer-hint" role="note">{hint}</p>}
    </form>
  );
}

// Under the box, shown while full access is picked: a quiet line in the middle, its name first, as chat apps put their
// notes there (Sean's pick of three sketches, 2026-11-12), with the access's shield.
function FullWarn() {
  const { t } = useApp();
  return <><b>{t("chat.access.fullWarnLead")}</b> {t("chat.access.fullWarn")}</>;
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


// How hard Claude thinks in the new conversation (Sean 2026-11-17: "בחירת חכמה כאילו LOW MEDIUM HIGH VERY HIGH"): a
// level the SDK takes as effort (very high is its xhigh), or "" for none, which leaves it to the user's own Claude Code
// settings. "" stands on the level those settings give the chosen model (agent.ts defaultEfforts), so the slider shows
// how hard Claude will really think: a separate "רגילה" in the middle was really very high here, set so in the
// settings (Sean 2026-11-18: "רגילה ובינונית זה לא אותו דבר?"). With none set the model's own default holds, taken
// as high, the default Anthropic documents for effort.
const LEVELS = ["low", "medium", "high", "xhigh"];
// How fast the fill's rainbow flows at each level: the harder it thinks, the quicker.
const LEVEL_PACE = [0.4, 0.8, 1.3, 2];

// The levels as a slider, a thick pill like a phone's volume and brightness sliders (Sean 2026-11-18: "למה הרמת חשיבה
// זה לא איזה SLIDER מגניב"; a thin rainbow track with a haloed thumb came first: "הוא פאקינג מחריד"; then the pill in
// the page's ink: "יותר טוב אבל למה הורדת את הצבעים"; then the AI's drifting clouds, which here should be straight:
// "דווקא פה אני רוצה את זה לינארי כזה ולא רנדומלי ... קשת יכול להיות מתאים"; then a rainbow in bands: "יותר מרוח
// בצבעים"). It fills from its start to the level, a quarter for each, with a soft, blurred rainbow of the AI's colours,
// wide enough that only part of it shows at once, flowing along it toward the fill's end, faster the higher the level
// (LEVEL_PACE). The level's name is written inside it in white, and the fill's round end is its handle. It stands on
// the user's own level (mine) until another is picked: the title's end says so there, and elsewhere offers the way
// back to it; picking that level again leaves it to the settings, as before. Pressed anywhere, the fill slides to the
// nearest level; dragged, it follows the pointer, the name changing as it passes each level, and settles on the
// nearest when let go. Under the pointer a faint fill shows where a press would take it. The arrow keys move it a
// level in the page's direction; Delete or Backspace goes back to the user's own.
function EffortSlider({ value, mine, onChange }: { value: string; mine?: string; onChange: (e: string) => void }) {
  const { t } = useApp();
  const track = useRef<HTMLDivElement>(null);
  const rainbow = useRef<HTMLSpanElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [near, setNear] = useState(-1);
  const pressed = useRef(false);
  const last = LEVELS.length - 1;
  const home = Math.max(0, LEVELS.indexOf(mine ?? "high"));
  const found = LEVELS.indexOf(value);
  const at = found < 0 ? home : found;
  const rtl = document.documentElement.dir === "rtl";
  // Where the pointer is along the bar from its start, 0 to 1; a level's fill ends at (its place + 1) / 4.
  const along = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = (x - r.left) / r.width;
    return Math.min(1, Math.max(0, rtl ? 1 - f : f));
  };
  const stop = (f: number) => Math.min(last, Math.max(0, Math.round(f * LEVELS.length) - 1));
  const end = (i: number) => (i + 1) / LEVELS.length;
  const pick = (i: number) => { const next = i === home ? "" : LEVELS[i]; if (next !== value) onChange(next); };
  const shown = drag !== null ? stop(drag) : at;
  const f = drag !== null ? Math.max(0.14, drag) : end(at);
  const name = t(`chat.effortsShort.${LEVELS[shown]}`);
  const clip = (to: number) => (rtl ? `inset(0 0 0 ${(1 - to) * 100}% round 999px)` : `inset(0 ${(1 - to) * 100}% 0 0 round 999px)`);
  // The rainbow's pace set once for each level shown, going on from where it is.
  const pace = LEVEL_PACE[shown];
  useEffect(() => {
    for (const a of rainbow.current?.getAnimations() ?? []) a.updatePlaybackRate(pace);
  }, [pace]);
  const keys = (e: React.KeyboardEvent) => {
    const up = ["ArrowUp", rtl ? "ArrowLeft" : "ArrowRight"];
    const down = ["ArrowDown", rtl ? "ArrowRight" : "ArrowLeft"];
    const i = up.includes(e.key) ? Math.min(last, at + 1) : down.includes(e.key) ? Math.max(0, at - 1)
      : e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "Delete" || e.key === "Backspace" ? home : null;
    if (i === null) return;
    e.preventDefault();
    pick(i);
  };
  // Faint marks where the levels past low end (low's is under the name), and the name, drawn twice: on the bar, and on
  // the fill over it, so where the fill ends inside the name its two parts take the two colours.
  const marks = LEVELS.slice(1).map((l, i) => <span key={l} className="effort-mark" style={{ insetInlineStart: `calc(${end(i + 1) * 100}% - 19px)` }} />);
  return (
    <div className="effort">
      <div className="effort-head">
        <p className="model-panel-title">{t("chat.effort")}</p>
        {shown === home
          ? <span className="effort-note">{t(mine ? "chat.effortMine" : "chat.effortClaude")}</span>
          : <button type="button" className="effort-back" onClick={() => pick(home)}>{t("chat.effortBack")}</button>}
      </div>
      <div
        ref={track} className={`effort-track${drag !== null ? " dragging" : ""}`} role="slider" tabIndex={0}
        aria-label={t("chat.effort")} aria-valuemin={0} aria-valuemax={last} aria-valuenow={shown} aria-valuetext={name}
        onKeyDown={keys}
        onPointerDown={(e) => { if (e.button) return; pressed.current = true; e.currentTarget.setPointerCapture(e.pointerId); pick(stop(along(e.clientX))); }}
        onPointerMove={(e) => {
          const x = along(e.clientX);
          if (!pressed.current) { setNear(stop(x)); return; }
          setDrag(x);
          pick(stop(x));
        }}
        onPointerUp={() => { pressed.current = false; setDrag(null); }}
        onPointerCancel={() => { pressed.current = false; setDrag(null); }}
        onPointerLeave={() => setNear(-1)}
      >
        <span className="effort-ghost" style={{ clipPath: clip(near >= 0 && !pressed.current ? end(near) : 0) }} />
        {marks}
        <span key={`b-${name}`} className="effort-name" aria-hidden="true">{name}</span>
        <span className="effort-fill" style={{ clipPath: clip(f) }}>
          <span ref={rainbow} className="effort-rainbow" />
          <span key={`f-${name}`} className="effort-name" aria-hidden="true">{name}</span>
        </span>
      </div>
    </div>
  );
}

// The model and how hard it thinks, in one quiet button of words at the box's end, as ChatGPT's "High ⌄" ("Opus ·
// גבוהה"), where two round buttons crowded it (Sean 2026-11-17: "נהיה שם ממש עומס בכפתורים"). It opens a panel over
// the box: the models as rows, the one in use ticked, and the level of thinking as a slider (EffortSlider). Escape,
// the button again, or a press outside closes it.
function ModelMenu({ model, effort, onModel, onEffort }: { model: string; effort: string; onModel: (m: string) => void; onEffort: (e: string) => void }) {
  const { s, t } = useApp();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panel = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const shut = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("pointerdown", away);
    addEventListener("keydown", shut);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", shut); };
  }, [open]);
  const key = MODELS.find(([m]) => m === model)?.[1] ?? "default";
  const words = `${t(`chat.modelShort.${key}`)}${effort ? ` · ${t(`chat.effortsShort.${effort}`)}` : ""}`;
  return (
    <div className="model-menu" ref={box}>
      <button type="button" className={`model-menu-btn${open ? " open" : ""}`} aria-expanded={open} aria-controls={panel} aria-label={`${t("chat.modelMenu")}: ${words}`} onClick={() => setOpen(!open)}>
        <span dir="auto">{words}</span><Icon name="down" />
      </button>
      {open && (
        <div className="model-panel" id={panel} role="dialog" aria-label={t("chat.modelMenu")}>
          <p className="model-panel-title">{t("chat.model")}</p>
          {MODELS.map(([m, k]) => (
            <button key={k} type="button" className={`model-option${m === model ? " on" : ""}`} aria-pressed={m === model} onClick={() => onModel(m)}>
              <Icon name={`model-${k}`} /><span dir="auto">{t(`chat.models.${k}`)}</span>{m === model && <Icon name="check" />}
            </button>
          ))}
          <EffortSlider value={effort} mine={s.claudeEfforts?.[model]} onChange={onEffort} />
        </div>
      )}
    </div>
  );
}

// The list button, for a window too narrow to show the list beside the conversation.
const ListButton = ({ onList }: { onList: () => void }) => {
  const { t } = useApp();
  return <button type="button" className="chat-lists" aria-label={t("chat.openList")} onClick={onList}><Icon name={document.documentElement.dir === "rtl" ? "panel-left" : "panel-right"} /></button>;
};

// The line over a new conversation's box: a different one each time it opens, picked from the time of day's lines and
// the any-time ones, some with the name from the settings (Sean 2026-11-12: "משפט יותר אקראי וקשור אולי לשעה ביום";
// the waving Pip that stood over it went). The name is set apart, so a Latin one keeps its own direction.
const partOfDay = (h: number) => (h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "noon" : h >= 17 && h < 22 ? "evening" : "night");
function Hello() {
  const { s, t } = useApp();
  const [pick] = useState(() => ({ part: partOfDay(new Date().getHours()), at: Math.random() }));
  const name = String(s.settings.displayName ?? "").trim();
  const lines = [...t(`chat.hello.${pick.part}`), ...t("chat.hello.any")].filter((line: string) => name || !line.includes("{name}"));
  const [before, after] = String(lines[Math.floor(pick.at * lines.length)]).split("{name}");
  return <h1>{before}{after !== undefined && <><bdi>{name}</bdi>{after}</>}</h1>;
}

// Whether the new conversation is temporary: a round button at the top of the page, its dashed bubble, named on hover.
// It hands itself over too, for the wave that leaves it (NewConversation).
function TemporaryToggle({ on, onChange }: { on: boolean; onChange: (v: boolean, from: HTMLElement) => void }) {
  const { t } = useApp();
  return (
    <button type="button" className={`chat-temp${on ? " on" : ""}`} aria-pressed={on} aria-label={t("chat.temporary.toggle")} onClick={(e) => onChange(!on, e.currentTarget)}>
      <Icon name="temporary" /><ActLabel>{t(on ? "chat.temporary.off" : "chat.temporary.toggle")}</ActLabel>
    </button>
  );
}

// A new conversation. With ChatGPT first in the settings on a key alone it is a plain one: no access or model to pick,
// and a line under the box says so; the starts and any message that is a command still go to Claude.
function NewConversation({ onList }: { onList: () => void }) {
  const { s, t, start, draft } = useApp();
  const [text, setText] = useState(() => { const d = draft.current; draft.current = ""; return d; });
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [access, setAccess] = useState<Access>("ask");
  const [busy, setBusy] = useState(false);
  // A temporary conversation (Sean 2026-11-12: "צאט INCOGNITO... חד פעמי שנמחק"), picked at the top of the page.
  const [temporary, setTemporary] = useState(false);
  // Switching it (Sean 2026-11-22, "תוסיף אנימציה כשעוברים לשיחה זמנית משהו מגניב"): a dashed ring, the button's own
  // bubble, washes out from the button over the page as it turns on and gathers back into it as it turns off; the
  // greeting drifts up and away like vapour while the temporary page's words come into focus, and the box to write in
  // closes a dashed line round itself (styles.css, .chat-temp-wave).
  const page = useRef<HTMLDivElement>(null);
  const [wave, setWave] = useState<{ n: number; on: boolean; x: number; y: number; far: number } | null>(null);
  const flip = (on: boolean, from: HTMLElement) => {
    setTemporary(on);
    const box = page.current?.getBoundingClientRect(), at = from.getBoundingClientRect();
    if (!box) return;
    const x = at.left + at.width / 2 - box.left, y = at.top + at.height / 2 - box.top;
    setWave((w) => ({ n: (w?.n ?? 0) + 1, on, x, y, far: Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y)) }));
  };
  const input = useRef<HTMLTextAreaElement>(null);
  const first = useFirstAi();
  // ChatGPT signed in with its account works in the project as Claude does, through Codex (codex.ts), with the same
  // access to pick; only Claude has models to pick from.
  const codex = first === "openai" && Boolean(s.aiLogins?.openai);
  const plain = !codex && first !== "claude" && !text.trim().startsWith("/");
  const go = (raw = text.trim(), files: string[] = []) => {
    if ((!raw && !files.length) || busy) return;
    setBusy(true);
    // A link alone is an application, which the server knows by itself (server.ts), so it goes as it was written.
    // The box's way into the conversation (launch.ts); its words fly with it only when the bubble will show them as
    // they are.
    takeOff(!raw.startsWith("/") && !files.length ? raw : "", s.sessions.map((c) => c.id));
    return start(raw, model || undefined, access, files, temporary, codex ? undefined : effort || undefined).catch((err) => { setBusy(false); grounded(); throw err; });
  };
  const begin = (command: string, more: boolean) => {
    if (!more) { go(`/${command}`)?.catch(() => {}); return; }
    setText(`/${command} `);
    requestAnimationFrame(() => input.current?.focus());
  };
  return (
    <div ref={page} className={`chat-new${temporary ? " temporary" : ""}`}>
      {wave && (
        <svg key={wave.n} className={`chat-temp-wave ${wave.on ? "out" : "in"}`} aria-hidden="true" style={{ "--far": `${wave.far}px` } as React.CSSProperties}
          onAnimationEnd={(e) => { if (e.target === e.currentTarget.lastElementChild && e.animationName.endsWith("fade")) setWave(null); }}>
          <circle cx={wave.x} cy={wave.y} r="19" /><circle cx={wave.x} cy={wave.y} r="19" />
        </svg>
      )}
      <div className="chat-top"><ListButton onList={onList} /><ThemePicker /><TemporaryToggle on={temporary} onChange={flip} /></div>
      <div className="chat-new-body">
        {/* Both faces in one place, the one not shown faded out in it, so switching crosses between them and the box
            under them stays where it is. */}
        <div className="chat-new-head">
          <div className="chat-new-face hello" aria-hidden={temporary}><Hello /></div>
          <div className="chat-new-face temp" aria-hidden={!temporary}><h1>{t("chat.temporary.title")}</h1><p className="chat-temp-note">{t("chat.temporary.note")}</p></div>
        </div>
        <Composer
          text={text} setText={setText} onSend={(files) => { go(text.trim(), files)?.catch(() => {}); }} placeholder={t("chat.newPlaceholder")} input={input} autoFocus glow="halo" temporary={temporary}
          tools={plain ? null : <>{!codex && <ModelMenu model={model} effort={effort} onModel={setModel} onEffort={setEffort} />}<AccessPicker value={access} onChange={setAccess} /></>}
          warn={plain ? "" : <FullWarn />} warnOn={access === "full"} hint={codex ? t("chat.ai.codex", MAKERS[first]) : plain ? t("chat.ai.plain", MAKERS[first]) : ""}
        />
        <div className="chat-starts" role="group" aria-label={t("chat.suggest")}>
          {/* Rows under the box, as ChatGPT's suggestions: an icon, the start's name and what it does, quiet until hovered
              (Sean 2026-11-17: "הייתי עושה משהו בשורות אולי יותר כמו ה CHATGPT עם אייקונים"). */}
          {STARTS.map(([command, more]) => (
            <button key={command} type="button" className="chat-start" disabled={busy} onClick={() => begin(command, more)}>
              <Icon name={START_ICONS[command] ?? "ai"} />
              <span className="chat-start-name">{t(`tools.commands.${command}`)[0]}</span>
              <span className="chat-start-note">{t(`tools.commands.${command}`)[1]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// A request to allow a step, as a line in the conversation like the steps' (Sean's pick of three sketches,
// 2026-11-12): a slow amber dot while it waits, what Pip asks in words ("May I edit 01-candidate-profile.md?"), what
// it would do folded under it, open to begin with (the file's whole path as given, then an edit as lines kept, taken
// out and put in; a command whole, as it is), and small round buttons: allow, allow for the folder in this
// conversation, deny. What a step asks can be steered by a posting, so nothing in it is shortened out of sight, a part
// cut short says so, and a character that reorders text is taken out and shown as a small red chip in its place
// (Steered), with a line in words saying what the chips are.
const HiddenMark = () => {
  const { t } = useApp();
  return <mark className="ask-control" role="img" aria-label={t("chat.hiddenChar")}><Icon name="hidden" /></mark>;
};
const Steered = ({ text }: { text: string }) => (
  <>{revealSteering(text).map((part, k) => (typeof part === "string" ? part : <HiddenMark key={k} />))}</>
);
const ASKS = new Set(["Edit", "Write", "Bash", "WebFetch", "WebSearch"]);
function askTarget(ev: Ev, change: Change | null) {
  if (change) return shortTarget(change.path);
  if (ev.tool !== "WebFetch" && ev.tool !== "WebSearch") return "";
  try { return String(JSON.parse(String(ev.input ?? "{}"))[ev.tool === "WebFetch" ? "url" : "query"] ?? ""); } catch { return ""; }
}
function Permission({ ev, sessionId }: { ev: Ev; sessionId: string }) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const body = useId();
  const change = useMemo(() => readChange({ tool: ev.tool, input: ev.input, change: ev.change }), [ev]);
  const send = (reply: Record<string, unknown>) => { setBusy(true); api(`sessions/${sessionId}/respond`, { requestId: ev.requestId, ...reply }).catch(() => setBusy(false)); };
  const target = askTarget(ev, change);
  const key = ASKS.has(ev.tool) && (ev.tool === "Bash" || target) ? ev.tool : "other";
  const [before, after] = String(t(`chat.ask.${key}`)).split("{target}");
  const what = change ? "change" : ev.tool === "Bash" ? "command" : "details";
  // An edit always shows its path (ChatGPT's come with no lines); anything else, its words when it has any.
  const shown = Boolean(change) || Boolean(String(ev.input ?? "").trim());
  // Only part of it came: the server's words for a step stop at 3,000 characters (a command is sent whole).
  const partial = change ? change.cut : ev.tool !== "Bash" && String(ev.input ?? "").length >= 3000;
  // Characters that reorder text anywhere in what it asks: said once in words, beside the chips that stand for them.
  const steered = [target, change?.path ?? "", ...(change?.lines.map((l) => l.text) ?? []), String(ev.input ?? "")].some(hasSteering);
  const [hiddenBefore, hiddenAfter = ""] = String(t("chat.hiddenNote")).split("{mark}");
  return (
    <section className="ask-line" role="group" aria-label={t("chat.permission", { tool: ev.tool })}>
      <div className="ask-row">
        <span className="ask-wait" aria-hidden="true" />
        <strong className="ask-title">{before}{after !== undefined && <><bdi><Steered text={key === "other" ? ev.tool : target} /></bdi>{after}</>}</strong>
        {shown && (
          <button type="button" className="ask-show" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
            {t(`chat.${open ? "hide" : "show"}.${what}`)}<Icon name="down" />
          </button>
        )}
      </div>
      {shown && (
        <div className={`fold${open ? " open" : ""}`} id={body}>
          <div>
            {change
              ? (
                <div className="pre ask-diff">
                  <div className="ask-path"><Steered text={change.path} /></div>
                  {change.lines.map((l, k) => (
                    <div key={k} className={`ask-diff-line ${l.kind}`}><span className="ask-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</span><span><Steered text={l.text || " "} /></span></div>
                  ))}
                </div>
              )
              : <pre className="pre"><Steered text={String(ev.input ?? "")} /></pre>}
          </div>
        </div>
      )}
      {steered && <p className="ask-partial"><Icon name="warn" /><span>{hiddenBefore}<HiddenMark />{hiddenAfter}</span></p>}
      {partial && <p className="ask-partial"><Icon name="warn" />{t("chat.partial")}</p>}
      <div className="ask-acts">
        <button type="button" className="ask-btn yes" disabled={busy} onClick={() => send({ allow: true })}><Icon name="check" />{t("chat.allow")}</button>
        {ev.canRemember && <button type="button" className="ask-btn" disabled={busy} onClick={() => send({ allow: true, remember: true })}>{t("chat.allowFolder")}</button>}
        <button type="button" className="ask-btn no" disabled={busy} onClick={() => send({ allow: false })}><Icon name="close" />{t("chat.deny")}</button>
      </div>
    </section>
  );
}

// An option's words in a row that keeps the page's way: Hebrew with its names set apart (Words), anything else set
// apart whole, so a Hebrew line that starts with "Python" doesn't turn left to right.
const Said = ({ text }: { text: string }) => (HEBREW.test(text) ? <Words text={text} /> : <bdi>{text}</bdi>);

// Pip's questions, each with its options as rows to pick, and a line for an answer of your own; waiting the way a
// request does, with the slow amber dot and a small round button. A question runs the way its language does.
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
          <legend dir={HEBREW.test(q.question) ? "rtl" : "ltr"}><span className="ask-wait" aria-hidden="true" /><span><Words text={q.question} /></span></legend>
          {q.options.map((o: any) => (
            <label key={o.label} className="ask-option">
              <input type={q.multiSelect ? "checkbox" : "radio"} name={`q${qi}`} checked={(picked[qi] ?? []).includes(o.label)} onChange={() => toggle(qi, o.label, q.multiSelect)} />
              <span><strong><Said text={o.label} /></strong>{o.description && <small><Said text={o.description} /></small>}</span>
            </label>
          ))}
          {/* Empty, the page's direction (as the box's), so the hint starts on the page's side; typed in, the words'. */}
          <input type="text" placeholder={t("chat.other")} aria-label={t("chat.other")} dir={other[qi] ? "auto" : undefined} value={other[qi] ?? ""} onChange={(e) => setOther({ ...other, [qi]: e.target.value })} />
        </fieldset>
      ))}
      {error && <p className="error-line" role="alert">{error}</p>}
      <div className="ask-acts"><button type="submit" className="ask-btn yes" disabled={busy}><Icon name="check" />{t("chat.answer")}</button></div>
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
    // What a step names comes from the AI, so characters that reorder text show as their codes here too (Steered).
    if (ev.label) return <bdi><Steered text={clip(String(ev.label))} /></bdi>;
    const target = clip(shortTarget(ev.target));
    if (String(t(`chat.tools.${ev.name}`)).startsWith("chat.tools.")) return <bdi><Steered text={target || String(ev.name)} /></bdi>;
    const words = String(t(`chat.tools.${ev.name}`, { target: "\u0000" }));
    const [before, after = ""] = words.split("\u0000");
    // Words with no place for the target (an application's own steps, "Writing the CV") get it after a colon, where
    // it was once glued to their last word with no space (Sean 2026-11-17).
    if (!words.includes("\u0000")) return <>{words}{target && <>: <bdi><Steered text={target} /></bdi></>}</>;
    return <>{before}{target && <bdi><Steered text={target} /></bdi>}{after}</>;
  };
}

// Each tool's icon, by what it does; its family gives its colour (styles.css .step-icon): the web blue, files grey,
// writing mint, judging amber, keeping pink.
const TOOL_ICONS: Record<string, string> = {
  FetchPosting: "site", WebFetch: "site", WebSearch: "find", SearchRole: "find", ReadPortal: "portals", ReadChannel: "portals", Read: "file", Glob: "files", Grep: "find",
  Write: "edit", Edit: "edit", NotebookEdit: "edit", Bash: "tools", DraftCv: "edit", AddKeywords: "edit", ReviewCv: "rules", BuildCv: "apps", EvaluateFit: "gauge",
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
// aside: the step started a helper that is still at work in the background, so it shows at work though it answered.
// What agent.ts refuse() tells the agent in an unattended run; the step says it in the user's words.
const UNATTENDED_REFUSED = /^This is an unattended run, so nobody can approve this/;
function ToolLine({ ev, result, working, place = "", fresh = false, aside = false }: { ev: Ev; result?: Ev; working: boolean; place?: StepRow["place"]; fresh?: boolean; aside?: boolean }) {
  const { t } = useApp();
  const label = useToolLabel();
  const [open, setOpen] = useState(false);
  const body = useId();
  const state = aside ? "working" : result ? (result.isError ? "failed" : "done") : working ? "working" : "done";
  const mark = state === "working"
    ? <span className="steps-orb" aria-hidden="true"><AiSky orb /></span>
    : <span className={`step-state ${state}`}><Icon name={state === "failed" ? "close" : "check"} /></span>;
  const row = <>{mark}<ToolMark ev={ev} /><span className="step-text">{label(ev)}</span></>;
  return (
    <li className={`tool ${state} ${place}${fresh ? " fresh" : ""}`}>
      <div className="tool-in">
        {result?.preview ? <>
          <button type="button" className="tool-row" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>{row}</button>
          <div className={`fold${open ? " open" : ""}`} id={body}><div>
            {UNATTENDED_REFUSED.test(result.preview) ? <p className="step-note" dir="auto">{t("chat.unattendedStep")}</p> : <pre className="pre">{result.preview}</pre>}
          </div></div>
        </> : <div className="tool-row">{row}</div>}
      </div>
    </li>
  );
}

// What Pip is up to while no step shows it, in one funny word like Claude Code's spinner ("Combobulating…", Sean
// 2026-11-11): one at a time from a deck shuffled once for the page, so none comes back before the rest have shown,
// and a new one every few seconds while the wait goes on.
const deck: number[] = [];
let lastWord = -1;
function dealWord(n: number) {
  if (!deck.length) {
    for (let i = 0; i < n; i++) deck.push(i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    // A new deck never starts with the word just shown.
    if (n > 1 && deck[n - 1] === lastWord) [deck[0], deck[n - 1]] = [deck[n - 1], deck[0]];
  }
  return (lastWord = deck.pop()!);
}
// A word as shown: its key, its place in the list, and where the passing light (pass-light, 1.8s) stood when it came,
// so every word's light runs on one clock and a new word doesn't restart it.
type Shown = { n: number; k: number; light: string };
const shownNow = (n: number, k: number): Shown => ({ n, k, light: `${-(performance.now() % 1800)}ms` });
function WorkWord({ className }: { className: string }) {
  const { t } = useApp();
  const words: string[] = t("chat.musing");
  // The word shown and, for the moment they cross, the one leaving (Sean's pick of four sketches: the old word blurs
  // away as the new one sharpens in its place).
  const [shown, setShown] = useState<{ now: Shown; gone?: Shown }>(() => ({ now: shownNow(0, dealWord(words.length)) }));
  useEffect(() => {
    const tick = setInterval(() => {
      const k = dealWord(words.length);
      setShown(({ now }) => ({ now: shownNow(now.n + 1, k), gone: now }));
    }, 6000);
    return () => clearInterval(tick);
  }, [words.length]);
  useEffect(() => {
    if (!shown.gone) return;
    const end = setTimeout(() => setShown(({ now }) => ({ now })), 320);
    return () => clearTimeout(end);
  }, [shown.gone]);
  const word = (w: Shown, out: boolean) => (
    <span key={w.n} className={`work-word${out ? " out" : ""}`}>
      <span className={className} style={{ animationDelay: w.light }}>{words[w.k % words.length]}</span>
    </span>
  );
  // Nothing hidden beside it: a hidden label, placed absolutely, escaped the conversation's scroll and made the whole
  // page scroll. aria-live off: the conversation is a live region, and it shouldn't read out every new word.
  return <span className="work" aria-live="off">{shown.gone && word(shown.gone, true)}{word(shown.now, false)}</span>;
}

// The tool calls between two messages as a chat app's work line (OpenAI's "Worked for 44s", Sean's pick,
// 2026-11-11): shut, the kinds of steps as a stack of coloured icons, how many there were and, after a run's last
// steps, how long it took (took), over a line across the column; opened, it grows to show each step as a row. At
// work, the AI's orb, the step under way with a light passing over its words, its number, and the AI's colours
// running along the line. musing: Pip is at work with no step under way (thinking what to do next) and the block is
// the last thing shown, so it keeps the orb and says one of his work words (WorkWord) until the next step comes.
// A helper still at work in the background (agent.ts setBackground): its task, what it does, its kind, its step.
type Aside = { id: string; what: string; kind: string; tool?: string };
const NONE = new Set<string>();

// aside: the steps whose helpers are still at work in the background; with none under way, the line names the last.
function ToolSteps({ tools, results, working, musing = false, took, aside = NONE }: { tools: Ev[]; results: Map<string, Ev>; working: boolean; musing?: boolean; took?: number; aside?: Set<string> }) {
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
  const away = tools.filter((x) => aside.has(x.id));
  const now = busy ? tools.find((x) => !results.has(x.id)) ?? tools[tools.length - 1] : away[away.length - 1] ?? null;
  const lit = Boolean(now) || musing;
  const failed = tools.some((x) => results.get(x.id)?.isError);
  const kinds = [...new Map(tools.map((x) => [toolIcon(x), x])).values()].slice(0, 4);
  return (
    <div className={`steps${lit ? " working" : ""}${failed ? " failed" : ""}`}>
      <button type="button" className="steps-head" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
        {lit
          ? <span className="steps-orb" aria-hidden="true"><AiSky orb /></span>
          : <span className="steps-stack" aria-hidden="true">{kinds.map((x) => <ToolMark key={x.id} ev={x} />)}</span>}
        <span className="steps-title">
          {now
            ? <span className="steps-now">{label(now)}</span>
            : musing
              ? <WorkWord className="steps-now" />
              : <><strong>{top === 1 ? t("chat.step") : t("chat.steps", { n: top })}</strong>{took ? <span>, {duration(took)}</span> : null}</>}
        </span>
        {now && <span className="steps-count">{t("chat.stepN", { n: tools.indexOf(now) + 1 })}</span>}
        {failed && !lit && <Icon name="warn" />}
        <Icon name="down" />
      </button>
      {/* Every step shown, however many: the list grows with them, never a scroll of its own. */}
      <div className={`fold${open ? " open" : ""}`} id={body}>
        <div className="steps-body">
          <ol>{tree.map((r) => <ToolLine key={r.ev.id} ev={r.ev} result={results.get(r.ev.id)} working={working} place={r.place} fresh={!known.has(r.ev.id)} aside={aside.has(r.ev.id)} />)}</ol>
        </div>
      </div>
      {lit && <span className="steps-bar" aria-hidden="true" />}
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
              <Markdown src={card.a} className="md q-answer" chat />
              <span className="q-turn"><Icon name="refresh" />{t("chat.cards.back")}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// The language of a whole answer, by its words outside code: one in Hebrew keeps all its parts on the right, a list of
// sources that starts each item with a link too (kit.tsx Markdown).
const answerDir = (src: string) => (langDir(src.replace(/```[\s\S]*?(?:```|$)/g, "")) === "rtl" ? "rtl" : undefined);

// Pip's answer: his words, a run of questions to prepare among them as cards (answer-parts.ts).
function Answer({ src }: { src: string }) {
  const parts = useMemo(() => answerParts(src), [src]);
  const dir = useMemo(() => answerDir(src), [src]);
  return (
    <div className="msg-pip">
      {parts.map((part, k) => ("cards" in part ? <QuestionCards key={k} cards={part.cards} /> : <Markdown key={k} src={part.md} className="md msg-text" dir={dir} chat />))}
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
const SIGN_IN_CODES = new Set(["claude_login", "openai_login", "no_agent"]);
// Claude's own words when its usage runs out ("You've hit your weekly limit · resets Nov 14, 8am (Asia/Jerusalem)"),
// said in the user's words, with when it comes back as Claude gives it.
const CLAUDE_LIMIT = /^You've hit your [^\n]*limit(?:\s*·\s*resets ([^\n]+))?$/i;
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
      {/* What happened in a calm line, not an alarm: a sign-in to make is no fault of the user's. The way to make it is a
          borderless pill, never the boxed button (Sean's rule), that opens the sign-in in a window of its own. */}
      <p className={ready ? "note" : "chat-login-says"} dir="auto">{!ready && <Icon name="warn" />}{t(ready ? "chat.errors.agent_ready" : expired ? "chat.errors.login_expired" : "chat.errors.no_agent", { name })}</p>
      {!ready && (opened ? <p className="note" dir="auto">{t("chat.loginOpened")}</p>
        : <button type="button" className="login-pill" onClick={open}><Icon name="login" />{t(expired ? "chat.loginAgain" : "chat.loginTo", { name })}</button>)}
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
  // Opened from a new conversation's box: the move from there (launch.ts).
  const root = useRef<HTMLDivElement>(null);
  const landing = useLanding(id, root);

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
  // The helpers still at work in the background, as the conversation last said (Sean 2026-11-12: "לא ברור אם הוא רץ
  // עדיין או לא"), and the steps that started them, which show at work until they're done.
  const background = useMemo((): Aside[] => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i].t === "background") return Array.isArray(events[i].tasks) ? events[i].tasks : [];
    return [];
  }, [events]);
  const aside = useMemo(() => new Set(background.flatMap((x) => (x.tool ? [x.tool] : []))), [background]);
  // Each turn's steps in one block at its top, its words after it (turnItems). Until the server's first word, a
  // conversation just started shows its message, under the key the server's will have, so the bubble stays.
  const items = useMemo((): TurnItem<Ev>[] => {
    const list = turnItems(events);
    return list.length || !landing?.words ? list : [{ kind: "event", key: "0", ev: { t: "user", text: landing.words } }];
  }, [events, landing]);

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
  // Stop pressed: said at once, as what is under way takes a moment to be killed, until the conversation and its
  // helpers in the background have all stopped. Stop can be pressed with only the helpers at work, so the turn's own
  // end isn't the only way out: a new turn begun after it is not being stopped either.
  const [stopping, setStopping] = useState(false);
  useEffect(() => { if (!working && !background.length) setStopping(false); }, [working, background.length]);
  useEffect(() => { if (working) setStopping(false); }, [working]);
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
  // Whether the run this end belongs to stopped on a sign-in to make: the last thing it said, a sign-in block. An item's
  // key is its place in the events (turnItems).
  const endedOnSignIn = (key: string) => {
    for (let i = Number(key) - 1; i >= 0; i--) {
      const e = events[i];
      if (!e || e.t === "user") return false;
      if (e.t === "error") return SIGN_IN_CODES.has(e.code);
      if (e.t === "text") return CLAUDE_REFUSED.test(e.text);
    }
    return false;
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
          {e.text && <div className="msg-bubble" dir="auto">{commandWords(e.text, t) ?? e.text}</div>}
        </div>
      );
      case "text": {
        if (CLAUDE_REFUSED.test(e.text)) return <AgentLogin key={key} code="claude_login" />;
        const limit = String(e.text).trim().match(CLAUDE_LIMIT);
        if (limit) return <p key={key} className="switched-line" dir="auto"><Icon name="warn" />{t("chat.claudeLimit")}{limit[1] ? <> {t("chat.claudeResets")} <bdi>{limit[1]}</bdi></> : null}</p>;
        return <Answer key={key} src={e.text} />;
      }
      case "permission": return resolved.has(e.requestId) ? settled(e) : <Permission key={key} ev={e} sessionId={id} />;
      case "question": return resolved.has(e.requestId) ? settled(e) : <Question key={key} ev={e} sessionId={id} />;
      // A run's end is said only when it has something to say: that it failed, or what it cost on a key.
      // A run that ended on a sign-in to make has said so in the sign-in block above it.
      case "result": return !e.ok && endedOnSignIn(key) ? null : !e.ok || e.cost >= 0.01
        ? <p key={key} className="done-line">{e.ok ? t("chat.done") : t("chat.doneError")}{e.cost >= 0.01 ? t("chat.cost", { cost: e.cost.toFixed(2) }) : ""}</p> : null;
      // A step refused in an unattended run is said in the step itself (ToolLine), not as a red line for each.
      case "error": return String(e.code ?? "").startsWith("unattended_") ? null
        : e.code === "claude_login" || e.code === "openai_login" || e.code === "no_agent" ? <AgentLogin key={key} code={e.code} />
        : <p key={key} className="error-line" role="alert" dir="auto">{e.code ? t(`chat.errors.${e.code}`, { detail: e.text ?? "" }) : e.text}</p>;
      case "switched": return <p key={key} className="switched-line" dir="auto"><Icon name="warn" />{t("chat.switched", { from: e.from, to: e.to })}</p>;
      default: return null;
    }
  };

  return (
    <div className="convo" ref={root}>
      {!bare && (
        <header className="chat-top">
          {onList && <ListButton onList={onList} />}
          {/* A temporary conversation has no title of its own (agent.ts): it says what it is, with its dashed bubble. */}
          {session?.temporary
            ? <h1 className="chat-title chat-title-temp"><Icon name="temporary" />{t("chat.temporary.title")}</h1>
            : <h1 className="chat-title" dir="auto">{session ? friendlyTitle(session.title, t) : ""}</h1>}
          {(plain || (session?.agent && session.agent !== "claude")) && session?.engine && <span className="chat-model"><bdi>{session.engine}</bdi></span>}
          <ThemePicker />
        </header>
      )}
      <div className="log-frame">
        <div className="log" ref={log} role="log" aria-live="polite" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          <div className="log-column">
            {items.map((item) => (item.kind === "tools"
              ? <ToolSteps key={item.key} tools={item.tools} results={results} working={working && item === current} took={took.get(item.key)} aside={aside}
                musing={!live && status === "running" && !stopping && item === items[items.length - 1]} />
              : (
                <React.Fragment key={item.key}>
                  {render(item.ev, item.key)}
                  {placed.after.get(Number(item.key))?.map((d) => <DocCard key={d.path} doc={d} />)}
                </React.Fragment>
              )))}
            {writing && <DocCard ghost={writing} />}
            {live && <div className="msg-pip live"><Markdown src={live} className="md msg-text" dir={answerDir(live)} chat /></div>}
            {!live && status === "running" && (stopping || items[items.length - 1]?.kind !== "tools") && (
              <div className="working-line">
                <span className="steps-orb" aria-hidden="true"><AiSky orb /></span>
                {stopping ? <span className="typing-text">{t("session.stopping")}</span> : <WorkWord className="typing-text" />}
              </div>
            )}
            {/* Pip done, his helpers not: how many are still at work in the background, and what each is doing. */}
            {!live && status !== "running" && status !== "waiting" && background.length > 0 && (
              <div className="working-line aside-line">
                <span className="steps-orb" aria-hidden="true"><AiSky orb /></span>
                <span className="typing-text">{background.length === 1 ? t("chat.aside.one") : t("chat.aside.many", { n: background.length })}</span>
                <span className="aside-what"><bdi><Steered text={background.map((x) => x.what).filter(Boolean).join(", ")} /></bdi></span>
              </div>
            )}
            {placed.end.map((d) => <DocCard key={d.path} doc={d} />)}
          </div>
        </div>
        <ThinBar target={log} />
      </div>
      <Composer
        text={text} setText={setText} onSend={send} onStop={stop} working={working || background.length > 0} placeholder={t("chat.message")} temporary={Boolean(session?.temporary)}
        tools={plain ? null : <AccessPicker value={access} onChange={changeAccess} />}
        warn={plain ? "" : <FullWarn />} warnOn={access === "full"}
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
  // The scene behind the chat and the colours that go with it (chat-theme.tsx), the plain chat by default.
  const [theme] = useChatTheme();
  return (
    <div className={`chat ${lists ? "lists-open" : ""} ${hidden ? "threads-hidden" : ""}`} data-chat-theme={theme}>
      <div className="chat-main">
        <ChatBackdrop theme={theme} />
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
