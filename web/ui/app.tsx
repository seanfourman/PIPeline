// The frame: shared state, language, theme, the sidebar, Pip's notices, and which screen shows.
import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { translate, type Lang } from "./i18n";
import { api, copyText, desktopSystem, errorText, goTo, Icon, isComputer, macCommand, ROUTED, type ApiError } from "./kit";
import { AccountDialog } from "./accounts";
import { Pip, PipMark, type Mood } from "./pip";
import { Apps } from "./views/apps";
import { Chat } from "./views/chat";
import { Editor, Files, Rules, Tools } from "./views/docs";
import { Home, Sprite } from "./views/home";
import { Login, type SiteInfo } from "./login";
import { JobPage } from "./views/job";
import { Jobs, SavedJobs } from "./views/jobs";
import { Portals } from "./views/portals";
import { ProfilePage } from "./views/profile";
import { Portfolio } from "./views/portfolio";
import { Settings } from "./views/settings";
import { Welcome } from "./views/welcome";

export type AppState = {
  applications: Record<string, any>[]; jobs: Record<string, any>[]; files: { path: string; modified: number }[];
  // The jobs the user saved themselves (saved.ts), apart from jobs, which Pip's searches found.
  saved: { url: string; title: string; company: string; location: string; date: string; saved: string }[];
  // plain: chat only, answered by the settings' AI (agent.ts); engine: the name of the one that answered last.
  // agent: "codex" when ChatGPT works in it as an agent, through Codex (codex.ts).
  sessions: { id: string; title: string; status: string; createdAt: number; model?: string; access?: string; plain?: boolean; engine?: string; agent?: string; pinned?: number; archived?: boolean; project?: string }[];
  // The conversations' projects (projects.ts); a Pip from before them has none.
  projects?: { id: string; name: string; createdAt: number }[];
  settings: Record<string, any>; presets: Record<string, { name: string; places: string[] }[]>; profileReady: boolean;
  // Whether a key for ChatGPT (openai) is saved (chatbots.ts); the keys never come here. aiLogins: whether it is
  // signed in with the account, through Codex (clis.ts).
  aiKeys: Record<string, boolean>;
  aiLogins?: Record<string, boolean>;
  // The account's name on this computer (auth.ts), and the introduction's state: whether it is done, the name
  // employers see (user/profile.json), and the documents it put in user/documents/ (server.ts).
  account?: string;
  // This computer's other accounts, by name, for the account menu; those of them this browser keeps a login to, which
  // open with no password (auth.ts); and this computer's id, the one the daily run's computer is named by (accounts.ts).
  accounts?: string[];
  remembered?: string[];
  computer?: string;
  intro?: { done: boolean; name: string; documents: { cv: string[]; linkedin: string[] } };
  // Phone access through the site (remote.ts): whether this computer is linked, where, as whom, and connected now.
  remote?: { linked: boolean; site: string; name: string; state: "off" | "connecting" | "on"; error: string };
  // The grade sheet kept from the settings, and whether it can be joined to a CV (transcript.ts).
  transcript?: { size: number; joinable: boolean } | null;
};

type News = { text: string; mood: Mood } | null;
// Pip updating himself (App): announced and away, back and updated, or neither.
type Update = "" | "updating" | "updated";
type Ctx = {
  s: AppState; loaded: boolean; refresh: () => Promise<void>;
  // Whether the page is on screen: the loading screen gone and the state in.
  shown: boolean;
  lang: Lang; setLang: (l: Lang) => void; t: (key: string, params?: Record<string, string | number>) => any; err: (e: unknown) => string;
  // theme is "light", "dark", or "" to follow the computer.
  dark: boolean; toggleTheme: () => void; theme: string; setTheme: (mode: string) => void;
  view: string; arg?: string;
  say: (text: string, mood?: Mood, ms?: number) => void; news: News; update: Update;
  // access is how much the conversation may do without asking (policy.ts); left out, it asks. files are the ids
  // of uploads attached to the first message (uploads.ts).
  start: (prompt: string, model?: string, access?: string, files?: string[]) => Promise<void>;
  // The same in the background: the conversation is made and listed, but the page stays where it is, and Pip
  // peeks out while it works (PeekingPip).
  run: (prompt: string) => Promise<void>;
  draft: React.MutableRefObject<string>;
  logout: () => void;
  // The login's board over the page, from the account menu: adding an account there is already, or making a new one.
  addAccount: (how: "join" | "create") => void;
};

const AppContext = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppContext);

const EMPTY: AppState = { applications: [], jobs: [], saved: [], files: [], sessions: [], settings: { markets: [], areas: [], roles: [], automation: {} }, presets: {}, profileReady: true, aiKeys: {}, intro: { done: true, name: "", documents: { cv: [], linkedin: [] } } };

// Browser storage only remembers small conveniences, and the page works without it.
export const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* unavailable */ } };

// For now the site is in Hebrew and the light theme only: the English version and the dark theme are off until
// they are ready, their buttons on the settings screen marked coming soon and those on the login hidden. true
// brings each back, with the one picked before; public/boot.js has the same two.
export const LANGUAGES_ON = false;
export const THEMES_ON = false;

// The page an address names, and what it opens there: /jobs, /chat/<id>, the home page at /. One of the old kind,
// from before the pages had addresses of their own (/#/jobs), is read the same, and App sets it right.
function readRoute(): [string, string | undefined] {
  const at = location.hash.startsWith("#/") ? location.hash.slice(1) : location.pathname;
  const [view = "", arg] = at.slice(1).split("/");
  let named = arg;
  try { named = arg && decodeURIComponent(arg); } catch { /* kept as it came */ }
  return [view || "dash", named || undefined];
}
// A page's address, the home page's /.
const pagePath = (view: string, arg?: string) => (view === "dash" && !arg ? "/" : `/${view}${arg ? `/${encodeURIComponent(arg)}` : ""}`);

export const COMMANDS: { group: string; items: { id: string; arg?: boolean; danger?: boolean }[] }[] = [
  { group: "daily", items: [{ id: "job-scraper" }, { id: "rank" }, { id: "apply", arg: true }, { id: "interview", arg: true }, { id: "outcome", arg: true }] },
  { group: "growth", items: [{ id: "upskill", arg: true }, { id: "expand" }, { id: "html-report" }] },
  { group: "showcase", items: [{ id: "portfolio" }, { id: "readme", arg: true }, { id: "brag-slim", arg: true }] },
  { group: "connect", items: [{ id: "gmail-sync" }, { id: "notion-sync" }, { id: "add-portal", arg: true }, { id: "add-template" }] },
  { group: "setup", items: [{ id: "setup", arg: true }, { id: "reset", danger: true }] },
];

// Shows "/apply https://site/..." as a readable conversation name.
export function friendlyTitle(title: string, t: Ctx["t"]) {
  const [cmd, ...rest] = title.split(" ");
  const id = cmd.startsWith("/") ? cmd.slice(1) : "";
  const known = COMMANDS.some((g) => g.items.some((c) => c.id === id));
  if (!known) return title;
  const arg = rest.join(" ");
  let detail = arg;
  try { if (/^https?:\/\//.test(arg)) detail = new URL(arg).hostname.replace(/^www\./, ""); } catch { /* keep the text */ }
  const name = t(`tools.commands.${id}`)[0];
  return detail ? `${name}: ${detail}` : name;
}

// One flat list, like a social site's sidebar; the order still runs from daily use to the advanced pages. The first
// SHOWN are in the list, and those after them in More's menu at its end, where any page added later goes too.
const NAV: [string, string][] = [
  ["dash", "home"], ["jobs", "jobs"], ["saved", "saved"], ["portals", "portals"], ["apps", "apps"], ["chat", "chat"],
  ["profile", "profile"], ["settings", "settings"], ["rules", "rules"], ["tools", "tools"], ["files", "files"], ["portfolio", "portfolio"],
];
const SHOWN = 10;
// Every page an address can open: the sidebar's, a CV or a letter in the editor, the introduction, and a job's own
// page (views/job.tsx).
const PAGES = new Set([...NAV.map(([id]) => id), "cv", "letter", "welcome", "job"]);

// The sidebar. Language and theme live on the settings page; the foot is the account, with its menu (AccountMenu).
// Beside the logo, here only, a tag that says Pip is still in beta.
function Sidebar() {
  const { s, t, view } = useApp();
  const current = view === "cv" || view === "letter" ? "files" : view;
  const waiting = s.sessions.filter((x) => x.status === "waiting").length;
  const more = NAV.slice(SHOWN);
  // A page's row, in the list or in More's menu; i, its place, is for the menu's rows coming in one after another.
  const row = ([id, icon]: [string, string], i: number) => (
    <a key={id} href={pagePath(id)} aria-current={current === id ? "page" : undefined} style={{ "--i": i } as React.CSSProperties}>
      <span className="nav-icon">
        <Icon name={icon} filled={current === id} />
        {id === "chat" && waiting > 0 && <span className="count" aria-label={t("nav.waiting", { n: waiting })}>{waiting}</span>}
      </span>
      <span className="nav-label">{t(`nav.${id === "dash" ? "home" : id}`)}</span>
    </a>
  );
  return (
    <nav className="side" aria-label={t("nav.main")}>
      <div className="brand-row">
        <a className="brand" href="/" aria-label={t("brand.name")}><PipMark /></a>
        <span className="beta">{t("brand.beta")}</span>
      </div>
      <div className="nav">
        {NAV.slice(0, SHOWN).map(row)}
        {more.length > 0 && <More here={more.some(([id]) => id === current)}>{more.map(row)}</More>}
      </div>
      <a className="btn post" href="/chat/new" aria-label={t("chat.new")}><Icon name="plus" /><span>{t("chat.new")}</span></a>
      <AccountMenu />
    </nav>
  );
}

// A menu's gap from its button, and the least it keeps from the window's edges.
const MORE_GAP = 6;
const MORE_EDGE = 8;

// More, at the end of the sidebar's list, as on a social site: a row like the others, three dots in a circle and the
// word, that opens a round menu of the pages after the list's first SHOWN (PopMenu). While the page you are on is in
// it, More is bold and its icon filled, as that page's own row would be.
function More({ here, children }: { here: boolean; children: React.ReactNode }) {
  const { t } = useApp();
  return (
    <PopMenu className={`nav-more ${here ? "here" : ""}`} face={<><span className="nav-icon"><Icon name="more" filled={here} /></span><span className="nav-label">{t("nav.more")}</span></>}>
      {children}
    </PopMenu>
  );
}

// The account at the sidebar's foot, as on a social site: one button, the letter, the name, the account's @name and
// three dots, that opens More's menu itself (PopMenu), its rows as More's are, an icon and the words. This computer's
// other accounts, each opened with its password, or straight away once this browser has been in it (AccountDialog);
// adding an account there is already, and making a new one, both on the login's board (Login); and logging out of
// this one. A new account is made only on the computer itself, not through the site (server.ts).
function AccountMenu() {
  const { s, t, logout, addAccount } = useApp();
  const [dialog, setDialog] = useState<{ name: string; remembered: boolean } | null>(null);
  const name = String(s.settings.displayName ?? "").trim() || s.account || "";
  const others = s.accounts ?? [];
  const here = ["127.0.0.1", "localhost"].includes(location.hostname);
  const at = (i: number) => ({ "--i": i }) as React.CSSProperties;
  const face = (
    <>
      <span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <span className="account-names">
        <span className="account-name">{name}</span>
        <bdi className="account-handle" dir="ltr">@{s.account ?? ""}</bdi>
      </span>
      <Icon name="dots" />
    </>
  );
  return (
    <>
      <PopMenu className="account" label={t("account.menu")} face={face}>
        {others.map((other, i) => (
          <button key={other} type="button" style={at(i)} onClick={() => setDialog({ name: other, remembered: Boolean(s.remembered?.includes(other)) })}>
            <span className="nav-icon"><span className="avatar" aria-hidden="true">{other.slice(0, 1).toUpperCase()}</span></span>
            <span className="nav-label"><bdi dir="ltr">@{other}</bdi></span>
          </button>
        ))}
        <button type="button" style={at(others.length)} onClick={() => addAccount("join")}>
          <span className="nav-icon"><Icon name="login" /></span><span className="nav-label">{t("account.add")}</span>
        </button>
        {here && (
          <button type="button" style={at(others.length + 1)} onClick={() => addAccount("create")}>
            <span className="nav-icon"><Icon name="signup" /></span><span className="nav-label">{t("account.create")}</span>
          </button>
        )}
        <button type="button" style={at(others.length + (here ? 2 : 1))} onClick={logout}>
          <span className="nav-icon"><Icon name="logout" /></span><span className="nav-label">{t("account.logout")}</span>
        </button>
      </PopMenu>
      {dialog && <AccountDialog name={dialog.name} remembered={dialog.remembered} onClose={() => setDialog(null)} />}
    </>
  );
}

// The menus that pop out of the sidebar: More's and the account's. Each is round and as wide as the sidebar inside its
// edges, and opens above its button, over what is before it; under it only where there is no room above (a phone's top
// bar), as under it, it would lie over part of the main button. It pops out of its button's middle and goes back into
// it (styles.css). It is a popover, so it stands above everything, and a click outside, Escape, an item picked in it,
// the page scrolling or the window changing size close it, as they do Select's list. Opened with the keys, its first
// item takes the focus, the arrow keys go up and down it, and Tab out of either end closes it. face is what the button
// shows, and label names one that shows only an icon. near: a small menu beside its button instead of one as wide as
// the sidebar (a conversation's ⋯), under the button or above it where there is no room, kept on the screen; an item
// marked data-keep (one that opens the menu's next level) leaves it open; onToggle hears it open and close.
export function PopMenu({ className, face, label, children, near = false, onToggle }: { className: string; face: React.ReactNode; label?: string; children: React.ReactNode; near?: boolean; onToggle?: (open: boolean) => void }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Whether the menu was open as More was pressed: the press has closed it already then, and the click that follows
  // should not open it again.
  const wasOpen = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = menu.current;
    if (!el) return;
    const toggled = (e: Event) => { const now = (e as ToggleEvent).newState === "open"; setOpen(now); onToggle?.(now); };
    el.addEventListener("toggle", toggled);
    return () => el.removeEventListener("toggle", toggled);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!menu.current?.contains(e.target as Node)) menu.current?.hidePopover(); };
    const shut = () => menu.current?.hidePopover();
    addEventListener("scroll", away, true);
    addEventListener("resize", shut);
    return () => { removeEventListener("scroll", away, true); removeEventListener("resize", shut); };
  }, [open]);

  const show = (keys: boolean) => {
    if (near) { showNear(keys); return; }
    const el = button.current, pop = menu.current, side = el?.closest<HTMLElement>(".side");
    if (!el || !pop || !side) return;
    if (pop.matches(":popover-open")) { pop.hidePopover(); return; }
    // Inside the sidebar's padding, and its border and scrollbar where it has them.
    const bar = side.getBoundingClientRect(), pad = getComputedStyle(side);
    const left = bar.left + side.clientLeft + parseFloat(pad.paddingLeft);
    pop.style.width = `${side.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight)}px`;
    pop.showPopover();
    // Then, shown and with its height, above its button or under it, growing from the button's middle, before it is
    // drawn.
    const at = el.getBoundingClientRect(), height = pop.offsetHeight;
    const above = at.top - MORE_GAP - MORE_EDGE;
    const top = height <= above || above > innerHeight - at.bottom - MORE_GAP - MORE_EDGE ? at.top - MORE_GAP - height : at.bottom + MORE_GAP;
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px`, transformOrigin: `${at.left + at.width / 2 - left}px ${at.top + at.height / 2 - top}px` });
    if (keys) pop.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
  };
  const showNear = (keys: boolean) => {
    const el = button.current, pop = menu.current;
    if (!el || !pop) return;
    if (pop.matches(":popover-open")) { pop.hidePopover(); return; }
    pop.style.width = "";
    pop.showPopover();
    const at = el.getBoundingClientRect(), width = pop.offsetWidth, height = pop.offsetHeight;
    const rtl = getComputedStyle(el).direction === "rtl";
    const left = Math.max(MORE_EDGE, Math.min(innerWidth - width - MORE_EDGE, rtl ? at.left : at.right - width));
    const top = at.bottom + MORE_GAP + height <= innerHeight - MORE_EDGE ? at.bottom + MORE_GAP : Math.max(MORE_EDGE, at.top - MORE_GAP - height);
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px`, transformOrigin: `${at.left + at.width / 2 - left}px ${at.top + at.height / 2 - top}px` });
    if (keys) pop.querySelector<HTMLElement>("a, button, input")?.focus({ preventScroll: true });
  };
  const keys = (e: React.KeyboardEvent) => {
    const links = [...(menu.current?.querySelectorAll<HTMLElement>("a, button") ?? [])];
    const at = links.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      links[(at + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length]?.focus();
    } else if (e.key === "Tab" && at === (e.shiftKey ? 0 : links.length - 1)) {
      // Back onto More, or on past it.
      menu.current?.hidePopover();
      button.current?.focus({ preventScroll: true });
      if (e.shiftKey) e.preventDefault();
    }
  };

  return (
    <>
      <button
        ref={button} type="button" className={className} aria-label={label} aria-expanded={open} aria-controls={`${id}-menu`}
        onPointerDown={() => { wasOpen.current = open; }}
        onClick={(e) => { if (wasOpen.current) wasOpen.current = false; else show(e.detail === 0); }}
      >
        {face}
      </button>
      {/* popover is not in React 18's types yet, so it goes in as a plain attribute. */}
      <div
        ref={menu} id={`${id}-menu`} {...{ popover: "auto" }} className={`more-menu ${near ? "near" : ""}`} onKeyDown={keys}
        onClick={(e) => { const hit = (e.target as Element).closest("a, button"); if (hit && !hit.hasAttribute("data-keep")) menu.current?.hidePopover(); }}
      >
        {children}
      </div>
    </>
  );
}

export function companionLine(s: AppState, view: string, t: Ctx["t"]): { text: string; mood: Mood; href?: string; action?: string; news?: boolean } {
  const waiting = s.sessions.find((x) => x.status === "waiting");
  const running = s.sessions.find((x) => x.status === "running");
  if (waiting) return { text: t("pip.waiting"), mood: "ask", href: `/chat/${waiting.id}`, action: t("pip.toChat"), news: true };
  if (running) return { text: t("pip.running"), mood: "work", href: `/chat/${running.id}`, action: t("pip.watch") };
  const line = t(`pip.views.${view}`);
  return { text: typeof line === "string" && !line.startsWith("pip.") ? line : "", mood: "idle" };
}

// How long Pip takes to slide back behind the sidebar; matches peek-in in styles.css.
const PEEK_IN_MS = 420;

// The commands that run in the background once started there (run): the smart search, and the ranking from the saved
// jobs page; with what Pip says while each works, and once it is done or has stopped.
const BACKGROUND: Record<string, { work: string; done: string; stopped: string }> = {
  "/job-scraper": { work: "pip.peekWork", done: "pip.workDone", stopped: "pip.workStopped" },
  "/rank": { work: "pip.peekRank", done: "pip.rankDone", stopped: "pip.rankStopped" },
};
const inBackground = (title: string) => Object.hasOwn(BACKGROUND, title);

// What Pip says from behind the sidebar (PeekingPip): its words, his mood, and where a click on him goes, if
// anywhere, with that said for screen readers. key changes with each new thing he says, which pops the bubble anew.
type Peek = { key: string; text: string; mood?: Mood; href?: string; label?: string };

// Pip peeking out from behind the sidebar at the bottom of the screen (up from the screen's bottom on a phone, where
// the sidebar is a bar on top), saying what he has to say in a pixel speech bubble. First what matters most: Pip
// updating himself, while he is away and once he is back (App's update); then what he says after something you did,
// for a few seconds (say: saved, built, a status changed); then, but on the conversations page, where they are in
// sight already, a conversation that waits for your answer, quietly, with no "!" (a click opens it, its name in his
// label for screen readers only), or a command at work in the background, whose end he says too. He slides out,
// leans out a little further now and then, pops up a new bubble with each new thing, and slides back in when he has
// nothing to say (kept while he goes). His words are in the app's language and run its way, a line that starts
// with a Latin company name too. The pages' own Pips stay as they are.
function PeekingPip() {
  const { s, t, view, say, news, update } = useApp();
  const waiting = s.sessions.find((x) => x.status === "waiting");
  const working = s.sessions.find((x) => x.status === "running" && inBackground(x.title));
  const session = view === "chat" ? undefined : waiting ?? working;
  const work = session === working;
  const workLine = working ? BACKGROUND[working.title].work : "pip.peekWork";
  const now: Peek | null = update
    ? { key: update, text: t(update === "updating" ? "pip.updating" : "pip.updated"), mood: update === "updating" ? "work" : "happy" }
    : news
      ? { key: `news:${news.text}`, text: news.text, mood: news.mood }
      : session
        ? {
          key: `${session.id}:${work}`, text: t(work ? workLine : "pip.peek"), mood: work ? "work" : undefined, href: `/chat/${session.id}`,
          label: `${t(work ? workLine : "pip.peek")} ${t("pip.peekIn")} ${friendlyTitle(session.title, t)}`,
        }
        : null;
  const [kept, setKept] = useState<Peek | null>(null);
  if (now && (kept?.key !== now.key || kept.text !== now.text || kept.label !== now.label)) setKept(now);
  const leaving = !now && !!kept;
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setKept(null), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : PEEK_IN_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  // A background command seen at work, and then done or stopped: how it went.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const x of s.sessions) {
      if (!inBackground(x.title)) continue;
      if (x.status === "running") seen.current.add(x.id);
      else if ((x.status === "idle" || x.status === "error") && seen.current.delete(x.id)) {
        const lines = BACKGROUND[x.title];
        say(t(x.status === "idle" ? lines.done : lines.stopped), x.status === "idle" ? "happy" : "confused");
      }
    }
  }, [s.sessions]);
  if (!kept) return null;
  // One element throughout, a link only while he leads somewhere, so Pip stays out as what he says changes.
  return (
    <a className={`peek ${leaving ? "leaving" : ""}`} href={kept.href} aria-label={kept.label} role={kept.href ? undefined : "status"}>
      <Pip className="peek-pip" mood={kept.mood} />
      <span className="peek-say" key={kept.key}>
        <span className="peek-edge"><span className="peek-words">{kept.text}</span></span>
        <SpeechTail />
      </span>
    </a>
  );
}

// The speech bubble's tail, in the bubble's pixels: its outline (k) and fill (w) on a grid of 3-pixel cells, the tip
// down at the start side, by Pip. Its second row lies over the bubble's bottom edge, so the edge opens into it, and
// its first, fill alone, over the bubble's white above that, so that wherever the edge falls between pixels, no line
// of it shows across the opening.
const TAIL = [".wwww.", "kwwwwk", ".kwwwk", "..kwwk", "...kwk", "....kk"];
export function SpeechTail() {
  return (
    <svg className="peek-tail" viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true">
      {TAIL.flatMap((row, y) => [...row].map((c, x) => (c === "." ? null : <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} className={c === "k" ? "tail-edge" : "tail-fill"} />)))}
    </svg>
  );
}

// The conversation last open since the page loaded. The conversations page opens on it, and on a new conversation
// once the page is loaded again; reloaded on a conversation, the address keeps that one.
let lastChat = "";

function Screen() {
  const { view, arg } = useApp();
  if (view === "chat" && arg) lastChat = arg;
  switch (view) {
    case "jobs": return <Jobs />;
    case "saved": return <SavedJobs />;
    case "job": return <JobPage />;
    case "portals": return <Portals />;
    case "apps": return <Apps />;
    case "chat": return <Chat id={arg ?? (lastChat || "new")} />;
    case "tools": return <Tools />;
    case "portfolio": return <Portfolio />;
    case "profile": return <ProfilePage />;
    case "rules": return <Rules />;
    case "files": return <Files />;
    case "settings": return <Settings />;
    case "cv": case "letter": return <Editor key={`${view}/${arg}`} kind={view} name={arg ?? ""} />;
    default: return <Home />;
  }
}

// The page shows once its fonts are in, Hebrew and Latin alike, so nothing first shows in a stand-in font;
// if they take longer than FONT_WAIT_MS it shows anyway.
const FONTS = ["16px Rubik", "800 16px Handjet"];
const FONT_WAIT_MS = 3000;
// The loading screen (in index.html) stays at least this long from the page opening, so Pip gets to hop and
// leave its trail rather than flash by.
const BOOT_MIN_MS = 1000;

// The program stopped with its page open (its icon's Quit, the computer turned off, or from a phone the computer
// unreachable): the whole page waits under the loading screen's own layout, Pip worried where he hops there, at his
// size there, and under him, where the paw prints were, what happened and how to bring it back, rising in softly line
// after line, and a plug inching to its socket while it waits. It asks every few seconds, and once the program answers
// the page loads afresh, the way it was left.
// Found so while the loading screen still shows (fromBoot), it doesn't fade in over it but grows out of it: once the
// loading screen has had its time (ready, the page's booted) and its Pip is on the ground between two hops, he stays
// there, worried, the paw prints fade under him, and the words rise in (from-boot in styles.css).
const OFFLINE_RETRY_MS = 2500;
// An update's moment away, waited out with the page as it is (App); how long Pip says he is updated, once he is; and
// how lately the page was used to count as in use.
const UPDATE_QUIET_MS = 90_000;
const UPDATED_MS = 5000;
const ACTIVE_MS = 60_000;
// The loading screen's hop (boot-hop in styles.css): how long one takes, and when in it Pip is up in the air.
const HOP_MS = 720;
const HOP_AIR = [0.12 * HOP_MS, 0.64 * HOP_MS];
// How long the words take to be in.
const SETTLE_MS = 2200;
// Waiting for Pip: a plug inching to its socket in hard steps, a spark each time they meet, and back again
// (offline-plug in styles.css). The plug's metal prongs come out of its body toward the socket, which comes before it
// in the line, and its cable out of the other side.
const SOCKET = ["OOOOOOOOO", "OwwwwwwwO", "OwOwwwOwO", "OwOwwwOwO", "OwwwwwwwO", "OwwwOwwwO", "OwwwwwwwO", "OOOOOOOOO"];
const PLUG = [".....OOOOO...", ".....OyyyOmmm", "cccccOyyyO...", ".....OyyyOmmm", ".....OOOOO..."];
const SPARK = ["X...X", ".X.X.", "..X..", ".X.X.", "X...X"];
const PLUG_INK = "#3a2414";
const PLUG_AMBER = "#ffc94a";

// The download's arrow into its tray, as on the introduction's first step.
const GET = ["..OOO..", "..OYO..", "OOOYOOO", ".OYYYO.", "O.OYO.O", "O..O..O", "OOOOOOO"];
const GetIcon = () => <Sprite className="offline-get-icon" rows={GET} colors={{ O: PLUG_INK, Y: PLUG_AMBER }} />;

function Plugging() {
  return (
    <span className="offline-plug" aria-hidden="true">
      <Sprite className="offline-socket" rows={SOCKET} colors={{ O: PLUG_INK, w: "#fffaf0" }} />
      <Sprite className="offline-spark" rows={SPARK} colors={{ X: PLUG_AMBER }} />
      <Sprite className="offline-plugged" rows={PLUG} colors={{ O: PLUG_INK, y: PLUG_AMBER, c: PLUG_INK, m: "#9aa0a8" }} />
    </span>
  );
}

// Pip away because it is updating itself (updating, which the program said just before it went): Pip at work rather
// than worried, words that say so, and no download, Pip being on the computer.
function Offline({ fromBoot, ready, updating }: { fromBoot: boolean; ready: boolean; updating: boolean }) {
  const { t } = useApp();
  const [phase, setPhase] = useState<"waiting" | "showing" | "settled">(fromBoot ? "waiting" : "settled");
  // On the site from a computer, in case Pip isn't on it at all: along the foot of the screen, apart from the words,
  // where to get it for what it runs (the site's installer beside this page there, or on a Mac the command for
  // Terminal, copied). On the computer's own address Pip is on it already.
  const [system] = useState(() => (!["127.0.0.1", "localhost"].includes(location.hostname) && isComputer() ? desktopSystem() : ""));
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  useEffect(() => {
    const check = () => { fetch("/api/me", { cache: "no-store" }).then((res) => { if (res.ok) location.reload(); }).catch(() => {}); };
    const timer = setInterval(check, OFFLINE_RETRY_MS);
    // Brought up after a while out of sight, when the browser lets its timer run only once a minute: at once.
    addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(timer); removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, []);
  useEffect(() => {
    if (phase !== "waiting" || !ready) return;
    const hop = document.querySelector("#boot .boot-pip .pip-bob")?.getAnimations()[0]?.currentTime;
    const at = typeof hop === "number" ? hop % HOP_MS : 0;
    const timer = setTimeout(() => setPhase("showing"), at > HOP_AIR[0] && at < HOP_AIR[1] ? HOP_AIR[1] - at : 0);
    return () => clearTimeout(timer);
  }, [phase, ready]);
  // In the same paint as this Pip shows, so the loading screen's and this one are never both or neither on screen; the
  // loading screen goes once the words are in and this page is opaque over it.
  useLayoutEffect(() => {
    if (phase === "settled" && fromBoot) document.getElementById("boot")?.remove();
    if (phase !== "showing") return;
    document.getElementById("boot")?.classList.add("to-offline");
    const timer = setTimeout(() => setPhase("settled"), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  return (
    <div className={`offline ${fromBoot ? "from-boot" : ""} ${phase}`} role="alertdialog" aria-modal="true" aria-labelledby="offline-title" aria-describedby="offline-text">
      <div className="offline-stage">
        <Pip mood={updating ? "work" : "worried"} className="offline-pip" />
        <div className="offline-words">
          <h1 id="offline-title">{t(updating ? "offline.updating.title" : "offline.title")}</h1>
          <div id="offline-text" className="offline-text">
            <p>{t(updating ? "offline.updating.text" : "offline.text")}</p>
            <p>{t("offline.then")}</p>
          </div>
          <p className="offline-wait" role="status">{t("offline.wait")}<Plugging /></p>
        </div>
      </div>
      {system && !updating && (
        <div className="offline-get">
          <span>{t(copied === "yes" ? "offline.macCopied" : "offline.none")}</span>
          {system === "mac"
            ? <button type="button" className="offline-get-go" onClick={() => copyText(macCommand()).then((ok) => setCopied(ok ? "yes" : "no"))}><GetIcon />{t("offline.macCopy")}</button>
            : <a className="offline-get-go" href="/PipSetup.exe" download><GetIcon />{t("offline.get")}</a>}
          {copied === "no" && <code dir="ltr">{macCommand()}</code>}
        </div>
      )}
      {/* As tall as the loading screen's paw prints, so Pip stands where he does there. */}
      <span className="offline-floor" aria-hidden="true" />
    </div>
  );
}

export function App() {
  const [s, setS] = useState<AppState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  // Whether the loading screen has gone. It shows only when the page opens, not after logging in or out.
  const [booted, setBooted] = useState(false);
  const [auth, setAuth] = useState<"unknown" | "in" | "out">("unknown");
  // No account on this computer yet: the login makes one (auth.ts).
  const [needsAccount, setNeedsAccount] = useState(false);
  // On the site, before a phone or a computer reaches a computer of its own: the site answers for it (site/server.ts).
  const [site, setSite] = useState<SiteInfo | null>(null);
  // The forest run plays when the page opens, not after a logout.
  const [intro, setIntro] = useState(true);
  // The login's board over everything while logged in, from the account menu (addAccount).
  const [adding, setAdding] = useState<"" | "join" | "create">("");
  const [[view, arg], setRoute] = useState(readRoute);
  const [lang, setLangState] = useState<Lang>(() => (LANGUAGES_ON && stored("lang") === "en" ? "en" : "he"));
  const [theme, setTheme] = useState(() => (THEMES_ON ? stored("theme") ?? "" : "light"));
  const [news, setNews] = useState<News>(null);
  const newsTimer = useRef<ReturnType<typeof setTimeout>>();
  const draft = useRef("");
  const prefersDark = useMemo(() => matchMedia("(prefers-color-scheme: dark)"), []);
  const [systemDark, setSystemDark] = useState(prefersDark.matches);
  // Whether the program has stopped answering: asked every few seconds, logged in or not, and known at once when any
  // call to it fails (kit.tsx's api says so); while it has, Offline covers everything. "boot" when it was so while the
  // loading screen still showed, which Offline then grows out of.
  const [offline, setOffline] = useState<false | "boot" | "later">(false);
  // Said by the program a few seconds before it goes to update itself (web/server.ts's /update): then its moment away
  // doesn't cover the page. Pip peeks out from behind the sidebar to say he is updating (PeekingPip), the page waits
  // and, once the new one answers, carries on as it was, logged in still (auth.ts keeps logins), with what was typed
  // and where it was, and Pip says he is updated before he goes back in. Only an update that takes longer than
  // UPDATE_QUIET_MS covers the page, Offline saying Pip is updating. As it asks, the page also says whether someone
  // used it lately (ACTIVE_MS), and an update waits till no one has for a while.
  const [update, setUpdate] = useState<Update>("");
  const updatingAt = useRef(0);
  const updatedTimer = useRef<ReturnType<typeof setTimeout>>();
  const usedAt = useRef(0);
  const authNow = useRef(auth);
  authNow.current = auth;
  useEffect(() => {
    const used = () => { usedAt.current = Date.now(); };
    const kinds = ["pointerdown", "keydown", "wheel", "touchstart"];
    for (const kind of kinds) addEventListener(kind, used, { capture: true, passive: true });
    const down = () => {
      if (updatingAt.current && Date.now() - updatingAt.current < UPDATE_QUIET_MS) return;
      setOffline((was) => was || (document.querySelector("#boot:not(.done)") ? "boot" : "later"));
    };
    addEventListener("pip-offline", down);
    const timer = setInterval(() => {
      api<{ updating?: boolean }>(Date.now() - usedAt.current < ACTIVE_MS ? "me?active=1" : "me").then((me) => {
        if (me.updating) {
          updatingAt.current ||= Date.now();
          clearTimeout(updatedTimer.current);
          setUpdate("updating");
        } else if (updatingAt.current) {
          // Back, updated: the state as it is now, and Pip says so for a moment.
          updatingAt.current = 0;
          setUpdate("updated");
          updatedTimer.current = setTimeout(() => setUpdate(""), UPDATED_MS);
          if (authNow.current === "in") refresh().catch(() => {});
        }
      }, () => {});
    }, 5000);
    return () => {
      for (const kind of kinds) removeEventListener(kind, used, { capture: true });
      removeEventListener("pip-offline", down);
      clearInterval(timer);
      clearTimeout(updatedTimer.current);
    };
  }, []);

  // The state as last taken, as text: the same again (as it mostly is, asked every five seconds) draws nothing anew,
  // which with a thousand jobs in it was the whole app drawn again for nothing.
  const lastState = useRef("");
  const refresh = useCallback(async () => {
    const next = await api<AppState>("state");
    const text = JSON.stringify(next);
    if (text !== lastState.current) {
      lastState.current = text;
      setS(next);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const done = () => setFontsReady(true);
    Promise.allSettled(FONTS.map((font) => document.fonts.load(font, "Pip פיפ"))).then(done);
    const timer = setTimeout(done, FONT_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = fontsReady && (auth === "out" || (auth === "in" && loaded));
  useEffect(() => {
    if (!ready || booted) return;
    const timer = setTimeout(() => {
      setBooted(true);
      // Grown out of by the offline screen, which takes its Pip over and then takes it away (Offline).
      if (document.querySelector(".offline.from-boot")) return;
      const boot = document.getElementById("boot");
      boot?.classList.add("done");
      setTimeout(() => boot?.remove(), 400);
    }, Math.max(0, BOOT_MIN_MS - performance.now()));
    return () => clearTimeout(timer);
  }, [ready, booted]);

  useEffect(() => {
    api<{ loggedIn: boolean; needsAccount: boolean; site?: boolean; download?: string; mac?: boolean }>("me").then((me) => {
      setNeedsAccount(me.needsAccount);
      setSite(me.site ? { download: me.download ?? "", mac: me.mac === true } : null);
      setAuth(me.loggedIn ? "in" : "out");
    }).catch(() => setAuth("out"));
    const onExpired = () => { setIntro(false); setAuth("out"); };
    addEventListener("pip-login-required", onExpired);
    const onScheme = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    prefersDark.addEventListener("change", onScheme);
    return () => { removeEventListener("pip-login-required", onExpired); prefersDark.removeEventListener("change", onScheme); };
  }, [prefersDark]);

  // The page from the address as it changes, by Back and Forward (popstate) or in the page (ROUTED: kit's goTo, and the
  // links below), with the state asked for afresh and the focus on the page's main part.
  useEffect(() => {
    if (auth !== "in") return;
    const onRoute = () => { setRoute(readRoute()); refresh().catch(() => {}); document.getElementById("main")?.focus({ preventScroll: true }); };
    addEventListener("popstate", onRoute);
    addEventListener(ROUTED, onRoute);
    refresh().catch(() => setLoaded(true));
    const timer = setInterval(() => refresh().catch(() => {}), 5000);
    return () => { removeEventListener("popstate", onRoute); removeEventListener(ROUTED, onRoute); clearInterval(timer); };
  }, [auth, refresh]);

  // A click on a link to one of the app's pages goes there in the page rather than loading it again; the browser's
  // own ways with a link stay as they were (a new tab or window, a download, another site, a file of the account's).
  // A link to the page already open does nothing, as before.
  useEffect(() => {
    const follow = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a?.href || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href);
      if (to.origin !== location.origin || to.hash || (to.pathname !== "/" && !PAGES.has(to.pathname.split("/")[1]))) return;
      e.preventDefault();
      if (to.pathname + to.search !== location.pathname + location.search) goTo(to.pathname + to.search);
    };
    document.addEventListener("click", follow);
    return () => document.removeEventListener("click", follow);
  }, []);

  // An address of the old kind (/#/jobs), set right once as the page opens.
  useLayoutEffect(() => { if (location.hash.startsWith("#/")) history.replaceState(null, "", pagePath(view, arg)); }, []);

  // The page an address may show, signed in and with the state in: the introduction while it is still to do; it again
  // only while the profile it builds isn't ready, as the home page sends you back to it then; and an address of no
  // page, the home page. Worked out as an address is arrived at (opened, followed or typed), and again when the
  // introduction comes to be still to do; not when it comes to be done, so it isn't left midway. The address is
  // changed to the page's in place where it is another, so Back doesn't lead to it. Signed out, the login covers
  // every address, and keeps it, to land there once in.
  const arrived = useRef("");
  useLayoutEffect(() => {
    if (auth !== "in" || !loaded) { arrived.current = ""; return; }
    const fresh = arrived.current !== view;
    arrived.current = view;
    const page = !s.intro?.done ? "welcome" : !fresh ? view : view === "welcome" ? (s.profileReady ? "dash" : "welcome") : PAGES.has(view) ? view : "dash";
    if (page === view) return;
    arrived.current = page;
    history.replaceState(null, "", pagePath(page));
    setRoute([page, undefined]);
  }, [auth, loaded, view, s.intro?.done]);

  // A language picked before logging in reaches the saved settings once they load.
  useEffect(() => {
    if (loaded && s.settings.language && s.settings.language !== lang) {
      api("settings", { ...s.settings, language: lang }).then((saved) => setS((cur) => ({ ...cur, settings: saved }))).catch(() => {});
    }
  }, [loaded]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const t = useCallback((key: string, params?: Record<string, string | number>) => translate(lang, key, params), [lang]);
  const waiting = s.sessions.filter((x) => x.status === "waiting").length;
  // A new user's introduction, until it is finished or put aside, and whenever the home page sends them back to it
  // (its address kept to it as it is arrived at, above).
  const welcome = auth === "in" && loaded && (view === "welcome" || !s.intro?.done);
  useEffect(() => { document.title = `${waiting ? `(${waiting}) ` : ""}${t("brand.name")} / ${t(`nav.${welcome ? "welcome" : view === "dash" ? "home" : view}`)}`; }, [waiting, view, welcome, t]);

  const dark = theme === "dark" || (!theme && systemDark);
  // A conversation begun, and the state brought in with it listed. Ranking the new jobs and the smart search, with
  // nothing more asked, are done by the server with the settings' AI (ranker.ts, scraper.ts), from whichever
  // button asks for them; with more after them they are Claude's commands.
  const begin = async (prompt: string, model?: string, access?: string, files?: string[]) => {
    const own = files?.length ? "" : ({ "/rank": "rank", "/job-scraper": "scrape" } as Record<string, string>)[prompt.trim()] ?? "";
    const session = own ? await api<{ id: string }>(own, {}) : await api<{ id: string }>("sessions", { prompt, model, access, files });
    await refresh();
    return session;
  };
  const ctx: Ctx = {
    s, loaded, refresh, shown: booted && loaded, lang, t, view, arg, news, update, draft, dark, theme,
    err: (e) => errorText(e as ApiError, lang),
    setTheme: (mode) => {
      setTheme(mode);
      store("theme", mode);
    },
    setLang: (l) => {
      setLangState(l);
      store("lang", l);
      // The agent and the daily email follow the same language, through the saved settings.
      if (loaded && s.settings.language !== l) api("settings", { ...s.settings, language: l }).then((saved) => setS((cur) => ({ ...cur, settings: saved }))).catch(() => {});
    },
    toggleTheme: () => {
      const next = dark ? "light" : "dark";
      setTheme(next);
      store("theme", next);
    },
    say: (text, mood = "wave", ms = 7000) => {
      clearTimeout(newsTimer.current);
      setNews({ text, mood });
      newsTimer.current = setTimeout(() => setNews(null), ms);
    },
    start: async (prompt, model, access, files) => {
      const session = await begin(prompt, model, access, files);
      goTo(`/chat/${session.id}`);
    },
    run: async (prompt) => { await begin(prompt); },
    logout: () => {
      // The state as last taken goes too, so the next login's, the same as it may be, is drawn.
      api("logout", {}).catch(() => {}).finally(() => { setIntro(false); setLoaded(false); lastState.current = ""; setS(EMPTY); setAuth("out"); });
    },
    addAccount: setAdding,
  };

  return (
    <AppContext.Provider value={ctx}>
      {/* Not under Offline, where its forest would run unseen and its field take the focus. */}
      {auth === "out" && booted && !offline && <Login intro={intro} create={needsAccount} site={site} onDone={() => { setNeedsAccount(false); setRoute(readRoute()); setAuth("in"); }} />}
      {/* The same board from the account menu, in place of the page until it opens the account or goes back. */}
      {auth === "in" && adding && !offline && <Login intro={false} create={adding === "create"} join={adding === "join"} onBack={() => setAdding("")} onDone={() => setAdding("")} />}
      {welcome && <div className={`welcome-wrap ${booted ? "entering" : "waiting"}`}><Welcome /></div>}
      {/* Laid out but hidden until the state is in too, so the first thing shown is the real page; then it fades in. */}
      {auth === "in" && !welcome && !adding && (
        <div className={`shell ${booted && loaded ? "entering" : "waiting"}`} aria-busy={!(booted && loaded)}>
          <Sidebar />
          <main id="main" tabIndex={-1}><Screen /></main>
          <PeekingPip />
        </div>
      )}
      {offline && <Offline fromBoot={offline === "boot"} ready={booted} updating={update === "updating"} />}
    </AppContext.Provider>
  );
}
