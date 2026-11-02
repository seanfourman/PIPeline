import { describe, expect, test } from "bun:test";
import { createAuth, SESSION_COOKIE } from "./auth";

const cookie = (id: string, others = "job_token=abc") => `${others}; ${SESSION_COOKIE}=${id}`;

describe("the login", () => {
  test("accepts only admin with the password admin", () => {
    const auth = createAuth();
    for (const [user, password] of [["admin", "wrong"], ["Admin", "admin"], ["admin ", "admin"], ["", ""], [undefined, undefined], ["root", "admin"]]) {
      expect(auth.login(user, password)).toBeNull();
    }
    expect(auth.login("admin", "admin")).toMatch(/^[0-9a-f]{32}$/);
  });

  test("a session opens the API until logout", () => {
    const auth = createAuth();
    const id = auth.login("admin", "admin")!;
    expect(auth.check(cookie(id))).toBe(true);
    expect(auth.check(`${SESSION_COOKIE}=${id}`)).toBe(true);
    auth.logout(cookie(id));
    expect(auth.check(cookie(id))).toBe(false);
  });

  test("a made-up or partial session opens nothing", () => {
    const auth = createAuth();
    const id = auth.login("admin", "admin")!;
    for (const header of [null, "", cookie("x"), cookie(id.slice(1)), `x${SESSION_COOKIE}=${id}`, `${SESSION_COOKIE}=`]) {
      expect(auth.check(header)).toBe(false);
    }
  });

  test("sessions belong to one server run", () => {
    const id = createAuth().login("admin", "admin")!;
    expect(createAuth().check(cookie(id))).toBe(false);
  });
});
