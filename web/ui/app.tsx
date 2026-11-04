// The frame: shared state, language, theme, the sidebar, Pip's notices, and which screen shows.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { translate, type Lang } from "./i18n";
import { api, errorText, Icon, type ApiError } from "./kit";
import { Pip, PipMark, type Mood } from "./pip";
import { Apps } from "./views/apps";
import { Chat } from "./views/chat";
import { Editor, Files, Profile, Rules, Tools } from "./views/docs";
import { Home } from "./views/home";
import { Login } from "./login";
import { Jobs, SavedJobs } from "./views/jobs";
import { Settings } from "./views/settings";

export type AppState = {
  applications: Record<string, any>[]; jobs: Record<string, any>[]; files: { path: string; modified: number }[];
  // plain: chat only, answered by the settings' AI (agent.ts); engine: the name of the one that answered last.
  // agent: "codex" when ChatGPT works in it as an agent, through Codex (codex.ts).
  sessions: { id: string; title: string; status: string; createdAt: number; model?: string; access?: string; plain?: boolean; engine?: string; agent?: string }[];
  settings: Record<string, any>; presets: Record<string, { name: string; places: string[] }[]>; profileReady: boolean;
  // Whether a key for ChatGPT (openai) is saved (chatbots.ts); the keys never come here. aiLogins: whether it is
  // signed in with the account, through Codex (clis.ts).
  aiKeys: Record<string, boolean>;
  aiLogins?: Record<string, boolean>;
};

type News = { text: string; mood: Mood } | null;
type Ctx = {
  s: AppState; loaded: boolean; refresh: () => Promise<void>;
  // Whether the page is on screen: the loading screen gone and the state in.
  shown: boolean;
  lang: Lang; setLang: (l: Lang) => void; t: (key: string, params?: Record<string, string | number>) => any; err: (e: unknown) => string;
  // theme is "light", "dark", or "" to follow the computer.
  dark: boolean; toggleTheme: () => void; theme: string; setTheme: (mode: string) => void;
  view: string; arg?: string;
  say: (text: string, mood?: Mood, ms?: number) => void; news: News;
  // access is how much the conversation may do without asking (policy.ts); left out, it asks. files are the ids
  // of uploads attached to the first message (uploads.ts).
  start: (prompt: string, model?: string, access?: string, files?: string[]) => Promise<void>;
  draft: React.MutableRefObject<string>;
  logout: () => void;
};

const AppContext = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppContext);

const EMPTY: AppState = { applications: [], jobs: [], files: [], sessions: [], settings: { markets: [], areas: [], roles: [], automation: {} }, presets: {}, profileReady: true, aiKeys: {} };

// Browser storage only remembers small conveniences, and the page works without it.
export const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* unavailable */ } };

// For now the site is in Hebrew and the light theme only: the English version and the dark theme are off until
// they are ready, their buttons on the settings screen marked coming soon and those on the login hidden. true
// brings each back, with the one picked before; public/boot.js has the same two.
export const LANGUAGES_ON = false;
export const THEMES_ON = false;

function readHash(): [string, string | undefined] {
  const [view = "dash", arg] = location.hash.slice(2).split("/");
  return [view || "dash", arg ? decodeURIComponent(arg) : undefined];
}

export const COMMANDS: { group: string; items: { id: string; arg?: boolean; danger?: boolean }[] }[] = [
  { group: "daily", items: [{ id: "job-scraper" }, { id: "rank" }, { id: "apply", arg: true }, { id: "interview", arg: true }, { id: "outcome", arg: true }] },
  { group: "growth", items: [{ id: "upskill", arg: true }, { id: "expand" }, { id: "html-report" }] },
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

// One flat list, like a social site's sidebar; the order still runs from daily use to the advanced pages.
const NAV: [string, string][] = [
  ["dash", "home"], ["jobs", "jobs"], ["saved", "saved"], ["apps", "apps"], ["chat", "chat"],
  ["profile", "profile"], ["settings", "settings"], ["rules", "rules"], ["tools", "tools"], ["files", "files"],
];

// The sidebar. Language and theme live on the settings page; the foot is the account, with a button to log out.
function Sidebar() {
  const { s, t, view, logout } = useApp();
  const current = view === "cv" || view === "letter" ? "files" : view;
  const waiting = s.sessions.filter((x) => x.status === "waiting").length;
  const name = String(s.settings.displayName ?? "").trim() || "admin";
  return (
    <nav className="side" aria-label={t("nav.main")}>
      <a className="brand" href="#/dash" aria-label={t("brand.name")}><PipMark /></a>
      <div className="nav">
        {NAV.map(([id, icon]) => (
          <a key={id} href={`#/${id}`} aria-current={current === id ? "page" : undefined}>
            <span className="nav-icon">
              <Icon name={icon} filled={current === id} />
              {id === "chat" && waiting > 0 && <span className="count" aria-label={t("nav.waiting", { n: waiting })}>{waiting}</span>}
            </span>
            <span className="nav-label">{t(`nav.${id === "dash" ? "home" : id}`)}</span>
          </a>
        ))}
      </div>
      <a className="btn post" href="#/chat/new" aria-label={t("chat.new")}><Icon name="plus" /><span>{t("chat.new")}</span></a>
      <div className="account">
        <span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <span className="account-name ellipsis">{name}</span>
        <button type="button" className="account-out" onClick={logout} aria-label={t("login.logout")}><Icon name="logout" /></button>
      </div>
    </nav>
  );
}

export function companionLine(s: AppState, view: string, t: Ctx["t"]): { text: string; mood: Mood; href?: string; action?: string; news?: boolean } {
  const waiting = s.sessions.find((x) => x.status === "waiting");
  const running = s.sessions.find((x) => x.status === "running");
  if (waiting) return { text: t("pip.waiting"), mood: "ask", href: `#/chat/${waiting.id}`, action: t("pip.toChat"), news: true };
  if (running) return { text: t("pip.running"), mood: "work", href: `#/chat/${running.id}`, action: t("pip.watch") };
  const line = t(`pip.views.${view}`);
  return { text: typeof line === "string" && !line.startsWith("pip.") ? line : "", mood: "idle" };
}

// What Pip says after something you did (saved, built, a status changed), in a small notice at the bottom of
// the screen that goes away on its own.
function Toast() {
  const { news } = useApp();
  if (!news) return null;
  return (
    <div className="toast" role="status" dir="auto">
      <Pip mood={news.mood} className="toast-pip" />
      <span>{news.text}</span>
    </div>
  );
}

// How long Pip takes to slide back behind the sidebar; matches peek-in in styles.css.
const PEEK_IN_MS = 420;

// When a conversation waits for an answer, Pip waits for you at the bottom of the screen, peeking out from
// behind the sidebar (up from the screen's bottom on a phone, where the sidebar is a bar on top), quietly, with
// no "!", saying in a pixel speech bubble that it waits for your answer; a click opens that conversation, whose
// name is in its label for screen readers only. It slides out, leans out a little further now and then, and
// slides back in when nothing waits or the conversations page is open (kept while it goes). The pages' own Pips
// stay as they are.
function PeekingPip() {
  const { s, t, view } = useApp();
  // Not on the conversations page, where the conversations and what they wait for are in sight already.
  const waiting = s.sessions.find((x) => x.status === "waiting");
  const id = waiting && view !== "chat" ? waiting.id : "";
  const [kept, setKept] = useState(id);
  const [title, setTitle] = useState("");
  if (id && id !== kept) setKept(id);
  if (waiting && id && waiting.title !== title) setTitle(waiting.title);
  const leaving = !id && !!kept;
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setKept(""), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : PEEK_IN_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  if (!kept) return null;
  return (
    <a className={`peek ${leaving ? "leaving" : ""}`} href={`#/chat/${kept}`} aria-label={`${t("pip.peek")} ${t("pip.peekIn")} ${friendlyTitle(title, t)}`}>
      <Pip className="peek-pip" />
      <span className="peek-say">
        <span className="peek-edge"><span className="peek-words">{t("pip.peek")}</span></span>
        <SpeechTail />
      </span>
    </a>
  );
}

// The speech bubble's tail, in the bubble's pixels: its outline (k) and fill (w) on a grid of 3-pixel cells,
// its top row over the bubble's bottom edge so the edge opens into it, the tip down at the start side, by Pip.
const TAIL = ["kwwwwk", ".kwwwk", "..kwwk", "...kwk", "....kk"];
function SpeechTail() {
  return (
    <svg className="peek-tail" viewBox="0 0 6 5" shapeRendering="crispEdges" aria-hidden="true">
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
    case "apps": return <Apps />;
    case "chat": return <Chat id={arg ?? (lastChat || "new")} />;
    case "tools": return <Tools />;
    case "profile": return <Profile />;
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

export function App() {
  const [s, setS] = useState<AppState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  // Whether the loading screen has gone. It shows only when the page opens, not after logging in or out.
  const [booted, setBooted] = useState(false);
  const [auth, setAuth] = useState<"unknown" | "in" | "out">("unknown");
  // The forest run plays when the page opens, not after a logout.
  const [intro, setIntro] = useState(true);
  const [[view, arg], setRoute] = useState(readHash);
  const [lang, setLangState] = useState<Lang>(() => (LANGUAGES_ON && stored("lang") === "en" ? "en" : "he"));
  const [theme, setTheme] = useState(() => (THEMES_ON ? stored("theme") ?? "" : "light"));
  const [news, setNews] = useState<News>(null);
  const newsTimer = useRef<ReturnType<typeof setTimeout>>();
  const draft = useRef("");
  const prefersDark = useMemo(() => matchMedia("(prefers-color-scheme: dark)"), []);
  const [systemDark, setSystemDark] = useState(prefersDark.matches);

  const refresh = useCallback(async () => {
    const next = await api<AppState>("state");
    setS(next);
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
      const boot = document.getElementById("boot");
      boot?.classList.add("done");
      setTimeout(() => boot?.remove(), 400);
    }, Math.max(0, BOOT_MIN_MS - performance.now()));
    return () => clearTimeout(timer);
  }, [ready, booted]);

  useEffect(() => {
    api<{ loggedIn: boolean }>("me").then((me) => setAuth(me.loggedIn ? "in" : "out")).catch(() => setAuth("out"));
    const onExpired = () => { setIntro(false); setAuth("out"); };
    addEventListener("pip-login-required", onExpired);
    const onScheme = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    prefersDark.addEventListener("change", onScheme);
    return () => { removeEventListener("pip-login-required", onExpired); prefersDark.removeEventListener("change", onScheme); };
  }, [prefersDark]);

  useEffect(() => {
    if (auth !== "in") return;
    const onHash = () => { setRoute(readHash()); refresh().catch(() => {}); document.getElementById("main")?.focus({ preventScroll: true }); };
    addEventListener("hashchange", onHash);
    refresh().catch(() => setLoaded(true));
    const timer = setInterval(() => refresh().catch(() => {}), 5000);
    return () => { removeEventListener("hashchange", onHash); clearInterval(timer); };
  }, [auth, refresh]);

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
  useEffect(() => { document.title = `${waiting ? `(${waiting}) ` : ""}${t("brand.name")} / ${t(`nav.${view === "dash" ? "home" : view}`)}`; }, [waiting, view, t]);

  const dark = theme === "dark" || (!theme && systemDark);
  const ctx: Ctx = {
    s, loaded, refresh, shown: booted && loaded, lang, t, view, arg, news, draft, dark, theme,
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
    // Ranking the new jobs and the smart search, with nothing more asked, are done by the server with the
    // settings' AI (ranker.ts, scraper.ts), from whichever button asks for them; with more after them they are
    // Claude's commands.
    start: async (prompt, model, access, files) => {
      const own = files?.length ? "" : ({ "/rank": "rank", "/job-scraper": "scrape" } as Record<string, string>)[prompt.trim()] ?? "";
      const session = own ? await api(own, {}) : await api("sessions", { prompt, model, access, files });
      await refresh();
      location.hash = `#/chat/${session.id}`;
    },
    logout: () => {
      api("logout", {}).catch(() => {}).finally(() => { setIntro(false); setLoaded(false); setS(EMPTY); setAuth("out"); });
    },
  };

  return (
    <AppContext.Provider value={ctx}>
      {auth === "out" && booted && <Login intro={intro} onDone={() => { setRoute(readHash()); setAuth("in"); }} />}
      {/* Laid out but hidden until the state is in too, so the first thing shown is the real page; then it fades in. */}
      {auth === "in" && (
        <div className={`shell ${booted && loaded ? "entering" : "waiting"}`} aria-busy={!(booted && loaded)}>
          <Sidebar />
          <main id="main" tabIndex={-1}><Screen /></main>
          <PeekingPip />
          <Toast />
        </div>
      )}
    </AppContext.Provider>
  );
}
