---
framework_version: 1.0.0
---

# Technical Skills

The evidence for rules 14 to 17 in `../10-cv-best-practices.md`.

## What to take from it

- **Exact, not vague.** List tools by their real names as the posting writes them, because hiring systems and recruiters search for those strings.
- **Few, not many.** A short list of what this posting values, each item one the candidate can defend. Every irrelevant skill dilutes the rest.
- **Grouped.** Three to five categories named by kind, the posting's main need first.
- **No levels** for technical skills. Soft skills are shown in the bullets, never listed.
- **Backed up.** A listed skill should also appear in a bullet or project that shows it used.

## Exact names

- **The posting's words.** The Tech Interview Handbook says to mirror the job description's keywords in the skills section and to write out abbreviations' full names, such as "Amazon Web Services" alongside AWS. Source: [Tech Interview Handbook](https://www.techinterviewhandbook.org/resume/).
- **Recruiters search for exact terms.** Greenhouse and Lever let recruiters search CVs by keyword, and Jobscan says most systems match keywords exactly. Sources: [Greenhouse support](https://support.greenhouse.io/hc/en-us/articles/202360199-Search-candidates-using-Boolean-queries), [Jobscan's tutorial](https://www.jobscan.co/jobscan-tutorial).
- **Languages up front for technical roles.** Google's recruiters want the programming languages listed prominently, and named again for each project and job. Source: [Inc.](https://www.inc.com/bill-murphy-jr/google-recruiters-say-these-5-resume-tips-including-x-y-z-formula-will-improve-your-odds-of-getting-hired-at-google.html).

## How many

- **Microsoft's recruiters:** keep the skills section short, and don't "over publicize" skills by listing everything; one has seen skill paragraphs take "three to four lines of space". List only the most relevant skills for the role. Source: [Microsoft Life](https://news.microsoft.com/life/make-resume-shine/).
- **IBM** names "writing random skills with no supporting evidence" among its eight common mistakes, and says to name the technologies used in the experience descriptions. Source: [IBM](https://www.ibm.com/careers/blog/eight-common-resume-writing-mistakes-that-keep-you-from-getting-your-dream-job).
- **The numbers.** Simplify's analysis of 75,308 real CVs found a median of 15 skills and a mean of 19.4; it reports no link to outcomes. Career guides mostly advise 8 to 15. Vendor data and practitioner opinion. Source: [Simplify](https://simplify.jobs/blog/how-many-skills-on-a-resume).
- **The template's limits.** The build caps the section at `skillItems` items in `skillLines` lines (`cv_checks.json`), so within the cap, relevance decides.

## Categories

- **The Tech Interview Handbook:** "[Skill summary]: [List skills]", grouped into programming languages, frameworks and databases. Source: [Tech Interview Handbook](https://www.techinterviewhandbook.org/resume/).
- **Harvard's template** divides the section into technical skills, language proficiency, laboratory techniques and personal interests. Source: [Harvard](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/).
- **Career sites** agree on grouping by category. Sources: [ResumeWorded](https://resumeworded.com/skill-categories-for-resume-key-advice), [The Muse](https://www.themuse.com/advice/every-basic-question-you-have-about-your-resume-skills-section-answered).
- The template writes each category as `\cvskill{Category}{skills, comma separated}`.

## Levels

- **Bars, stars and percentages are self-scores.** They mean nothing to a recruiter, they can undersell the candidate, and an ATS may strip them. In most cases a CV needs no skill levels at all, since employers care how the skills were applied. Text levels help mainly for spoken languages. Sources: [Resume Genius](https://resumegenius.com/blog/resume-help/skill-levels-for-resume), [Jobscan](https://www.jobscan.co/blog/levels-of-skill-on-resume/).
- **"Familiar with"** signals a skill the candidate can't defend. Under the interview test (rule 44), such a skill doesn't belong on the CV.

## Soft skills

- **IBM:** "Demonstrate the soft skills; don't just list them." Source: [IBM](https://www.ibm.com/careers/blog/eight-common-resume-writing-mistakes-that-keep-you-from-getting-your-dream-job).
- **NACE:** employers look on a CV for evidence of problem-solving (nearly 90%) and teamwork (nearly 80%), and a bullet is where that evidence lives. Source: [NACE](https://naceweb.org/talent-acquisition/candidate-selection/what-employers-seek-on-a-resume).

## What data postings ask for

- **SQL comes first** in most analyses of data analyst postings, followed in varying order by Excel, Python and a BI tool (Tableau or Power BI). One 2025 analysis of 2,893 postings found Excel in 39%, SQL 31%, Tableau 21%, Python 14%, Power BI 13% and R 8%. Another, of about 9,000 data postings, found SQL the most requested skill. Sources: [Avery Smith's analysis](https://recapio.com/digest/i-analyzed-2893-data-analyst-jobs-to-find-out-what-skills-you-need-to-get-hired-by-avery-smith-data-), [The Startup on Medium](https://medium.com/swlh/want-to-become-a-data-analyst-scientist-or-engineer-66902875bf9b).
- **The posting itself** is the better guide, since it is what the hiring system matches against.

## Skills-first hiring

- LinkedIn reports that recruiters are 25% more likely to search by skills than three years earlier. Source: [Jobscan on LinkedIn's report](https://www.jobscan.co/blog/linkedin-report-skills-first-hiring/).
- `user/CV_RULES.md` allows at most five additions beyond the profile, and the user is told about each one.
