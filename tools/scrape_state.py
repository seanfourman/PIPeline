#!/usr/bin/env python3
"""Keep /scrape's growing history out of the agent context.

Pass a JSON array of search hits to `candidates` before fetching details, then
pass the enriched entries to `store`. Both commands deduplicate against the
current history and tracker; `store` writes the history atomically.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

from job_key import make_key
from rank_state import STATE, TRACKER, load_state, norm, save_state, state_lock, tracker_pairs


def read_jobs(path: Path) -> list:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {path}: {exc}") from exc
    if isinstance(data, dict):
        data = data.get("results")
    if not isinstance(data, list):
        raise ValueError("results must be a JSON array of jobs")
    return data


def identity(job: dict) -> tuple[str, tuple[str, str] | None]:
    """A hit's URL, and its company and title pair when it names a company.

    A job board can hide the employer (an agency's posting, a confidential
    search). Such a posting still counts, with an empty company string. Two of
    them with one title need not be one job, so only the URL tells them apart,
    and they have no pair.
    """
    for field in ("title", "url"):
        if not isinstance(job.get(field), str) or not job[field].strip():
            raise ValueError(f"job needs a non-empty {field}")
    if not isinstance(job.get("company"), str):
        raise ValueError("job needs a company, an empty string when the posting names none")
    url = job["url"].strip()
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"job has an invalid posting URL: {url}")
    pair = (norm(job["company"]), norm(job["title"])) if job["company"].strip() else None
    return url.rstrip("/"), pair


def select(jobs: list, seen: dict, tracker: set, *, strict: bool = False) -> tuple[list[dict], dict]:
    urls, pairs = set(), set()
    for entry in seen.values():
        if not isinstance(entry, dict):
            raise ValueError("user/job_scraper/seen_jobs.json contains a non-object entry")
        if isinstance(entry.get("url"), str):
            urls.add(entry["url"].rstrip("/"))
        if norm(entry.get("company")):
            pairs.add((norm(entry.get("company")), norm(entry.get("title"))))

    selected = []
    counts = {"already_seen": 0, "already_applied": 0, "repeated_in_batch": 0, "invalid": []}
    batch_urls, batch_pairs = set(), set()
    for index, job in enumerate(jobs):
        try:
            if not isinstance(job, dict):
                raise ValueError("job is not an object")
            url, pair = identity(job)
        except ValueError as exc:
            if strict:
                raise ValueError(f"job {index + 1}: {exc}") from exc
            counts["invalid"].append({"index": index, "error": str(exc)})
            continue
        if url in urls or (pair and pair in pairs):
            counts["already_seen"] += 1
        elif pair and pair in tracker:
            counts["already_applied"] += 1
        elif url in batch_urls or (pair and pair in batch_pairs):
            counts["repeated_in_batch"] += 1
        else:
            selected.append(job)
            batch_urls.add(url)
            if pair:
                batch_pairs.add(pair)
    return selected, counts


def run(args) -> int:
    # store writes the history back, so it holds the lock from its read to its
    # write (rank_state.state_lock); the other commands only read it.
    if args.command == "store":
        with state_lock(args.state):
            return _run(args)
    return _run(args)


def _run(args) -> int:
    if args.state.exists():
        doc, seen = load_state(args.state)
    else:
        doc = {"seen": {}}
        seen = doc["seen"]
    if args.command == "history":
        domain = (args.domain or "").lower().strip(".")
        if not args.portal or not domain:
            raise ValueError("history needs --portal and --domain")
        count = 0
        for entry in seen.values():
            if not isinstance(entry, dict):
                continue
            if entry.get("portal") == args.portal:
                count += 1
            elif not entry.get("portal"):
                url = entry.get("url")
                try:
                    host = (urlsplit(url if isinstance(url, str) else "").hostname or "").lower()
                except ValueError:
                    continue
                if host == domain or host.endswith("." + domain):
                    count += 1
        print(json.dumps({"portal": args.portal, "prior_entries": count}))
        return 0

    jobs = read_jobs(args.results)
    selected, counts = select(jobs, seen, tracker_pairs(args.tracker), strict=args.command == "store")
    if args.command == "candidates":
        print(json.dumps({"selected": selected, **counts}, ensure_ascii=False))
        return 0

    added = []
    for job in selected:
        for field in ("first_seen", "posted_date", "deadline", "fit", "status", "portal", "source"):
            if field not in job:
                raise ValueError(f"job needs {field} before storage")
        if job["fit"] not in ("high", "medium", "low") or job["status"] not in ("new", "skipped", "expired"):
            raise ValueError("job has an invalid fit or status")
        if job["source"] not in ("cli", "websearch") or not isinstance(job["portal"], str):
            raise ValueError("job has an invalid portal or source")
        key = make_key(job["company"], job["title"], job["url"])
        if key in seen and not job["company"].strip():
            # With no employer named, the key is "unknown-company_<title>", and
            # another unnamed posting can have the same title: its URL, the
            # posting's identity, tells this one apart.
            url = job["url"].strip().rstrip("/")
            key = f"{key}-{hashlib.sha1(url.encode('utf-8')).hexdigest()[:6]}"
        if key in seen:
            raise ValueError(f"canonical key already exists for another posting: {key}")
        seen[key] = job
        added.append(key)
    if selected:
        args.state.parent.mkdir(parents=True, exist_ok=True)
        save_state(args.state, doc)
    print(json.dumps({"added": added, **counts}, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=("candidates", "store", "history"))
    parser.add_argument("--results", type=Path)
    parser.add_argument("--portal")
    parser.add_argument("--domain")
    args = parser.parse_args()
    args.state, args.tracker = STATE, TRACKER
    try:
        if args.command != "history" and args.results is None:
            parser.error("candidates and store need --results")
        return run(args)
    except ValueError as exc:
        print(f"scrape_state: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
