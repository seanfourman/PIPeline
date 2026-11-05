"""The few facts about the user that the tools need, from user/profile.json.

The user/ folder holds everything that belongs to one person (profile, rules, CVs, applications, job list,
settings) and is never committed, so nothing personal is written into the code. The introduction on the web
interface fills it in for a new user.
"""

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent


def profile(root: pathlib.Path = ROOT) -> dict:
    try:
        data = json.loads((root / "user" / "profile.json").read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def cv_file_name(root: pathlib.Path = ROOT) -> str:
    """The name the CV sent to employers carries: "<the user's name> - Resume.pdf", or "Resume.pdf" with no name
    set. Characters a file name can't hold are dropped."""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", str(profile(root).get("name") or "")).strip()[:60]
    return f"{name} - Resume.pdf" if name else "Resume.pdf"
