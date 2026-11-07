import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSite } from "../site/server";
import { createRemote, siteAddress } from "./remote";
import { translate } from "./ui/i18n";

// A stand-in for the computer's server: what it saw of each request, a login, a slow stream, and an echo.
const seen: Request[] = [];
let streamCancelled = false;
async function handle(req: Request): Promise<Response> {
  seen.push(req);
  const url = new URL(req.url);
  if (url.pathname === "/") return new Response("<html>app</html>", { headers: { "Content-Type": "text/html" } });
  if (url.pathname === "/api/login") {
    const body = await req.json();
    if (!["dana", "noa"].includes(body.user) || body.password !== "a-long-secret") return new Response('{"error":"bad_login"}', { status: 401 });
    return new Response('{"ok":true}', { headers: { "Set-Cookie": "job_session=abc123; HttpOnly; SameSite=Strict; Path=/" } });
  }
  if (url.pathname === "/api/stream") {
    let n = 0;
    req.signal.addEventListener("abort", () => { streamCancelled = true; });
    return new Response(new ReadableStream({
      async pull(c) { await Bun.sleep(40); if (req.signal.aborted) return; c.enqueue(new TextEncoder().encode(`data: ${n++}\n\n`)); },
    }), { headers: { "Content-Type": "text/event-stream" } });
  }
  if (url.pathname === "/api/echo") {
    const bytes = new Uint8Array(await req.arrayBuffer());
    return Response.json({ length: bytes.length, last: bytes[bytes.length - 1], type: req.headers.get("content-type"), origin: req.headers.get("origin") });
  }
  return new Response("not found", { status: 404 });
}

const dir = mkdtempSync(path.join(os.tmpdir(), "remote-"));
let site: ReturnType<typeof startSite>;
let origin = "";
const remote = createRemote({ handle, port: 4174, localToken: "tok", file: path.join(dir, "remote.json") });
const phone = (p: string, init: RequestInit = {}) => fetch(`${origin}${p}`, { redirect: "manual", ...init });
const cookies = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const until = async (check: () => boolean, ms = 8000) => { for (const end = Date.now() + ms; !check() && Date.now() < end;) await Bun.sleep(50); return check(); };
// The app's sign-in on the site, as its page sends it.
const login = (user: string, password: string, headers: Record<string, string> = { Origin: origin }) =>
  phone("/api/login", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ user, password }) });
// The site's id for the computer linked as dana.
const dana = () => site.store.named("dana")?.id ?? "";
let signedIn = "";

beforeAll(async () => {
  site = startSite({ port: 0, dataFile: ":memory:" });
  origin = `http://127.0.0.1:${site.server.port}`;
  await remote.link(origin, "dana");
  await until(() => remote.status().state === "on");
});
afterAll(() => { remote.stop(); site.stop(); });

describe("the site's address", () => {
  test("is https, unless it is this computer", () => {
    expect(siteAddress("pip.example.com/")).toBe("https://pip.example.com");
    expect(siteAddress("http://localhost:4180")).toBe("http://localhost:4180");
    expect(siteAddress("localhost:4180")).toBe("http://localhost:4180");
    expect(() => siteAddress("http://pip.example.com")).toThrow("remote_address");
    expect(() => siteAddress("")).toThrow("remote_address");
  });
});

describe("an installed Pip, used on its site", () => {
  const installed = createRemote({ handle, port: 4174, localToken: "tok", file: path.join(dir, "installed.json"), pairWith: "" });
  afterAll(() => installed.stop());

  test("pairs as soon as it starts, before it has an account, and opens there by a code that ties one browser", async () => {
    const paired = createRemote({ handle, port: 4174, localToken: "tok", file: path.join(dir, "installed.json"), pairWith: origin });
    paired.start();
    expect(await until(() => paired.status().state === "on")).toBe(true);
    expect(paired.status()).toMatchObject({ linked: true, name: "" });
    const open = await paired.openUrl();
    expect(open?.url).toStartWith(`${origin}/pair/`);
    expect(open?.open).toBe(false);
    const tied = await fetch(open!.url, { redirect: "manual" });
    expect(tied.headers.get("location")).toBe("/");
    const browser = cookies(tied);
    expect(browser).toMatch(/^pip_pc=[0-9a-f]{32}; pip_here=1$/);
    expect(await (await phone("/", { headers: { Cookie: browser } })).text()).toBe("<html>app</html>");
    expect(cookies(await fetch(open!.url, { redirect: "manual" }))).toBe("");
    // That browser's page asking, as it does every few seconds: Pip opening again knows it is open.
    await phone("/api/me", { headers: { Cookie: browser } });
    expect((await paired.openUrl())?.open).toBe(true);
    paired.stop();
  });

  test("takes its account's name there, if free, and signing in elsewhere takes it", async () => {
    installed.start();
    expect(await until(() => installed.status().state === "on")).toBe(true);
    await expect(installed.claim("DANA")).rejects.toThrow("remote_name_taken");
    await expect(installed.claim("<script>")).rejects.toThrow("remote_name");
    await installed.claim("noa");
    expect(installed.status().name).toBe("noa");
    const res = await login("Noa", "a-long-secret");
    expect(cookies(res)).toContain(`pip_pc=${site.store.named("noa")!.id}`);
  });

  test("turned off in the settings, it stays off its site and opens on the computer", async () => {
    installed.stop();
    const again = createRemote({ handle, port: 4174, localToken: "tok", file: path.join(dir, "installed.json"), pairWith: origin });
    await again.unlink();
    expect(site.store.named("noa")).toBeNull();
    again.start();
    await Bun.sleep(300);
    expect(again.status().linked).toBe(false);
    expect(await again.openUrl(300)).toBeNull();
  });

  test("with its site out of reach, it opens on the computer", async () => {
    const lost = createRemote({ handle, port: 4174, localToken: "tok", file: path.join(dir, "lost.json"), pairWith: "http://127.0.0.1:9" });
    lost.start();
    expect(await lost.openUrl(600)).toBeNull();
    lost.stop();
  });
});

describe("phone access", () => {
  test("the computer links under its account's name and stays connected", () => {
    expect(remote.status()).toMatchObject({ linked: true, name: "dana", state: "on", site: origin });
  });

  test("a phone that has not signed in gets the app's own sign-in, from the site", async () => {
    const page = await phone("/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="root"');
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect((await phone("/styles.css")).headers.get("content-type")).toContain("text/css");
    expect(await (await phone("/api/me")).json()).toEqual({ loggedIn: false, needsAccount: false, site: true, download: "", mac: false });
    expect((await phone("/api/state")).status).toBe(401);
    // Only the interface's own files: web/server.ts is right beside them.
    expect((await phone("/..%2fserver.ts")).status).toBe(404);
    // The sign-in's old address leads to the page.
    expect((await phone("/login")).headers.get("location")).toBe("/");
  });

  test("the computer checks the password; the site passes on its session", async () => {
    expect((await login("dana", "a-long-secret", {})).status).toBe(403);
    expect(await (await login("dana", "wrong")).json()).toEqual({ error: "bad_login" });
    expect((await login("nobody", "x")).status).toBe(401);
    const res = await login("Dana", "a-long-secret");
    expect(res.status).toBe(200);
    signedIn = cookies(res);
    expect(signedIn).toContain("job_session=abc123");
    expect(signedIn).toContain(`pip_pc=${dana()}`);
  });

  test("then the phone gets the computer's interface, as a request made there", async () => {
    const res = await phone("/", { headers: { Cookie: `${signedIn}; job_token=guessed; other=1` } });
    expect(await res.text()).toBe("<html>app</html>");
    const req = seen[seen.length - 1];
    expect(req.headers.get("host")).toBe("127.0.0.1:4174");
    // The computer's own token, never one the phone sent, and only its session cookie.
    expect(req.headers.get("cookie")).toBe("job_token=tok; job_session=abc123");
  });

  test("a stream arrives as it is written, and a phone that leaves stops it", async () => {
    streamCancelled = false;
    const res = await phone("/api/stream", { headers: { Cookie: signedIn } });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("data: 0");
    await reader.cancel();
    expect(await until(() => streamCancelled)).toBe(true);
  });

  test("a large body arrives whole, and a write must come from the site's own pages", async () => {
    const body = new Uint8Array(1_000_001).fill(7);
    body[body.length - 1] = 9;
    const res = await phone("/api/echo", { method: "POST", headers: { Cookie: signedIn, Origin: origin, "Content-Type": "application/json" }, body });
    expect(await res.json()).toEqual({ length: 1_000_001, last: 9, type: "application/json", origin: "http://127.0.0.1:4174" });
    expect((await phone("/api/echo", { method: "POST", headers: { Cookie: signedIn, Origin: "https://evil.example" }, body: "{}" })).status).toBe(403);
  });

  test("a name already linked is not given twice, in any case", async () => {
    const other = createRemote({ handle, port: 4174, localToken: "x", file: path.join(dir, "other.json") });
    await expect(other.link(origin, "DANA")).rejects.toThrow("remote_name_taken");
    await expect(other.link(origin, "<script>")).rejects.toThrow("remote_name");
  });

  test("with the computer off, the phone gets the app's page, which says so, and a sign-in is told so", async () => {
    remote.stop();
    await until(() => !site.relay.online(dana()));
    const page = await phone("/", { headers: { Cookie: signedIn } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="root"');
    expect(await (await phone("/api/state", { headers: { Cookie: signedIn } })).json()).toEqual({ error: "pc_offline" });
    expect(await (await login("dana", "a-long-secret")).json()).toEqual({ error: "login_no_pc" });
    remote.start();
    expect(await until(() => site.relay.online(dana()))).toBe(true);
  });

  test("too many wrong passwords for a name stop being passed on", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await login("dana", "wrong")).status;
    expect(last).toBe(429);
  });

  test("every error the site answers with has words, which the app's sign-in shows", () => {
    const codes = [...readFileSync(path.join(import.meta.dir, "..", "site", "server.ts"), "utf8").matchAll(/error: "(\w+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(5);
    for (const code of codes) for (const lang of ["he", "en"] as const) expect(translate(lang, `errors.${code}`)).not.toBe(`errors.${code}`);
  });

  test("unlinking gives the name back", async () => {
    await remote.unlink();
    expect(remote.status().linked).toBe(false);
    expect(site.store.named("dana")).toBeNull();
  });
});
