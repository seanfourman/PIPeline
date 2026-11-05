# Template: one-page-clean

Reproduces the candidate's own Canva resumes. All layout values were measured from those PDFs and live in `onepage.sty`. Tailoring changes text only.

- **Type:** CV
- **Source extension:** .tex
- **Engine/toolchain:** lualatex
- **Page limit:** 1 page(s)
- **Fonts:** Proxima Nova when installed (system font, the originals' font). Otherwise Figtree, bundled in `fonts/`, adjusted to the same widths and ink.
- **Class/packages:** article, `onepage.sty` (geometry, fontspec, xcolor, tikz, hyperref)

## Compile command

    python templates/cv/one-page-clean/build.py <company>_<role>

Build a CV with `python templates/cv/one-page-clean/build.py <company>_<role>`, run from the repository root. It compiles, verifies, and saves `user/documents/applications/<company>_<role>/<the user's name> - Resume.pdf`. Run one plain command per shell call, without `cd`, variables or `&&`, because anything else stops to ask the user for approval.

## Rules

Every rule about what the CV says and what stops the compile is in `user/CV_RULES.md`. This file covers only how the template works.

## The final file

The CV sent to an employer is always named `<the user's name> - Resume.pdf`. The build command saves it in `user/documents/applications/<company>_<role>/`.

## Style rules

- Never edit sizes, spacing, colors or the preamble in a tailored CV. Use only the commands in `template.tex`.
- The page is symmetric: every rule, text edge and date uses the same left and right margin, 35.8bp from each page edge. The user asked for this over the small hand-placed drift in the Canva originals, so do not add offsets. The name, role and contact lines are centered by their ink, the contact line sits midway between its rules, every section has the same gap below its rule, and the top and bottom ink margins are equal when the last line has a descender.
- Section order: Technical Skills, Professional Experience, Projects (optional), Education, Additional Information. The name and role line are always in capitals as in the template.
- The role line has the form `ROLE \cvsep{} FOCUS`, in capitals. It steps down from 18 to 16 and 15 by itself when long.
- Link the company and project names with `\cvlink`. The LinkedIn and GitHub addresses are written out on the contact line and linked.
- The page centers itself vertically. To spread out a short page, pass larger gaps, as the originals do: `\cvsection[45]{TITLE}` above a section and `\cvrolegap[35]` between roles. The defaults are 29.5 and 21.
- Date ranges use a single ASCII hyphen with spaces, such as `Aug 2025 - Present`. Degrees carry months too, such as `Oct 2023 - Jul 2026`, since Google's recruiters ask recent graduates for the month and year of graduation. The build checks a job's months, not a degree's, so a degree's months come from the profile.

## Known pitfalls

- Compile from `user/cv/`: a CV there loads the style two folders up, and the style finds its fonts and limits from its own folder.
- Keep `Kerning = Off` and `Ligatures = NoCommon` in `onepage.sty`. With kerning on, the PDF text layer splits words (`PyT orch`), so an ATS keyword match fails even though the page looks right.
- Escape `&`, `%`, `#` and `_` in body text. An unescaped `%` silently removes the rest of the line.
- `tools/verify_layout.py` is written for the two-page moderncv layout. For this template, rely on `tools/verify_pdf.py --pages 1 --ascii-dates` and the visual read.
- A company name in `\cvlink` cannot break across lines, so keep role lines short enough to fit one line.
