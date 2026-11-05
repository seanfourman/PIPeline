#!/usr/bin/env python3
"""Compiles a tailored CV, verifies it, and saves the file that goes to the employer.

Run from the repository root: python templates/cv/one-page-clean/build.py <company>_<role>

It builds user/cv/main_<company>_<role>.tex and, when every check passes, writes
user/documents/applications/<company>_<role>/<the user's name> - Resume.pdf (the name from user/profile.json).
A broken CV rule prints what to rewrite and exits 1.
"""

import json
import pathlib
import re
import shutil
import subprocess
import sys

import ats

REPO = pathlib.Path(__file__).resolve().parents[3]
FINAL_NAME = ats.CV_NAME
# The user's limits and banned wording (user/cv_checks.json, never committed), or the template's neutral ones.
USER_CHECKS = REPO / "user" / "cv_checks.json"
CHECKS = USER_CHECKS if USER_CHECKS.exists() else pathlib.Path(__file__).with_name("cv_checks.json")


def phrase_pattern(phrase: str) -> str:
    """A phrase from cv_checks.json as a regex. # is any number, * is up to two words, and a plural or a hyphen still matches."""
    pattern = ""
    for word in re.split(r"[\s-]+", phrase.strip()):
        if word == "*":
            pattern += r"(?:[\s-]+\w+){0,2}" if pattern else ""
            continue
        if pattern:
            pattern += r"[\s-]+"
        pattern += r"\d+" if word == "#" else re.escape(word)
    return rf"(?<!\w){pattern}s?(?!\w)"


def banned_list() -> list[tuple[re.Pattern, str]]:
    groups = json.loads(CHECKS.read_text(encoding="utf-8"))["banned"]
    return [(re.compile("|".join(map(phrase_pattern, group["phrases"])), re.I), group["reason"]) for group in groups if group["phrases"]]


def banned_wording(source: pathlib.Path) -> list[str]:
    banned = banned_list()
    found = []
    for number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), 1):
        text = re.sub(r"(?<!\\)%.*", "", line)
        for pattern, reason in banned:
            match = pattern.search(text)
            if match:
                found.append(f"line {number}: \"{match.group()}\": {reason}")
    return found


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2 or not re.fullmatch(r"[a-z0-9_]+", sys.argv[1]):
        print("usage: build.py <company>_<role>, in lowercase letters, digits and underscores")
        return 2
    name = sys.argv[1]
    cv = REPO / "user" / "cv"
    source = cv / f"main_{name}.tex"
    if not source.exists():
        print(f"not found: {source.relative_to(REPO).as_posix()}")
        return 2
    banned = banned_wording(source)
    if banned:
        print("BUILD STOPPED. Rewrite these, following user/CV_RULES.md:")
        print("\n".join(banned))
        return 1
    engine = shutil.which("lualatex")
    if not engine:
        print("lualatex is not on PATH")
        return 2

    build = cv / "build"
    build.mkdir(exist_ok=True)
    pdf = cv / f"main_{name}.pdf"
    # A failed compile also removes the PDF in user/cv/, and the last good one should stay openable.
    last_good = pdf.read_bytes() if pdf.exists() else None
    try:
        run = subprocess.run(
            [engine, "-interaction=nonstopmode", "-halt-on-error", "-output-directory=build", source.name],
            cwd=cv, capture_output=True, timeout=300,
        )
        log = run.stdout.decode("utf-8", "replace")
        built = build / pdf.name
        if run.returncode != 0 or not built.exists() or built.stat().st_size == 0:
            lines = log.splitlines()
            errors = [i for i, line in enumerate(lines) if line.startswith("!") or "Job dates need months" in line]
            print("COMPILE STOPPED. Fix the text, not the layout:")
            for i in errors[:3]:
                print("\n".join(lines[i:i + 4]))
            return 1
        built.replace(pdf)
    finally:
        shutil.rmtree(build, ignore_errors=True)
        if last_good and not pdf.exists():
            pdf.write_bytes(last_good)

    check = subprocess.run(
        [sys.executable, "tools/verify_pdf.py", f"user/cv/{pdf.name}", "--pages", "1", "--ascii-dates"],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8",
    )
    print((check.stdout + check.stderr).strip())
    if check.returncode != 0:
        return 1

    folder = REPO / "user" / "documents" / "applications" / name
    folder.mkdir(parents=True, exist_ok=True)
    final = folder / FINAL_NAME
    shutil.copyfile(pdf, final)
    print(f"Saved {final.relative_to(REPO).as_posix()}")
    if (folder / "job_posting.md").exists():
        ats.report(name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
