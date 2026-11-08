import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSite } from "../site/server";
import { applySwitch, ensureIds, findLocal, localAccounts, moveComputerFiles, requestSwitch } from "./accounts";
import { createRemote } from "./remote";
import { answerFile, answerManifest, manifest, safeRel, syncAccount } from "./sync";
import { deriveKey, openWith, sealWith } from "./synckey";

const temp = (name: string) => mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const put = (dir: string, rel: string, text: string, at?: number) => {
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (at) utimesSync(file, new Date(at), new Date(at));
};
const read = (dir: string, rel: string) => readFileSync(path.join(dir, rel), "utf8");
const account = (dir: string, user: string, id: string) => put(dir, "app/account.json", JSON.stringify({ user, hash: "h", id, salt: "00".repeat(16) }));

describe("several accounts on one computer", () => {
  test("the one asked for is swapped in at the start, the open one out under its id", () => {
    const root = temp("accounts");
    const user = path.join(root, "user"), users = path.join(root, "users");
    account(user, "dana", "aaaaaaaaaaaaaaaa");
    put(user, "cv/main_x.tex", "dana's");
    account(path.join(users, "bbbbbbbbbbbbbbbb"), "noa", "bbbbbbbbbbbbbbbb");
    expect(localAccounts(users, user).map((a) => [a.name, a.open])).toEqual([["dana", true], ["noa", false]]);
    expect(findLocal("NOA", users, user)?.id).toBe("bbbbbbbbbbbbbbbb");

    expect(applySwitch(users, user)).toBe("none");
    requestSwitch("bbbbbbbbbbbbbbbb", users);
    expect(applySwitch(users, user)).toBe("switched");
    expect(localAccounts(users, user).map((a) => [a.name, a.open])).toEqual([["noa", true], ["dana", false]]);
    expect(read(path.join(users, "aaaaaaaaaaaaaaaa"), "cv/main_x.tex")).toBe("dana's");
    expect(existsSync(path.join(users, "switch.json"))).toBe(false);
  });

  test("a stop halfway is mended at the next start, and a missing account leaves all as it was", () => {
    const root = temp("accounts");
    const user = path.join(root, "user"), users = path.join(root, "users");
    // Out already, not in yet.
    account(path.join(users, "bbbbbbbbbbbbbbbb"), "noa", "bbbbbbbbbbbbbbbb");
    account(path.join(users, "aaaaaaaaaaaaaaaa"), "dana", "aaaaaaaaaaaaaaaa");
    requestSwitch("bbbbbbbbbbbbbbbb", users);
    expect(applySwitch(users, user)).toBe("switched");
    expect(localAccounts(users, user)[0]).toMatchObject({ name: "noa", open: true });
    // Asked for one that isn't here.
    requestSwitch("cccccccccccccccc", users);
    expect(applySwitch(users, user)).toBe("failed");
    expect(localAccounts(users, user)[0]).toMatchObject({ name: "noa", open: true });
  });

  test("a new computer's starting folder goes aside, kept, and is no account", () => {
    const root = temp("accounts");
    const user = path.join(root, "user"), users = path.join(root, "users");
    put(user, "CLAUDE.md", "[YOUR_NAME]");
    account(path.join(users, "bbbbbbbbbbbbbbbb"), "noa", "bbbbbbbbbbbbbbbb");
    requestSwitch("bbbbbbbbbbbbbbbb", users);
    expect(applySwitch(users, user)).toBe("switched");
    expect(readdirSync(users).some((n) => n.startsWith("unused-"))).toBe(true);
    expect(localAccounts(users, user).map((a) => a.name)).toEqual(["noa"]);
  });

  test("an older account gets an id and a salt once; the site link moves out to the computer's own files", () => {
    const root = temp("accounts");
    const user = path.join(root, "user"), users = path.join(root, "users");
    put(user, "app/account.json", JSON.stringify({ user: "dana", hash: "h" }));
    const first = ensureIds(user)!;
    expect(first.id).toMatch(/^[0-9a-f]{16}$/);
    expect(first.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(ensureIds(user)).toEqual(first);
    put(user, "app/remote.json", '{"site":"x"}');
    moveComputerFiles(users, user);
    expect(read(users, "remote.json")).toBe('{"site":"x"}');
    expect(existsSync(path.join(user, "app", "remote.json"))).toBe(false);
  });
});

describe("an account kept alike on its computers", () => {
  test("only a path inside the account's folder, and not one of the computer's own files, is taken", () => {
    for (const ok of ["cv/main_x.tex", "app/settings.json", "app/sessions/1.json"]) expect(safeRel(ok)).toBe(true);
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b", "", "app/sessions.json", "app/token", "app/sync-key.json", "app/sync-backup/2026-11-08/x", "_backup_2026-11-04/cv.tex", "a//b"]) {
      expect(safeRel(bad)).toBe(false);
    }
  });

  test("the list leaves out the computer's own files and keeps what was deleted", () => {
    const dir = temp("sync");
    put(dir, "cv/a.tex", "a");
    put(dir, "app/token", "secret");
    put(dir, "app/sessions.json", "{}");
    put(dir, "app/sync-key.json", "{}");
    expect(Object.keys(manifest(dir).files)).toEqual(["cv/a.tex"]);
    rmSync(path.join(dir, "cv/a.tex"));
    const now = Date.now();
    expect(manifest(dir, now).deleted).toEqual({ "cv/a.tex": now });
  });

  // Two computers' folders, each answering the other as server.ts does, through a stand-in for the site.
  const key = deriveKey("a-long-secret", "00".repeat(16));
  const between = (from: string, k = key) => ({
    peers: async () => [{ id: "other", online: true }],
    peer: async (_account: string, _to: string, what: "manifest" | "file", rel?: string) => {
      const box = what === "manifest" ? answerManifest(from, k) : answerFile(from, k, rel);
      return box ? new Response(box) : new Response("", { status: 404 });
    },
  });

  test("a newer file comes over, an older one doesn't, and a deletion does; what is replaced is put aside", async () => {
    const a = temp("sync-a"), b = temp("sync-b");
    // Times from ten days ago, a few seconds apart.
    const at = (s: number) => Date.now() - 10 * 86_400_000 + s * 1000;
    put(a, "cv/main_x.tex", "new on a", at(2));
    put(b, "cv/main_x.tex", "old on b", at(1));
    put(b, "letters/l.tex", "newer on b", at(3));
    put(a, "letters/l.tex", "older on a", at(1));
    put(a, "app/token", "a's own");
    const got = await syncAccount({ dir: b, account: "dana", key, peers: between(a), now: at(5) });
    expect(got).toEqual({ pulled: 1, removed: 0, reached: 1 });
    expect(read(b, "cv/main_x.tex")).toBe("new on a");
    expect(read(b, "letters/l.tex")).toBe("newer on b");
    expect(existsSync(path.join(b, "app", "token"))).toBe(false);
    expect(read(b, `app/sync-backup/${new Date(at(5)).toISOString().slice(0, 10)}/cv/main_x.tex`)).toBe("old on b");
    // And back: a takes b's newer letter.
    await syncAccount({ dir: a, account: "dana", key, peers: between(b), now: at(5) });
    expect(read(a, "letters/l.tex")).toBe("newer on b");

    // Deleted on a after b had it: gone from b too.
    manifest(a, at(6));
    rmSync(path.join(a, "letters/l.tex"));
    manifest(a, at(7));
    expect((await syncAccount({ dir: b, account: "dana", key, peers: between(a), now: at(8) })).removed).toBe(1);
    expect(existsSync(path.join(b, "letters/l.tex"))).toBe(false);
  });

  test("another key reads nothing", async () => {
    const a = temp("sync-a"), b = temp("sync-b");
    put(a, "cv/main_x.tex", "a", 2_000_000);
    const other = deriveKey("another-password", "00".repeat(16));
    expect(await syncAccount({ dir: b, account: "dana", key, peers: between(a, other) })).toEqual({ pulled: 0, removed: 0, reached: 0 });
    expect(() => openWith(other, sealWith(key, "x"))).toThrow();
  });
});

describe("a computer joining an account through the site", () => {
  const dir = temp("join");
  const dana = path.join(dir, "dana");
  const joined = path.join(dir, "joined");
  const salt = "11".repeat(16);
  const danaKey = deriveKey("a-long-secret", salt);
  const seen: Record<string, string>[] = [];
  let site: ReturnType<typeof startSite>;
  let origin = "";
  // The computer the account was made on, answering as server.ts's peerRoutes do.
  const first = createRemote({
    port: 4174, localToken: "tok", file: path.join(dir, "first.json"), accountName: () => "dana",
    handle: async (req) => {
      const url = new URL(req.url);
      seen.push({ path: url.pathname, peer: req.headers.get("x-pip-peer") ?? "", account: req.headers.get("x-pip-account") ?? "" });
      if (url.pathname === "/api/peer/join") {
        const body = await req.json();
        if (body.password !== "a-long-secret") return new Response('{"error":"bad_login"}', { status: 401 });
        return Response.json({ salt, box: sealWith(danaKey, JSON.stringify({ user: "dana", hash: "h", id: "dddddddddddddddd", salt })).toString("base64") });
      }
      if (url.pathname === "/api/peer/manifest") return new Response(answerManifest(dana, danaKey));
      const file = url.pathname === "/api/peer/file" ? answerFile(dana, danaKey, url.searchParams.get("p")) : null;
      return file ? new Response(file) : new Response("", { status: 404 });
    },
  });
  const second = createRemote({ port: 4174, localToken: "tok", file: path.join(dir, "second.json"), pairWith: "", handle: async () => new Response("", { status: 404 }) });
  const until = async (check: () => boolean, ms = 8000) => { for (const end = Date.now() + ms; !check() && Date.now() < end;) await Bun.sleep(50); return check(); };

  beforeAll(async () => {
    site = startSite({ port: 0, dataFile: ":memory:" });
    origin = `http://127.0.0.1:${site.server.port}`;
    put(dana, "app/account.json", JSON.stringify({ user: "dana", hash: "h", id: "dddddddddddddddd", salt }));
    put(dana, "cv/main_dana.tex", "dana's CV");
    put(dana, "app/sessions.json", "dana's logins here");
    await first.link(origin, "dana");
    await until(() => first.status().state === "on");
    const paired = createRemote({ port: 4174, localToken: "tok", file: path.join(dir, "second.json"), pairWith: origin, handle: async () => new Response("", { status: 404 }) });
    paired.start();
    await until(() => paired.status().state === "on");
    paired.stop();
    second.start();
    await until(() => second.status().state === "on");
  });
  afterAll(() => { first.stop(); second.stop(); site.stop(); });

  test("a computer not on the account can't ask its computers anything", async () => {
    expect(await second.peers("dana")).toEqual([]);
    expect((await second.peer("dana", site.store.named("dana")!.id, "manifest"))?.status).toBe(403);
  });

  test("the password is checked by the account's computer; no such account and a wrong password say so", async () => {
    await expect(second.join("nobody", "x")).rejects.toThrow("no_such_account");
    await expect(second.join("dana", "wrong-password")).rejects.toThrow("bad_login");
  });

  test("with the password, it joins, and takes the account's files, not the other computer's own", async () => {
    const { salt: given, box } = await second.join("DANA", "a-long-secret");
    const key = deriveKey("a-long-secret", given);
    expect(JSON.parse(openWith(key, Buffer.from(box, "base64")).toString("utf8")).id).toBe("dddddddddddddddd");
    const firstId = site.store.named("dana")!.id;
    expect(await second.peers("dana")).toEqual([{ id: firstId, online: true }]);
    const got = await syncAccount({ dir: joined, account: "dana", key, peers: second, all: true });
    expect(got.reached).toBe(1);
    expect(read(joined, "cv/main_dana.tex")).toBe("dana's CV");
    expect(existsSync(path.join(joined, "app", "sessions.json"))).toBe(false);
    // Marked by the site as the joining computer's, for the account.
    expect(seen.find((s) => s.path === "/api/peer/manifest")).toMatchObject({ account: "dana" });
    expect(seen.find((s) => s.path === "/api/peer/manifest")?.peer).toMatch(/^[0-9a-f]{32}$/);
  });
});
