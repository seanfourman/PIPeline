# Job search workspace

This file is the same for everyone who uses this workspace. Everything about the person using it (their profile, CV rules, search settings, CVs and applications) lives in `user/`, which is never committed, and their own instructions are in `user/CLAUDE.md`, loaded below.

A new user's `user/` starts from `templates/user/` and is filled in by the web interface's introduction or by `/setup`. If `user/CLAUDE.md` is missing, run `python tools/init_user.py` first, then `/setup`.

Wherever an instruction names a file under `user/`, it means this user's own copy. Never copy anything from `user/` into a file outside it.

Whatever you write to the user in Hebrew (replies, questions, notes in the interface) addresses them in gender-neutral forms: plural, infinitive or impersonal, never the masculine or feminine singular.

@user/CLAUDE.md
