"""Guard for the CV's ATS score: what counts as a term, and what makes a CV unreadable."""
import importlib.util
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("ats", REPO / "templates" / "cv" / "one-page-clean" / "ats.py")
ats = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ats)

GOOD_CV = """DANA COHEN
dana.cohen@example.com | 050-123-4567
TECHNICAL SKILLS
Languages: TypeScript, Python
PROFESSIONAL EXPERIENCE
Example Ltd - Junior Software Engineer (Part-Time) Aug 2025 - Present
Built features in React and Node.js.
EDUCATION
B.Sc. in Computer Science 2023 - 2026
"""


class FindTerms(unittest.TestCase):
    def test_finds_names_in_any_case_and_across_lines(self):
        self.assertEqual(ats.find_terms("typescript and\nNode.js"), ["TypeScript", "Node.js"])

    def test_java_is_not_javascript(self):
        self.assertEqual(ats.find_terms("JavaScript"), ["JavaScript"])

    def test_ordinary_words_are_not_terms(self):
        for text in ("Go to market with an aid to the team", "a rag and a qa", "said this is ai"):
            self.assertEqual(ats.find_terms(text), [], text)

    def test_short_language_names_count_in_a_list(self):
        self.assertIn("Go", ats.find_terms("Python, Go, Rust"))
        self.assertIn("C", ats.find_terms("Python, C, Rust"))

    def test_postgresql_is_not_a_literal_sql(self):
        self.assertEqual(ats.find_terms("PostgreSQL"), ["PostgreSQL"])
        self.assertIn("SQL", ats.find_terms("Python, SQL"))

    def test_react_native_is_not_react(self):
        self.assertEqual(ats.find_terms("React Native"), ["React Native"])


class Score(unittest.TestCase):
    def test_counts_posting_terms_found_in_the_cv(self):
        result = ats.score(GOOD_CV, "We use TypeScript, React, Node.js and Kafka.")
        self.assertEqual(result["score"], 75)
        self.assertEqual(result["missing"], ["Kafka"])

    def test_what_the_archive_step_appends_is_not_the_posting(self):
        posting = "TypeScript, React, Node.js\nURL: https://example.com/kafka\n\n## posting_guard\nKafka Docker Redis"
        self.assertEqual(ats.score(GOOD_CV, posting)["score"], 100)

    def test_too_few_terms_gives_no_score(self):
        self.assertIsNone(ats.score(GOOD_CV, "Be a great teammate who knows React.")["score"])

    def test_an_unreadable_cv_scores_zero_however_many_terms_match(self):
        result = ats.score(GOOD_CV.replace("dana.cohen@example.com", "(cid:12)"), "TypeScript, React, Node.js")
        self.assertEqual(result["score"], 0)
        self.assertEqual(len(result["problems"]), 2)


    def test_words_that_run_together_score_zero(self):
        result = ats.score(GOOD_CV, "TypeScript, React, Node.js", "SoftwareEngineerbuildingproductionfeaturesacrossthestack")
        self.assertEqual(result["score"], 0)
        self.assertEqual(result["problems"], ["words run together in the text layer"])

    def test_the_same_text_with_spaces_is_fine(self):
        result = ats.score(GOOD_CV, "TypeScript, React, Node.js", "Software Engineer building production features")
        self.assertEqual(result["score"], 100)


class ParseProblems(unittest.TestCase):
    def test_a_good_cv_has_none(self):
        self.assertEqual(ats.parse_problems(GOOD_CV), [])

    def test_each_problem_is_named(self):
        cases = {
            "no phone number as text": GOOD_CV.replace("050-123-4567", "LINKEDIN"),
            "a main section heading is missing": GOOD_CV.replace("EDUCATION", "SCHOOL"),
            "the section headings are out of order": "dana.cohen@example.com 050-123-4567 Aug 2025 - Present EDUCATION TECHNICAL SKILLS PROFESSIONAL EXPERIENCE",
            "no job dates with months": GOOD_CV.replace("Aug 2025 - Present", "2025 - Present"),
            "a date range uses a non-ASCII dash": GOOD_CV.replace("2023 - 2026", "2023–2026"),
        }
        for problem, text in cases.items():
            self.assertIn(problem, ats.parse_problems(text))


if __name__ == "__main__":
    unittest.main()
