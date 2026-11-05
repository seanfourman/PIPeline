# CV Rules

This is the one place that controls how this user's CVs are made. Every other file points here, and if one disagrees, this file wins. Facts about the user live in `user/profile/01-candidate-profile.md`; search settings, salary and field preferences live on the interface's settings screen; and the limits and banned wording the build enforces live in `user/cv_checks.json`, which the rules screen edits. Both this file and the profile apply to cover letters too.

<!-- SETUP: The introduction and /setup add this user's own rules below. Until then these general rules apply. -->

## How a CV gets made

1. `/apply` takes a posting, checks the hard requirements, and scores the job.
2. It drafts `user/cv/main_<company>_<role>.tex` from the master CV, using facts from the profile and the rules below.
3. A reviewer reads the draft as a hiring manager and returns edits.
4. `python templates/cv/one-page-clean/build.py <company>_<role>` refuses banned wording, compiles, enforces the layout limits, and saves `user/documents/applications/<company>_<role>/<the user's name> - Resume.pdf`.
5. The posting is archived beside it, and `ats.py` scores the CV and saves its scorecard: the CV measured against what the largest employers publish.
6. The user gets the PDF, the score, and a list of what was added beyond the profile, and sends it themselves. Nothing is sent to an employer automatically.

## What the CV may claim

- **Cover the main things the posting asks for, within reason.** The limit is what a recruiter believes for this person's experience.
- **Add at most 5 things beyond the profile**, the ones most relevant to this posting, and tell the user what was added every time.
- **Never mirror the posting.** A CV that ticks every requirement is not believable. Gaps are fine.
- **Never invent, whatever a posting asks for:** employers, job titles, dates, degrees, grades, certifications, security clearance, years of experience, numbers or results.
- **Job bullets come from the profile first.** A skill not used in a job goes in Technical Skills, not in a made-up achievement under an employer.

## How the CV must read

- **Where the user lives never appears.** The location in the profile is for evaluating commute only.
- **Results, not activity counts.** Say what the work did, with a measured result where one exists.
- **The whole CV stays focused on this posting.** Every skill, bullet and project earns its place for this job.
- **The summary positions, the bullets prove.** Never repeat a bullet's achievement in the summary.
- **Never on a CV:** salary expectations, a national ID or a home address.

## What stops the build

The build checks CVs only, so a cover letter follows these rules without that check. Fix a refusal by rewriting the text, never by changing the layout, the font size or the limits. Read `user/cv_checks.json` before drafting: `limits` holds the summary's lines and the skills ceilings, `banned` the wording that stops the build, grouped by reason.

## Changing a rule

Change a rule on the interface's rules screen, which edits this file directly. Limits and banned wording have their own form there and exist only in `user/cv_checks.json`.
