import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProjects } from "./projects";
import { cleanName, matches, metaChange } from "./threads";

describe("threads", () => {
  test("takes a change to a conversation's place in the list, field by field, and refuses one that doesn't hold up", () => {
    expect(metaChange({ title: "  CV for   Wix  " }, [])).toEqual({ title: "CV for Wix" });
    expect(metaChange({ pinned: true }, [], 1000)).toEqual({ pinned: 1000 });
    expect(metaChange({ pinned: false }, [])).toEqual({ pinned: null });
    expect(metaChange({ archived: true }, [])).toEqual({ archived: true, pinned: null });
    expect(metaChange({ archived: false }, [])).toEqual({ archived: false });
    expect(metaChange({ project: "p1" }, ["p1"])).toEqual({ project: "p1" });
    expect(metaChange({ project: "" }, ["p1"])).toEqual({ project: null });
    expect(metaChange({ project: null }, [])).toEqual({ project: null });
    expect(metaChange({ project: "gone" }, ["p1"])).toBeNull();
    expect(metaChange({ title: "   " }, [])).toBeNull();
    expect(metaChange({ pinned: "yes" }, [])).toBeNull();
    expect(metaChange({}, [])).toBeNull();
    expect(cleanName("a\n  b", 80)).toBe("a b");
  });

  test("finds a conversation by its title or its words, every word asked for, without case", () => {
    const c = { title: "Interview prep: Mobileye", events: [{ t: "user", text: "Help me with the system design round" }, { t: "text", text: "Sure. Start with the requirements." }, { t: "tool", text: "secret" }] };
    expect(matches(c, "mobileye")).toBe(true);
    expect(matches(c, "system DESIGN")).toBe(true);
    expect(matches(c, "mobileye requirements")).toBe(true);
    expect(matches(c, "secret")).toBe(false);
    expect(matches(c, "mobileye kubernetes")).toBe(false);
    expect(matches(c, "  ")).toBe(false);
  });

  test("keeps projects in one file: made, renamed, deleted, and a bad name refused", () => {
    const store = createProjects(path.join(mkdtempSync(path.join(os.tmpdir(), "projects-")), "app", "projects.json"));
    expect(store.list()).toEqual([]);
    const a = store.create("  Job search  ")!;
    const b = store.create("Interviews")!;
    expect(store.list().map((p) => p.name)).toEqual(["Job search", "Interviews"]);
    expect(store.create(" ")).toBeNull();
    expect(store.rename(a.id, "Applications")?.name).toBe("Applications");
    expect(store.rename("nope", "x")).toBeNull();
    expect(store.remove(b.id)).toBe(true);
    expect(store.remove(b.id)).toBe(false);
    expect(store.list().map((p) => p.name)).toEqual(["Applications"]);
  });
});
