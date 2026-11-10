// A job's own words, read from where each site keeps them, for the ranking (ranker.ts fetchPosting) and the job page
// (postings.ts). Most pages show their posting as text, which posting_guard.py reads. Others draw it in the browser
// from data in the page (Comeet, Apple), give a clean copy written for Google (schema.org's JobPosting), or keep it
// behind their own public list (Greenhouse's API), and a Telegram post is read from its embed. Each reader here only
// finds that HTML and the facts beside it (job type, place, dates); posting_guard.py still cleans every word of it,
// hidden content and all, before anything reads it.
import { jsonAt } from "./boards";

// What a site says about a job besides its words, in its own data; the AI fills what's missing (postings.ts).
export type Salary = { text?: string; min?: number; max?: number; currency?: string; unit?: string };
export type Facts = {
  employment?: "full_time" | "part_time" | "student" | "internship" | "contract" | "temporary";
  workMode?: "onsite" | "hybrid" | "remote";
  level?: "intern" | "entry" | "mid" | "senior" | "lead";
  posted?: string; deadline?: string; salary?: Salary; jobNumber?: string;
};
// A posting found in a page's data: its HTML, sections already headed where the site splits it, and its facts.
// flat is a description with its line breaks taken out (AllJobs' copy for Google runs its lines together), which
// the page's own text reads better than; its facts still count.
export type Found = { html: string; facts: Facts; flat?: boolean };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
  const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
});
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const day = (v: unknown) => /^\d{4}-\d{2}-\d{2}/.exec(String(v ?? ""))?.[0];
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
// A part under its heading; an empty part has neither.
const section = (title: string, body: string) => (body.replace(/<[^>]*>/g, "").trim() ? `<h2>${escape(title)}</h2>${body}` : "");
// Plain text with line breaks as HTML, for a site that gives its parts as text.
const asHtml = (text: string) => (/<\/?[a-z][^>]*>/i.test(text) ? text : `<p>${escape(text).replace(/\r?\n/g, "<br>")}</p>`);

export function employmentOf(v: unknown): Facts["employment"] {
  const s = (Array.isArray(v) ? v[0] : str(v)).toLowerCase();
  if (/intern/.test(s)) return "internship";
  if (/student|סטודנט/.test(s)) return "student";
  if (/part|חלקית/.test(s)) return "part_time";
  if (/full|מלאה/.test(s)) return "full_time";
  if (/contract|freelance/.test(s)) return "contract";
  if (/temp/.test(s)) return "temporary";
  return undefined;
}
export function workModeOf(v: unknown): Facts["workMode"] {
  const s = str(v).toLowerCase();
  return /remote|telecommute/.test(s) ? "remote" : /hybrid/.test(s) ? "hybrid" : /on.?site|office/.test(s) ? "onsite" : undefined;
}
export function levelOf(v: unknown): Facts["level"] {
  const s = str(v).toLowerCase();
  if (/intern/.test(s)) return "intern";
  if (/entry|junior|graduate|associate/.test(s)) return "entry";
  if (/lead|principal|staff|director|manager|executive|head/.test(s)) return "lead";
  if (/senior|\bsr\b/.test(s)) return "senior";
  if (/mid|intermediate/.test(s)) return "mid";
  return undefined;
}
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;

// The cleaned text as lines: blank ones gone, and a mark left alone on its line (a list item whose words are in a
// paragraph of their own) joined to the words after it.
export function markedLines(text: string): string[] {
  const out: string[] = [];
  let mark = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (line === "##" || line === "•") { mark = mark || `${line} `; continue; }
    out.push(mark && !/^(## |• )/.test(line) ? mark + line : line);
    mark = "";
  }
  return out;
}

// schema.org's JobPosting, the copy of a job a page writes for Google: its description and its facts. Only a
// description long enough to be the posting itself counts, as some sites put a line or two there.
export function jsonLdPosting(html: string, minChars = 300): Found | null {
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const items = [data].flat().flatMap((d: any) => (Array.isArray(d?.["@graph"]) ? d["@graph"] : [d]));
    for (const it of items as any[]) {
      if (![it?.["@type"]].flat().includes("JobPosting")) continue;
      let description = str(it.description);
      if (/&lt;\/?[a-z]/i.test(description)) description = decode(description);
      if (description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length < minChars) continue;
      const pay = it.baseSalary?.value ?? {};
      const salary = clean<Salary>({ min: Number(pay.minValue ?? pay.value) || undefined, max: Number(pay.maxValue) || undefined, currency: str(it.baseSalary?.currency) || undefined, unit: str(pay.unitText).toLowerCase() || undefined });
      return {
        html: asHtml(description),
        flat: !/<[a-z][^>]*>|\n/i.test(description),
        facts: clean<Facts>({
          employment: employmentOf(it.employmentType), workMode: /telecommute/i.test(str(it.jobLocationType)) ? "remote" : undefined,
          posted: day(it.datePosted), deadline: day(it.validThrough), salary: salary.min || salary.max ? salary : undefined,
          jobNumber: str(it.identifier?.value ?? (typeof it.identifier === "string" ? it.identifier : "")) || undefined,
        }),
      };
    }
  }
  return null;
}

// A Comeet position's page: its data (POSITION_DATA, given its value well after it is declared) holds each part
// of the posting under its own name, with its job type, level and place of work.
export function comeetPosting(html: string): Found | null {
  const at = html.search(/POSITION_DATA\s*=\s*\{/);
  if (at < 0) return null;
  let p: any;
  try { p = JSON.parse(jsonAt(html, html.indexOf("{", at)) || "null"); } catch { return null; }
  const details = [...(p?.custom_fields?.details ?? [])].sort((a: any, b: any) => Number(a?.order ?? 0) - Number(b?.order ?? 0));
  const body = details.map((d: any) => section(str(d?.name), asHtml(str(d?.value)))).join("");
  if (!body) return null;
  return { html: body, facts: clean<Facts>({ employment: employmentOf(p.employment_type), workMode: workModeOf(p.workplace_type), level: levelOf(p.experience_level), posted: day(p.time_updated) }) };
}

// Apple's job page: the job is in the page's router data, a JSON text inside a script, with its summary,
// description and qualifications as text.
export function applePosting(html: string): Found | null {
  const at = html.indexOf("__staticRouterHydrationData");
  const open = at < 0 ? -1 : html.indexOf('JSON.parse("', at);
  if (open < 0) return null;
  let i = open + 'JSON.parse("'.length;
  for (; i < html.length && html[i] !== '"'; i++) if (html[i] === "\\") i++;
  let data: unknown;
  try { data = JSON.parse(JSON.parse(html.slice(open + 'JSON.parse('.length, i + 1))); } catch { return null; }
  const find = (v: any, depth = 0): any => {
    if (!v || typeof v !== "object" || depth > 12) return null;
    if (typeof v.postingTitle === "string" && (v.jobSummary || v.description)) return v;
    for (const x of Object.values(v)) { const got = find(x, depth + 1); if (got) return got; }
    return null;
  };
  const job = find(data);
  if (!job) return null;
  const parts: [string, unknown][] = [["Summary", job.jobSummary], ["Description", job.description], ["Minimum Qualifications", job.minimumQualifications], ["Preferred Qualifications", job.preferredQualifications]];
  const body = parts.map(([title, text]) => section(title, asHtml(str(text)))).join("");
  return body ? { html: body, facts: clean<Facts>({ posted: day(job.postDateInGMT ?? job.postingDate), jobNumber: str(job.jobNumber) || undefined }) } : null;
}

// A Telegram post, from its embed (t.me/<channel>/<post>?embed=1): the message's own words and when it was sent.
export function telegramPosting(html: string): Found | null {
  const start = html.search(/<div[^>]*class="[^"]*tgme_widget_message_text[^"]*"[^>]*>/);
  if (start < 0) return null;
  const from = html.indexOf(">", start) + 1;
  let depth = 1;
  let i = from;
  for (const m of html.slice(from).matchAll(/<(\/?)div\b[^>]*>/gi)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { i = from + m.index!; break; }
  }
  const body = depth === 0 ? html.slice(from, i) : "";
  return body.replace(/<[^>]+>/g, "").trim() ? { html: `<p>${body}</p>`, facts: clean<Facts>({ posted: day(/<time[^>]*datetime="([^"]+)"/.exec(html)?.[1]) }) } : null;
}
export const telegramEmbed = (url: string) => {
  const m = /^https?:\/\/(?:www\.)?t\.me\/(?:s\/)?([A-Za-z0-9_]{3,64})\/(\d{1,12})(?:[/?#]|$)/.exec(url);
  return m ? `https://t.me/${m[1]}/${m[2]}?embed=1&mode=tme` : "";
};

// Greenhouse keeps its job pages from robots and gives the same job through its public API, which the portals
// check already reads for the list (boards.ts).
export const greenhouseApi = (url: string) => {
  const m = /^https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/([A-Za-z0-9_-]{1,80})\/jobs\/(\d{1,15})(?:[/?#]|$)/.exec(url);
  return m ? `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}` : "";
};
export function greenhousePosting(json: string): Found | null {
  let j: any;
  try { j = JSON.parse(json); } catch { return null; }
  const content = decode(str(j?.content));
  if (!content.replace(/<[^>]+>/g, "").trim()) return null;
  return { html: content, facts: clean<Facts>({ posted: day(j.first_published ?? j.updated_at), deadline: day(j.application_deadline) }) };
}

// A page's posting from its own data, where it keeps one: the site's own reader first, then the copy for Google.
export function pageData(html: string, url: string): Found | null {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* none */ }
  if (/(^|\.)comeet\.(com|co)$/.test(host)) return comeetPosting(html) ?? jsonLdPosting(html);
  if (host === "jobs.apple.com") return applePosting(html) ?? jsonLdPosting(html);
  if (host === "t.me") return telegramPosting(html);
  return jsonLdPosting(html);
}

// A portal's detail command, as linkedin-search's and freehire-search's print it (--format plain): the title, the
// company and place, the site's facts a line each, the description, and the link. The title and the link go, as the
// page shows its own; the facts stay in the text too, for the ranking to read.
const FACT_LINE = /^(Posted|Seniority|Category|Employment|Salary|Skills|Function|Industries|Status): (.*)$/;
export function portalPlain(out: string): { text: string; facts: Facts; closed: boolean } {
  const lines = out.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && (/^(URL|slug): /.test(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) lines.pop();
  const facts: Facts = {};
  let closed = false;
  const kept: string[] = [];
  lines.forEach((line, i) => {
    if (i < 2) return;
    const fact = FACT_LINE.exec(line);
    if (!fact || kept.some((l) => !FACT_LINE.test(l))) { kept.push(line); return; }
    const [, name, value] = fact;
    if (name === "Status") { closed = /closed|expired/i.test(value); return; }
    if (name === "Seniority") facts.level = levelOf(value);
    if (name === "Employment") facts.employment = employmentOf(value);
    if (name === "Posted") facts.posted = day(value);
    if (name === "Salary") facts.salary = { text: value.slice(0, 80) };
    kept.push(line);
  });
  return { text: kept.join("\n").trim(), facts: clean(facts), closed };
}
