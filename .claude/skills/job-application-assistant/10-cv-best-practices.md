---
framework_version: 1.0.0
---

# CV Best Practices

What the research on CVs agrees on, turned into rules for writing and reviewing a tailored CV, section by section. **Part 1** is the rules: the CV writer and the reviewer follow them for every CV, and the web interface sends them to whichever AI writes the CV. **Part 2** points to [`cv-research/`](cv-research/README.md), which holds the evidence for every rule with its sources: what recruiters, hiring systems, studies and the largest employers say.

**What wins.** `user/CV_RULES.md`, the limits and banned wording in `user/cv_checks.json`, and the template's guide win over anything here. Nothing here is a reason to claim what the profile and the master CV don't state. The examples below show a shape only: their brackets are filled from the profile, never invented.

## Part 1: The rules

### How a CV is read

1. **Three readers, in this order.** First a hiring system parses the CV and, at many large employers, grades it against the posting's requirements (Workday's AI grades from A to D). Then a recruiter searches it by title and keywords, now or months later. Then a person decides in seconds whether to read on, looking at the job titles, the employers and the first words of each line. Write for all three.
2. **The top third decides.** The role line, the summary and the first entries must show, without reading further, the role this CV is for, the two or three requirements the candidate matches best, and the evidence for them.
3. **What employers look for is shown, never claimed.** Employers rank problem-solving, teamwork, written communication and initiative highest on a CV, and the largest hire for learning ability, ownership and impact. These appear only as facts in the bullets: what the candidate solved, with whom, what they started, what they learned to get it done.

### Aim it at the posting

4. **Every required qualification the candidate meets is visible,** in the posting's own words, with the preferred ones after them. Meta and Amazon tell applicants exactly this, and Workday's AI gives a CV that shows every basic qualification an A or a B.
5. **The posting's exact words for what the candidate really has.** Hiring systems and recruiters match strings: "Power BI", not "BI dashboards"; "A/B testing", not "experiments". Give a term once in full with its abbreviation where both are in use: "Business Intelligence (BI)". Internal jargon and shorthand (team names, internal tools, "QoQ") appear only when every reader in the field knows them.
6. **Every keyword sits in evidence.** A skill in Technical Skills also appears, where the profile allows, in a bullet or project that shows it used. Terms listed with no evidence read as stuffing, to people and to AI screeners alike.
7. **Never mirror the posting.** Don't copy its sentences and don't tick every requirement it lists (CV_RULES.md). A CV that matches everything is not believable, and an honest gap is fine.
8. **Most relevant first, everywhere.** Within each section, what matches this posting comes first. Work unrelated to it shrinks to its title and dates, or to one line with a result that carries over.

### The header

9. **The role line names the posting's title, or the closest one the background honestly supports,** with a focus taken from the posting ("DATA ANALYST | SQL & BI"). Adjust the title, never the level: no "Senior" the profile doesn't support.
10. **Contact: a personal email, the phone, LinkedIn, and GitHub or a portfolio,** with clean, live links (`linkedin.com/in/<name>`, `github.com/<name>`). For a technical role the GitHub link sits here at the top. Never a work email or work phone.
11. **Nothing personal.** No photo, age or date of birth, marital status, children, ID number, address or city, religion, nationality or health. None of it bears on the hire, and in Israel an employer may not decide on most of it.

### The summary

12. **The summary positions; the bullets prove.** Fill the CV rules' line count in this order:
    1. The role noun: the posting's title or the closest honest one, with the level or the degree.
    2. The two or three strongest matching skills in the posting's words, with the domain or kind of data they were used on.
    3. What sets the candidate apart for this role that no bullet already says: a domain, a combination of skills, the kind of problems solved.
    4. What the candidate brings to this team, concretely.

    Shape: "[Title] with [degree or years] and hands-on work in [skill], [skill] and [skill] on [domain or data]. [What sets them apart]. [What they bring to this team]."
13. **Never in a summary:** an objective ("seeking a challenging position"), "I" or "my", character adjectives (hard-working, team player, passionate, motivated, detail-oriented), a list of every skill, or an achievement a bullet already states.

### Technical Skills

14. **Exact tools, not vague areas.** Name each tool as its maker and the posting do ("PostgreSQL", "Power BI", "scikit-learn"), never "databases", "BI tools" or "machine learning libraries". A language can carry its libraries when the posting names them or they matter, as in "Python (pandas, scikit-learn)". No versions unless the posting asks for one.
15. **Few and relevant.** List only what this posting values and the candidate could discuss for five minutes in an interview: every irrelevant skill dilutes the rest. The build's limits in `cv_checks.json` cap the count, and within them fewer relevant skills beat more. Never pad a line.
16. **Three to five categories, named by kind, ordered by the posting.** The category the posting stresses most comes first. For a data role, for example: Languages (SQL, Python, R); Data & BI (Power BI, Tableau, Excel); Databases & Cloud; Methods (statistics, A/B testing, forecasting); Tools (Git, Jira). For a software role: Languages; Frameworks; Databases; Cloud & DevOps; Tools. Never a "Soft skills" or "Other" category.
17. **No levels, bars, stars or percentages** for technical skills. Spoken languages are the exception and go under Additional Information. Every skill listed is in the profile or the master CV, or among the additions CV_RULES.md allows.

### Professional Experience

18. **Bullets say what the candidate changed, built or decided, and what came of it, never the job description.** "Responsible for weekly reports" is a duty. "Automated the weekly sales report in [tool], replacing [the manual process] for [who used it]" is an accomplishment. Every large employer asks for accomplishments, not responsibilities.
19. **A result, how it was reached, and how it was measured.** Google's formula is "Accomplished [X] as measured by [Y], by doing [Z]". Lead with the result or the thing built, name the tools in the how, and end with the evidence. Google's own example of better: "Won second place out of 50 teams in hackathon" over "Won second place in hackathon".
20. **Numbers only from the profile or the master CV.** Where they have none, show scale honestly: how many users, rows, sources, reports or teams, how often, for whom, what it replaced. Never estimate, round up or invent a number.
21. **Show scope, recency and relevance.** Give the size of what was handled (users, data, money, people, deadlines) and put the newest relevant work first. Name the technologies used inside the bullets: a skill with no use behind it reads as random.
22. **Open with a specific verb in the past tense** (present only for ongoing work in the current role): built, automated, reduced, analyzed, designed, migrated, launched, cut, modeled, cleaned. Never "responsible for", "helped", "worked on", "involved in", "participated in" or "assisted with", and never "I".
23. **Short and varied.** One idea per bullet, on one line where possible: a bullet that spills a word or two onto a second line is rewritten to fit one, as Google's recruiters advise. Give three to five bullets to the most relevant role and fewer to the rest, as the CV rules allow. Use no verb twice in one role, and no run of bullets that all end "using X, Y and Z".
24. **Junior and unrelated jobs still show contribution.** When a role had no measurable result, show the candidate's own contribution and the skill it took ("trained [n] new staff on [system]"), or cut the role to one line. Leave something to tell in the interview: the CV doesn't hold every detail.
25. **By field.** For data roles: the data (its source, its size), the tool, and the decision or process the analysis changed, not only the dashboard that was built. For software roles: the system, its scale (users, requests, records, response time), the stack, and what changed for its users.

### Projects

26. **A project reads like a job:** the linked name and a one-line description, then the result first (users, accuracy, speed, adoption) and the technical detail after, naming the languages used. One deep, real project beats several tutorial copies such as a to-do app or a course's capstone.
27. **Include projects when they prove what the jobs don't,** above all early in a career, and drop the section when the posting doesn't need it (the template marks it optional).

### Education

28. **The degree as the diploma names it, the institution, and its months and years** (`Oct 2023 - Jul 2026`), as Google's recruiters ask recent graduates; an ongoing degree shows its expected end. The months come from the profile, never a guess. Add the GPA when the CV rules show it, and a distinction (honors, dean's list) in the template's parentheses.
29. **More detail the more recent the degree.** Students and new graduates may add a line of upper-level coursework or a final project that matches the posting, three to five courses at most; everyone else drops it. Matriculation (בגרות) and psychometric scores stay off once there is a degree, unless the posting asks for them.
30. **The template sets the section order.** Google's recruiters put education first for students and new graduates; whether to do that is the user's choice, never the writer's.

### Additional Information

31. **Languages,** native first, each with an honest level in LinkedIn's terms: native or bilingual, full professional, professional working, limited working, elementary. For example, "Hebrew (native), English (full professional)".
32. **Military Service in one line:** the role, the corps or unit as far as it may be named, the years, and one result or responsibility in civilian words ("led a team of [n]", not internal acronyms). Name the skills the role demanded, not only its title. A classified role shows skills and scale, never the mission. Reserve duty may appear when the role is relevant; it is never something the CV must explain, and an employer may not discriminate over it.
33. **Availability** only as the profile states it, and only when the posting raises it or it helps (a student's days and hours, a start date).
34. **Other lines only when they earn the space:** a relevant certification with its issuer, volunteering that shows a skill the posting wants, an award with its scale ("1st of [n] teams"), a publication. Interests appear only when they bear on the role, never as a generic list (reading, movies, travel). No references, and no "references available on request".

### Format the systems can read

35. **One column of real text.** No text in images, icons, headers or footers; no tables or columns for layout; the template's section titles. Never add graphics, colors, columns or icons. The name and contact details stay in the body: iCIMS creates no profile when the name is only in a header, and Greenhouse misses contact details there.
36. **The text layer must say what the page shows.** Words must not split (`PyT orch`) and ligatures must extract as letters. The template's font settings handle this, so never change them. A PDF whose plain text reads wrong has failed, however good it looks.
37. **Dates carry the month and year on every job and degree** (`Aug 2025 - Present`), in one format throughout: hiring systems compute tenure from them, and years alone look like a hidden gap. A gap of more than about six months that the profile explains (study, military or reserve service, a project, a move) appears as what it was. Never hide one by dropping months or stretching dates.
38. **Consistent and correct, to the letter.** Tools are spelled as their makers spell them (PostgreSQL, Power BI, scikit-learn, JavaScript, GitHub, Node.js). Job titles are written in full ("Senior Data Analyst", not "Sr. Data Analyst"), because Greenhouse's parser misreads abbreviations. Every number is in digits. Every bullet ends the same way, all with a period or none, in one capitalization style. Bold only what the template bolds. Zero typos.

### Israel

39. **Language.** CVs are in English unless the profile sets another language, and never switch per posting. Write natively, never as a word-for-word translation of a Hebrew text, and give employers, institutions and degrees their official English names (Clalit Health Services, Tel Aviv University).
40. **Public-sector and tender jobs (מכרזים):** every threshold condition (תנאי סף) must be visibly met, with the exact degree and field and dates that add up to the years of experience asked for. A committee can't credit what it can't check on paper.

### Honest and human

41. **Write like the person who did the work.** Hiring managers rank AI-written CVs among their top red flags, and generic claims, buzzwords and the same rhythm in every line give one away. Describe work done with AI tools by what was built and decided, not by the tool. Before the final check, give the summary, the bullets and the project lines the humanizer pass (`.claude/skills/humanizer/SKILL.md`, in its embedded mode): it rewrites the patterns that mark text as AI-written and keeps every fact. The CV's own form stays, as `/apply` Step 4b says: verb-first bullets with no "I", the posting's exact terms, and only the template's bold.
42. **Rewrite these words on sight,** unless a specific fact right after them earns them: responsible for, duties included, helped, worked on, various, etc., team player, hard-working, motivated, passionate, detail-oriented, results-driven, dynamic, synergy, proven track record, spearheaded, leveraged, utilized ("used" says it), excellent communication skills. In Hebrew: אחראי/ת על, שחקן/ית צוות, יחסי אנוש מעולים, ראש גדול, מוטיבציה גבוהה, יכולת למידה גבוהה. The banned list in `user/cv_checks.json` is what stops the build.
43. **No hidden text, ever:** no white or tiny text, no keywords outside the visible page, no instructions to AI screeners. They are found, and the CV is thrown out.
44. **The interview test.** The candidate can talk about every line for two minutes without backtracking (03-writing-style.md), because interviewers ask about anything on the page. A line that fails is softened or cut.

### The final check

Before the CV is done, every answer is yes:

- The top third names the role and the two or three best matches with this posting.
- Every required qualification the candidate meets appears in the posting's words, at least once inside a bullet or a project.
- The summary positions without repeating a bullet, and has no "I", objective or character adjectives.
- Every skill is an exact tool the posting values, in three to five categories, with no levels.
- Every bullet says what the candidate changed, built or decided, opens with a specific verb, shows a result or a scale and fits its line, and no two read alike.
- Every employer, title, date, degree, number and skill is in the profile or the master CV, or among the additions CV_RULES.md allows.
- There is no cliché, AI-sounding phrase, personal detail or hidden text, and the humanizer pass ran.
- Every date carries a month, in one format, tools are spelled right, numbers are digits, bullets end alike, and there are no typos.
- It fits one page within the CV rules' limits.

## Part 2: The evidence

The evidence for every rule, with its sources, is in [`cv-research/`](cv-research/README.md), one file per part of the CV. Its README lists the files, says how strong each kind of source is, and names what the research doesn't settle. When new research changes a rule, change the rule here and its evidence there together, and raise `framework_version` in both.
