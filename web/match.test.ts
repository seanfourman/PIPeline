import { describe, expect, test } from "bun:test";
import { mkdtempSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { autoScore, createAutoScores, postingPart, roleFit, roleWords, skillsFit, words, yearsFit } from "./match";
import { profileSkills } from "./posting-words";
import { fromList, listedRole, type Role } from "./roles";
import { jobId } from "./ui/jobid";

const ROLES: Role[] = [fromList(listedRole("fullstack")!, "junior"), fromList(listedRole("backend")!, "junior")];
const PROFILE = "Skills: Python, React, Docker, SQL, Git, Linux";
const POSTING = [
  "## Requirements", "• 1+ years of experience with Python or Node.js", "• React and SQL", "• Docker", "## Nice to have", "• Kubernetes", "• AWS",
];
const read = (title: string, lines: string[], years: number | null = null) => ({ title, read: { status: "read", lines, years: years === null ? null : { min: years } } });
const base = { have: profileSkills(PROFILE), roles: roleWords(ROLES), field: [], seniority: "junior" };

describe("the automatic score", () => {
  test("a title's words are written one way, in English or Hebrew, without their level", () => {
    expect(words("Junior Full-Stack Engineer")).toEqual(["fullstack", "developer"]);
    expect(words("מפתח/ת פול סטאק לסטודנטים")).toEqual(["developer", "fullstack"]);
    expect(words("Back End Developer (Node.js)")).toEqual(["backend", "developer", "node.js"]);
    expect(words("Senior Data Scientist")).toEqual(["datascience"]);
  });

  test("a title fits the role whose words it has, by its English title or its Hebrew name", () => {
    const roles = roleWords(ROLES);
    expect(roleFit("Fullstack Developer", roles, []).fit).toBe(1);
    expect(roleFit("מפתח/ת צד שרת", roles, []).role?.id).toBe("backend");
    expect(roleFit("מפתח/ת צד שרת", roles, []).fit).toBe(1);
    // What every engineer's title has counts half: a software engineer is a third of the way to a full stack one.
    expect(roleFit("Software Engineer", roles, []).fit).toBeCloseTo(1 / 3);
    expect(roleFit("Sales Manager", roles, []).fit).toBe(0);
    // In the roles' field but with none of a role's words: a little, and no role named.
    expect(roleFit("Python Programmer", roleWords([fromList(listedRole("analyst")!, "junior")]), ["python"])).toEqual({ fit: 0.4, role: null });
    expect(roleFit("QA Automation Engineer", roles, ["engineer"])).toEqual({ fit: 0.4, role: null });
    // No roles set: not counted against.
    expect(roleFit("Anything", [], []).fit).toBe(0.7);
  });

  test("the years asked are weighed against the level searched for", () => {
    expect(yearsFit(1, "junior", "Developer", true)).toBe(1);
    expect(yearsFit(2, "junior", "Developer", true)).toBe(0.6);
    expect(yearsFit(4, "junior", "Developer", true)).toBe(0.1);
    expect(yearsFit(null, "junior", "Developer", true)).toBe(0.85);
    expect(yearsFit(null, "junior", "Developer", false)).toBe(0.5);
    expect(yearsFit(null, "junior", "Junior Developer", false)).toBe(1);
    expect(yearsFit(6, "senior", "Developer", true)).toBe(1);
    expect(yearsFit(8, "any", "Developer", true)).toBe(1);
  });

  test("the skills the profile shows count, a required one twice, and a few named say little", () => {
    expect(skillsFit([], new Set())).toBe(0.3);
    expect(skillsFit([{ name: "Python", must: true }], new Set(["Python"]))).toBeCloseTo(0.65);
    expect(skillsFit([{ name: "Python", must: true }], new Set())).toBeCloseTo(0.15);
    const many = ["A", "B", "C", "D", "E"].map((name) => ({ name, must: true }));
    expect(skillsFit(many, new Set(["A", "B", "C", "D", "E"]))).toBeCloseTo(10.6 / 12);
    expect(skillsFit([...many, { name: "F", must: false }], new Set(["A", "B", "C", "D", "E"]))).toBeCloseTo(10.6 / 13);
  });

  test("a read posting that asks for what the profile has, in a role searched for, is a strong fit; one outside the roles isn't", () => {
    const strong = autoScore({ ...base, title: "Junior Full Stack Developer", tier: "ok", posting: postingPart(read("Junior Full Stack Developer", POSTING, 1)) });
    expect(strong.basis).toBe("posting");
    expect(strong.score).toBeGreaterThanOrEqual(75);
    expect(strong.skills).toEqual({ have: 4, of: 7, mustHave: 4, mustOf: 5 });
    expect(strong.role?.id).toBe("fullstack");
    expect(strong.years).toBe(1);
    const outside = autoScore({ ...base, title: "Data Analyst", tier: "ok", posting: postingPart(read("Data Analyst", ["• SQL, Excel and Tableau"])) });
    expect(outside.role).toBeNull();
    expect(outside.score).toBeLessThan(60);
  });

  test("a job known by its title alone is never a strong fit, however well its title fits", () => {
    const title = autoScore({ ...base, title: "Junior Full Stack Developer", tier: "ok", posting: null });
    expect(title.basis).toBe("title");
    expect(title.skills).toBeNull();
    expect(title.score).toBeLessThan(75);
    expect(title.score).toBeGreaterThanOrEqual(60);
    expect(autoScore({ ...base, title: "Sales Manager", tier: "ok", posting: null }).score).toBeLessThan(45);
    // A posting that wouldn't open is known by its title alone too.
    expect(postingPart({ title: "X", read: { status: "unreachable" } })).toBeNull();
  });

  test("scores the list from the postings kept, reading each file again only once it changed", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "auto-"));
    const url = "https://jobs.acme.example/7";
    let profile = PROFILE;
    const auto = createAutoScores({ dir, profile: () => profile });
    const settings = { roles: ROLES, seniority: "junior" };
    const job = { url, title: "Junior Full Stack Developer", tier: "ok" };
    expect(auto.scorer(settings)(job).basis).toBe("title");
    // Saved as postings.ts saves, through a rename.
    const save = (body: unknown) => { writeFileSync(path.join(dir, "tmp"), JSON.stringify(body)); renameSync(path.join(dir, "tmp"), path.join(dir, `${jobId(url)}.json`)); };
    save({ id: jobId(url), url, ...read(job.title, POSTING, 1) });
    const first = auto.scorer(settings)(job);
    expect(first.basis).toBe("posting");
    // The profile showing more skills raises it.
    profile = `${PROFILE}, Node.js, Kubernetes, AWS`;
    expect(auto.scorer(settings)(job).score).toBeGreaterThan(first.score);
    // A posting read again that asks for four years falls.
    save({ id: jobId(url), url, ...read(job.title, POSTING, 4) });
    expect(auto.scorer(settings)(job).score).toBeLessThan(first.score);
    // One job's, from its posting as its page has it.
    expect(auto.of(read(job.title, POSTING, 1), "ok", settings).basis).toBe("posting");
  });
});
