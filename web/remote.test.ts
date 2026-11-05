import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSite } from "../site/server";
import { createRemote, siteAddress } from "./remote";

// A stand-in for the computer's server: what it saw of each request, a login, a slow stream, and an echo.
const seen: Request[] = [];
let streamCancelled = false;
async function handle(req: Request): Promise<Response> {
  seen.push(req);
  const url = new URL(req.url);
  if (url.pathname === "/") return new Response("<html>app</html>", { headers: { "Content-Type": "text/html" } });
  if (url.pathname === "/api/login") {
    const body = await req.json();
    if (body.user !== "dana" || body.password !== "a-long-secret") return new Response('{"error":"bad_login"}', { status: 401 });
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

describe("phone access", () => {
  test("the computer links under its account's name and stays connected", () => {
    expect(remote.status()).toMatchObject({ linked: true, name: "dana", state: "on", site: origin });
  });

  test("a phone that has not signed in goes to the sign-in", async () => {
    const res = await phone("/");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    expect((await phone("/api/state")).status).toBe(401);
    expect(await (await phone("/login")).text()).toContain("סיסמה");
  });

  test("the computer checks the password; the site passes on its session", async () => {
    const form = (name: string, password: string) => new URLSearchParams({ name, password });
    const headers = { Origin: origin };
    expect((await phone("/login", { method: "POST", body: form("dana", "a-long-secret") })).status).toBe(403);
    expect((await phone("/login", { method: "POST", headers, body: form("dana", "wrong") })).status).toBe(401);
    expect((await phone("/login", { method: "POST", headers, body: form("nobody", "x") })).status).toBe(401);
    const res = await phone("/login", { method: "POST", headers, body: form("Dana", "a-long-secret") });
    expect(res.status).toBe(303);
    signedIn = cookies(res);
    expect(signedIn).toContain("job_session=abc123");
    expect(signedIn).toContain("pip_user=dana");
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

  test("with the computer off, the phone is told so", async () => {
    remote.stop();
    await until(() => !site.relay.online("dana"));
    expect((await phone("/", { headers: { Cookie: signedIn } })).status).toBe(503);
    expect(await (await phone("/api/state", { headers: { Cookie: signedIn } })).json()).toEqual({ error: "pc_offline" });
    remote.start();
    expect(await until(() => site.relay.online("dana"))).toBe(true);
  });

  test("too many wrong passwords for a name stop being passed on", async () => {
    const headers = { Origin: origin };
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await phone("/login", { method: "POST", headers, body: new URLSearchParams({ name: "dana", password: "wrong" }) })).status;
    expect(last).toBe(429);
  });

  test("unlinking gives the name back", async () => {
    await remote.unlink();
    expect(remote.status().linked).toBe(false);
    expect(site.store.named("dana")).toBeNull();
  });
});
