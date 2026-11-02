"""Guard for cv_checks.json: the wording a CV may not use, and that the template reads every limit."""
import importlib.util
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "templates" / "cv" / "one-page-clean"
sys.path.insert(0, str(TEMPLATE))
spec = importlib.util.spec_from_file_location("cv_build", TEMPLATE / "build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


def refused(line: str) -> list[str]:
    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder) / "main.tex"
        source.write_text(line, encoding="utf-8")
        return build.banned_wording(source)


class BannedWording(unittest.TestCase):
    def test_stops_what_the_rules_ban(self):
        for line in (
            "Lives in Netanya", "based in Israel", "Final degree project", "Final project, grade 98", "capstone  project",
            "Used Claude and ChatGPT", "AI-assisted development", "AI assisted development", "vibe coding",
            "340 commits", "a commit", "35 test files", "35 automated TypeScript test files", "a 12-slide talk", "12 slides",
        ):
            self.assertTrue(refused(line), line)

    def test_leaves_ordinary_engineering_text_alone(self):
        for line in (
            "Committed to a schedule", "Wrote automated tests", "Graded answers with Gemini",
            "Software Engineering Project (Industry Collaboration)",
        ):
            self.assertEqual(refused(line), [], line)

    def test_a_tex_comment_is_not_cv_text(self):
        self.assertEqual(refused("% final project\nReal text \\% final"), [])

    def test_special_characters_are_literal(self):
        self.assertIsNotNone(re.search(build.phrase_pattern("c++"), "knows c++ well"))
        self.assertIsNone(re.search(build.phrase_pattern("c++"), "ccc"))


class Limits(unittest.TestCase):
    def test_the_template_reads_every_limit_and_hardcodes_none(self):
        limits = json.loads(build.CHECKS.read_text(encoding="utf-8"))["limits"]
        style = (TEMPLATE / "onepage.sty").read_text(encoding="utf-8")
        for name in limits:
            self.assertIn(f'cvlimit("{name}")', style)
        for hardcoded in ("cvlines=4", "cvskilllines>6", "cvskillitems>20", "0.85"):
            self.assertNotIn(hardcoded, style)


if __name__ == "__main__":
    unittest.main()
