#!/usr/bin/env python3
"""Gives a new user their own folder: copies every starting file from templates/user/ into user/ that isn't there yet.

Usage: python tools/init_user.py

user/ holds everything that belongs to one person and is never committed (see .gitignore). A file already in
user/ is never overwritten, so running this again is safe. The web interface runs the same step when it starts.
"""

import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "templates" / "user"
USER = ROOT / "user"


def init_user(root: pathlib.Path = ROOT) -> list[str]:
    """Copy the missing starting files and return the ones copied, relative to user/."""
    templates, user = root / "templates" / "user", root / "user"
    added = []
    for source in sorted(p for p in templates.rglob("*") if p.is_file()):
        target = user / source.relative_to(templates)
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        added.append(target.relative_to(user).as_posix())
    return added


def main() -> int:
    added = init_user()
    print("\n".join(f"added user/{a}" for a in added) if added else "user/ already has every starting file")
    return 0


if __name__ == "__main__":
    sys.exit(main())
