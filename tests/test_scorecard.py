"""Guard for the CV's scorecard: each lens's checks, the Workday-style grade, and how ats.py finds the posting's title."""
import importlib.util
import tempfile
import unittest
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("ats", REPO / "templates" / "cv" / "one-page-clean" / "ats.py")
ats = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ats)
scorecard = ats.scorecard

TODAY = date(2026, 11, 5)
POSTING = """Junior Data Analyst at Acme Health.
Requirements:
- Experience with SQL and Python.
- Building Power BI dashboards.
- Excel.
Advantage: Tableau or PostgreSQL.
"""
GOOD = r"""\documentclass{article}
\begin{document}
\cvname{DANA COHEN}
\cvheadline{DATA ANALYST \cvsep{} SQL \& BI}
\cvcontact{dana@example.com \cvcsep{} 050-123-4567 \cvcsep{} \cvlink{https://linkedin.com/in/dana}{linkedin.com/in/dana} \cvcsep{} \cvlink{https://github.com/dana}{github.com/dana}}
\cvsummary{Data Analyst with a B.Sc. in Statistics and hands-on work in SQL, Python and Power BI on healthcare data. Builds the reports clinics plan by.}
\cvsection{TECHNICAL SKILLS}
\cvskillsstart
\cvskill{Languages}{SQL, Python (pandas, NumPy)}
\cvskill{Data \& BI}{Power BI, Excel}
\cvskill{Tools}{Git, Jira}
\cvsection{PROFESSIONAL EXPERIENCE}
\cvfirstrole
\cvjob{\cvlink{https://acme.example}{Acme Health} - Data Analyst}{Aug 2025 - Present}
\cvbullet{Automated 12 weekly SQL reports in Power BI, cutting their preparation from 2 days to 3 hours}
\cvbullet{Modeled clinic visits in Python with pandas, forecasting demand for 40 clinics}
% \cvbullet{A line left out of this version}
\cvbullet{Cleaned 3 years of Excel records into one PostgreSQL table used by 5 teams}
\cvrolegap
\cvjob{\cvlink{https://shop.example}{Shop} - Analyst Intern}{Jan 2025 - Jul 2025}
\cvbullet{Built a Git-versioned Jira board tracking 30 sprints}
\cvsection{PROJECTS}
\cvfirstrole
\cvrole{\cvlink{https://github.com/dana/x}{Clinic Forecast} - Demand forecasting in Python}{}
\cvbullet{Reached 92\% accuracy on 2 years of visit data}
\cvsection{EDUCATION}
\cvskillsstart
\cvrole{B.Sc. in Statistics - Tel Aviv University (GPA 91)}{Oct 2022 - Jul 2025}
\cvsection{ADDITIONAL INFORMATION}
\cvskillsstart
\cvinfo{Languages}{Hebrew (native), English (full professional)}
\end{document}
"""
WEAK = r"""\cvheadline{SOFTWARE ENGINEER \cvsep{} BACKEND}
\cvcontact{dana@example.com \cvcsep{} 050-123-4567}
\cvsummary{I am a passionate team player seeking a challenging position.}
\cvsection{TECHNICAL SKILLS}
\cvskill{Skills}{Python (advanced), Communication, Leadership}
\cvsection{PROFESSIONAL EXPERIENCE}
\cvjob{\cvlink{https://acme.example}{Acme} - Engineer}{2024 - 2025}
\cvbullet{Responsible for the weekly reports.}
\cvbullet{Helped the team with two migrations}
\cvsection{EDUCATION}
\cvrole{B.Sc. in Computer Science - Some University}{2021 - 2024}
"""
CLEAN = {"score": 80, "missing": ["Tableau"], "problems": []}


def lens(card: dict, name: str) -> dict:
    return next(l for l in card["lenses"] if l["id"] == name)


def failed(card: dict, name: str) -> set:
    return {c["id"] for c in lens(card, name)["checks"] if not c["ok"]}


class Parse(unittest.TestCase):
    def test_reads_the_templates_commands(self):
        cv = scorecard.parse(GOOD)
        self.assertEqual(cv["headline"], "DATA ANALYST | SQL & BI")
        self.assertEqual(cv["skills"][0], {"category": "Languages", "items": ["SQL", "Python (pandas, NumPy)"]})
        self.assertEqual(cv["jobs"][0]["title"], "Acme Health - Data Analyst")
        self.assertEqual(cv["jobs"][0]["dates"], "Aug 2025 - Present")
        self.assertEqual(len(cv["jobs"][0]["bullets"]), 3, "a commented-out bullet is not on the CV")
        self.assertEqual(cv["projects"][0]["title"], "Clinic Forecast - Demand forecasting in Python")
        self.assertEqual(cv["education"][0]["dates"], "Oct 2022 - Jul 2025")
        self.assertEqual(cv["info"]["Languages"], "Hebrew (native), English (full professional)")

    def test_a_posting_splits_into_required_and_preferred(self):
        self.assertEqual(scorecard.posting_terms(POSTING, ats.find_terms), (["Python", "SQL", "Power BI", "Excel"], ["PostgreSQL", "Tableau"]))
        hebrew = "דרישות: ניסיון ב-SQL ו-Python\nידע ב-Tableau - יתרון"
        self.assertEqual(scorecard.posting_terms(hebrew, ats.find_terms), (["Python", "SQL"], ["Tableau"]))

    def test_the_title_matches_without_the_level_words(self):
        self.assertTrue(scorecard.title_matches("Junior Data Analyst (Hybrid)", "DATA ANALYST | SQL & BI"))
        self.assertFalse(scorecard.title_matches("Product Manager", "DATA ANALYST | SQL & BI"))
        self.assertIsNone(scorecard.title_matches("אנליסט/ית נתונים", "DATA ANALYST"), "Hebrew and English can't be compared")
        self.assertIsNone(scorecard.title_matches("", "DATA ANALYST"))


class Card(unittest.TestCase):
    def test_a_cv_that_follows_the_rules_scores_high_everywhere(self):
        card = scorecard.card(GOOD, POSTING, CLEAN, ats.find_terms, "Junior Data Analyst", today=TODAY)
        for name in ("google", "amazon", "meta", "microsoft", "nvidia", "ibm", "deloitte", "systems", "pip"):
            self.assertEqual(lens(card, name)["score"], 100, (name, failed(card, name)))
        workday = lens(card, "workday")
        self.assertEqual((workday["grade"], workday["score"], workday["required"], workday["preferred"]), ("A", 85, [4, 4], [1, 2]))
        self.assertEqual(workday["missing"], ["Tableau"])
        self.assertEqual(lens(card, "ats")["score"], 80)
        self.assertEqual(card["overall"], 97)
        self.assertEqual(scorecard.line(card), "Scorecard: Google 100, Amazon 100, Meta 100, Microsoft 100, Nvidia 100, IBM 100, Deloitte 100, "
                                               "Workday A (85), Hiring systems 100, ATS 80, Pip 100. Overall 97.")

    def test_a_weak_cv_loses_points_for_what_each_employer_names(self):
        problems = {"score": 25, "missing": ["SQL", "Power BI", "Excel"], "problems": ["no job dates with months"]}
        card = scorecard.card(WEAK, POSTING, problems, ats.find_terms, "Junior Data Analyst", today=TODAY)
        self.assertEqual(failed(card, "google"), {"title", "no_objective", "measured", "tailored", "github", "education_detail", "graduation_month"})
        self.assertEqual(failed(card, "nvidia"), {"tailored", "applied_skills", "impact"})
        self.assertIn("no_duties", failed(card, "amazon"))
        self.assertIn("basic_quals", failed(card, "amazon"))
        self.assertTrue({"no_pronouns", "relevant_skills", "impact"} <= failed(card, "microsoft"))
        self.assertTrue({"no_soft_skills", "skills_evidence", "projects_if_thin"} <= failed(card, "ibm"))
        self.assertTrue({"summary_clean", "skill_categories", "no_levels", "verbs", "no_cliches", "digits", "endings", "month_dates", "parse_ok"}
                        <= failed(card, "pip"))
        self.assertEqual(lens(card, "workday")["grade"], "C")
        self.assertLess(card["overall"], 30)

    def test_a_check_that_doesnt_apply_is_left_out(self):
        card = scorecard.card(GOOD, "We want a curious person who knows SQL.", {"score": None, "missing": [], "problems": []}, ats.find_terms, today=TODAY)
        self.assertNotIn("title", {c["id"] for c in lens(card, "google")["checks"]}, "no title to compare")
        self.assertNotIn("tailored", {c["id"] for c in lens(card, "google")["checks"]}, "no ATS score to judge")
        self.assertIsNone(lens(card, "workday")["score"], "too few terms to grade")
        self.assertIsNone(lens(card, "ats")["score"])
        self.assertEqual(scorecard.line(card).split(", ")[7], "Workday -")

    def test_the_hiring_systems_lens_reads_the_pdf_as_their_parsers_do(self):
        good = scorecard.card(GOOD, POSTING, CLEAN, ats.find_terms, cv_text="DANA COHEN\nDATA ANALYST", candidate="Dana Cohen",
                              pdf_bytes=180_000, today=TODAY)
        self.assertEqual(lens(good, "systems")["score"], 100)
        bad = scorecard.card(GOOD.replace("Data Analyst}{Aug", "Sr. Data Analyst}{Aug"), POSTING, CLEAN, ats.find_terms,
                             cv_text="D A N A  C O H E N\nDATA ANALYST", candidate="Dana Cohen", pdf_bytes=3_000_000, today=TODAY)
        self.assertEqual(failed(bad, "systems"), {"size", "name_in_body", "no_spaced_letters", "full_titles"})


class RealWording(unittest.TestCase):
    """Wording real CVs use that the checks must not count against them."""

    def test_names_and_terms_that_look_like_flags(self):
        self.assertIsNone(scorecard.CLICHE.search("Turned 13 algorithms, from dynamic programming to PPO, into a live match"))
        self.assertIsNotNone(scorecard.CLICHE.search("Thrives in a dynamic environment"))
        self.assertIsNone(scorecard.SPELLED.search("rendered in Three.js"))
        self.assertIsNotNone(scorecard.SPELLED.search("Led three teams"))

    def test_an_irregular_past_tense_is_a_verb(self):
        self.assertTrue(scorecard.opens_with_verb("Read a 3 GB GeoTIFF one tile at a time"))
        self.assertFalse(scorecard.opens_with_verb("Worked on the media pipeline"))

    def test_the_role_lines_focus_counts_toward_the_title(self):
        self.assertTrue(scorecard.title_matches("Graduate Frontend Full Stack Engineer UpNEXT", "SOFTWARE ENGINEER | FRONTEND & FULL STACK"))
        self.assertFalse(scorecard.title_matches("Career Boost Program: Full-Stack AI Marketer", "SOFTWARE ENGINEER | FULL STACK & AI"))


class Terms(unittest.TestCase):
    def test_data_tools_count_in_english_and_hebrew(self):
        self.assertEqual(ats.find_terms("Power BI, Tableau and Excel; ידע באקסל וסטטיסטיקה"), ["Excel", "Power BI", "Tableau", "Statistics"])

    def test_excel_the_verb_is_not_excel_the_tool(self):
        self.assertEqual(ats.find_terms("You will excel at teamwork"), [])


class RoleOf(unittest.TestCase):
    def test_the_posting_title_comes_from_the_tracker_row_for_this_cv(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "user").mkdir()
            (Path(root) / "user" / "job_search_tracker.csv").write_text(
                "date,company,role,cv_file\n2026-11-01,Acme,Old Role,user/cv/main_other.tex\n2026-11-05,Acme,Junior Data Analyst,user\\cv\\main_acme_data.tex\n",
                encoding="utf-8")
            self.assertEqual(ats.role_of("acme_data", Path(root)), "Junior Data Analyst")
            self.assertEqual(ats.role_of("missing", Path(root)), "")


if __name__ == "__main__":
    unittest.main()
