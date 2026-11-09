import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NAME_RULE as SITE_NAME_RULE } from "../site/store";
import { createAuth, openedByHand, REMEMBERED_COOKIE, rememberedCookie, rememberedOf, SESSION_COOKIE, SESSION_MS } from "./auth";
import { commonPasswords, NAME_RULE, nameProblem, PASSWORD_MIN, passwordChecks, passwordError } from "./ui/account-rules";

const cookie = (id: string, others = "job_token=abc") => `${others}; ${SESSION_COOKIE}=${id}`;
const accountFile = () => path.join(mkdtempSync(path.join(os.tmpdir(), "account-")), "app", "account.json");

describe("the account", () => {
  test("the first visit makes it, once, and is logged in", async () => {
    const file = accountFile();
    const auth = createAuth(file);
    expect(auth.needsAccount()).toBe(true);
    const id = await auth.create("dana", "a-long-secret");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(auth.check(cookie(id))).toBe(true);
    expect(auth.needsAccount()).toBe(false);
    expect(auth.user()).toBe("dana");
    await expect(auth.create("eve", "another-secret")).rejects.toThrow("account_exists");
  });

  test("keeps a hash of the password, never the password", async () => {
    const file = accountFile();
    await createAuth(file).create("dana", "a-long-secret");
    const saved = readFileSync(file, "utf8");
    expect(saved).not.toContain("a-long-secret");
    expect(JSON.parse(saved)).toMatchObject({ user: "dana", hash: expect.stringMatching(/^\$argon2/) });
  });

  test("refuses a name the site couldn't take, and a password too short, too common or with the name in it", async () => {
    const auth = createAuth(accountFile());
    for (const name of ["", "x".repeat(41), "@dana", "da<na>", "-dana", "dana\u0000"]) {
      await expect(auth.create(name, "a-long-secret")).rejects.toThrow("account_name");
    }
    await expect(auth.create("dana", "12345")).rejects.toThrow("account_password");
    await expect(auth.create("dana", "abcdefg")).rejects.toThrow("account_password");
    await expect(auth.create("dana", "FootBall")).rejects.toThrow("account_password_common");
    await expect(auth.create("dana", "Dana-2024")).rejects.toThrow("account_password_name");
    expect(() => auth.validate("dana", "12345678")).toThrow("account_password_common");
    expect(() => auth.validate("dana", "a-long-secret")).not.toThrow();
    expect(auth.needsAccount()).toBe(true);
  });

  test("takes names in any letters, with dots, dashes, underscores and spaces after the first", async () => {
    for (const name of ["דנה כהן", "dana.k", "Dana_K-2", "7even"]) {
      const auth = createAuth(accountFile());
      await auth.create(name, "a-long-secret");
      expect(auth.user()).toBe(name);
    }
  });
});

describe("the rules a new account keeps", () => {
  test("are the site's own for the name", () => {
    expect(NAME_RULE.source).toBe(SITE_NAME_RULE.source);
    expect(NAME_RULE.flags).toBe(SITE_NAME_RULE.flags);
  });

  test("say what is wrong with a name", () => {
    expect(nameProblem("  ")).toEqual({ problem: "empty" });
    expect(nameProblem("x".repeat(41))).toEqual({ problem: "long" });
    expect(nameProblem("_dana")).toEqual({ problem: "start" });
    expect(nameProblem("dana@home")).toEqual({ problem: "char", char: "@" });
    expect(nameProblem(" dana k ")).toEqual({ problem: "" });
  });

  test("check the password rule by rule", () => {
    const common = new Set(["password", "12345678"]);
    expect(passwordChecks("short", "dana", common)).toEqual({ long: false, common: true, name: true });
    expect(passwordChecks("PassWord", "dana", common)).toEqual({ long: true, common: false, name: true });
    expect(passwordChecks("my-dana-pw", "Dana", common)).toEqual({ long: true, common: true, name: false });
    // A name of two letters counts only as the whole password.
    expect(passwordChecks("al-is-here", "al", common).name).toBe(true);
    expect(passwordChecks("al", "al", common).name).toBe(false);
    expect(passwordError("a-long-secret", "dana", common)).toBe("");
  });

  test("list the common passwords of eight characters or more, in lower case", () => {
    const file = path.join(import.meta.dir, "public", "common-passwords.txt");
    expect(existsSync(file)).toBe(true);
    const list = commonPasswords(readFileSync(file, "utf8"));
    expect(list.size).toBeGreaterThan(2000);
    for (const p of ["password", "12345678", "football", "qwerty123"]) expect(list.has(p)).toBe(true);
    for (const p of list) {
      expect([...p].length).toBeGreaterThanOrEqual(PASSWORD_MIN);
      expect(p).toBe(p.toLowerCase());
    }
  });
});

describe("the login", () => {
  test("accepts only the account's name with its password", async () => {
    const file = accountFile();
    await createAuth(file).create("dana", "a-long-secret");
    const auth = createAuth(file);
    for (const [user, password] of [["dana", "wrong"], ["dana", "A-LONG-SECRET"], ["dan", "a-long-secret"], ["", ""], [undefined, undefined], ["admin", "admin"]]) {
      expect(await auth.login(user, password)).toBeNull();
    }
    expect(await auth.login("dana", "a-long-secret")).toMatch(/^[0-9a-f]{32}$/);
    // Spaces typed around the name do not count, nor its case, as on the site.
    expect(await auth.login(" dana ", "a-long-secret")).toMatch(/^[0-9a-f]{32}$/);
    expect(await auth.login("DaNa", "a-long-secret")).toMatch(/^[0-9a-f]{32}$/);
  });

  test("with no account yet, nothing logs in", async () => {
    expect(await createAuth(accountFile()).login("admin", "admin")).toBeNull();
  });

  test("a session opens the API until logout", async () => {
    const auth = createAuth(accountFile());
    const id = await auth.create("dana", "a-long-secret");
    expect(auth.check(`${SESSION_COOKIE}=${id}`)).toBe(true);
    auth.logout(cookie(id));
    expect(auth.check(cookie(id))).toBe(false);
  });

  test("a made-up or partial session opens nothing", async () => {
    const auth = createAuth(accountFile());
    const id = await auth.create("dana", "a-long-secret");
    for (const header of [null, "", cookie("x"), cookie(id.slice(1)), `x${SESSION_COOKIE}=${id}`, `${SESSION_COOKIE}=`]) {
      expect(auth.check(header)).toBe(false);
    }
  });

  test("a login outlasts the server starting again, as when Pip updates itself", async () => {
    const file = accountFile();
    const id = await createAuth(file).create("dana", "a-long-secret");
    expect(createAuth(file).check(cookie(id))).toBe(true);
    // Only a hash of it is written down.
    expect(readFileSync(path.join(path.dirname(file), "sessions.json"), "utf8")).not.toContain(id);
  });

  test("but not a logout, an account made again, or a month unused", async () => {
    const file = accountFile();
    const kept = path.join(path.dirname(file), "sessions.json");
    const first = createAuth(file);
    const id = await first.create("dana", "a-long-secret");
    const other = (await first.login("dana", "a-long-secret"))!;
    first.logout(cookie(id));
    expect(createAuth(file).check(cookie(id))).toBe(false);
    expect(createAuth(file).check(cookie(other))).toBe(true);
    // A month unused.
    const old = JSON.parse(readFileSync(kept, "utf8"));
    for (const key of Object.keys(old.sessions)) old.sessions[key] = Date.now() - SESSION_MS - 1000;
    writeFileSync(kept, JSON.stringify(old));
    expect(createAuth(file).check(cookie(other))).toBe(false);
    // The account made again, after its password was forgotten: the old account's logins are no longer its own.
    const again = accountFile();
    const was = await createAuth(again).create("dana", "a-long-secret");
    rmSync(again);
    await createAuth(again).create("noa", "another-secret");
    expect(createAuth(again).check(cookie(was))).toBe(false);
  });
});

describe("the logins the browser keeps to this computer's other accounts", () => {
  const dana = "0123456789abcdef";
  const noa = "fedcba9876543210".padEnd(32, "0");
  const one = "f".repeat(32);
  const two = "e".repeat(32);

  test("are read from their own cookie, each an account's id and a login's id, and nothing else", () => {
    const header = `job_token=abc; ${SESSION_COOKIE}=${one}; ${REMEMBERED_COOKIE}=${dana}.${one}_${noa}.${two}_nonsense_${dana.slice(1)}.${one}_${dana}.${one}x`;
    expect([...rememberedOf(header)]).toEqual([[dana, one], [noa, two]]);
    for (const none of [null, "", `job_token=abc; ${SESSION_COOKIE}=${one}`, `x${REMEMBERED_COOKIE}=${dana}.${one}`, `${REMEMBERED_COOKIE}=`]) {
      expect(rememberedOf(none).size).toBe(0);
    }
  });

  test("are written back so, and with none left the cookie goes", () => {
    const kept = new Map([[dana, one], [noa, two]]);
    const cookie = rememberedCookie(kept);
    expect(cookie).toBe(`${REMEMBERED_COOKIE}=${dana}.${one}_${noa}.${two}; HttpOnly; SameSite=Strict; Path=/`);
    expect(rememberedOf(cookie.split(";")[0])).toEqual(kept);
    expect(rememberedCookie(new Map())).toBe(`${REMEMBERED_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  });

  test("open their account only while the login is still its own", async () => {
    const file = accountFile();
    const id = await createAuth(file).create("dana", "a-long-secret");
    const auth = createAuth(file);
    expect(auth.holds(id)).toBe(true);
    for (const wrong of ["", id.slice(1), "0".repeat(32)]) expect(auth.holds(wrong)).toBe(false);
    auth.logout(cookie(id));
    expect(createAuth(file).holds(id)).toBe(false);
  });
});

describe("a page of Pip asked for by hand, let past the start link's cookie", () => {
  const asked = (headers: Record<string, string>) => openedByHand(new Headers(headers));
  const page = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

  test("its address typed or a bookmark opened, and a click on Pip's own page, are let in", () => {
    expect(asked({ ...page, "sec-fetch-site": "none", "sec-fetch-user": "?1" })).toBe(true);
    expect(asked({ ...page, "sec-fetch-site": "none" })).toBe(true);
    expect(asked({ ...page, "sec-fetch-site": "same-origin", "sec-fetch-user": "?1" })).toBe(true);
  });

  test("another site's link, a page on another of this computer's ports, or a page moving itself, are not", () => {
    expect(asked({ ...page, "sec-fetch-site": "cross-site", "sec-fetch-user": "?1" })).toBe(false);
    expect(asked({ ...page, "sec-fetch-site": "same-site", "sec-fetch-user": "?1" })).toBe(false);
    expect(asked({ ...page, "sec-fetch-site": "same-origin" })).toBe(false);
  });

  test("a script's request, a frame, a picture, or a browser that says nothing, are not", () => {
    expect(asked({ "sec-fetch-site": "none", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" })).toBe(false);
    expect(asked({ "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" })).toBe(false);
    expect(asked({ "sec-fetch-site": "none", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" })).toBe(false);
    expect(asked({})).toBe(false);
  });
});
