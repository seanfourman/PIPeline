#!/usr/bin/env python3
"""Inventory a person's projects for a portfolio: their public GitHub repositories and the project folders on
this computer, with the facts that show what is worth showcasing.

Read-only but for its own inventory, which it writes only inside user/portfolio/. It never reads source code (only
file names and sizes, READMEs and manifests), never opens secrets (.env files, keys) and never walks system folders. GitHub is read through `gh` when it is
installed and signed in, otherwise through the public API (60 calls an hour without a token; GITHUB_TOKEN raises
that), so only public repositories show unless `gh` is signed in.

Usage:
  python tools/portfolio_scan.py [--github USER] [--root PATH ...] [--depth N] [--out FILE] [--no-local]

With no --root it looks in the usual places for code under the home folder (Desktop, Documents, source, Projects,
dev, code, repos, GitHub), the ones that exist. The inventory goes to user/portfolio/inventory.json by default,
and a short table of what was found is printed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORTFOLIO = ROOT / "user" / "portfolio"
DEFAULT_OUT = PORTFOLIO / "inventory.json"

# A folder with one of these in it is a project; the walk doesn't go further down once it finds one.
MARKERS = {
    ".git", "package.json", "pyproject.toml", "requirements.txt", "setup.py", "Cargo.toml", "go.mod", "pom.xml",
    "build.gradle", "build.gradle.kts", "CMakeLists.txt", "composer.json", "Gemfile", "pubspec.yaml", "deno.json",
    "Package.swift", "mix.exs",
}
MARKER_SUFFIXES = (".sln", ".csproj", ".ipynb", ".xcodeproj")
# Never walked into, for finding projects or for counting their files.
SKIP_DIRS = {
    "node_modules", ".git", "venv", ".venv", "env", "__pycache__", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
    "target", "bin", "obj", ".idea", ".vscode", ".vs", "site-packages", ".cache", ".gradle", "Pods", "DerivedData",
    ".turbo", ".parcel-cache", "coverage", ".pytest_cache", ".mypy_cache", ".tox", "vendor", "third_party", "external",
    ".terraform", "AppData", "Program Files", "Program Files (x86)", "Windows", "$Recycle.Bin", "System Volume Information",
    "OneDriveTemp", ".Trash", "Library", "checkpoints", "wandb", "mlruns", ".ipynb_checkpoints", "installer",
}
SECRET_NAMES = re.compile(r"^(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_rsa.*|credentials.*|secrets?\..*)$", re.I)
MEDIA_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp4", ".webm", ".mov"}
MEDIA_DIRS = {"media", "docs", "assets", "screenshots", "images", "img", "demo", "gifs", "videos", ".github"}
LANGS = {
    ".py": "Python", ".ipynb": "Jupyter", ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
    ".mjs": "JavaScript", ".cjs": "JavaScript", ".cs": "C#", ".java": "Java", ".kt": "Kotlin", ".go": "Go", ".rs": "Rust",
    ".cpp": "C++", ".cc": "C++", ".cxx": "C++", ".hpp": "C++", ".h": "C/C++", ".c": "C", ".swift": "Swift", ".rb": "Ruby",
    ".php": "PHP", ".html": "HTML", ".css": "CSS", ".scss": "CSS", ".sass": "CSS", ".wgsl": "WGSL", ".glsl": "GLSL",
    ".frag": "GLSL", ".vert": "GLSL", ".hlsl": "HLSL", ".sql": "SQL", ".r": "R", ".dart": "Dart", ".vue": "Vue",
    ".svelte": "Svelte", ".sh": "Shell", ".ps1": "PowerShell", ".lua": "Lua", ".tex": "TeX", ".m": "MATLAB",
    ".scala": "Scala", ".ex": "Elixir", ".exs": "Elixir", ".hs": "Haskell", ".zig": "Zig", ".sol": "Solidity",
}
LIVE_HOSTS = re.compile(
    r"https?://[\w.-]+\.(?:vercel\.app|netlify\.app|onrender\.com|github\.io|pages\.dev|herokuapp\.com|fly\.dev|"
    r"railway\.app|web\.app|firebaseapp\.com|streamlit\.app|huggingface\.co/spaces[\w/.-]*|surge\.sh|glitch\.me)[^\s)\"'<>]*",
    re.I,
)
FILE_CAP = 25_000
README_NAMES = ("README.md", "readme.md", "Readme.md", "README.MD", "README.rst", "README.txt", "README")


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def iso(ts: float | None) -> str | None:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ts else None


def run(cmd: list[str], cwd: Path | None = None, timeout: int = 20) -> str:
    try:
        done = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
        return done.stdout.strip() if done.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def norm_remote(url: str) -> str:
    """github.com/owner/name for a remote, whatever its form (https, ssh, .git)."""
    url = url.strip()
    m = re.search(r"github\.com[:/]+([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", url, re.I)
    return f"github.com/{m.group(1)}/{m.group(2)}".lower() if m else ""


# ---------- GitHub ----------

def github_repos(user: str) -> tuple[list[dict], str]:
    fields = ("name full_name description html_url homepage language topics stargazers_count forks_count fork archived "
              "created_at pushed_at size default_branch open_issues_count license").split()
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "pip-portfolio-scan"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    gh = bool(shutil.which("gh")) and subprocess.run(["gh", "auth", "status"], capture_output=True).returncode == 0

    def page(n: int) -> list | None:
        path = f"users/{user}/repos?per_page=100&type=owner&sort=pushed&page={n}"
        if gh:
            out = run(["gh", "api", path], timeout=60)
            try:
                return json.loads(out) if out else None
            except json.JSONDecodeError:
                return None
        try:
            with urllib.request.urlopen(urllib.request.Request(f"https://api.github.com/{path}", headers=headers), timeout=20) as res:
                return json.loads(res.read().decode("utf-8"))
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as err:
            log(f"GitHub: {err}")
            return None

    raw: list[dict] = []
    for n in range(1, 6):
        batch = page(n)
        if not isinstance(batch, list) or not batch:
            break
        raw.extend(batch)
        if len(batch) < 100:
            break
    how = "gh" if gh else "api"
    repos = []
    for r in raw:
        repo = {k: r.get(k) for k in fields}
        repo["license"] = (r.get("license") or {}).get("spdx_id") if isinstance(r.get("license"), dict) else None
        repo["key"] = norm_remote(r.get("html_url") or "")
        repos.append(repo)
    return repos, how


def current_name(key: str) -> str:
    """A repository's address now, for one renamed since a folder was cloned: GitHub answers the old address with
    the repository under its new name. One call each, only for remotes that matched nothing."""
    owner_name = key.removeprefix("github.com/")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "pip-portfolio-scan"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.github.com/repos/{owner_name}", headers=headers), timeout=15) as res:
            return norm_remote(json.loads(res.read().decode("utf-8")).get("html_url") or "")
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return ""


def github_readme(full_name: str, branch: str) -> dict | None:
    """The README's size and what it shows, read from raw.githubusercontent.com (not counted against the API limit)."""
    for name in ("README.md", "readme.md", "Readme.md"):
        url = f"https://raw.githubusercontent.com/{full_name}/{branch}/{name}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "pip-portfolio-scan"}), timeout=15) as res:
                return readme_facts(res.read().decode("utf-8", "replace"))
        except (urllib.error.URLError, TimeoutError):
            continue
    return None


# ---------- this computer ----------

def default_roots() -> list[Path]:
    home = Path.home()
    names = ["Desktop", "Documents", "source", "Projects", "projects", "dev", "code", "Code", "repos", "GitHub", "git", "src"]
    seen, roots = set(), []
    for n in names:
        p = home / n
        if p.is_dir() and p.resolve() not in seen:
            seen.add(p.resolve())
            roots.append(p)
    return roots


def is_project(path: Path, entries: list[str]) -> bool:
    if any(e in MARKERS for e in entries):
        return True
    return any(e.endswith(MARKER_SUFFIXES) for e in entries)


def find_projects(roots: list[Path], depth: int) -> list[Path]:
    found: list[Path] = []
    for root in roots:
        stack = [(root, 0)]
        while stack:
            path, d = stack.pop()
            try:
                entries = os.listdir(path)
            except OSError:
                continue
            # A root is only where to look: a stray notebook or package.json on the Desktop doesn't make the whole
            # Desktop one project.
            if path != root and is_project(path, entries):
                found.append(path)
                continue
            if d >= depth:
                continue
            for e in entries:
                if e.startswith(".") or e in SKIP_DIRS:
                    continue
                child = path / e
                if child.is_dir() and not child.is_symlink():
                    stack.append((child, d + 1))
    return sorted(set(found))


def readme_facts(text: str) -> dict:
    return {
        "chars": len(text),
        "headings": len(re.findall(r"^#{1,6} ", text, re.M)),
        "images": len(re.findall(r"!\[[^\]]*\]\([^)]+\)|<img\b", text, re.I)),
        "gifs": len(re.findall(r"\.gif\b", text, re.I)),
        "videos": len(re.findall(r"\.(?:mp4|webm|mov)\b|user-attachments/assets", text, re.I)),
        "badges": len(re.findall(r"shields\.io|badge", text, re.I)),
        "tables": len(re.findall(r"^\|.*\|\s*$", text, re.M)),
        "code_blocks": text.count("```") // 2,
        "details": len(re.findall(r"<details", text, re.I)),
        "live_links": sorted(set(LIVE_HOSTS.findall(text)))[:5],
        "title": next((l.lstrip("# ").strip() for l in text.splitlines() if l.startswith("#")), ""),
    }


def manifest_facts(path: Path, entries: set[str]) -> dict:
    facts: dict = {}
    if "package.json" in entries:
        try:
            pkg = json.loads((path / "package.json").read_text(encoding="utf-8", errors="replace"))
            deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
            facts["node"] = {
                "name": pkg.get("name"), "description": pkg.get("description"), "homepage": pkg.get("homepage"),
                "scripts": sorted((pkg.get("scripts") or {}).keys())[:20], "dependencies": sorted(deps.keys())[:60],
            }
        except (OSError, json.JSONDecodeError):
            pass
    if "pyproject.toml" in entries:
        text = (path / "pyproject.toml").read_text(encoding="utf-8", errors="replace")[:20_000]
        name = re.search(r'^name\s*=\s*"([^"]+)"', text, re.M)
        desc = re.search(r'^description\s*=\s*"([^"]+)"', text, re.M)
        facts["python"] = {"name": name and name.group(1), "description": desc and desc.group(1)}
    if "requirements.txt" in entries:
        lines = (path / "requirements.txt").read_text(encoding="utf-8", errors="replace").splitlines()
        reqs = [re.split(r"[<>=!~\[; ]", l.strip())[0] for l in lines if l.strip() and not l.startswith("#")]
        facts.setdefault("python", {})["requirements"] = reqs[:60]
    return facts


def walk_files(path: Path):
    count = 0
    for dirpath, dirnames, filenames in os.walk(path):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".") or d == ".github"]
        for f in filenames:
            count += 1
            if count > FILE_CAP:
                return
            yield Path(dirpath), f


def git_facts(path: Path) -> dict | None:
    if not (path / ".git").exists():
        return None
    log_dates = run(["git", "-C", str(path), "log", "--format=%ct"], timeout=30).split()
    remotes = run(["git", "-C", str(path), "remote", "-v"]).splitlines()
    remote = next((r.split()[1] for r in remotes if r.split()[0:1] == ["origin"]), remotes[0].split()[1] if remotes else "")
    authors = run(["git", "-C", str(path), "shortlog", "-sne", "HEAD"], timeout=30).splitlines()
    return {
        "remote": remote, "key": norm_remote(remote), "commits": len(log_dates),
        "first_commit": iso(float(log_dates[-1])) if log_dates else None, "last_commit": iso(float(log_dates[0])) if log_dates else None,
        "authors": len(authors), "branch": run(["git", "-C", str(path), "branch", "--show-current"]),
    }


def local_project(path: Path) -> dict:
    entries = set(os.listdir(path))
    langs: dict[str, int] = {}
    media = 0
    total = 0
    tests = False
    newest = 0.0
    for d, f in walk_files(path):
        if SECRET_NAMES.match(f):
            continue
        p = d / f
        try:
            st = p.stat()
        except OSError:
            continue
        total += st.st_size
        newest = max(newest, st.st_mtime)
        ext = p.suffix.lower()
        if ext in LANGS:
            langs[LANGS[ext]] = langs.get(LANGS[ext], 0) + st.st_size
        if ext in MEDIA_EXT and (set(p.relative_to(path).parts[:-1]) & MEDIA_DIRS or d == path):
            media += 1
        if re.match(r"(test_.*|.*_test|.*\.test|.*\.spec)\.\w+$", f) or d.name in ("tests", "test", "__tests__"):
            tests = True
    readme = next((path / n for n in README_NAMES if n in entries), None)
    readme_info = None
    if readme:
        try:
            readme_info = readme_facts(readme.read_text(encoding="utf-8", errors="replace")[:400_000])
            readme_info["path"] = str(readme)
        except OSError:
            pass
    mf = manifest_facts(path, entries)
    live = set((readme_info or {}).get("live_links", []))
    home = (mf.get("node") or {}).get("homepage")
    if isinstance(home, str) and home.startswith("http"):
        live.add(home)
    top = sorted(langs.items(), key=lambda kv: -kv[1])
    code_bytes = sum(langs.values())
    return {
        "name": path.name, "path": str(path), "git": git_facts(path),
        "languages": {k: round(v / code_bytes * 100) for k, v in top[:6]} if code_bytes else {},
        "code_kb": round(code_bytes / 1024), "size_mb": round(total / 1_048_576, 1), "last_modified": iso(newest or None),
        "readme": readme_info, "media_files": media, "tests": tests,
        "ci": (path / ".github" / "workflows").is_dir(), "docker": "Dockerfile" in entries or "docker-compose.yml" in entries,
        "license": next((e for e in entries if e.upper().startswith("LICENSE")), None),
        "live_urls": sorted(live)[:5], "manifests": mf,
        "has_secrets_file": any(SECRET_NAMES.match(e) for e in entries),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--github", help="GitHub user name")
    ap.add_argument("--root", action="append", default=[], help="folder to look for projects in (repeatable)")
    ap.add_argument("--depth", type=int, default=4, help="how deep under each root to look (default 4)")
    ap.add_argument("--readmes", type=int, default=12, help="READMEs to read from GitHub for repos not on this computer")
    ap.add_argument("--no-local", action="store_true", help="only GitHub")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="a .json file inside user/portfolio/")
    args = ap.parse_args()
    # The inventory goes only into the portfolio's folder, so running the scan can never write over anything else.
    out = Path(args.out).resolve()
    if out.suffix.lower() != ".json" or not out.is_relative_to(PORTFOLIO.resolve()):
        ap.error(f"--out must be a .json file inside {PORTFOLIO}")
    # Folder names in any language print, whatever the console's code page.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    started = time.time()
    inventory: dict = {"generated": iso(time.time()), "github_user": args.github, "github_via": None, "roots": [], "projects": []}
    repos: list[dict] = []
    if args.github:
        repos, how = github_repos(args.github)
        inventory["github_via"] = how
        log(f"GitHub: {len(repos)} repositories via {how or 'nothing'}")

    locals_: list[dict] = []
    if not args.no_local:
        roots = [Path(r).expanduser() for r in args.root] or default_roots()
        inventory["roots"] = [str(r) for r in roots]
        for i, p in enumerate(find_projects(roots, args.depth)):
            try:
                locals_.append(local_project(p))
            except OSError as err:
                log(f"skipped {p}: {err}")
            if (i + 1) % 10 == 0:
                log(f"... {i + 1} local projects read")

    by_key = {r["key"]: r for r in repos if r.get("key")}
    used = set()
    owner = f"github.com/{args.github.lower()}/" if args.github else None
    for proj in locals_:
        key = (proj.get("git") or {}).get("key")
        if key and owner and key.startswith(owner) and key not in by_key:
            renamed = current_name(key)
            if renamed in by_key:
                proj["git"]["key"] = key = renamed
        proj["github"] = by_key.get(key) if key else None
        if proj["github"]:
            used.add(key)
        proj["source"] = "both" if proj["github"] else "local"
    remote_only = [r for r in repos if r.get("key") not in used]
    # READMEs of the most promising repos that aren't on this computer: not forks, most stars, then most recent.
    remote_only.sort(key=lambda r: r.get("pushed_at") or "", reverse=True)
    remote_only.sort(key=lambda r: (bool(r.get("fork")), -(r.get("stargazers_count") or 0)))
    for r in remote_only[: max(0, args.readmes)]:
        if not r.get("fork"):
            r["readme"] = github_readme(r["full_name"], r.get("default_branch") or "main")
    inventory["projects"] = locals_ + [{"name": r["name"], "source": "github", "github": r} for r in remote_only]
    inventory["seconds"] = round(time.time() - started, 1)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(inventory, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"{len(inventory['projects'])} projects ({len(locals_)} on this computer, {len(remote_only)} only on GitHub) -> {out}")
    print(f"{'name':32} {'from':6} {'commits':>7} {'stars':>5} {'readme':>7} {'media':>5}  languages")
    for p in inventory["projects"]:
        gh = p.get("github") or {}
        g = p.get("git") or {}
        rd = (p.get("readme") or gh.get("readme") or {}) or {}
        langs = ", ".join(list((p.get("languages") or {}).keys())[:3]) or (gh.get("language") or "")
        print(f"{p['name'][:32]:32} {p['source']:6} {g.get('commits', ''):>7} {gh.get('stargazers_count', '') if gh else '':>5} "
              f"{rd.get('chars', ''):>7} {p.get('media_files', ''):>5}  {langs}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
