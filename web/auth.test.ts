import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAuth, SESSION_COOKIE } from "./auth";

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

  test("refuses an empty name or a short password", async () => {
    const auth = createAuth(accountFile());
    await expect(auth.create("", "a-long-secret")).rejects.toThrow("account_name");
    await expect(auth.create("x".repeat(41), "a-long-secret")).rejects.toThrow("account_name");
    await expect(auth.create("dana", "12345")).rejects.toThrow("account_password");
    expect(auth.needsAccount()).toBe(true);
  });
});

describe("the login", () => {
  test("accepts only the account's name with its password", async () => {
    const file = accountFile();
    await createAuth(file).create("dana", "a-long-secret");
    const auth = createAuth(file);
    for (const [user, password] of [["dana", "wrong"], ["Dana", "a-long-secret"], ["", ""], [undefined, undefined], ["admin", "admin"]]) {
      expect(await auth.login(user, password)).toBeNull();
    }
    expect(await auth.login("dana", "a-long-secret")).toMatch(/^[0-9a-f]{32}$/);
    // Spaces typed around the name do not count.
    expect(await auth.login(" dana ", "a-long-secret")).toMatch(/^[0-9a-f]{32}$/);
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

  test("sessions belong to one server run", async () => {
    const file = accountFile();
    const id = await createAuth(file).create("dana", "a-long-secret");
    expect(createAuth(file).check(cookie(id))).toBe(false);
  });
});
