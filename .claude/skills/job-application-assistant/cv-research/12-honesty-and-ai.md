---
framework_version: 1.0.0
---

# Honesty, AI and Red Flags

The evidence for rules 41 to 44 in `../10-cv-best-practices.md`.

## What to take from it

- An AI-sounding CV is now one of hiring managers' top red flags. Specific, concrete lines in varied rhythm are what read as real.
- Hidden text is detected, and it ends the application.
- Everything on the page will be asked about, so every line must survive two minutes of questions.
- Typos, generic content and duties without results are the classic red flags, and they still are.

## AI-written CVs

- **The top red flag.** Resume Genius's 2024 survey of 625 US hiring managers put an AI-generated CV first among the red flags. Resume Now's 2025 report found 62% of employers more likely to reject an AI-written CV that wasn't personalized. Jobseeker's 2025 survey names generic, buzzword-heavy text as the giveaway. Sources: [CNBC on Resume Genius](https://www.cnbc.com/2024/04/08/3-resume-red-flags-recruiters-look-out-for-and-how-to-avoid-them.html), [Resume Now](https://www.resume-now.com/job-resources/careers/ai-applicant-report), [Jobseeker](https://www.jobseeker.com/en/resume/articles/2025-hr-trends-hiring-statistics).
- **Harvard:** AI can help revise bullet points or work in keywords from a posting, but it should not be the primary author. Source: [Harvard](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/).
- **What this means for the system.** An AI drafts these CVs, so the rules make the draft read like the person who did the work: the profile's specific facts, the posting's words, varied rhythm, and no stock phrases. The reviewer is told to rewrite any line that sounds like a student, like someone who operates AI tools, or like activity instead of a result (`.claude/agents/application-reviewer.md`).

## Hidden text

- **It is found.** Duke researchers working with hireEZ found hidden instructions to AI screeners, such as tiny text or keywords in the background color, in at least 1% of about 200,000 real CVs from 2019 to 2025. The share rose sevenfold between July 2024 and November 2025. Greenhouse reports a similar share. Detection tools look for exactly this, and any plain-text view of the PDF shows it. Sources: [Duke](https://pratt.duke.edu/news/thwarting-prompt-injection/), [HR Review](https://hrreview.co.uk/hr-news/jobseekers-use-hidden-ai-prompts-to-trick-recruitment-systems/384249).

## AI screeners' bias

- A 2024 University of Washington study found three AI models preferring White-associated names 85% of the time and male-associated names 52% (female 11%) on otherwise identical CVs. Sources: [UW News](https://www.washington.edu/news/2024/10/31/ai-bias-resume-screening-race-gender/), [the paper](https://arxiv.org/abs/2407.20371).

## The interview test

- **Morgan Stanley:** "It starts with knowing your resume. Be able to articulate everything you've listed without reading or referring to it." Source: [Morgan Stanley](https://www.morganstanley.com/people-opportunities/students-graduates/resources/interview-preparation).
- **Amazon:** be truthful. **Jobscan:** don't exaggerate claims you can't back up in an interview. **EY:** don't misrepresent dates, since a background check will reveal it. Sources: [Amazon](https://www.aboutamazon.com/news/workplace/applying-at-amazon-7-tips-from-recruiters), [Jobscan](https://www.jobscan.co/blog/resume-summary/), [EY (PDF)](https://www.ey.com/content/dam/ey-unified-site/ey-com/en-gl/careers/documents/ey_resume-dos-and-donts-dec-2020.pdf).
- **An IBM recruiter:** don't write every detail, "so you still have something to say and elaborate during the interview". Source: [IBM](https://www.ibm.com/careers/blog/make-your-resume-stand-out-from-the-pile).

## Red flags and the words behind them

- **Hiring managers' red flags.** In Resume Genius's 2024 survey, after the AI-generated CV: 50% hesitated over frequent job changes, about 44% over a CV without measurable achievements, and about 42% each over typos and irrelevant content; 11% called a poor font choice a deal-breaker. Older surveys rank typos first (see `10-format-and-length.md`). Source: [Resume Genius](https://resumegenius.com/blog/resume-help/resume-red-flags).
- **Stock descriptors.** EY: no "hardworking, team player, good communicator". Nisha lists "שחקן צוות" among the clichés never to write. Sources: [EY (PDF)](https://www.ey.com/content/dam/ey-unified-site/ey-com/en-gl/careers/documents/ey_resume-dos-and-donts-dec-2020.pdf), [Nisha](https://www.nisha.co.il/7-%d7%93%d7%91%d7%a8%d7%99%d7%9d-%d7%a9%d7%90%d7%a1%d7%95%d7%a8-%d7%9c%d7%9b%d7%aa%d7%95%d7%91-%d7%91%d7%a7%d7%95%d7%a8%d7%95%d7%aa-%d7%97%d7%99%d7%99%d7%9d/).
- **Duty phrases.** IBM: "One mistake a lot of people make is to highlight job descriptions on their resume." Amazon's example rewrites "Responsible for introducing new tech stack". Sources: [IBM](https://www.ibm.com/careers/blog/make-your-resume-stand-out-from-the-pile), [Amazon](https://www.aboutamazon.com/news/workplace/amazon-job-application-resume-writing-tips).
- Rule 42's list gathers these with the stock phrases of `03-writing-style.md`. The banned list in `user/cv_checks.json`, which stops the build, is the user's own.
