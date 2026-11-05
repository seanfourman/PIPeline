---
framework_version: 1.0.0
---

# The Summary

The evidence for rules 12 and 13 in `../10-cv-best-practices.md`.

## What to take from it

- The summary sits in the top lines, which recruiters read first, so it states who the candidate is for this role: the title, the strongest matching skills, what sets them apart, and what they bring.
- It positions; the bullets prove. `user/CV_RULES.md` forbids repeating a bullet's achievement in it.
- No objective, no "I", no character adjectives. The template makes it fill a set number of lines, so it must carry substance, not padding.

## How it is built

- **The Tech Interview Handbook:** a headline of fewer than 10 words, and a summary under 50 words that answers why the candidate fits the job. Start with the noun for the role, as in "Software Engineer with X years of...", followed by specialties and notable results. Source: [Tech Interview Handbook](https://www.techinterviewhandbook.org/resume/).
- **Jobscan:** two to five sentences in the form "[Job Title] with experience in [Skill 1], [Skill 2], and [Skill 3]. Proven ability to [Accomplishment 1] and [Accomplishment 2]. Known for [work style, strength, or value]." Use the exact title from the posting and two or three skills in its wording; early-career candidates draw on internships, school projects or volunteering. Avoid vague buzzwords, first-person pronouns, claims you can't back up, duties instead of results, and the same summary for every application. Source: [Jobscan](https://www.jobscan.co/blog/resume-summary/).
- **Microsoft's recruiters:** drop the "old-school" objective for an introductory paragraph that works as an elevator pitch. Source: [Microsoft Life](https://news.microsoft.com/life/make-resume-shine/).
- **The system's version.** Jobscan puts accomplishments in the summary, but `user/CV_RULES.md` keeps them in the bullets. So rule 12's third sentence names what sets the candidate apart (a domain, a combination of skills, the kind of problems solved) without repeating a bullet.

## What to leave out

- **The objective.** Google's recruiters: "Skipping the objective. (They know what your objective is: to land this particular job.)" Career sites agree that objective statements are out of date. Sources: [Inc.](https://www.inc.com/bill-murphy-jr/google-recruiters-say-these-5-resume-tips-including-x-y-z-formula-will-improve-your-odds-of-getting-hired-at-google.html), [ResumeWorded](https://resumeworded.com/blog/objective-or-summary-for-resume-post), [iHire](https://www.ihireconstruction.com/resourcecenter/jobseeker/pages/ask-a-resume-writer-are-resume-objective-statements-outdated).
- **Character adjectives.** EY: "Don't fill your summary with descriptors such as: hardworking, team player, good communicator." Source: [EY (PDF)](https://www.ey.com/content/dam/ey-unified-site/ey-com/en-gl/careers/documents/ey_resume-dos-and-donts-dec-2020.pdf).
- **Pronouns.** Harvard and Jobscan: no "I" or "we". Sources: [Harvard](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/), [Jobscan](https://www.jobscan.co/blog/resume-summary/).

## Is it needed?

- EY says a summary isn't required but is fine to add, and is most useful for showing transferable skills when changing fields. Source: [EY (PDF)](https://www.ey.com/content/dam/ey-unified-site/ey-com/en-gl/careers/documents/ey_resume-dos-and-donts-dec-2020.pdf).
- Some career sites claim recruiters skip summary paragraphs, but no clear study supports it. What is supported is that recruiters read the top lines first, and Israeli recruiters want the strongest matches there. Sources: [Mako](https://www.mako.co.il/finances-money/Article-02c0a6072605581027.htm), [HR Dive](https://www.hrdive.com/news/recruiters-spend-74-seconds-looking-at-your-resume/541582/).
- The template always has one and the build checks its line count (`summaryLines` and `summaryFill` in `cv_checks.json`).
