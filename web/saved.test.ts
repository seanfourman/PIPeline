import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSaved, setSaved } from "./saved";

const file = () => path.join(mkdtempSync(path.join(os.tmpdir(), "job-saved-")), "saved_jobs.json");
const job = (n: number) => ({ url: `https://www.linkedin.com/jobs/view/${n}`, title: `Role ${n}`, company: `Co ${n}`, location: "Tel Aviv", date: "2026-11-04" });

describe("the jobs the user saved", () => {
  test("a job saved is kept with what was shown of it, the newest first, once", () => {
    const f = file();
    setSaved(job(1), f, "2026-11-06T10:00:00.000Z");
    setSaved(job(2), f, "2026-11-06T11:00:00.000Z");
    setSaved(job(1), f, "2026-11-06T12:00:00.000Z");
    expect(readSaved(f).map((j) => j.title)).toEqual(["Role 1", "Role 2"]);
    expect(readSaved(f)[0]).toEqual({ ...job(1), saved: "2026-11-06T12:00:00.000Z" });
  });

  test("save: false takes it off", () => {
    const f = file();
    setSaved(job(1), f);
    setSaved(job(2), f);
    expect(setSaved({ url: job(1).url, save: false }, f).map((j) => j.title)).toEqual(["Role 2"]);
  });

  test("only a web address is taken, and what a page sends is cleaned and cut to size", () => {
    const f = file();
    expect(() => setSaved({ ...job(1), url: "javascript:alert(1)" }, f)).toThrow("bad_url");
    expect(() => setSaved({ ...job(1), url: "" }, f)).toThrow("bad_url");
    const [saved] = setSaved({ ...job(3), title: `<b>${"x".repeat(400)}</b>`, company: { a: 1 } }, f);
    expect(saved.title.length).toBe(200);
    expect(saved.title).not.toContain("<");
    expect(saved.company).toBe("[object Object]");
  });

  test("nothing saved yet, or a file that isn't a list, reads as none", () => {
    expect(readSaved(file())).toEqual([]);
    const f = file();
    setSaved(job(1), f);
    expect(JSON.parse(readFileSync(f, "utf8"))).toHaveLength(1);
  });
});
