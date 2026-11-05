---
framework_version: 1.0.0
---

# Format and Length

The evidence for rules 35 to 38 in `../10-cv-best-practices.md`, and for the template's one page.

## What to take from it

- A plain, one-column page of real text, easy to skim. Every large employer asks for that.
- The PDF's text layer must read exactly like the page, or keyword searches miss it.
- Consistency and zero typos: a single typo is enough for many hiring managers to stop reading.
- One page early in a career.

## A plain layout

- **Amazon:** "it's best to keep a resume text-forward, black and white, and simple"; resumes that "use straightforward language, highlight measurable data, and are streamlined for maximum readability". Source: [Amazon](https://www.aboutamazon.com/news/workplace/amazon-job-application-resume-writing-tips).
- **Google's recruiters:** keep the format simple and highly readable, with black text, one clean and consistent font and size, and bullet points instead of long lines of text. Source: [Inc.](https://www.inc.com/bill-murphy-jr/google-recruiters-say-these-5-resume-tips-including-x-y-z-formula-will-improve-your-odds-of-getting-hired-at-google.html).
- **Microsoft's recruiters:** "It starts and ends with [clean] formatting", with the most important information up front, wide margins, white space and bullet points rather than dense blocks. Source: [Microsoft Life](https://news.microsoft.com/life/make-resume-shine/).
- **Meta:** "formatted in a way that's easy to read". **KPMG:** "Keep it neat, attractive, organized and easy to read" and "Ensure formatting is consistent." **IBM:** enough white space, and short bullets instead of paragraphs. Sources: [Meta](https://www.metacareers.com/hiring-process/), [KPMG Canada](https://kpmg.com/ca/en/careers/students/applying-to-kpmg.html), [IBM](https://www.ibm.com/careers/blog/eight-common-resume-writing-mistakes-that-keep-you-from-getting-your-dream-job).
- **Harvard:** easy to skim, balanced white space, consistent emphasis, and a check that the formatting holds after converting to PDF. **EY:** bullets and dates that line up, the most recent job first, and formatting as the final touch once the content is done. Sources: [Harvard](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/), [EY (PDF)](https://www.ey.com/content/dam/ey-unified-site/ey-com/en-gl/careers/documents/ey_resume-dos-and-donts-dec-2020.pdf).

## What the systems can read

- **Columns, tables, headers and footers** can be misread or skipped, and one column never fails. Sources: [Jobscan on tables and columns](https://www.jobscan.co/blog/resume-tables-columns-ats/), [Jobscan on formatting mistakes](https://www.jobscan.co/blog/ats-formatting-mistakes/), [Enhancv's two-column test](https://enhancv.com/blog/two-column-resume-ats-test/).
- **The Tech Interview Handbook:** no headers or footers, no photos or graphic design tools, no symbols in section headers, and Arial, Calibri or Garamond at 10 pt or more. Source: [Tech Interview Handbook](https://www.techinterviewhandbook.org/resume/).
- **Ligatures and split words.** In LaTeX, "fi" and "fl" can be set as single glyphs that extract as one character unless the PDF maps them back to letters, so a search for "profile" misses it. With fontspec (LuaLaTeX, XeLaTeX), turning common ligatures off avoids the problem. The template sets `Ligatures=NoCommon`, and `Kerning=Off` because kerning split words like `PyT orch` in the text layer. Sources: [the GNU LaTeX reference](https://svn.gnu.org.ua/sources/latexrefman/trunk/latex2e-help-texinfo-tree/latex2e/Ligatures.html), [the TeX Live list](https://tug.org/pipermail/tex-live/2009-February/019970.html), [the LaTeX.org forum](https://latex.org/forum/viewtopic.php?p=63695), `templates/cv/one-page-clean/TEMPLATE.md`.
- **The file.** Google's recruiters and EY both say PDF. The template builds a true-text PDF, and `ats.py` scores it against the posting. Sources: [Inc.](https://www.inc.com/bill-murphy-jr/google-recruiters-say-these-5-resume-tips-including-x-y-z-formula-will-improve-your-odds-of-getting-hired-at-google.html), [EY (PDF)](https://www.ey.com/content/dam/ey-unified-site/ey-com/en-gl/careers/documents/ey_resume-dos-and-donts-dec-2020.pdf).

## Dates

- The Tech Interview Handbook writes job dates as MM/YYYY; the template writes `Aug 2025 - Present`. Both carry the month that hiring systems use to compute tenure. Harvard advises against starting each line with a date. Sources: [Tech Interview Handbook](https://www.techinterviewhandbook.org/resume/), [Harvard](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/).
- EY: "Don't misrepresent dates, a background check will reveal this." Source: [EY (PDF)](https://www.ey.com/content/dam/ey-unified-site/ey-com/en-gl/careers/documents/ey_resume-dos-and-donts-dec-2020.pdf).

## Consistency and typos

- **Typos end CVs.** 58% of hiring managers dismissed CVs over typos (CareerBuilder, 2013), 77% called typos or bad grammar a deal-breaker (CareerBuilder, 2018), and 79% named spelling and grammar mistakes their top pet peeve (TopResume, 2018). Google's recruiters: "Check for typos. This is so important, we'll say it again: Check for typos." Sources: [CareerBuilder, 2013](https://prnewswire.com/news-releases/careerbuilder-releases-study-of-common-and-not-so-common-resume-mistakes-that-can-cost-you-the-job-223251611.html), [CareerBuilder, 2018](https://resources.careerbuilder.com/employer-blog/in-this-tight-labor-market-employers-still-have-candidate-deal-breakers), [TopResume](https://topresume.com/press/press-2018-02-14), [Inc.](https://www.inc.com/bill-murphy-jr/google-recruiters-say-these-5-resume-tips-including-x-y-z-formula-will-improve-your-odds-of-getting-hired-at-google.html).
- **One style for numbers and punctuation.** Mixed styles read as carelessness. Digits also match what recruiters type into a search. Source: [ResumeWorded on punctuation](https://resumeworded.com/blog/resume-punctuation-rules-post).
- **Bold.** Microsoft's recruiters say to bold and italicize key words; Gergely Orosz says "overusing highlighting or bolding defeats the purpose". The template decides what is bold. Sources: [Microsoft Life](https://news.microsoft.com/life/make-resume-shine/), [Orosz](https://dev.to/gergelyorosz/six-principles-your-resume-should-follow-so-recruiters-will-read-it-3a0o).
- **Fonts.** There is no consensus on serif against sans-serif; body text runs 10 to 12 pt. In Resume Genius's 2024 survey, 11% called a poor font choice a deal-breaker. The template sets the font. Source: [Resume Genius](https://resumegenius.com/blog/resume-help/resume-red-flags).

## Length

- **Employers, early in a career, say one page.** Google's recruiters advise keeping it under a single page (technical roles with many relevant projects may run to a second). EY: one page for recent graduates and anyone under five years of experience. KPMG: "Try to keep your resume to one page." IBM: one page for recent graduates and up to two for experienced professionals. Amazon's student recruiter: one page. Sources: [Inc.](https://www.inc.com/bill-murphy-jr/google-recruiters-say-these-5-resume-tips-including-x-y-z-formula-will-improve-your-odds-of-getting-hired-at-google.html), [EY (PDF)](https://www.ey.com/content/dam/ey-unified-site/ey-com/en-gl/careers/documents/ey_resume-dos-and-donts-dec-2020.pdf), [KPMG Canada](https://kpmg.com/ca/en/careers/students/applying-to-kpmg.html), [IBM](https://www.ibm.com/careers/blog/eight-common-resume-writing-mistakes-that-keep-you-from-getting-your-dream-job), [Amazon](https://www.aboutamazon.com/news/workplace/applying-at-amazon-7-tips-from-recruiters).
- **Recruiters in experiments say two pages; outcomes say short, for juniors.** In ResumeGo's 2018 experiment, 482 hiring professionals picked two-page CVs 2.3 times as often overall (1.4 times at entry level, 2.6 at mid level, 2.9 for managers) and read them for 4:05 minutes against 2:24. Jobscan's real outcomes show the opposite for juniors: at entry level, the shortest quarter of CVs got interviews 17.9% of the time and the longest quarter 2.8%. Mid-career, the second-shortest quarter did best (9.8%) and the shortest did worst (3.8%). In Jobscan's words, "your first page has to earn the second page read". Sources: [ResumeGo](https://www.resumego.net/research/one-or-two-page-resumes/), [CNBC on ResumeGo](https://www.cnbc.com/2018/12/19/resumego-hiring-managers-prefer-candidates-with-two-page-resumes.html), [Jobscan](https://www.jobscan.co/blog/page-length-is-not-what-recruiters-say-they-prefer/).
- **Israeli guides** say one to two pages (Drushim). The template is one page. Source: [Drushim](https://drushim.co.il/article/13/).
