// Local web interface for the job-search workspace. Listens on this computer only.
// First, so the user's folder is in place before any module below reads it.
import "./switching";
import "./upgrade";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSession, createTaskSession, getSession, isAccess, listSessions, runTask, runUnattended } from "./agent";
import { AccountError, clearedCookie, createAuth, openedByHand, rememberedCookie, rememberedOf, sessionCookie, sessionOf } from "./auth";
import { buildInterface, watchInterface } from "./build";
import { createAutomation, mailWords, readMailAccount, saveMailAccount, sendMail } from "./automation";
import { askInOrder, ENGINE_NAMES, engineOrder } from "./ai";
import { ChatbotError, checkKey, keyStatus, PROVIDERS, saveKey as saveAiKey, type Provider } from "./chatbots";
import { cliSignedIn, cliStatus, openLogin } from "./clis";
import { accountFile, computerId, findLocal, localAccounts, readAccount, requestSwitch, USERS_DIR, type AccountFile, type LocalAccount } from "./accounts";
import { foundPortals } from "./discover";
import { answerFile, answerManifest, syncAccount } from "./sync";
import { deriveKey, loadKey, openWith, saveKey, sealWith } from "./synckey";
import { INDUSTRIES, PORTALS } from "./portals";
import { rankJobs, type Steps } from "./ranker";
import { readPortalChecks, scanPortals, scrapeJobs } from "./scraper";
import { applyJob } from "./applier";
import { conversationFiles, loadState, resolveDocument, searchJobs } from "./data";
import { atsTerms, buildSource, EditError, isSourceKind, listEditableFiles, listSources, readChecks, readDocument, readEditableFile, readSource, saveChecks, saveDocument, saveEditableFile, saveSource, setApplicationStatus } from "./edit";
import { REPO } from "./policy";
import { createRemote, RemoteError } from "./remote";
import { byteRange, MEDIA_TYPES, mediaFile, PORTFOLIO_DIR, readPortfolio } from "./portfolio";
import { readSaved, setSaved } from "./saved";
import { loadSettings, REGION_PRESETS, saveSettings, syncWorkspace } from "./settings";
import { joinWithTranscript, removeTranscript, saveTranscript, TRANSCRIPT, TranscriptError, transcriptInfo } from "./transcript";
import { getUpload, saveUpload, UploadError } from "./uploads";
import { nameProblem } from "./ui/account-rules";
import { APP_DIR, cvFileName, listUserDocuments, profileReady, saveUserDocument, saveUserName, USER_DIR, UserFileError, userProfile } from "./user";

const PORT = Number(process.env.JOB_WEB_PORT ?? 4174);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const PUBLIC = path.join(import.meta.dir, "public");
const TOKEN_FILE = path.join(APP_DIR, "token");

await buildInterface(path.join(PUBLIC, "build"));
watchInterface(path.join(PUBLIC, "build"));
// Whether Claude and ChatGPT are signed in, known before the first conversation asks.
cliStatus().catch(() => {});
// The settings' block in the agent's files written afresh as the server starts (settings.ts), so what a new version
// changed in it, such as the sites the daily run searches the web on, reaches the agent without the settings saved
// again.
if (existsSync(path.join(APP_DIR, "settings.json"))) syncWorkspace(loadSettings(), REPO);

mkdirSync(APP_DIR, { recursive: true });
if (!existsSync(TOKEN_FILE)) writeFileSync(TOKEN_FILE, crypto.randomUUID().replaceAll("-", ""));
const TOKEN = readFileSync(TOKEN_FILE, "utf8").trim();
const START_URL = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;
// The site (remote.ts). PIP_SITE is its address: an installed Pip, which the launcher gives it to, pairs with it as
// soon as it starts and opens there; one run from the repository only offers it in the settings.
const remote = createRemote({
  handle, port: PORT, localToken: TOKEN, defaultSite: process.env.PIP_SITE ?? "", pairWith: process.env.PIP_SITE ?? "", accountName: () => auth.user(),
});

// Where to open Pip in the browser: straight on its site by a one-time code when linked to one that answers in time
// (remote.ts), or else here, on the start link; and whether a page of it is open on this computer already, so that no
// second one opens. A page asks every few seconds (/api/me, /api/state), but one out of sight for a while only once a
// minute: here it is seen by the server (pageSeen), and on the site by the site.
const PAGE_SEEN_MS = 75_000;
let pageSeen = 0;
const openPlan = async () => {
  const away = await remote.openUrl().catch(() => null);
  return { url: away?.url ?? START_URL, already: Date.now() - pageSeen < PAGE_SEEN_MS || Boolean(away?.open) };
};
// The default browser on a link: Windows' start, a Mac's open, or the desktop's own elsewhere.
const openInBrowser = (url: string) => {
  const command = process.platform === "win32" ? ["cmd", "/c", "start", "", url] : [process.platform === "darwin" ? "open" : "xdg-open", url];
  try { Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }); } catch { /* no browser to open it in */ }
};
const openBrowser = async () => {
  const plan = await openPlan();
  console.log(plan.already ? "Pip is open in the browser already." : `Opening it ${plan.url === START_URL ? "here" : "on the site"}.`);
  if (!plan.already) openInBrowser(plan.url);
};

// Updates, asked about with the server's key by what updates an installed Pip from its site (installer/launcher.cs, a
// Mac's update.sh) before it does: whether Pip is in the middle of something an update would cut short (a conversation
// running or waiting for an answer, the daily run, a search or a ranking) or someone used a page of it lately (a page
// says so as it asks, /api/me?active=1), so that an update comes while no one is looking; and, posted, that it is
// about to update, which the page asks about (/api/me), to wait quietly while Pip is away.
const UPDATING_MS = 5 * 60_000;
const IDLE_MS = 5 * 60_000;
let updatingSince = 0;
let usedAt = 0;
const busyNow = () => Date.now() - usedAt < IDLE_MS || listBusy !== "" || automation.isRunning() || listSessions().some((x) => x.status === "running" || x.status === "waiting");

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...SECURITY_HEADERS, "Content-Type": "application/json" } });

// The AI the settings put first, the next connected one taking over from one that fails, each switch shown in the
// conversation's steps.
const askFor = (steps: Steps & { switched: (from: string, to: string, code: string) => void }) => {
  const order = engineOrder(loadSettings().aiPrimary);
  return (system: string, prompt: string, stop: AbortSignal) => askInOrder(order, system, [{ role: "user", text: prompt }], {
    signal: stop, onSwitch: (from, to, err) => steps.switched(ENGINE_NAMES[from], ENGINE_NAMES[to], err.code),
  }).then((r) => ({ text: r.text, by: ENGINE_NAMES[r.engine] }));
};
const language = () => (loadSettings().language === "en" ? "en" as const : "he" as const);

const automation = createAutomation({
  loadSettings, loadState, runSession: runUnattended, sendMail: (mail) => sendMail(mail), computer: computerId(),
  // The daily run's portals check: the employers and the Israeli boards, which the run's agent doesn't search. An
  // employer that had nothing at its last check rests three days (scraper.ts).
  scanPortals: (title, timeout) => runTask(title, (steps, signal) => scanPortals({ steps, signal, lang: language(), ask: askFor(steps), boards: true, rest: 3, discover: true }), timeout),
});
// Only the address leaves the server. The password is written once and never read back.
const automationStatus = () => ({ running: automation.isRunning(), runs: automation.runs(), next: automation.next(), mailUser: readMailAccount()?.user ?? "" });

const auth = createAuth();
// The server's own run on the job list going now, "rank" or "scrape", or "" for none.
let listBusy = "";

const loggedIn = (id: string) => new Response(JSON.stringify({ ok: true }), { headers: { ...SECURITY_HEADERS, "Content-Type": "application/json", "Set-Cookie": sessionCookie(id) } });

// ---------- the accounts: several on this computer, and each on several computers (accounts.ts, sync.ts) ----------

const COMPUTER = computerId();
// Starts Pip again, to open another account: the server stops with RESTART, and the launcher starts it again
// (installer/launcher.cs), as launchd does on a Mac on any stop that isn't clean. Run by hand, it has to be started again
// by hand (a server it started itself would go with it on Windows).
const RESTART = 75;
function restart() {
  setTimeout(() => {
    remote.stop();
    if (process.env.PIP_LAUNCHER !== "1" && process.env.XPC_SERVICE_NAME !== "com.pip.server") console.log("Stopped to open another account: start Pip again to open it.");
    process.exit(RESTART);
  }, 300);
}
// Something a restart would cut short: a conversation, a search, a ranking or the daily run at work.
const working = () => listBusy !== "" || automation.isRunning() || listSessions().some((x) => x.status === "running");
// Logins to other accounts that failed, within a quarter of an hour; past ten, no more tries for a while.
let accountFails: number[] = [];
const accountTries = () => (accountFails = accountFails.filter((t) => Date.now() - t < 15 * 60_000)).length;

// Opens another account on this computer with its password: checked, and a login made in its own folder (switchTo).
async function openLocal(req: Request, other: LocalAccount, password: unknown): Promise<Response> {
  const session = await createAuth(accountFile(other.dir)).login(other.name, password);
  if (!session) {
    accountFails.push(Date.now());
    await Bun.sleep(400);
    return json({ error: "bad_login" }, 401);
  }
  return switchTo(req, other, session);
}

// Opens another account on this computer in place of the open one, by a login of its own: one just made with its
// password, or one this browser has already (rememberedOf). The browser takes the login along and keeps the open
// account's own with the others it remembers, so going back takes no password either; the key the browser and the
// launcher open this server with is kept in the account's folder too (each account's folder has one, user/app/token),
// and Pip starts again with it.
function switchTo(req: Request, other: LocalAccount, session: string): Response {
  if (working()) return json({ error: "account_busy" }, 409);
  writeFileSync(path.join(other.dir, "app", "token"), TOKEN);
  requestSwitch(other.id);
  restart();
  const cookies = [sessionCookie(session)];
  // Not through the site, which passes on only the login itself (remote.ts).
  if (req.headers.get("x-pip-relayed") !== "1") cookies.push(rememberedCookie(remembering(req, other.id)));
  return withCookies({ ok: true, switching: other.name }, 200, cookies);
}

// The logins this browser keeps to the other accounts once the account `next` is open: the open account's own among
// them while it is good, next's out, and only accounts still on this computer.
function remembering(req: Request, next: string) {
  const cookie = req.headers.get("cookie");
  const kept = rememberedOf(cookie);
  const accounts = localAccounts();
  const open = accounts.find((a) => a.open);
  if (open?.id && auth.check(cookie)) kept.set(open.id, sessionOf(cookie));
  const here = new Set(accounts.map((a) => a.id));
  for (const id of [...kept.keys()]) if (id === next || !here.has(id)) kept.delete(id);
  return kept;
}

const withCookies = (data: unknown, status: number, cookies: string[]) => {
  const headers = new Headers({ ...SECURITY_HEADERS, "Content-Type": "application/json" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(data), { status, headers });
};

// An account that is on other computers, joined here: one of them checks the password through the site and gives what
// the account is (its id, name, password's hash and salt), sealed with the account's key, which the password makes
// here too; then everything the account has comes from them into its folder here (users/<id>/), and it is opened.
async function joinAccount(req: Request, name: string, password: string): Promise<Response> {
  if (working()) return json({ error: "account_busy" }, 409);
  try {
    const { salt, box } = await remote.join(name, password);
    const key = deriveKey(password, salt);
    const account = JSON.parse(openWith(key, Buffer.from(box, "base64")).toString("utf8")) as AccountFile;
    if (!/^[0-9a-f]{16,32}$/.test(account.id ?? "") || typeof account.user !== "string" || typeof account.hash !== "string") throw new RemoteError("remote_unreachable");
    const dir = path.join(USERS_DIR, account.id!);
    mkdirSync(path.join(dir, "app"), { recursive: true });
    writeFileSync(accountFile(dir), JSON.stringify({ user: account.user, hash: account.hash, id: account.id, salt: account.salt }));
    saveKey(dir, key);
    const got = await syncAccount({ dir, account: account.user, key, peers: remote, all: true });
    if (!got.reached) throw new RemoteError("account_offline");
    return openLocal(req, { id: account.id!, name: account.user, dir, open: false }, password);
  } catch (err) {
    const code = err instanceof RemoteError ? err.message : "remote_unreachable";
    if (code === "bad_login" || code === "no_such_account") accountFails.push(Date.now());
    return json({ error: code }, code === "bad_login" ? 401 : code === "no_such_account" ? 404 : code === "remote_busy" ? 429 : 503);
  }
}

// A new account beside this computer's, from the account menu (logged in, on this computer itself, not through the
// site): made as the first one is, its name taken on the site first, but in a folder of its own (users/<id>/), and
// opened in place of the open one (switchTo).
async function makeAnother(req: Request, body: Record<string, unknown>): Promise<Response> {
  if (!auth.check(req.headers.get("cookie")) || req.headers.get("x-pip-relayed") === "1") return json({ error: "account_exists" }, 409);
  if (working()) return json({ error: "account_busy" }, 409);
  const name = String(body.user ?? "").trim();
  const making = path.join(USERS_DIR, `making-${Date.now()}`);
  const made = createAuth(accountFile(making));
  try {
    made.validate(name, body.password);
    if (findLocal(name)) throw new AccountError("remote_name_taken");
    await remote.claim(name).catch((err) => {
      if (err instanceof RemoteError && err.message !== "remote_unreachable") throw new AccountError(err.message);
    });
    const session = await made.create(name, body.password);
    const id = readAccount(making)?.id ?? "";
    renameSync(making, path.join(USERS_DIR, id));
    return switchTo(req, { id, name, dir: path.join(USERS_DIR, id), open: false }, session);
  } catch (err) {
    rmSync(making, { recursive: true, force: true });
    if (err instanceof AccountError) return json({ error: err.message }, err.message === "remote_name_taken" ? 409 : 400);
    throw err;
  }
}

// A request from another computer of an account that is here (open or not), passed along by the site, which only it
// marks so (remote.ts): this computer's list of the account's files, one of them, or joining the account, which takes
// its password. What it answers is sealed with the account's key.
async function peerRoutes(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/peer/")) return null;
  if (req.headers.get("x-pip-relayed") !== "1" || !/^[0-9a-f]{32}$/.test(req.headers.get("x-pip-peer") ?? "")) return json({ error: "not_found" }, 404);
  const local = findLocal(req.headers.get("x-pip-account") ?? "");
  if (!local) return json({ error: "no_such_account" }, 404);
  const what = url.pathname.slice("/api/peer/".length);
  if (what === "join" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (!(await createAuth(accountFile(local.dir)).verify(local.name, body.password))) {
      await Bun.sleep(400);
      return json({ error: "bad_login" }, 401);
    }
    const account = JSON.parse(readFileSync(accountFile(local.dir), "utf8")) as AccountFile;
    const key = loadKey(local.dir) ?? deriveKey(String(body.password), account.salt!);
    return json({ salt: account.salt, box: sealWith(key, JSON.stringify(account)).toString("base64") });
  }
  const key = loadKey(local.dir);
  if (!key) return json({ error: "no_key" }, 409);
  const sealed = (box: Buffer) => new Response(box, { headers: { ...SECURITY_HEADERS, "Content-Type": "application/octet-stream" } });
  if (what === "manifest") return sealed(answerManifest(local.dir, key));
  const file = what === "file" ? answerFile(local.dir, key, url.searchParams.get("p")) : null;
  return file ? sealed(file) : json({ error: "not_found" }, 404);
}

// The open account kept alike with its other computers: soon after Pip starts, every quarter of an hour, and right
// after a login, while this computer has the account's key.
let syncing: Promise<void> | null = null;
function syncNow() {
  const name = auth.user();
  const key = loadKey(USER_DIR);
  if (!name || !key || syncing) return;
  syncing = syncAccount({ dir: USER_DIR, account: name, key, peers: remote })
    .then((r) => { if (r.pulled || r.removed) console.log(`Took ${r.pulled} newer files and ${r.removed} deletions from the account's other computers.`); })
    .catch((err) => console.log(`Couldn't sync with the account's other computers: ${(err as Error)?.message ?? err}`))
    .finally(() => { syncing = null; });
}

// The login form, and whether this browser is logged in; on the first visit, making the account instead. Everything
// else in the API needs a login.
async function loginRoutes(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/me") {
    if (url.searchParams.get("active") === "1") usedAt = Date.now();
    return json({ loggedIn: auth.check(req.headers.get("cookie")), needsAccount: auth.needsAccount(), updating: Date.now() - updatingSince < UPDATING_MS });
  }
  // While there is no account yet, or logged in and making another (makeAnother), whether a name typed for it is free,
  // asked by the board as it is typed: free true or false (one of this computer's accounts has it, or the site says
  // so), or null when that can't be told (not paired, or the site out of reach).
  if (url.pathname === "/api/account/name" && req.method === "POST") {
    if (!auth.needsAccount() && !auth.check(req.headers.get("cookie"))) return json({ error: "account_exists" }, 409);
    const name = String((await req.json().catch(() => ({})) as Record<string, unknown>).user ?? "").trim();
    return json({ free: nameProblem(name).problem ? null : findLocal(name) ? false : await remote.free(name) });
  }
  if (url.pathname === "/api/account" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (!auth.needsAccount()) return makeAnother(req, body);
    try {
      // Paired with its site before there was an account: the name is taken there first, for signing in there, once
      // the name and the password are good. With the site out of reach the account is made anyway, and takes the name
      // once connected.
      auth.validate(body.user, body.password);
      await remote.claim(String(body.user ?? "").trim()).catch((err) => {
        if (err instanceof RemoteError && err.message !== "remote_unreachable") throw new AccountError(err.message);
      });
      return loggedIn(await auth.create(body.user, body.password));
    } catch (err) {
      if (err instanceof AccountError) return json({ error: err.message }, ["account_exists", "remote_name_taken"].includes(err.message) ? 409 : 400);
      throw err;
    }
  }
  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const id = await auth.login(body.user, body.password);
    if (id) {
      syncNow();
      return loggedIn(id);
    }
    // Another account on this computer opens in place of this one; through the site, which asks the computer where it
    // is open, it says it isn't open here.
    const other = findLocal(String(body.user ?? ""));
    if (other && !other.open) {
      if (req.headers.get("x-pip-relayed") !== "1") return openLocal(req, other, body.password);
      if (await createAuth(accountFile(other.dir)).verify(other.name, body.password)) return json({ error: "account_not_open" }, 409);
    }
    await Bun.sleep(400);
    return json({ error: "bad_login" }, 401);
  }
  // Another account, by its name and password, from the account menu or the login (no login needed: its password is
  // what lets it in): one on this computer opens in place of the open one; one on other computers joins this one first.
  // With no password, one on this computer that this browser still has a login to opens with that; otherwise the
  // password is asked for (password_needed), and a login of the browser's that is no longer good is forgotten.
  if (url.pathname === "/api/accounts/open" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const name = String(body.user ?? "").trim();
    const password = String(body.password ?? "");
    if (!name) return json({ error: "bad_login" }, 400);
    if (accountTries() >= 10) return json({ error: "remote_busy" }, 429);
    if (name.toLowerCase() === auth.user().toLowerCase()) return json({ error: "account_here" }, 409);
    const local = findLocal(name);
    if (!password) {
      const kept = rememberedOf(req.headers.get("cookie"));
      const login = local ? kept.get(local.id) : undefined;
      if (!local || !login) return json({ error: "password_needed" }, 401);
      if (createAuth(accountFile(local.dir)).holds(login)) return switchTo(req, local, login);
      kept.delete(local.id);
      return withCookies({ error: "password_needed" }, 401, [rememberedCookie(kept)]);
    }
    return local ? openLocal(req, local, password) : joinAccount(req, name, password);
  }
  if (url.pathname === "/api/logout" && req.method === "POST") {
    auth.logout(req.headers.get("cookie"));
    return new Response(JSON.stringify({ ok: true }), { headers: { ...SECURITY_HEADERS, "Content-Type": "application/json", "Set-Cookie": clearedCookie } });
  }
  if ((url.pathname.startsWith("/api/") || url.pathname === "/file") && !auth.check(req.headers.get("cookie"))) {
    return json({ error: "login_required" }, 401);
  }
  return null;
}

const hasCookie = (req: Request) =>
  (req.headers.get("cookie") ?? "").split(/;\s*/).includes(`job_token=${TOKEN}`);
// The cookie the start link gives, as does a page asked for by hand (auth.ts openedByHand).
const TOKEN_COOKIE = `job_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`;
// A page of this site by its path alone: letters, digits, / _ . and -, never starting //, so it can't lead elsewhere.
const LOCAL_PAGE = /^\/(?!\/)[A-Za-z0-9/_.-]{0,200}$/;

// A browser without the cookie that wasn't let in by hand, as one sent by another site's link: a page that says how to
// go on, in Pip's font, with a link to the same page, which a click lets in (openedByHand). No script runs on it, and
// the path it links to is this site's own.
function turnedAway(url: URL) {
  const page = LOCAL_PAGE.test(url.pathname) ? url.pathname : "/";
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pip</title><style>
@font-face { font-family: Rubik; src: url(/fonts/rubik-hebrew.woff2) format("woff2"); unicode-range: U+0590-05FF; font-weight: 300 900; }
@font-face { font-family: Rubik; src: url(/fonts/rubik-latin.woff2) format("woff2"); unicode-range: U+0000-00FF; font-weight: 300 900; }
body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #fff; color: #0f1419; font: 16px/1.6 Rubik, "Segoe UI", system-ui, sans-serif; text-align: center; }
p { margin: 0 0 8px; } a { color: #2f7a3a; font-weight: 600; }
</style></head><body><main>
<p>כדי להיכנס לפיפ, לוחצים כאן: <a href="${page}">כניסה לפיפ</a></p>
<p dir="ltr" lang="en">To open Pip, click here: <a href="${page}">Open Pip</a></p>
</main></body></html>`;
  return new Response(html, {
    status: 401,
    headers: {
      ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

// The browser opening a page (an address typed, a link followed, a reload), rather than a file one asks for.
const opensPage = (req: Request) => (req.method === "GET" || req.method === "HEAD") && /\btext\/html\b/.test(req.headers.get("accept") ?? "");

// A website the user visits must not be able to reach this server, so the host,
// the origin of every write, and a cookie that never leaves this site are all checked.
function rejected(req: Request, url: URL): Response | null {
  if (!HOSTS.has(req.headers.get("host") ?? "")) return new Response("Forbidden", { status: 403 });
  if (req.method !== "GET") {
    if (req.headers.get("origin") !== url.origin) return new Response("Forbidden", { status: 403 });
    if (!req.headers.get("content-type")?.startsWith("application/json")) return new Response("Unsupported", { status: 415 });
  }
  if (!hasCookie(req)) {
    // A page of Pip opened by hand in another browser on this computer (its address typed, a bookmark, a link from
    // another program, or the turned-away page's link), as Sean chose: the cookie, and on to the same page, where the
    // login asks for the account's password. After the host check above, and only a page loaded, never a write.
    if (req.method === "GET" && openedByHand(req.headers) && req.headers.get("x-pip-relayed") !== "1") {
      return new Response(null, { status: 303, headers: { ...SECURITY_HEADERS, Location: LOCAL_PAGE.test(url.pathname) ? url.pathname : "/", "Set-Cookie": TOKEN_COOKIE } });
    }
    // The turned-away page's own font.
    if (req.method === "GET" && /^\/fonts\/rubik-(hebrew|latin)\.woff2$/.test(url.pathname)) return null;
    return turnedAway(url);
  }
  return null;
}

function eventStream(id: string, req: Request) {
  const session = getSession(id);
  if (!session) return json({ error: "not found" }, 404);
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const push = (event: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { cleanup(); }
      };
      push({ t: "hello", session: session.summary(), events: session.events });
      const unsubscribe = session.subscribe(push);
      const beat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": beat\n\n")); } catch { cleanup(); }
      }, 20_000);
      cleanup = () => { clearInterval(beat); unsubscribe(); };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { ...SECURITY_HEADERS, "Content-Type": "text/event-stream" } });
}

async function api(req: Request, url: URL): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  if (req.method === "GET") {
    if (parts[0] === "state") {
      const settings = loadSettings();
      // The introduction shows until it is finished or put aside; someone set up before it was made never sees it.
      const intro = { done: settings.introDone || (profileReady() && settings.markets.length > 0), name: String(userProfile().name ?? ""), documents: listUserDocuments() };
      // The other accounts on this computer, for the account menu, those this browser keeps a login to (they open with
      // no password), and this computer's id, which the daily run's is.
      const others = localAccounts().filter((a) => !a.open);
      const kept = rememberedOf(req.headers.get("cookie"));
      const accounts = others.map((a) => a.name);
      const remembered = others.filter((a) => kept.has(a.id)).map((a) => a.name);
      return json({ ...loadState(settings), saved: readSaved(), settings, presets: REGION_PRESETS, sessions: listSessions(), aiKeys: keyStatus(), aiLogins: await cliStatus(), account: auth.user(), accounts, remembered, computer: COMPUTER, intro, remote: remote.status(), transcript: transcriptInfo() });
    }
    if (parts[0] === "profile" || parts[0] === "rules") return json(readDocument(parts[0]));
    if (parts[0] === "checks") return json(readChecks());
    if (parts[0] === "ats-terms") return json({ terms: await atsTerms() });
    if (parts[0] === "sources" && !parts[1]) return json({ sources: listSources() });
    if (parts[0] === "sources" && isSourceKind(parts[1] ?? "") && parts[2]) return json(readSource(parts[1] as "cv" | "letter", parts[2]));
    if (parts[0] === "files") return json({ groups: listEditableFiles() });
    if (parts[0] === "file") return json(readEditableFile(url.searchParams.get("path")));
    if (parts[0] === "automation") return json(automationStatus());
    // The portals page: every portal, the industries, and each one's last check.
    if (parts[0] === "portals") return json({ portals: PORTALS, industries: INDUSTRIES, checks: readPortalChecks(), found: foundPortals(), busy: listBusy === "portals" });
    // The portfolio page: what /portfolio wrote (portfolio.ts), and the pictures and videos it shows.
    if (parts[0] === "portfolio" && !parts[1]) return json(readPortfolio());
    if (parts[0] === "portfolio" && parts[1] === "media") return portfolioMedia(req, url);
    if (parts[0] === "sessions" && parts[1] && parts[2] === "events") return eventStream(parts[1], req);
    if (parts[0] === "uploads" && parts[1]) {
      const upload = getUpload(parts[1]);
      if (!upload) return json({ error: "not found" }, 404);
      // Like /file: a PDF opens in the browser's viewer, which the page's policy would stop; anything else is
      // shown sandboxed, so nothing in it can run.
      return new Response(Bun.file(upload.file), {
        headers: {
          "Content-Type": upload.type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "private, max-age=86400",
          ...(upload.kind === "pdf" ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'" }),
          "Content-Disposition": `inline; filename="${upload.name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(upload.name)}`,
        },
      });
    }
    if (parts[0] === "sessions" && parts[1] && parts[2] === "files") {
      const session = getSession(parts[1]);
      return session ? json({ files: conversationFiles(session.events) }) : json({ error: "not found" }, 404);
    }
    if (parts[0] === "search") {
      try {
        const p = url.searchParams;
        return json(await searchJobs(p.get("q") ?? "", p.get("days") ?? "14", p.get("market") ?? "all", p.get("mode") ?? "", loadSettings()));
      } catch (err) {
        return json({ error: String((err as Error).message) }, 400);
      }
    }
    return json({ error: "not found" }, 404);
  }

  const body = await req.json().catch(() => ({})) as Record<string, any>;
  // A file attached in the chat, its bytes in base64 inside the JSON, like every other write here.
  if (parts[0] === "uploads" && !parts[1]) {
    try {
      return json(saveUpload(String(body.name ?? ""), String(body.data ?? "")));
    } catch (err) {
      if (err instanceof UploadError) return json({ error: `upload_${err.message}` }, 400);
      throw err;
    }
  }
  // The daily run turned on runs on the computer it was turned on at, the account's others leave it to that one.
  if (parts[0] === "settings") {
    const daily = body?.automation?.enabled === true && !body.automation.computer ? { ...body, automation: { ...body.automation, computer: COMPUTER } } : body;
    return json(saveSettings(daily, REPO));
  }
  // The grade sheet, kept from the settings in its bytes as base64, or put away (transcript.ts).
  if (parts[0] === "transcript") {
    try {
      if (parts[1] === "remove") removeTranscript();
      else await saveTranscript(body.data);
    } catch (err) {
      if (err instanceof TranscriptError) throw new EditError(err.message);
      throw err;
    }
    return json({ transcript: transcriptInfo() });
  }
  // The introduction's own saves (ui/views/welcome.tsx): the name employers see, the documents /setup reads, and
  // its end. The name also greets the user, unless they chose another for that.
  if (parts[0] === "intro") {
    try {
      if (parts[1] === "name") {
        const name = saveUserName(body.name);
        const settings = loadSettings();
        if (!settings.displayName) saveSettings({ ...settings, displayName: name.split(" ")[0] }, REPO);
        return json({ name });
      }
      if (parts[1] === "document") return json({ file: saveUserDocument(body.kind, body.name, body.data), documents: listUserDocuments() });
    } catch (err) {
      if (err instanceof UserFileError) throw new EditError(err.message);
      throw err;
    }
    if (parts[1] === "done") return json(saveSettings({ ...loadSettings(), introDone: true }, REPO));
  }
  if (parts[0] === "profile" || parts[0] === "rules") return json(saveDocument(parts[0], body.text, body.base));
  if (parts[0] === "checks") return json(saveChecks(body));
  if (parts[0] === "applications" && parts[1] === "status") {
    setApplicationStatus(body);
    return json({ ok: true });
  }
  // A job the user saved, or took off their saved jobs (saved.ts).
  if (parts[0] === "saved") return json({ saved: setSaved(body) });
  // The portfolio's website (/portfolio builds it in user/portfolio/site/) opened in this computer's browser, from its
  // folder. Not from the phone, which would open it here, out of sight.
  if (parts[0] === "portfolio" && parts[1] === "site") {
    const site = path.join(PORTFOLIO_DIR, "site", "index.html");
    if (req.headers.get("x-pip-relayed") === "1" || !existsSync(site)) return json({ error: "not found" }, 404);
    openInBrowser(pathToFileURL(site).href);
    return json({ ok: true });
  }
  if (parts[0] === "sources" && isSourceKind(parts[1] ?? "") && parts[2]) {
    const kind = parts[1] as "cv" | "letter";
    saveSource(kind, parts[2], body.source, body.base);
    return json({ ...(await buildSource(kind, parts[2])), ...readSource(kind, parts[2]) });
  }
  if (parts[0] === "file") return json(saveEditableFile(body.path, body.text, body.base));
  if (parts[0] === "automation") {
    if (parts[1] === "run") {
      if (automation.isRunning()) throw new EditError("run_active", 409);
      automation.run("manual");
      return json(automationStatus());
    }
    if (parts[1] === "mail") {
      const user = String(body.user ?? "").trim();
      const password = String(body.password ?? "").replace(/\s+/g, "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || !password) throw new EditError("mail_account_needed");
      saveMailAccount(user, password);
      return json(automationStatus());
    }
    if (parts[1] === "test") {
      const to = loadSettings().automation.email || readMailAccount()?.user;
      if (!to) throw new EditError("mail_account_missing");
      const words = mailWords(loadSettings());
      return json({ result: await sendMail({ to, subject: words.testSubject, body: words.testBody, attachments: [] }) });
    }
  }
  // Phone access: linking takes the account's name on the site, unlinking gives it back (remote.ts).
  if (parts[0] === "remote") {
    try {
      if (parts[1] === "link") await remote.link(body.site, auth.user());
      else if (parts[1] === "unlink") await remote.unlink();
      else return json({ error: "not found" }, 404);
    } catch (err) {
      if (err instanceof RemoteError) throw new EditError(err.message);
      throw err;
    }
    return json(remote.status());
  }
  // Signing in to Claude or ChatGPT with the account: Claude Code or Codex opens in a window of its own here (clis.ts).
  if (parts[0] === "ai-login") {
    const provider = String(body.provider) as Provider | "claude";
    if (provider !== "claude" && !PROVIDERS.includes(provider)) return json({ error: "not found" }, 404);
    try { openLogin(provider); } catch (err) { if (err instanceof ChatbotError) throw new EditError(err.code); throw err; }
    return json({ ok: true });
  }
  // A key for ChatGPT, kept only once OpenAI takes it; an empty one forgets it. Like the mail
  // password, it is written once and never read back.
  if (parts[0] === "ai-keys") {
    const provider = String(body.provider) as Provider;
    if (!PROVIDERS.includes(provider)) return json({ error: "not found" }, 404);
    const key = String(body.key ?? "").trim();
    if (key) {
      try { await checkKey(provider, key); } catch (err) { if (err instanceof ChatbotError) throw new EditError(err.code); throw err; }
    }
    saveAiKey(provider, key);
    return json(keyStatus());
  }
  // The new jobs ranked (ranker.ts), or the smart search and save (scraper.ts), by the settings' AI, the next
  // connected one taking over from one that fails for the rest of the run, and the server doing everything else.
  // One run of each at a time, since two would pick the same jobs; and while one writes the list, the other waits.
  // The portals check, from the portals page: the employers' own lists read now (scraper.ts scanPortals).
  if (parts[0] === "rank" || parts[0] === "scrape" || (parts[0] === "portals" && parts[1] === "scan")) {
    if (listBusy) throw new EditError(`${listBusy}_busy`, 409);
    const job = parts[0];
    listBusy = job;
    const settings = loadSettings();
    const lang = settings.language === "en" ? "en" : "he";
    const title = job === "rank" ? "/rank" : job === "scrape" ? "/job-scraper" : lang === "he" ? "בדיקת פורטלים" : "Portals check";
    const session = createTaskSession(title, (steps, signal) => {
      const ask = askFor(steps);
      const work = job === "rank" ? rankJobs({ steps, signal, lang, ask })
        : job === "scrape" ? scrapeJobs({ steps, signal, lang, ask, settings })
        : scanPortals({ steps, signal, lang, ask, settings, discover: true });
      return work.finally(() => { listBusy = ""; });
    });
    return json(session.summary());
  }
  if (parts[0] === "sessions" && !parts[1]) {
    const prompt = String(body.prompt ?? "").trim();
    const uploads = attached(body.files);
    if (!prompt && !uploads.length) return json({ error: "empty" }, 400);
    // Applying is /apply itself, Claude's, or ChatGPT's in Codex when ChatGPT is first and its account signed in
    // (codex.ts: the reviewer a sub-agent of its own, the PDF looked at as pictures). On a key alone ChatGPT has no
    // agent, so the server does it with it (applier.ts).
    const applying = prompt.match(/^\/apply\s+([\s\S]+)$/)?.[1]?.trim();
    const settings = loadSettings();
    const order = engineOrder(settings.aiPrimary);
    if (applying && !uploads.length && order[0] !== "claude" && !cliSignedIn().openai) {
      const lang = settings.language === "en" ? "en" : "he";
      const session = createTaskSession(prompt.slice(0, 300), (steps, signal) => applyJob({
        input: applying, steps, signal, lang,
        ask: (system, text, stop) => askInOrder(order, system, [{ role: "user", text }], {
          signal: stop, onSwitch: (from, to, err) => steps.switched(ENGINE_NAMES[from], ENGINE_NAMES[to], err.code),
        }).then((r) => ({ text: r.text, by: ENGINE_NAMES[r.engine] })),
      }));
      return json(session.summary());
    }
    return json(createSession(prompt, body.model, { access: isAccess(body.access) ? body.access : "ask", uploads }).summary());
  }
  const session = parts[0] === "sessions" ? getSession(parts[1]) : undefined;
  if (!session) return json({ error: "not found" }, 404);
  if (parts[2] === "message") {
    const text = String(body.text ?? "").trim();
    const uploads = attached(body.files);
    if (!text && !uploads.length) return json({ error: "empty" }, 400);
    session.send(text, uploads);
    return json({ ok: true });
  }
  if (parts[2] === "respond") return json({ ok: session.respond(String(body.requestId), body) });
  if (parts[2] === "access") {
    if (!isAccess(body.access)) return json({ error: "bad access" }, 400);
    session.setAccess(body.access);
    return json(session.summary());
  }
  if (parts[2] === "interrupt") { await session.interrupt(); return json({ ok: true }); }
  return json({ error: "not found" }, 404);
}

// A picture or a video of the portfolio's, from its media folder only; a video in the pieces it asks for, so it starts
// and seeks without the whole file first.
function portfolioMedia(req: Request, url: URL) {
  const abs = mediaFile(url.searchParams.get("path"));
  if (!abs) return new Response("Not found", { status: 404 });
  const file = Bun.file(abs);
  const headers = { ...SECURITY_HEADERS, "Content-Type": MEDIA_TYPES[path.extname(abs).toLowerCase()], "Cache-Control": "private, max-age=60", "Accept-Ranges": "bytes" };
  const range = byteRange(req.headers.get("range"), file.size);
  if (range === "bad") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.size}` } });
  if (!range) return new Response(file, { headers });
  return new Response(file.slice(range.start, range.end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${file.size}` } });
}

// The uploads a message names, by id, up to five; one that is not there is left out.
const attached = (ids: unknown) => (Array.isArray(ids) ? ids.slice(0, 5).map((id) => getUpload(String(id))).filter((u) => u !== null) : []);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

async function document(url: URL) {
  const asked = url.searchParams.get("path") ?? "";
  const abs = resolveDocument(asked);
  if (!abs) return new Response("Not found", { status: 404 });
  const isHtml = abs.toLowerCase().endsWith(".html");
  const isCv = /[\\/]cv[\\/][^\\/]+\.pdf$/i.test(abs);
  // A CV asked for with the grade sheet comes joined to it, in one file (transcript.ts).
  const joined = isCv && url.searchParams.get("with") === "transcript";
  let body: Blob | Uint8Array = Bun.file(abs);
  if (joined) {
    if (!transcriptInfo()) return new Response("Not found", { status: 404 });
    try {
      body = await joinWithTranscript(abs);
    } catch {
      return new Response("The CV and the transcript could not be joined; they can be downloaded separately. לא הצלחתי לחבר את קורות החיים ואת גיליון הציונים, אפשר להוריד אותם בנפרד.", {
        status: 422, headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }
  // Saving a CV from the browser keeps the name employers should see, and the grade sheet's likewise; download=1
  // saves rather than shows it.
  const name = joined ? cvFileName(undefined, "Resume and Transcript") : isCv ? cvFileName()
    : asked.replaceAll("\\", "/") === TRANSCRIPT ? cvFileName(undefined, "Transcript") : path.basename(abs);
  const how = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(body, {
    headers: {
      "Content-Type": isHtml ? "text/html; charset=utf-8" : "application/pdf",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Disposition": `${how}; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      ...(isHtml ? { "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : {}),
    },
  });
}

// Checked often, so a run still happens the same day when the server starts after the set hour.
const AUTOMATION_CHECK_MS = 60_000;
setInterval(() => automation.tick(), AUTOMATION_CHECK_MS);

// Every request, from this computer's browser or passed on from the phone by the site (remote.ts).
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // Asked where to open Pip, by the launcher (installer/launcher.cs) or a second start, which open it there or, with a
  // page open already, bring that one up.
  if (url.pathname === "/open" && url.searchParams.get("t") === TOKEN && HOSTS.has(req.headers.get("host") ?? "")) {
    return json(await openPlan());
  }
  if (url.pathname === "/update" && url.searchParams.get("t") === TOKEN && HOSTS.has(req.headers.get("host") ?? "")) {
    if (req.method === "POST") updatingSince = Date.now();
    return json({ busy: busyNow() });
  }
  // The start link: on its site, when linked to one that answers in time (remote.ts), or else here.
  if (url.pathname === "/" && url.searchParams.get("t") === TOKEN && HOSTS.has(req.headers.get("host") ?? "")) {
    const away = await remote.openUrl().catch(() => null);
    return new Response(null, {
      status: 303,
      headers: { Location: away?.url ?? "/", "Set-Cookie": TOKEN_COOKIE, ...SECURITY_HEADERS },
    });
  }
  const refusal = rejected(req, url);
  if (refusal) return refusal;
  // A page of Pip open on this computer, asking as it does every few seconds (not one on the site, passed on).
  if ((url.pathname === "/api/me" || url.pathname === "/api/state") && req.headers.get("x-pip-relayed") !== "1") pageSeen = Date.now();
  const peer = await peerRoutes(req, url);
  if (peer) return peer;
  const login = await loginRoutes(req, url);
  if (login) return login;
  if (url.pathname.startsWith("/api/")) {
    return api(req, url).catch((err) => {
      if (err instanceof EditError) return json({ error: err.code, params: err.params }, err.status);
      throw err;
    });
  }
  if (url.pathname === "/file") return document(url);

  // A file of the interface, or one of the app's pages (/jobs, /chat/<id>): the browser opening an address with no file
  // at it gets the one page, which shows the page the address names, or the home page for one it doesn't. A script, a
  // style or a picture asked for and not there is not found, as before.
  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  let abs = path.join(PUBLIC, rel);
  if (!abs.startsWith(PUBLIC + path.sep)) return new Response("Not found", { status: 404 });
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    if (!opensPage(req)) return new Response("Not found", { status: 404 });
    abs = path.join(PUBLIC, "index.html");
  }
  return new Response(Bun.file(abs), { headers: { ...SECURITY_HEADERS, "Content-Type": MIME[path.extname(abs)] ?? "application/octet-stream" } });
}

let server;
try {
  server = Bun.serve({ hostname: "127.0.0.1", port: PORT, idleTimeout: 0, fetch: handle });
} catch (err) {
  if ((err as { code?: string }).code !== "EADDRINUSE") throw err;
  console.log("The interface is already running. Opening it.");
  // The one running says where (/open), unless a page of it is open already.
  if (!process.env.JOB_WEB_NO_BROWSER) {
    const plan = await fetch(`http://127.0.0.1:${PORT}/open?t=${TOKEN}`).then((r) => r.json()).catch(() => null) as { url?: string; already?: boolean } | null;
    if (!plan?.already) openInBrowser(plan?.url ?? START_URL);
  }
  process.exit(0);
}

remote.start();
setTimeout(syncNow, 20_000);
setInterval(syncNow, 15 * 60_000);
console.log(`Job search interface: http://127.0.0.1:${server.port}`);
console.log("Keep this window open while you use it.");
if (!process.env.JOB_WEB_NO_BROWSER) openBrowser();
