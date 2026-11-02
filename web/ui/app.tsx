// The frame: shared state, language, theme, the sidebar with Pip, and which screen shows.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { translate, type Lang } from "./i18n";
import { api, errorText, Icon, type ApiError } from "./kit";
import { Pip, type Mood } from "./pip";
import { Apps } from "./views/apps";
import { Chat } from "./views/chat";
import { Editor, Files, Profile, Rules, Tools } from "./views/docs";
import { Home } from "./views/home";
import { Login } from "./login";
import { Jobs } from "./views/jobs";
import { Settings } from "./views/settings";

export type AppState = {
  applications: Record<string, any>[]; jobs: Record<string, any>[]; files: { path: string; modified: number }[];
  sessions: { id: string; title: string; status: string; createdAt: number }[];
  settings: Record<string, any>; presets: Record<string, { name: string; places: string[] }[]>; profileReady: boolean;
};

type News = { text: string; mood: Mood } | null;
type Ctx = {
  s: AppState; loaded: boolean; refresh: () => Promise<void>;
  lang: Lang; setLang: (l: Lang) => void; t: (key: string, params?: Record<string, string | number>) => any; err: (e: unknown) => string;
  dark: boolean; toggleTheme: () => void;
  view: string; arg?: string;
  say: (text: string, mood?: Mood, ms?: number) => void; news: News;
  start: (prompt: string, model?: string) => Promise<void>;
  draft: React.MutableRefObject<string>;
  logout: () => void;
};

const AppContext = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppContext);

const EMPTY: AppState = { applications: [], jobs: [], files: [], sessions: [], settings: { markets: [], areas: [], roles: [], automation: {} }, presets: {}, profileReady: true };

// Browser storage only remembers small conveniences, and the page works without it.
const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* unavailable */ } };

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

const NAV: [string | null, [string, string][]][] = [
  [null, [["dash", "home"], ["jobs", "jobs"], ["apps", "apps"], ["chat", "chat"]]],
  ["you", [["profile", "profile"], ["settings", "settings"]]],
  ["advanced", [["rules", "rules"], ["tools", "tools"], ["files", "files"]]],
];

function Sidebar() {
  const { s, t, view, lang, setLang, dark, toggleTheme, logout } = useApp();
  const current = view === "cv" || view === "letter" ? "files" : view;
  const waiting = s.sessions.filter((x) => x.status === "waiting").length;
  return (
    <nav className="side" aria-label={t("nav.main")}>
      <a className="brand" href="#/dash">
        <Pip mood="idle" className="brand-pip" />
        <span className="brand-text"><strong>{t("brand.name")}</strong><small>{t("brand.tagline")}</small></span>
      </a>
      <div className="nav">
        {NAV.map(([group, items]) => (
          <React.Fragment key={group ?? "main"}>
            {group && <div className="nav-group">{t(`nav.${group}`)}</div>}
            {items.map(([id, icon]) => (
              <a key={id} href={`#/${id}`} aria-current={current === id ? "page" : undefined}>
                <Icon name={icon} /><span>{t(`nav.${id === "dash" ? "home" : id}`)}</span>
                {id === "chat" && waiting > 0 && <span className="count" aria-label={t("nav.waiting", { n: waiting })}>{waiting}</span>}
              </a>
            ))}
          </React.Fragment>
        ))}
      </div>
      <PipDock />
      <div className="side-foot">
        <div className="lang" role="group" aria-label={t("nav.language")}>
          <button type="button" aria-pressed={lang === "he"} onClick={() => setLang("he")}>עברית</button>
          <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
        </div>
        <button type="button" className="theme" onClick={toggleTheme} aria-label={dark ? t("nav.light") : t("nav.dark")} title={dark ? t("nav.light") : t("nav.dark")}>
          <Icon name={dark ? "sun" : "moon"} />
        </button>
        <button type="button" className="theme" onClick={logout} aria-label={t("login.logout")} title={t("login.logout")}>
          <Icon name="logout" />
        </button>
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

function PipDock() {
  const { s, t, view, news, say } = useApp();
  if (view === "dash") return <div className="pip-dock" />;
  const line = news ? { ...news, news: true } : companionLine(s, view, t);
  const hello = t("pip.hello") as string[];
  return (
    <div className={`pip-dock ${line.news ? "has-news" : ""}`}>
      {line.text && (
        <div className="bubble" role="status" dir="auto">
          {line.text}
          {"href" in line && line.href && !location.hash.startsWith(line.href) && <a href={line.href}>{line.action}</a>}
        </div>
      )}
      <button type="button" className="pip-button" aria-label={t("pip.name")} onClick={() => say(hello[Math.floor(Math.random() * hello.length)], "wave", 4000)}>
        <Pip mood={line.mood} />
      </button>
    </div>
  );
}

function Screen() {
  const { view, arg, s } = useApp();
  switch (view) {
    case "jobs": return <Jobs tab={arg} />;
    case "apps": return <Apps />;
    case "chat": return <Chat id={arg ?? s.sessions[0]?.id ?? "new"} />;
    case "tools": return <Tools />;
    case "profile": return <Profile />;
    case "rules": return <Rules />;
    case "files": return <Files />;
    case "settings": return <Settings />;
    case "cv": case "letter": return <Editor key={`${view}/${arg}`} kind={view} name={arg ?? ""} />;
    default: return <Home />;
  }
}

export function App() {
  const [s, setS] = useState<AppState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [auth, setAuth] = useState<"unknown" | "in" | "out">("unknown");
  // The forest run plays when the page opens, not after a logout.
  const [intro, setIntro] = useState(true);
  const [[view, arg], setRoute] = useState(readHash);
  const [lang, setLangState] = useState<Lang>(() => (stored("lang") === "en" ? "en" : "he"));
  const [theme, setTheme] = useState(() => stored("theme") ?? "");
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
  useEffect(() => { document.title = `${waiting ? `(${waiting}) ` : ""}${t("brand.name")} · ${t(`nav.${view === "dash" ? "home" : view}`)}`; }, [waiting, view, t]);

  const dark = theme === "dark" || (!theme && systemDark);
  const ctx: Ctx = {
    s, loaded, refresh, lang, t, view, arg, news, draft, dark,
    err: (e) => errorText(e as ApiError, lang),
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
    start: async (prompt, model) => {
      const session = await api("sessions", { prompt, model });
      await refresh();
      location.hash = `#/chat/${session.id}`;
    },
    logout: () => {
      api("logout", {}).catch(() => {}).finally(() => { setIntro(false); setLoaded(false); setS(EMPTY); setAuth("out"); });
    },
  };

  return (
    <AppContext.Provider value={ctx}>
      {auth === "out" && <Login intro={intro} onDone={() => { setRoute(readHash()); setAuth("in"); }} />}
      {auth === "in" && (
        <div className="shell entering">
          <Sidebar />
          <main id="main" tabIndex={-1}><Screen /></main>
        </div>
      )}
    </AppContext.Provider>
  );
}
