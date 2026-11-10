import { describe, expect, test } from "bun:test";
import { dirOf, parseProfile, parts, profileDir, profileHealth, roleHead, skillsOf } from "./ui/profile-parse";

const NOW = new Date(2026, 10, 10);
const PROFILE = `# Candidate Profile

<!-- SETUP: a note that never shows -->

## Identity
- **Name:** Dana Levi
- **Location:** Haifa, Israel
- **Phone:** +972 50 123 4567
- **Email:** dana@example.com
- **LinkedIn:** linkedin.com/in/dana
- **GitHub:** [YOUR_GITHUB_URL]
- **Status:** M.Sc. student
- **Notice period:** Two weeks

### Languages
| Language | Level | Notes |
|----------|-------|-------|
| Hebrew | Native | |
| English | Fluent | [optional] |

### Interests
- **Rock climbing**: weekends
- Board games

## Education

| Degree | Period | Institution | Key Topics |
|--------|--------|-------------|------------|
| B.Sc. in Computer Science | 2023 - 2026 | University of Haifa | Algorithms |

## Professional Experience

### Junior Software Engineer (Part-Time) - YOOZ (Aug 2025 - Present)
Israel. Verified from git history.
- Built features end to end.
  - With tests.
- Ran the deploys.

### [JOB_TITLE] - [COMPANY] ([START] - [END])
- [RESPONSIBILITY]

## Independent Projects
- **Trail Finder** (https://github.com/dana/trail, live: https://trail.example.com): A route planner.
  - Deployed nightly.
- **Bird Sounds**: A CNN.

## Technical Skills

### Programming & ML
- **Python** (advanced): pandas, NumPy
- **Statistics:** hypothesis testing

### Software & Tools
- Git, GitHub Actions, Docker
- Weights & Biases (experiment tracking)

## Publications
None yet.

## Awards
- Dean's list (2025)

## Claims Checked Against the Code
| Claim | Note |
|-------|------|
| Docker | at the lab |
`;

describe("profile-parse", () => {
  test("finds each part of the file, from its heading to the next", () => {
    const found = parts(PROFILE);
    expect(found.map((p) => p.title)).toEqual(["Identity", "Education", "Professional Experience", "Independent Projects", "Technical Skills", "Publications", "Awards", "Claims Checked Against the Code"]);
    expect(PROFILE.slice(found[1].start, found[1].end).startsWith("## Education")).toBe(true);
    expect(PROFILE.slice(found[1].start, found[1].end)).not.toContain("## Professional");
    expect(found[found.length - 1].end).toBe(PROFILE.length);
  });

  test("reads a role's head: the title up to the last dash, the company, the dates and how long", () => {
    expect(roleHead("Junior Software Engineer (Part-Time) - YOOZ (Aug 2025 - Present)", NOW)).toEqual({ title: "Junior Software Engineer (Part-Time)", company: "YOOZ", start: "Aug 2025", end: "Present", months: 16 });
    expect(roleHead("Software Engineering Project, Industry Collaboration - BlueBird Aero Systems (Oct 2025 - Jun 2026)", NOW)).toMatchObject({ company: "BlueBird Aero Systems", months: 9 });
    expect(roleHead("Electrical Technician - Israeli Air Force, mandatory service (2020 - 2023)", NOW).months).toBe(48);
    expect(roleHead("Freelance work", NOW)).toEqual({ title: "Freelance work", company: "", start: "", end: "", months: null });
  });

  test("turns skill lines into names, each with what it carries as its note", () => {
    expect(skillsOf("**Python** (advanced): pandas, NumPy")).toEqual([{ name: "Python", note: "(advanced): pandas, NumPy" }]);
    expect(skillsOf("**Statistics:** hypothesis testing")).toEqual([{ name: "Statistics", note: "hypothesis testing" }]);
    expect(skillsOf("Git, GitHub Actions; Docker").map((s) => s.name)).toEqual(["Git", "GitHub Actions", "Docker"]);
    expect(skillsOf("Weights & Biases (experiment tracking)")).toEqual([{ name: "Weights & Biases", note: "experiment tracking" }]);
    expect(skillsOf("Tableau and Power BI: basic, academic level")).toEqual([{ name: "Tableau and Power BI", note: "basic, academic level" }]);
    const sentence = skillsOf("Electrical systems troubleshooting from schematics in the field and at the bench");
    expect(sentence).toHaveLength(1);
    expect(sentence[0].name.endsWith("…")).toBe(true);
    expect(sentence[0].note).toContain("at the bench");
  });

  test("reads the whole profile, leaving out what the template left to fill and keeping what it doesn't know", () => {
    const p = parseProfile(PROFILE, NOW);
    expect(p).toMatchObject({ name: "Dana Levi", location: "Haifa, Israel", email: "dana@example.com", linkedin: "linkedin.com/in/dana", github: "", status: "M.Sc. student" });
    expect(p.facts).toEqual([{ key: "Notice period", value: "Two weeks" }]);
    expect(p.languages).toEqual([{ name: "Hebrew", level: "Native", notes: "" }, { name: "English", level: "Fluent", notes: "" }]);
    expect(p.interests).toEqual(["Rock climbing", "Board games"]);
    expect(p.education).toEqual([{ degree: "B.Sc. in Computer Science", period: "2023 - 2026", institution: "University of Haifa", topics: "Algorithms" }]);
    expect(p.roles).toHaveLength(1);
    expect(p.roles[0]).toMatchObject({ company: "YOOZ", notes: ["Israel. Verified from git history."], bullets: [{ text: "Built features end to end.", more: ["With tests."] }, { text: "Ran the deploys.", more: [] }] });
    expect(p.projects).toEqual([
      { name: "Trail Finder", links: ["https://github.com/dana/trail", "https://trail.example.com"], text: "A route planner.", more: ["Deployed nightly."] },
      { name: "Bird Sounds", links: [], text: "A CNN.", more: [] },
    ]);
    expect(p.skills.map((g) => [g.group, g.items.map((s) => s.name)])).toEqual([["Programming & ML", ["Python", "Statistics"]], ["Software & Tools", ["Git", "GitHub Actions", "Docker", "Weights & Biases"]]]);
    expect(p.publications).toEqual([]);
    expect(p.awards).toEqual(["Dean's list (2025)"]);
    expect(p.others.map((o) => o.title)).toEqual(["Claims Checked Against the Code"]);
    expect(JSON.stringify(p)).not.toContain("SETUP");
  });

  test("tells which way a line runs by its first letter", () => {
    expect(dirOf("פרטים אישיים")).toBe("rtl");
    expect(dirOf("(2) להציג עוד")).toBe("rtl");
    expect(dirOf("Claims Checked Against the Code")).toBe("ltr");
    expect(dirOf("2023 – 2026")).toBeNull();
  });

  test("tells which way the profile's own words run, leaving out names of skills and people", () => {
    expect(profileDir(parseProfile(PROFILE, NOW))).toBe("ltr");
    const hebrew = "## Identity\n- **Name:** Dana Levi\n- **Status:** סטודנטית לתואר שני\n\n## Professional Experience\n\n### מפתחת - YOOZ (Aug 2025 - Present)\n- בניתי שירות ב-Python\n- Built the deploys\n\n## Technical Skills\n- Python, React, Docker, Git\n";
    expect(profileDir(parseProfile(hebrew, NOW))).toBe("rtl");
    expect(profileDir(parseProfile("## Identity\n- **Name:** Dana Levi\n\n## Technical Skills\n- Python\n", NOW))).toBeNull();
  });

  test("scores the profile's health by what it has, and says what is missing", () => {
    const full = profileHealth(parseProfile(PROFILE, NOW));
    expect(full.score).toBe(100);
    const sparse = profileHealth(parseProfile("## Identity\n- **Name:** Dana\n- **Email:** d@example.com\n\n## Technical Skills\n- **Python**\n", NOW));
    expect(sparse.score).toBeLessThan(30);
    const missing = sparse.groups.flatMap((g) => g.checks).filter((c) => !c.ok).map((c) => c.id);
    expect(missing).toEqual(["phone", "location", "linkedin", "languages", "skills", "roles", "dates", "bullets", "education", "projects"]);
  });
});
