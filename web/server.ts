// Local web interface for the job-search workspace. Listens on this computer only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSession, createTaskSession, getSession, isAccess, listSessions, runUnattended } from "./agent";
import { clearedCookie, createAuth, sessionCookie } from "./auth";
import { buildInterface } from "./build";
import { createAutomation, mailWords, readMailAccount, saveMailAccount, sendMail } from "./automation";
import { askInOrder, ENGINE_NAMES, engineOrder } from "./ai";
import { ChatbotError, checkKey, keyStatus, PROVIDERS, saveKey, type Provider } from "./chatbots";
import { cliStatus, openLogin } from "./clis";
import { rankJobs } from "./ranker";
import { scrapeJobs } from "./scraper";
import { applyJob } from "./applier";
import { conversationFiles, loadState, resolveDocument, searchJobs } from "./data";
import { atsTerms, buildSource, EditError, isSourceKind, listEditableFiles, listSources, readChecks, readDocument, readEditableFile, readSource, saveChecks, saveDocument, saveEditableFile, saveSource, setApplicationStatus } from "./edit";
import { REPO } from "./policy";
import { loadSettings, REGION_PRESETS, saveSettings } from "./settings";
import { getUpload, saveUpload, UploadError } from "./uploads";

const PORT = Number(process.env.JOB_WEB_PORT ?? 4174);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const PUBLIC = path.join(import.meta.dir, "public");
const DATA = path.join(import.meta.dir, "data");
const TOKEN_FILE = path.join(DATA, "token");

await buildInterface(path.join(PUBLIC, "build"));
// Whether ChatGPT is signed in, known before the first conversation asks.
cliStatus().catch(() => {});

mkdirSync(DATA, { recursive: true });
if (!existsSync(TOKEN_FILE)) writeFileSync(TOKEN_FILE, crypto.randomUUID().replaceAll("-", ""));
const TOKEN = readFileSync(TOKEN_FILE, "utf8").trim();
const START_URL = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;

const openBrowser = () => {
  if (!process.env.JOB_WEB_NO_BROWSER) Bun.spawn(["cmd", "/c", "start", "", START_URL], { stdout: "ignore", stderr: "ignore" });
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...SECURITY_HEADERS, "Content-Type": "application/json" } });

const automation = createAutomation({ loadSettings, loadState, runSession: runUnattended, sendMail: (mail) => sendMail(mail) });
// Only the address leaves the server. The password is written once and never read back.
const automationStatus = () => ({ running: automation.isRunning(), runs: automation.runs(), mailUser: readMailAccount()?.user ?? "" });

const auth = createAuth();
// The server's own run on the job list going now, "rank" or "scrape", or "" for none.
let listBusy = "";

// The login form, and whether this browser is logged in. Everything else in the API needs a login.
async function loginRoutes(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/me") return json({ loggedIn: auth.check(req.headers.get("cookie")) });
  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const id = auth.login(body.user, body.password);
    if (!id) {
      await Bun.sleep(400);
      return json({ error: "bad_login" }, 401);
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { ...SECURITY_HEADERS, "Content-Type": "application/json", "Set-Cookie": sessionCookie(id) } });
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

// A website the user visits must not be able to reach this server, so the host,
// the origin of every write, and a cookie that never leaves this site are all checked.
function rejected(req: Request, url: URL): Response | null {
  if (!HOSTS.has(req.headers.get("host") ?? "")) return new Response("Forbidden", { status: 403 });
  if (req.method !== "GET") {
    if (req.headers.get("origin") !== url.origin) return new Response("Forbidden", { status: 403 });
    if (!req.headers.get("content-type")?.startsWith("application/json")) return new Response("Unsupported", { status: 415 });
  }
  if (!hasCookie(req)) {
    return new Response("Open the interface with start-web.cmd. פתח את הממשק דרך start-web.cmd.", {
      status: 401, headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
    });
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
      return json({ ...loadState(settings), settings, presets: REGION_PRESETS, sessions: listSessions(), aiKeys: keyStatus(), aiLogins: await cliStatus() });
    }
    if (parts[0] === "profile" || parts[0] === "rules") return json(readDocument(parts[0]));
    if (parts[0] === "checks") return json(readChecks());
    if (parts[0] === "ats-terms") return json({ terms: await atsTerms() });
    if (parts[0] === "sources" && !parts[1]) return json({ sources: listSources() });
    if (parts[0] === "sources" && isSourceKind(parts[1] ?? "") && parts[2]) return json(readSource(parts[1] as "cv" | "letter", parts[2]));
    if (parts[0] === "files") return json({ groups: listEditableFiles() });
    if (parts[0] === "file") return json(readEditableFile(url.searchParams.get("path")));
    if (parts[0] === "automation") return json(automationStatus());
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
  if (parts[0] === "settings") return json(saveSettings(body, REPO));
  if (parts[0] === "profile" || parts[0] === "rules") return json(saveDocument(parts[0], body.text, body.base));
  if (parts[0] === "checks") return json(saveChecks(body));
  if (parts[0] === "applications" && parts[1] === "status") {
    setApplicationStatus(body);
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
  // Signing in to ChatGPT with the account: Codex opens in a window of its own here (clis.ts).
  if (parts[0] === "ai-login") {
    const provider = String(body.provider) as Provider;
    if (!PROVIDERS.includes(provider)) return json({ error: "not found" }, 404);
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
    saveKey(provider, key);
    return json(keyStatus());
  }
  // The new jobs ranked (ranker.ts), or the smart search and save (scraper.ts), by the settings' AI, the next
  // connected one taking over from one that fails for the rest of the run, and the server doing everything else.
  // One run of each at a time, since two would pick the same jobs; and while one writes the list, the other waits.
  if (parts[0] === "rank" || parts[0] === "scrape") {
    if (listBusy) throw new EditError(`${listBusy}_busy`, 409);
    const job = parts[0];
    listBusy = job;
    const settings = loadSettings();
    const lang = settings.language === "en" ? "en" : "he";
    const order = engineOrder(settings.aiPrimary);
    const session = createTaskSession(job === "rank" ? "/rank" : "/job-scraper", (steps, signal) => {
      const ask = (system: string, prompt: string, stop: AbortSignal) => askInOrder(order, system, [{ role: "user", text: prompt }], {
        signal: stop, onSwitch: (from, to, err) => steps.switched(ENGINE_NAMES[from], ENGINE_NAMES[to], err.code),
      }).then((r) => ({ text: r.text, by: ENGINE_NAMES[r.engine] }));
      return (job === "rank" ? rankJobs({ steps, signal, lang, ask }) : scrapeJobs({ steps, signal, lang, ask, settings })).finally(() => { listBusy = ""; });
    });
    return json(session.summary());
  }
  if (parts[0] === "sessions" && !parts[1]) {
    const prompt = String(body.prompt ?? "").trim();
    const uploads = attached(body.files);
    if (!prompt && !uploads.length) return json({ error: "empty" }, 400);
    // Applying, with ChatGPT first in the settings, is done by the server with it (applier.ts); with
    // Claude first it is Claude's own /apply, the recommended way.
    const applying = prompt.match(/^\/apply\s+([\s\S]+)$/)?.[1]?.trim();
    const settings = loadSettings();
    const order = engineOrder(settings.aiPrimary);
    if (applying && !uploads.length && order[0] !== "claude") {
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

// The uploads a message names, by id, up to five; one that is not there is left out.
const attached = (ids: unknown) => (Array.isArray(ids) ? ids.slice(0, 5).map((id) => getUpload(String(id))).filter((u) => u !== null) : []);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml",
};

function document(url: URL) {
  const abs = resolveDocument(url.searchParams.get("path") ?? "");
  if (!abs) return new Response("Not found", { status: 404 });
  const isHtml = abs.toLowerCase().endsWith(".html");
  // Saving a CV from the browser keeps the name employers should see; download=1 saves rather than shows it.
  const name = /[\\/]cv[\\/][^\\/]+\.pdf$/i.test(abs) ? "Sean Fourman - Resume.pdf" : path.basename(abs);
  const how = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(Bun.file(abs), {
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

let server;
try {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: PORT,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/" && url.searchParams.get("t") === TOKEN && HOSTS.has(req.headers.get("host") ?? "")) {
        return new Response(null, {
          status: 303,
          headers: { Location: "/", "Set-Cookie": `job_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`, ...SECURITY_HEADERS },
        });
      }
      const refusal = rejected(req, url);
      if (refusal) return refusal;
      const login = await loginRoutes(req, url);
      if (login) return login;
      if (url.pathname.startsWith("/api/")) {
        return api(req, url).catch((err) => {
          if (err instanceof EditError) return json({ error: err.code, params: err.params }, err.status);
          throw err;
        });
      }
      if (url.pathname === "/file") return document(url);

      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const abs = path.join(PUBLIC, rel);
      if (!abs.startsWith(PUBLIC + path.sep) || !existsSync(abs)) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(abs), { headers: { ...SECURITY_HEADERS, "Content-Type": MIME[path.extname(abs)] ?? "application/octet-stream" } });
    },
  });
} catch (err) {
  if ((err as { code?: string }).code !== "EADDRINUSE") throw err;
  console.log("The interface is already running. Opening it.");
  openBrowser();
  process.exit(0);
}

console.log(`Job search interface: http://127.0.0.1:${server.port}`);
console.log("Keep this window open while you use it.");
openBrowser();
