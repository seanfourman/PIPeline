// The frame: shared state, language, theme, the sidebar, Pip's notices, and which screen shows.
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { translate, type Lang } from "./i18n";
import { api, copyText, desktopSystem, errorText, Icon, isComputer, macCommand, type ApiError } from "./kit";
import { Pip, PipMark, type Mood } from "./pip";
import { Apps } from "./views/apps";
import { Chat } from "./views/chat";
import { Editor, Files, Profile, Rules, Tools } from "./views/docs";
import { Home, Sprite } from "./views/home";
import { Login, type SiteInfo } from "./login";
import { Jobs, SavedJobs } from "./views/jobs";
import { Portals } from "./views/portals";
import { Settings } from "./views/settings";
import { Welcome } from "./views/welcome";

export type AppState = {
  applications: Record<string, any>[]; jobs: Record<string, any>[]; files: { path: string; modified: number }[];
  // The jobs the user saved themselves (saved.ts), apart from jobs, which Pip's searches found.
  saved: { url: string; title: string; company: string; location: string; date: string; saved: string }[];
  // plain: chat only, answered by the settings' AI (agent.ts); engine: the name of the one that answered last.
  // agent: "codex" when ChatGPT works in it as an agent, through Codex (codex.ts).
  sessions: { id: string; title: string; status: string; createdAt: number; model?: string; access?: string; plain?: boolean; engine?: string; agent?: string }[];
  settings: Record<string, any>; presets: Record<string, { name: string; places: string[] }[]>; profileReady: boolean;
  // Whether a key for ChatGPT (openai) is saved (chatbots.ts); the keys never come here. aiLogins: whether it is
  // signed in with the account, through Codex (clis.ts).
  aiKeys: Record<string, boolean>;
  aiLogins?: Record<string, boolean>;
  // The account's name on this computer (auth.ts), and the introduction's state: whether it is done, the name
  // employers see (user/profile.json), and the documents it put in user/documents/ (server.ts).
  account?: string;
  intro?: { done: boolean; name: string; documents: { cv: string[]; linkedin: string[] } };
  // Phone access through the site (remote.ts): whether this computer is linked, where, as whom, and connected now.
  remote?: { linked: boolean; site: string; name: string; state: "off" | "connecting" | "on"; error: string };
  // The grade sheet kept from the settings, and whether it can be joined to a CV (transcript.ts).
  transcript?: { size: number; joinable: boolean } | null;
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
  // The same in the background: the conversation is made and listed, but the page stays where it is, and Pip
  // peeks out while it works (PeekingPip).
  run: (prompt: string) => Promise<void>;
  draft: React.MutableRefObject<string>;
  logout: () => void;
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
  ["dash", "home"], ["jobs", "jobs"], ["saved", "saved"], ["portals", "portals"], ["apps", "apps"], ["chat", "chat"],
  ["profile", "profile"], ["settings", "settings"], ["rules", "rules"], ["tools", "tools"], ["files", "files"],
];

// The sidebar. Language and theme live on the settings page; the foot is the account, with a button to log out.
function Sidebar() {
  const { s, t, view, logout } = useApp();
  const current = view === "cv" || view === "letter" ? "files" : view;
  const waiting = s.sessions.filter((x) => x.status === "waiting").length;
  const name = String(s.settings.displayName ?? "").trim() || s.account || "";
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

// The commands that run in the background once started there (run): the smart search.
const BACKGROUND = ["/job-scraper"];

// When a conversation waits for an answer, Pip waits for you at the bottom of the screen, peeking out from
// behind the sidebar (up from the screen's bottom on a phone, where the sidebar is a bar on top), quietly, with
// no "!", saying in a pixel speech bubble that it waits for your answer; a click opens that conversation, whose
// name is in its label for screen readers only. While a command runs in the background, he peeks out the same
// way, at work, saying what he is doing, and when it is done he says so in a notice. He slides out, leans out a
// little further now and then, and slides back in when nothing waits or works or the conversations page is open
// (kept while he goes). The pages' own Pips stay as they are.
function PeekingPip() {
  const { s, t, view, say } = useApp();
  // Not on the conversations page, where the conversations and what they wait for are in sight already.
  const waiting = s.sessions.find((x) => x.status === "waiting");
  const working = s.sessions.find((x) => x.status === "running" && BACKGROUND.includes(x.title));
  const now = view === "chat" ? undefined : waiting ?? working;
  const [kept, setKept] = useState<{ id: string; title: string; work: boolean } | null>(null);
  if (now && (kept?.id !== now.id || kept.title !== now.title || kept.work !== (now === working))) setKept({ id: now.id, title: now.title, work: now === working });
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
      if (!BACKGROUND.includes(x.title)) continue;
      if (x.status === "running") seen.current.add(x.id);
      else if ((x.status === "idle" || x.status === "error") && seen.current.delete(x.id)) {
        say(t(x.status === "idle" ? "pip.workDone" : "pip.workStopped"), x.status === "idle" ? "happy" : "worried");
      }
    }
  }, [s.sessions]);
  if (!kept) return null;
  const says = t(kept.work ? "pip.peekWork" : "pip.peek");
  return (
    <a className={`peek ${leaving ? "leaving" : ""}`} href={`#/chat/${kept.id}`} aria-label={`${says} ${t("pip.peekIn")} ${friendlyTitle(kept.title, t)}`}>
      <Pip className="peek-pip" mood={kept.work ? "work" : undefined} />
      <span className="peek-say">
        <span className="peek-edge"><span className="peek-words">{says}</span></span>
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
    case "portals": return <Portals />;
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

// The program stopped with its page open (its icon's Quit, the computer turned off, or from a phone the computer
// unreachable): the whole page waits under the loading screen's own layout, Pip worried where he hops there, at his
// size there, and under him, where the paw prints were, what happened and how to bring it back, rising in softly line
// after line, and a plug inching to its socket while it waits. It asks every few seconds, and once the program answers
// the page loads afresh, the way it was left.
// Found so while the loading screen still shows (fromBoot), it doesn't fade in over it but grows out of it: once the
// loading screen has had its time (ready, the page's booted) and its Pip is on the ground between two hops, he stays
// there, worried, the paw prints fade under him, and the words rise in (from-boot in styles.css).
const OFFLINE_RETRY_MS = 2500;
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

function Plugging() {
  return (
    <span className="offline-plug" aria-hidden="true">
      <Sprite className="offline-socket" rows={SOCKET} colors={{ O: PLUG_INK, w: "#fffaf0" }} />
      <Sprite className="offline-spark" rows={SPARK} colors={{ X: PLUG_AMBER }} />
      <Sprite className="offline-plugged" rows={PLUG} colors={{ O: PLUG_INK, y: PLUG_AMBER, c: PLUG_INK, m: "#9aa0a8" }} />
    </span>
  );
}

function Offline({ fromBoot, ready }: { fromBoot: boolean; ready: boolean }) {
  const { t } = useApp();
  const [phase, setPhase] = useState<"waiting" | "showing" | "settled">(fromBoot ? "waiting" : "settled");
  // On the site from a computer, in case Pip isn't on it at all: where to get it, for what it runs (the site's
  // installer beside this page there, or on a Mac the command for Terminal, copied). On the computer's own address Pip
  // is on it already.
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
        <Pip mood="worried" className="offline-pip" />
        <div className="offline-words">
          <h1 id="offline-title">{t("offline.title")}</h1>
          <div id="offline-text" className="offline-text">
            <p>{t("offline.text")}</p>
            <p>{t("offline.then")}</p>
          </div>
          <p className="offline-wait" role="status">{t("offline.wait")}<Plugging /></p>
          {system && (
            <p className="offline-get">
              {t("offline.none")}{" "}
              {system === "mac"
                ? <button type="button" onClick={() => copyText(macCommand()).then((ok) => setCopied(ok ? "yes" : "no"))}>{t(copied === "yes" ? "offline.macCopied" : "offline.macCopy")}</button>
                : <a href="/PipSetup.exe" download>{t("offline.get")}</a>}
              {copied === "no" && <code dir="ltr">{macCommand()}</code>}
            </p>
          )}
        </div>
      </div>
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
  const [[view, arg], setRoute] = useState(readHash);
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
  useEffect(() => {
    const down = () => setOffline((was) => was || (document.querySelector("#boot:not(.done)") ? "boot" : "later"));
    addEventListener("pip-offline", down);
    const timer = setInterval(() => { api("me").catch(() => {}); }, 5000);
    return () => { removeEventListener("pip-offline", down); clearInterval(timer); };
  }, []);

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
  // A new user's introduction, until it is finished or put aside, and whenever the home page sends them back to it.
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
    start: async (prompt, model, access, files) => {
      const session = await begin(prompt, model, access, files);
      location.hash = `#/chat/${session.id}`;
    },
    run: async (prompt) => { await begin(prompt); },
    logout: () => {
      api("logout", {}).catch(() => {}).finally(() => { setIntro(false); setLoaded(false); setS(EMPTY); setAuth("out"); });
    },
  };

  return (
    <AppContext.Provider value={ctx}>
      {/* Not under Offline, where its forest would run unseen and its field take the focus. */}
      {auth === "out" && booted && !offline && <Login intro={intro} create={needsAccount} site={site} onDone={() => { setNeedsAccount(false); setRoute(readHash()); setAuth("in"); }} />}
      {welcome && <div className={`welcome-wrap ${booted ? "entering" : "waiting"}`}><Welcome /></div>}
      {/* Laid out but hidden until the state is in too, so the first thing shown is the real page; then it fades in. */}
      {auth === "in" && !welcome && (
        <div className={`shell ${booted && loaded ? "entering" : "waiting"}`} aria-busy={!(booted && loaded)}>
          <Sidebar />
          <main id="main" tabIndex={-1}><Screen /></main>
          <PeekingPip />
          <Toast />
        </div>
      )}
      {offline && <Offline fromBoot={offline === "boot"} ready={booted} />}
    </AppContext.Provider>
  );
}
