#!/usr/bin/env python3
"""Scores a tailored CV by what the largest employers tell applicants, and by the system's own CV rules.

ats.py calls card() after it scores the posting's terms and saves the result as scorecard.json beside the CV.
Each lens is a checklist drawn from one employer's published advice (the sources are in
.claude/skills/job-application-assistant/cv-research/13-large-employers.md), and its score is the share of
its checks the CV passes. No employer has seen the CV: a lens measures it against what that employer
publishes, nothing more. Workday's lens grades A to D the way its HiredScore documentation defines the grades,
from the posting's tools and skills only. The hiring systems' lens checks what Greenhouse, iCIMS and SAP
SuccessFactors document as unreadable (14-hiring-systems.md). Pip's lens is the final check of
10-cv-best-practices.md. Same files in, same scores out.
"""

from __future__ import annotations

import re
from datetime import date

# The template's commands and how many brace groups each takes.
ARGS = {"cvheadline": 1, "cvcontact": 1, "cvsummary": 1, "cvsection": 1, "cvskill": 2, "cvjob": 2, "cvrole": 2, "cvbullet": 1, "cvinfo": 2}
COMMAND = re.compile(r"\\(" + "|".join(ARGS) + r")(?![A-Za-z])")

PREFERRED = re.compile(r"advantage|\bplus\b|preferred|nice[- ]to[- ]have|bonus|יתרון|רצוי", re.I)
DUTY = re.compile(r"\b(responsible for|duties|helped|assisted|worked on|involved in|participated in|tasked with|in charge of)\b", re.I)
OBJECTIVE = re.compile(r"\b(seeking|looking for|objective|to obtain|aspiring)\b", re.I)
PRONOUN = re.compile(r"\b(I|[Mm]y|[Mm]e|[Ww]e|[Oo]ur)\b")
CLICHE = re.compile(r"\b(team player|hard[- ]working|motivated|passionate|detail[- ]oriented|results[- ]driven|synergy|proven track record|"
                    r"dynamic (team|environment|professional|individual|person)|spearheaded|leveraged|utili[sz]ed|go-getter|excellent communication)\b", re.I)
SOFT = re.compile(r"\b(communication|teamwork|team work|leadership|problem[- ]solving|time management|interpersonal|soft skills?|team player)\b", re.I)
LEVEL = re.compile(r"\b(expert|advanced|intermediate|beginner|basic|proficient|familiar)\b|\d+\s*%|[★☆●○]", re.I)
# A count written in words, but not a name that starts with one, as Three.js does.
SPELLED = re.compile(r"(?<![\w.])(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?![\w-]|\.\w)", re.I)
RESULT = re.compile(r"\b(reduc|increas|improv|cut|sav|grew|rais|lower|doubl|halv|accelerat|shorten|replac|enabl|eliminat|prevent|boost|sped|faster|adopted)\w*", re.I)
JOB_DATES = re.compile(r"[A-Z][a-z]{2} \d{4} - (?:Present|[A-Z][a-z]{2} \d{4})")
MONTH = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{4}")
HEBREW = re.compile(r"[\u0590-\u05FF]")
# What Greenhouse's parser documents as unreadable: a title cut short, and letters spaced apart.
ABBREVIATED = re.compile(r"\b(Sr|Jr|Mgr|Eng|Exec|Assoc|Asst|Coord|Spec|Admin|Dev|Dept|Mktg|Acct)\b\.?", re.I)
SPACED = re.compile(r"(?<!\S)(?:\w ){3,}\w(?!\S)")
GREENHOUSE_PARSE_LIMIT = 2_500_000

LANGUAGES = {"Python", "SQL", "R", "Java", "JavaScript", "TypeScript", "C", "C++", "C#", "Go", "Rust", "Kotlin", "Swift", "PHP", "Ruby",
             "Scala", "Bash", "MATLAB", "SAS", "VBA", "DAX"}
# A bullet that opens with one of these is a duty or a sentence, not an action.
WEAK = {"responsible", "duties", "helped", "assisted", "worked", "involved", "participated", "tasked", "the", "a", "an", "various", "in",
        "as", "for", "with", "i", "my", "was", "were", "had"}
# Action verbs that don't end in -ed: irregular past forms, and present forms for ongoing work.
VERBS = {"built", "led", "ran", "won", "cut", "made", "wrote", "set", "drove", "grew", "took", "gave", "brought", "taught", "found", "held",
         "kept", "sold", "spent", "sent", "began", "became", "chose", "rebuilt", "rewrote", "read", "put", "split", "fit", "met", "drew", "flew",
         "got", "knew", "lent", "lost", "paid", "rose", "saw", "oversaw", "shot", "spoke", "stood", "struck", "thought", "threw", "understood",
         "undertook", "overcame", "sped", "fed", "dug", "wound", "build", "lead", "run", "design", "develop", "own",
         "manage", "create", "analyze", "analyse", "automate", "maintain", "write", "migrate", "deploy", "implement", "improve", "reduce",
         "launch", "model", "clean", "train", "teach", "mentor", "support", "coordinate", "research", "test", "ship", "drive", "grow", "plan",
         "present", "deliver", "define", "map", "integrate", "optimize", "monitor", "review", "translate", "operate", "handle"}
# Words a role title carries that say its level or terms, not the job.
LEVEL_WORDS = {"junior", "jr", "senior", "sr", "intern", "internship", "student", "entry", "level", "mid", "graduate", "trainee", "i", "ii",
               "iii", "the", "a", "an", "of", "and", "for", "with", "hybrid", "remote", "part", "time", "position", "role"}
NAMES = {"google": "Google", "amazon": "Amazon", "meta": "Meta", "microsoft": "Microsoft", "nvidia": "Nvidia", "ibm": "IBM", "deloitte": "Deloitte",
         "workday": "Workday", "systems": "Hiring systems", "ats": "ATS", "pip": "Pip"}


def groups(tex: str, at: int, count: int) -> list[str]:
    """The next count brace groups after a command, skipping spaces and an optional [..] argument."""
    out, i = [], at
    while len(out) < count:
        while i < len(tex) and tex[i] in " \t\r\n":
            i += 1
        if i < len(tex) and tex[i] == "[":
            end = tex.find("]", i)
            if end < 0:
                break
            i = end + 1
            continue
        if i >= len(tex) or tex[i] != "{":
            break
        depth, start = 0, i
        while i < len(tex):
            if tex[i] == "\\":
                i += 2
                continue
            if tex[i] == "{":
                depth += 1
            elif tex[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        out.append(tex[start + 1:i])
        i += 1
    return out


def plain(tex: str) -> str:
    """LaTeX text as a reader sees it: links by their text, escapes undone, other commands dropped."""
    text = re.sub(r"\\cvlink\{[^{}]*\}\{([^{}]*)\}", r"\1", tex)
    text = re.sub(r"\\cvc?sep\{\}", " | ", text)
    text = re.sub(r"\\([&%#_$])", r"\1", text)
    text = re.sub(r"\\[A-Za-z]+\*?(\[[^\]]*\])?", "", text)
    return re.sub(r"\s+", " ", text.replace("{", "").replace("}", "").replace("~", " ")).strip()


def split_items(text: str) -> list[str]:
    """A skills line's items: split at commas, but not inside parentheses, as in "Python (pandas, NumPy)"."""
    items, depth, current = [], 0, ""
    for c in text:
        depth += (c == "(") - (c == ")" and depth > 0)
        if c == "," and depth == 0:
            items.append(current)
            current = ""
        else:
            current += c
    return [item.strip() for item in [*items, current] if item.strip()]


def parse(tex: str) -> dict:
    """The CV's parts, read from the one-page-clean template's commands."""
    tex = "\n".join(re.sub(r"(?<!\\)%.*", "", line) for line in tex.splitlines())
    cv = {"headline": "", "contact": "", "summary": "", "skills": [], "jobs": [], "projects": [], "education": [], "info": {}}
    section, entry = "", None
    for m in COMMAND.finditer(tex):
        name = m.group(1)
        args = [plain(a) for a in groups(tex, m.end(), ARGS[name])]
        if len(args) < ARGS[name]:
            continue
        if name in ("cvheadline", "cvcontact", "cvsummary"):
            cv[name[2:]] = args[0]
        elif name == "cvsection":
            section, entry = args[0].upper(), None
        elif name == "cvskill":
            cv["skills"].append({"category": args[0], "items": split_items(args[1])})
        elif name in ("cvjob", "cvrole"):
            entry = {"title": args[0], "dates": args[1], "bullets": []}
            where = "jobs" if name == "cvjob" else "projects" if "PROJECT" in section else "education" if "EDUCATION" in section else "jobs"
            cv[where].append(entry)
        elif name == "cvbullet" and entry is not None:
            entry["bullets"].append(args[0])
        elif name == "cvinfo":
            cv["info"][args[0]] = args[1]
    return cv


def posting_terms(posting: str, find_terms) -> tuple[list[str], list[str]]:
    """The posting's terms, split into required and preferred by the lines that call a skill an advantage."""
    required, preferred = [], []
    for part in re.split(r"\n|(?<=[.;])\s+", posting):
        target = preferred if PREFERRED.search(part) else required
        for term in find_terms(part):
            if term not in target:
                target.append(term)
    return required, [t for t in preferred if t not in required]


def words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9+#]+", text.lower()) if w not in LEVEL_WORDS}


def title_matches(role: str, headline: str):
    """Whether the role line, its focus included, names the posting's title, ignoring level words; None when they
    can't be compared."""
    want = words(re.sub(r"\(.*?\)", "", role or ""))
    if not want or HEBREW.search(role):
        return None
    return len(want & words(headline)) / len(want) >= 0.5


def share(items: list, test):
    return sum(1 for item in items if test(item)) / len(items) if items else None


def opens_with_verb(bullet: str) -> bool:
    first = (re.findall(r"[A-Za-z]+", bullet) or [""])[0].lower()
    return first not in WEAK and (first in VERBS or first.endswith("ed"))


def mentions(text: str, item: str) -> bool:
    core = item.split("(")[0].strip()
    return bool(core) and re.search(rf"(?<!\w){re.escape(core)}(?!\w)", text, re.I) is not None


def check(name: str, ok, value=None):
    """One check, or None when it doesn't apply to this CV or posting."""
    if ok is None:
        return None
    out = {"id": name, "ok": bool(ok)}
    if value is not None:
        out["value"] = round(100 * value)
    return out


def at_least(name: str, value, floor: float):
    return check(name, None if value is None else value >= floor, value)


def lens(name: str, checks: list, **extra) -> dict:
    used = [c for c in checks if c is not None]
    score = round(100 * sum(c["ok"] for c in used) / len(used)) if used else None
    return {"id": name, "score": score, "checks": used, **extra}


def card(tex: str, posting: str, ats_result: dict, find_terms, role: str = "", cv_text: str = "", today: date | None = None,
         candidate: str = "", pdf_bytes: int | None = None) -> dict:
    """The scorecard. cv_text is the PDF's text layer when there is one, candidate the user's name, and pdf_bytes the
    PDF's size: the checks that need them are left out without them."""
    today = today or date.today()
    cv = parse(tex)
    jobs, projects, education = cv["jobs"], cv["projects"], cv["education"]
    bullets = [b for entry in jobs + projects for b in entry["bullets"]]
    items = [item for group in cv["skills"] for item in group["items"]]
    told = " ".join(bullets + [p["title"] for p in projects])
    pdf_text = cv_text
    cv_text = pdf_text or " ".join([cv["headline"], cv["summary"], *items, *(e["title"] for e in jobs + projects + education), *bullets, *cv["info"].values()])
    found = set(find_terms(cv_text))
    posting_found = set(find_terms(posting))
    told_found = set(find_terms(told))
    required, preferred = posting_terms(posting, find_terms)
    # A skill counts as named elsewhere by its own words or by the term it is ("REST APIs" is the posting's "RESTful API").
    relevant = lambda i: mentions(posting, i) or mentions(told, i) or bool(set(find_terms(i)) & (posting_found | told_found))
    evidenced = lambda i: mentions(told, i) or bool(set(find_terms(i)) & told_found)

    # What the checks measure.
    measured = share(bullets, lambda b: re.search(r"\d", b))
    impact = share(bullets, lambda b: re.search(r"\d", b) or RESULT.search(b))
    no_duties = check("no_duties", not any(DUTY.search(b) for b in bullets) if bullets else None)
    title = check("title", title_matches(role, cv["headline"]))
    summary_terms = check("summary_terms", len(set(find_terms(cv["summary"])) & posting_found) >= 2 if len(posting_found) >= 2 else None)
    no_objective = check("no_objective", not OBJECTIVE.search(cv["summary"]))
    month_dates = check("month_dates", all(JOB_DATES.fullmatch(j["dates"]) for j in jobs) if jobs else None)
    ats_score = ats_result.get("score")
    technical = bool(posting_found & LANGUAGES)
    years = [int(y) for e in education for y in re.findall(r"\d{4}", e["dates"])]
    recent = bool(education) and (any(re.search(r"present|expected", e["dates"], re.I) for e in education) or max(years, default=0) >= today.year - 2)

    google = lens("google", [
        title,
        no_objective,
        at_least("measured", measured, 0.6),
        check("tailored", None if ats_score is None else ats_score >= 70, None if ats_score is None else ats_score / 100),
        check("github", re.search(r"github\.com", cv["contact"], re.I) is not None if technical else None),
        check("languages_listed", bool(set(find_terms(" ".join(items))) & LANGUAGES) if technical else None),
        check("project_languages", all(set(find_terms(p["title"] + " " + " ".join(p["bullets"]))) & LANGUAGES for p in projects)
              if technical and projects else None),
        check("education_detail", any("GPA" in e["title"] for e in education) and all(re.search(r"\d{4}", e["dates"]) for e in education)
              if recent else None),
        check("graduation_month", all(MONTH.search(e["dates"]) for e in education) if recent else None),
    ])

    req_hit = [t for t in required if t in found]
    pref_hit = [t for t in preferred if t in found]
    if len(required) + len(preferred) < 3:
        workday = lens("workday", [], grade=None)
    else:
        req_share = len(req_hit) / len(required) if required else 1.0
        pref_share = len(pref_hit) / len(preferred) if preferred else None
        grade = "A" if req_share == 1 and (pref_share is None or pref_share >= 0.5) else "B" if req_share == 1 else "C" if req_hit else "D"
        value = 0.7 * req_share + 0.3 * pref_share if pref_share is not None else req_share
        workday = {"id": "workday", "score": round(100 * value), "grade": grade, "checks": [],
                   "required": [len(req_hit), len(required)], "preferred": [len(pref_hit), len(preferred)],
                   "missing": [t for t in required + preferred if t not in found]}

    amazon = lens("amazon", [
        no_duties,
        at_least("measured", measured, 0.5),
        check("basic_quals", len(req_hit) == len(required) if required else None),
        at_least("preferred_quals", len(pref_hit) / len(preferred) if preferred else None, 0.5),
        month_dates,
    ])
    microsoft = lens("microsoft", [
        no_objective,
        check("no_pronouns", not PRONOUN.search(" ".join([cv["summary"], *bullets]))),
        at_least("relevant_skills", share(items, relevant), 0.7),
        at_least("impact", impact, 0.6),
        summary_terms,
        title,
    ])
    ibm = lens("ibm", [
        check("keywords", None if ats_score is None else ats_score >= 75, None if ats_score is None else ats_score / 100),
        no_duties,
        at_least("skills_evidence", share(items, evidenced), 0.5),
        check("no_soft_skills", not any(SOFT.search(i) for i in items) if items else None),
        at_least("measured", measured, 0.5),
        check("projects_if_thin", bool(projects) if len(jobs) <= 1 else None),
    ])
    firsts = [[(re.findall(r"[A-Za-z]+", b) or [""])[0].lower() for b in j["bullets"]] for j in jobs]
    pip = lens("pip", [
        summary_terms,
        title,
        check("summary_clean", not (OBJECTIVE.search(cv["summary"]) or PRONOUN.search(cv["summary"]) or CLICHE.search(cv["summary"]))),
        check("skill_categories", 3 <= len(cv["skills"]) <= 5 and not any(re.search(r"soft|other|misc", g["category"], re.I) for g in cv["skills"])
              if cv["skills"] else None),
        check("no_levels", not any(LEVEL.search(i) for i in items) if items else None),
        at_least("verbs", share(bullets, opens_with_verb), 0.8),
        check("no_repeated_verbs", all(len(f) == len(set(f)) for f in firsts) if jobs else None),
        at_least("measured", measured, 0.6),
        no_duties,
        check("no_cliches", not CLICHE.search(" ".join([cv["summary"], *bullets]))),
        check("digits", not any(SPELLED.search(b) for b in bullets) if bullets else None),
        check("endings", len({b.rstrip().endswith(".") for b in bullets}) <= 1 if bullets else None),
        month_dates,
        check("parse_ok", not ats_result.get("problems")),
    ])
    meta = lens("meta", [
        check("basic_quals", len(req_hit) == len(required) if required else None),
        at_least("impact", impact, 0.6),
        check("parse_ok", not ats_result.get("problems")),
    ])
    nvidia = lens("nvidia", [
        check("tailored", None if ats_score is None else ats_score >= 70, None if ats_score is None else ats_score / 100),
        check("applied_skills", bool(projects) or any(re.search(r"volunteer", f"{k} {v}", re.I) for k, v in cv["info"].items()) if recent else None),
        at_least("impact", impact, 0.6),
    ])
    deloitte = lens("deloitte", [
        check("tailored", None if ats_score is None else ats_score >= 70, None if ats_score is None else ats_score / 100),
        at_least("verbs", share(bullets, opens_with_verb), 0.8),
        at_least("measured", measured, 0.5),
    ])
    problems = ats_result.get("problems") or []
    first_line = next((l for l in pdf_text.splitlines() if l.strip()), "")
    systems = lens("systems", [
        check("size", None if pdf_bytes is None else pdf_bytes <= GREENHOUSE_PARSE_LIMIT),
        check("name_in_body", all(w.lower() in first_line.lower() for w in candidate.split()) if candidate and pdf_text else None),
        check("contact_as_text", not ({"no email as text", "no phone number as text"} & set(problems))),
        check("sections_found", not ({"a main section heading is missing", "the section headings are out of order"} & set(problems))),
        check("text_readable", not ({"the text layer has unreadable characters", "words run together in the text layer"} & set(problems))),
        check("no_spaced_letters", not SPACED.search(cv_text)),
        check("full_titles", not any(ABBREVIATED.search(j["title"]) for j in jobs) if jobs else None),
    ])
    ats = {"id": "ats", "score": ats_score, "checks": [], "missing": ats_result.get("missing", [])}

    lenses = [google, amazon, meta, microsoft, nvidia, ibm, deloitte, workday, systems, ats, pip]
    scores = [l["score"] for l in lenses if l["score"] is not None]
    return {"overall": round(sum(scores) / len(scores)) if scores else None, "lenses": lenses}


def line(result: dict) -> str:
    """The scorecard in one line, as ats.py prints it."""
    def one(l: dict) -> str:
        score = "-" if l["score"] is None else str(l["score"])
        return f"{NAMES[l['id']]} {l['grade']} ({score})" if l.get("grade") else f"{NAMES[l['id']]} {score}"
    overall = "-" if result["overall"] is None else result["overall"]
    return f"Scorecard: {', '.join(one(l) for l in result['lenses'])}. Overall {overall}."
