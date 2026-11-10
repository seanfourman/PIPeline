import { describe, expect, test } from "bun:test";
import { factsIn, skillsIn } from "./posting-words";

describe("posting-words", () => {
  test("finds the skills a posting names in order, required unless counted an advantage, and had when the profile names them", () => {
    const lines = [
      "## Requirements", "• 2+ years with Python and SQL", "• Experience with React or Angular", "• C/C++ - an advantage",
      "## Nice to have", "• Docker, Kubernetes", "• Python scripting",
      "Send your CV to jobs@acme.example",
    ];
    expect(skillsIn(lines, "Python, React, Docker")).toEqual([
      { name: "Python", must: true, have: true }, { name: "SQL", must: true, have: false }, { name: "React", must: true, have: true }, { name: "Angular", must: true, have: false },
      { name: "C++", must: false, have: false }, { name: "C", must: false, have: false }, { name: "Docker", must: false, have: true }, { name: "Kubernetes", must: false, have: false },
    ]);
  });

  test("doesn't take a word for a skill where it means something else", () => {
    expect(skillsIn(["JavaScript and Node.js", "C-level reporting", "Let's go to market", "Express your interest"], "").map((s) => s.name)).toEqual(["JavaScript", "Node.js"]);
  });

  test("reads how a posting is worked: its kind, where, and days in the office, in English and Hebrew", () => {
    expect(factsIn("Full-time position. Hybrid: 3 days a week in the office.")).toEqual({ employment: "full_time", workMode: "hybrid", officeDays: 3 });
    expect(factsIn("Fully remote, part-time")).toEqual({ employment: "part_time", workMode: "remote" });
    expect(factsIn("משרה מלאה, עבודה היברידית, 2 ימים מהמשרד")).toEqual({ employment: "full_time", workMode: "hybrid", officeDays: 2 });
    expect(factsIn("We build robots.")).toEqual({});
  });
});
