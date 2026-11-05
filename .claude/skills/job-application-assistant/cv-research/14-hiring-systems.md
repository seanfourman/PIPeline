---
framework_version: 1.0.0
---

# The Hiring Systems

The evidence for rules 1, 35 and 38 in `../10-cv-best-practices.md`, and for the scorecard's Workday and hiring-systems lenses (`templates/cv/one-page-clean/scorecard.py`).

## What to take from it

- Almost every large employer screens through one of a few systems: 487 of the Fortune 500 have one, and Workday alone serves over 40% of them. Few of these companies publish their own CV rules, so writing for their systems covers most of the 500 better than 500 separate checklists could.
- The systems agree on what they can't read: graphics and images, tables and columns, text in headers, footers or text boxes, letters spaced apart, abbreviated titles, and very large files.
- The template avoids the layout problems by design, and the scorecard checks the rest on every CV.

## Which systems the Fortune 500 use

- **Jobscan's 2026 report** (August 20, 2026), built by reviewing the career pages and job listings of all 500 companies by hand: 97.4% (487) had a detectable applicant tracking system, and the other 13 may use in-house ones. Workday serves over 40% (39.2% in 2025) and SAP SuccessFactors 12% (13.2% in 2025), together 52.4%. Taleo is in decline, and iCIMS is still widely used. Earlier years: 97.8% in 2025 and 98.4% in 2024. Source: [Jobscan](https://www.jobscan.co/blog/fortune-500-use-applicant-tracking-systems/).
- **Other counts,** from search extracts rather than the reports themselves: Ongig's June 2025 review of 476 Fortune 500 companies, by a different method, found Workday at 22.6% and Taleo at 22.4%; across the 13,000 or so companies of all sizes Jobscan tracks, Greenhouse leads (19.0%), then Workday (17.5%), Lever (15.6%) and iCIMS (14.4%). Tech companies and startups lean to Greenhouse and Lever.

## What each system documents

- **Workday (HiredScore)** grades each candidate from A to D by how well the CV matches the posting's skills, education and experience; meeting every basic qualification earns an A or a B. See `01-how-cvs-are-read.md`.
- **Greenhouse** lists what makes a parse fail: "Greenhouse Recruiting can't parse resumes larger than 2.5MB"; "resumes that include graphics, photos, or word art"; resumes "uploaded as an image, rather than a document"; "complex resumes with tables, headers, and footers"; a name and contact details in headers, footers or text boxes, which can be missed; "a columned layout"; resumes "without clear sections and differing formats throughout each section"; "a resume with spaces between the letters"; abbreviated titles, such as "Sr. Account Exec" instead of "Senior Account Executive"; and company names without terms like "Inc., Co., LTD, or LLC", which may not be recognized. It accepts .doc, .docx, .pdf, .rtf and .txt, and recruiters fill in a failed parse by hand. Sources: [Greenhouse: unsuccessful resume parse](https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse), [Greenhouse: supported formats](https://support.greenhouse.io/hc/en-us/articles/360052218132-Supported-formats-for-resumes-cover-letters-and-other-candidate-uploads).
- **iCIMS:** "if the candidate's name is included in the header of the document, iCIMS ATS will not be able to parse the information. Without a candidate name, iCIMS ATS will not create a Candidate Profile, and the resume will be rejected." Errors are most common with text in text boxes, images, annotations or tables. It accepts .doc, .docx, .odt, .pdf, .rtf and .txt, not .zip. The article sits behind iCIMS's community login, so this is its indexed text. Source: [iCIMS community](https://community.icims.com/articles/Knowledge/Creating-New-Candidates-via-Bulk-File-Transfer-Migrating-Legacy-Resumes-during-Implementation).
- **SAP SuccessFactors** accepts .doc, .docx, .gif, .jpeg, .jpg, .pdf and .txt, and parses with Textkernel. Its help page loads with JavaScript, so this is from the page's search extract. Source: [SAP Help](https://help.sap.com/docs/successfactors-recruiting/setting-up-and-maintaining-sap-successfactors-recruiting/working-with-resume-parsing).
- **Oracle Taleo** documents a plain-text resume parser for mobile applications. Source: [Oracle](https://docs.oracle.com/en/cloud/saas/taleo-enterprise/22d/otcug/c-plaintextresumeparsingmobile.html).

## How the template and the scorecard answer them

| What the systems can't read | Who documents it | In this system |
|---|---|---|
| Graphics, photos, word art, a CV saved as an image | Greenhouse, iCIMS | The template has none and builds a text PDF |
| Tables and columns | Greenhouse, iCIMS | One column of text |
| The name or contact details in a header, footer or text box | iCIMS, Greenhouse | Both sit in the body. The scorecard checks that the name is the text's first line, and `ats.py` that the email and phone read as text |
| Letters spaced apart | Greenhouse | The scorecard checks the text layer |
| Abbreviated job titles | Greenhouse | Rule 38; the scorecard checks every job title |
| A file over 2.5 MB | Greenhouse | The scorecard checks the size; the CVs built so far weigh 25 to 27 KB |
| No clear sections | Greenhouse | The template's section titles, checked by `ats.py` |
| Words split in the text layer, ligatures | `templates/cv/one-page-clean/TEMPLATE.md` | Kerning and common ligatures off; `ats.py` checks the layout text |

## The Fortune 500 beyond their systems

- Most of the 500 publish no CV rules. Among the largest tech companies, Google, Amazon, Microsoft, Meta, Nvidia and IBM publish advice (`13-large-employers.md`), while Apple and Netflix publish none on CVs: their careers sites were searched in November 2026.
