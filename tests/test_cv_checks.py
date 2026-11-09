"""Guard for cv_checks.json: the wording a CV may not use, and that the template reads every limit.

build.py reads the user's own list (user/cv_checks.json, never committed) when there is one, and the template's
neutral list otherwise. Each check here names the list it reads, so the suite gives the same answer on every
computer, with or without a user/ folder.
"""
import importlib.util
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
TEMPLATE = REPO / "templates" / "cv" / "one-page-clean"
sys.path.insert(0, str(TEMPLATE))
spec = importlib.util.spec_from_file_location("cv_build", TEMPLATE / "build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

# The template's neutral list, which a user has until they write their own.
SHARED = TEMPLATE / "cv_checks.json"
# A list like one a user keeps in user/cv_checks.json, written on the rules screen: a sample, to check how its
# phrases match. # is any number, * up to two words, and a plural or a hyphen still matches.
OWN = {
    "banned": [
        {"reason": "a project reads as real work", "phrases": ["final project", "degree project", "capstone project", "grade #"]},
        {"reason": "the work, not the tools", "phrases": ["claude", "chatgpt", "vibe", "ai assisted"]},
    ],
}


def refused(line: str, checks=None) -> list[str]:
    """What build.py refuses in a CV of this text: by the template's neutral list, or by the list given."""
    with tempfile.TemporaryDirectory() as folder:
        source = Path(folder) / "main.tex"
        source.write_text(line, encoding="utf-8")
        path = SHARED
        if checks is not None:
            path = Path(folder) / "cv_checks.json"
            path.write_text(json.dumps(checks), encoding="utf-8")
        with mock.patch.object(build, "CHECKS", path):
            return build.banned_wording(source)


class BannedWording(unittest.TestCase):
    def test_stops_what_the_rules_ban(self):
        for line in (
            "Lives in Haifa", "based in Israel", "340 commits", "a commit",
            "35 test files", "35 automated TypeScript test files", "a 12-slide talk", "12 slides",
        ):
            self.assertTrue(refused(line), line)
        for line in (
            "Final degree project", "Final project, grade 98", "capstone  project",
            "Used Claude and ChatGPT", "AI-assisted development", "AI assisted development", "vibe coding",
        ):
            self.assertTrue(refused(line, OWN), line)

    def test_leaves_ordinary_engineering_text_alone(self):
        for checks in (None, OWN):
            for line in (
                "Committed to a schedule", "Wrote automated tests", "Graded answers with Gemini",
                "Software Engineering Project (Industry Collaboration)",
            ):
                self.assertEqual(refused(line, checks), [], line)

    def test_a_tex_comment_is_not_cv_text(self):
        self.assertEqual(refused("% final project\nReal text \\% final", OWN), [])

    def test_special_characters_are_literal(self):
        self.assertIsNotNone(re.search(build.phrase_pattern("c++"), "knows c++ well"))
        self.assertIsNone(re.search(build.phrase_pattern("c++"), "ccc"))


class Limits(unittest.TestCase):
    def test_the_template_reads_every_limit_and_hardcodes_none(self):
        limits = json.loads(SHARED.read_text(encoding="utf-8"))["limits"]
        style = (TEMPLATE / "onepage.sty").read_text(encoding="utf-8")
        for name in limits:
            self.assertIn(f'cvlimit("{name}")', style)
        for hardcoded in ("cvlines=4", "cvskilllines>6", "cvskillitems>20", "0.85"):
            self.assertNotIn(hardcoded, style)


if __name__ == "__main__":
    unittest.main()
