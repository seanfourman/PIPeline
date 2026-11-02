#!/usr/bin/env python3
"""Estimates how a CV reads to an ATS: can its text be parsed, and how many of the posting's terms it contains.

Run from the repository root: python templates/cv/one-page-clean/ats.py <company>_<role>

It reads documents/applications/<company>_<role>/ and writes ats.json there. Real ATS products
do not share a scoring formula, so this is an estimate. Same files in, same score out.
"""

import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools"))
from verify_pdf import extract_text_layer, find_non_ascii_date_ranges  # noqa: E402

CV_NAME = "Sean Fourman - Resume.pdf"
MIN_TERMS = 3
RUN_TOGETHER = 40
SECTIONS = ["TECHNICAL SKILLS", "PROFESSIONAL EXPERIENCE", "EDUCATION"]
EMAIL = r"[\w.+-]+@[\w-]+\.[\w.-]+"
PHONE = r"(?<!\d)(?:\+972[- ]?|0)\d{1,2}[- ]?\d{3}[- ]?\d{4}(?!\d)"
JOB_DATES = r"[A-Z][a-z]{2} \d{4} - (?:Present|[A-Z][a-z]{2} \d{4})"

# Upper-case or ambiguous names, where matching any case would count ordinary words.
CASE_SENSITIVE = {"AI", "ML", "C", "Go", "QA", "RAG", "NLP", "ETL", "R"}
TERMS = {
    "Python": r"\bpython\b", "TypeScript": r"\btypescript\b", "JavaScript": r"\bjavascript\b|(?<![.\w])js\b",
    "Java": r"\bjava\b", "C#": r"(?<!\w)c#", "C++": r"(?<!\w)c\+\+", "C": r"(?<=, )C\b(?![#+])|\bC(?=,| programming| language)",
    "Go": r"\bGolang\b|(?<=, )Go\b|\bGo(?=,| developer| engineer)", "Rust": r"\brust\b", "Kotlin": r"\bkotlin\b",
    "Swift": r"\bswift\b", "PHP": r"\bphp\b", "Ruby": r"\bruby\b", "Scala": r"\bscala\b", "R": r"(?<=, )R\b(?=,|\.)",
    "Bash": r"\b(bash|shell scripting)\b", "HTML": r"\bhtml5?\b", "CSS": r"\bcss3?\b",
    "React": r"\breact(\.js|js)?\b(?! native)", "React Native": r"\breact native\b", "Angular": r"\bangular\b", "Vue": r"\bvue(\.js|js)?\b",
    "Next.js": r"\bnext\.?js\b", "Redux": r"\bredux\b", "Tailwind": r"\btailwind\b", "Vite": r"\bvite\b",
    "Three.js": r"\bthree\.?js\b", "WebGPU": r"\bwebgpu\b", "Android": r"\bandroid\b", "iOS": r"\bios\b", "Flutter": r"\bflutter\b",
    "Node.js": r"\bnode(\.?js)?\b", "Express": r"\bexpress(\.?js)?\b", "NestJS": r"\bnest\.?js\b", "FastAPI": r"\bfastapi\b",
    "Django": r"\bdjango\b", "Flask": r"\bflask\b", "Spring": r"\bspring( boot)?\b", ".NET": r"(?<!\w)(asp\.net|\.net)\b",
    "APIs": r"\b(rest(ful)?|apis?)\b", "GraphQL": r"\bgraphql\b", "gRPC": r"\bgrpc\b", "Microservices": r"\bmicroservices?\b",
    "SQL": r"\b(sql|t-sql)\b", "PostgreSQL": r"\b(postgresql|postgres)\b", "MySQL": r"\bmysql\b",
    "SQL Server": r"\b(sql server|mssql)\b", "MongoDB": r"\bmongo(db)?\b", "Redis": r"\bredis\b", "Elasticsearch": r"\belastic ?search\b",
    "DynamoDB": r"\bdynamodb\b", "Firebase": r"\bfirebase\b", "Kafka": r"\bkafka\b", "RabbitMQ": r"\brabbitmq\b",
    "AWS": r"\b(aws|amazon web services)\b", "S3": r"\bs3\b", "Lambda": r"\blambda\b", "Azure": r"\bazure\b", "GCP": r"\b(gcp|google cloud)\b",
    "Docker": r"\bdocker\b", "Kubernetes": r"\b(kubernetes|k8s)\b", "Terraform": r"\bterraform\b", "Ansible": r"\bansible\b", "Linux": r"\blinux\b",
    "Git": r"\bgit\b", "GitHub": r"\bgithub\b", "GitLab": r"\bgitlab\b", "Jenkins": r"\bjenkins\b",
    "CI/CD": r"\b(ci/?cd|continuous integration|continuous delivery|continuous deployment)\b",
    "Testing": r"\b(testing|testable|test coverage|unit tests?|automated tests?)\b", "pytest": r"\bpytest\b", "Jest": r"\bjest\b",
    "Playwright": r"\bplaywright\b", "Selenium": r"\bselenium\b", "Cypress": r"\bcypress\b", "Postman": r"\bpostman\b", "QA": r"\bQA\b",
    "Agile": r"\b(agile|scrum)\b", "Jira": r"\bjira\b", "Open Source": r"\bopen[- ]source\b",
    "AI": r"\bAI\b", "ML": r"\bML\b|\b[Mm]achine [Ll]earning\b", "Deep Learning": r"\bdeep learning\b", "Computer Vision": r"\bcomputer vision\b",
    "NLP": r"\bNLP\b", "LLM": r"\b(llms?|large language models?)\b", "RAG": r"\bRAG\b", "LangChain": r"\blangchain\b",
    "OpenAI": r"\bopenai\b", "Gemini": r"\bgemini\b", "PyTorch": r"\bpytorch\b", "TensorFlow": r"\b(tensorflow|keras)\b",
    "scikit-learn": r"\b(scikit-learn|sklearn)\b", "Pandas": r"\bpandas\b", "NumPy": r"\bnumpy\b", "ETL": r"\bETL\b", "Spark": r"\bspark\b", "Airflow": r"\bairflow\b",
    "TCP/IP": r"\btcp(/ip)?\b", "Ethernet": r"\bethernet\b", "Embedded": r"\bembedded\b", "RTOS": r"\brtos\b", "FPGA": r"\bfpga\b",
    "MATLAB": r"\bmatlab\b", "LabVIEW": r"\blabview\b", "PySide6": r"\b(pyside6?|pyqt\d?)\b",
}
COMPILED = {name: re.compile(pattern, 0 if name in CASE_SENSITIVE else re.I) for name, pattern in TERMS.items()}


def posting_body(text: str) -> str:
    """The posting without what the archive step appends, which is not the employer's wording."""
    text = text.split("\n## posting_guard", 1)[0]
    return re.sub(r"^URL: .*$", "", text, flags=re.M)


def find_terms(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text)
    return [name for name, pattern in COMPILED.items() if pattern.search(text)]


def parse_problems(cv_text: str) -> list[str]:
    """What would stop a parser from reading the CV. These do not depend on the posting."""
    text = re.sub(r"\s+", " ", cv_text)
    problems = []
    if "(cid:" in text or "�" in text:
        problems.append("the text layer has unreadable characters")
    if not re.search(EMAIL, text):
        problems.append("no email as text")
    if not re.search(PHONE, text):
        problems.append("no phone number as text")
    places = [text.find(section) for section in SECTIONS]
    if -1 in places:
        problems.append("a main section heading is missing")
    elif places != sorted(places):
        problems.append("the section headings are out of order")
    if not re.search(JOB_DATES, text):
        problems.append("no job dates with months")
    if find_non_ascii_date_ranges(cv_text):
        problems.append("a date range uses a non-ASCII dash")
    return problems


def layout_text(pdf: pathlib.Path) -> str:
    """The text as a position-based parser reads it, which joins words when the PDF has no real spaces."""
    from pypdf import PdfReader
    return "\n".join(page.extract_text(extraction_mode="layout") for page in PdfReader(str(pdf)).pages)


def score(cv_text: str, posting_text: str, layout: str = "") -> dict:
    wanted = find_terms(posting_body(posting_text))
    found = set(find_terms(cv_text))
    matched = [term for term in wanted if term in found]
    problems = parse_problems(cv_text)
    if any(len(token) >= RUN_TOGETHER for token in layout.split()):
        problems.append("words run together in the text layer")
    if problems:
        value = 0
    elif len(wanted) < MIN_TERMS:
        value = None
    else:
        value = round(100 * len(matched) / len(wanted))
    return {"score": value, "matched": matched, "missing": [term for term in wanted if term not in found], "problems": problems}


def report(name: str) -> int:
    folder = REPO / "documents" / "applications" / name
    pdf, posting = folder / CV_NAME, folder / "job_posting.md"
    for needed in (pdf, posting):
        if not needed.exists():
            print(f"ATS score skipped, not found: {needed.relative_to(REPO).as_posix()}")
            return 2
    result = score(extract_text_layer(pdf)[0], posting.read_text(encoding="utf-8"), layout_text(pdf))
    (folder / "ats.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    total = len(result["matched"]) + len(result["missing"])
    print(f"ATS score: {result['score']} ({len(result['matched'])} of {total} posting terms)")
    print(f"Missing: {', '.join(result['missing']) or 'nothing'}")
    if result["problems"]:
        print(f"Parse problems: {'; '.join(result['problems'])}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1:] == ["--terms"]:
        print(json.dumps(list(TERMS)))
        sys.exit(0)
    if len(sys.argv) != 2 or not re.fullmatch(r"[a-z0-9_]+", sys.argv[1]):
        print("usage: ats.py <company>_<role>, in lowercase letters, digits and underscores")
        sys.exit(2)
    sys.exit(report(sys.argv[1]))
