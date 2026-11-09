#!/usr/bin/env python3
"""Where a pre-approved tool may read or write a file the agent names.

`.claude/settings.json` lets the agent run some tools with any arguments, and
the SDK allows those commands before the web app's policy (web/policy.ts) is
asked, so a path such a tool opens is part of that grant. A path anywhere on
disk would be a write nobody was asked about - a script an allowed command
runs, a startup folder, Claude's own settings - or a read around the policy's,
such as a key file. Each tool names the folders its workflow uses and refuses a
path that resolves anywhere else. verify_pdf.py's --dump-text check is the same
rule with its own folders.
"""

import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def temp_dirs():
    """The system temp directory, where the session scratchpad and the web app's work files are."""
    dirs = [Path(tempfile.gettempdir())]
    if os.name != "nt":
        dirs.append(Path("/tmp"))
    return [d.resolve() for d in dirs]


def refused(path, inside, suffix=None):
    """Return why `path` may not be used, or None if it resolves inside one of the folders `inside`."""
    path = Path(path)
    # On Windows "x.py::$DATA" is x.py itself, and no path a workflow passes has a colon after the drive.
    if ":" in str(path)[len(path.anchor):]:
        return "must not contain ':'"
    if suffix is not None and path.suffix.lower() != suffix:
        return f"must name a {suffix} file"
    if path.is_symlink():
        return "must not be a symlink"
    # resolve() follows links and "..", and gives an existing file's long name for a Windows short one (SETTIN~1.JSO).
    real = path.resolve()
    if not any(real.is_relative_to(folder) for folder in inside):
        return "must be inside " + " or ".join(str(folder) for folder in inside)
    return None
