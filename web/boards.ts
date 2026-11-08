// The Israeli job boards the system reads itself (portals.ts): AllJobs, Drushim and JobMaster searched for a role, and
// an employer's own list of jobs read for the fields of the roles in the settings. Every page comes through the
// project's own fetcher (tools/fetch_page.py: browser headers, robots.txt enforced, each site's kept for an hour,
// nothing saved in the project), one page at a time per site with a pause between them. What the pages say is
// third-party data: only a posting's title, company, place, date and link are taken from them, and a link only when
// it points at the board itself.
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DRUSHIM_SEARCH, type Portal, type Read } from "./portals";
import { PYTHON, runTool, type Run } from "./ranker";
import { fieldsOf, titleMatches, titleWords, type Role } from "./roles";

export type Board = "alljobs" | "drushim" | "jobmaster";
export const BOARDS: Board[] = ["alljobs", "drushim", "jobmaster"];
// source: the board, or "page" for a careers page the user added.
export type Posting = { title: string; company: string; location: string; date: string; url: string; source: Board | "page" };

// Between two pages from the same site; longer where its robots.txt asks for it (Crawl-delay).
const GAP_MS = 500;
const GAPS: Record<string, number> = { "api.lever.co": 1000 };
const MAX_TEXT = 160;

const SEARCH: Record<Board, (q: string) => string> = {
  // AllJobs' own date filter (&fdate) is one its robots.txt asks not to use, so recency is checked here instead.
  alljobs: (q) => `https://www.alljobs.co.il/SearchResultsGuest.aspx?page=1&position=&type=&freetxt=${encodeURIComponent(q)}`,
  drushim: DRUSHIM_SEARCH,
  jobmaster: (q) => `https://www.jobmaster.co.il/jobs/?q=${encodeURIComponent(q)}`,
};
const ORIGIN: Record<Board, string> = { alljobs: "https://www.alljobs.co.il", drushim: "https://www.drushim.co.il", jobmaster: "https://www.jobmaster.co.il" };

// ---------- text ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
// The visible text of a piece of markup, on one line: no tags, no invisible or direction characters.
export const text = (html: string, max = MAX_TEXT) => decode(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
  .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// "לפני 3 שעות", "לפני יומיים", "היום", "05/11/2026": the date a posting was put up, as YYYY-MM-DD, or "" when the
// words don't say.
export function postedOn(words: string, today: string) {
  const t = words.replace(/\s+/g, " ").trim();
  const back = (days: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const full = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (full) {
    const year = full[3].length === 2 ? `20${full[3]}` : full[3];
    return `${year}-${full[2].padStart(2, "0")}-${full[1].padStart(2, "0")}`;
  }
  if (/דק(ה|ות)|שע(ה|ות|תיים)|היום|minute|hour|today|just now|עכשיו/i.test(t)) return back(0);
  if (/אתמול|yesterday/i.test(t)) return back(1);
  if (/יומיים/.test(t)) return back(2);
  const n = Number(t.match(/(\d+)/)?.[1] ?? 1);
  if (/(ימים|יום|day)/i.test(t)) return back(n);
  if (/שבועיים/.test(t)) return back(14);
  if (/(שבוע|week)/i.test(t)) return back(7 * n);
  if (/חודשיים/.test(t)) return back(60);
  if (/(חודש|month)/i.test(t)) return back(30 * n);
  return "";
}

// ---------- the boards' pages ----------

// AllJobs, a search or an employer's page: each posting is a link to UploadSingle.aspx with its title, after the box's
// date and before the employer's link and the place. A box ends where the next posting starts or where the list
// does: at its pages' numbers (jobs-paging), the similar companies after them or the page's footer, whose links to
// employers' pages are no posting's. cid keeps only the postings of that employer, since its page also shows others'.
export function parseAllJobs(html: string, today: string, cid?: number): Posting[] {
  const links = [...html.matchAll(/<a\b[^>]*href=["'][^"']*UploadSingle\.aspx\?JobID=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const firsts: { id: string; at: number; title: string }[] = [];
  const taken = new Set<string>();
  for (const m of links) {
    const title = text(m[2]);
    if (!title || title.length < 3 || taken.has(m[1])) continue;
    taken.add(m[1]);
    firsts.push({ id: m[1], at: m.index!, title });
  }
  const ends = [...html.matchAll(/class=["'][^"']*\b(?:jobs-paging|similarCompaniesContainer)\b|<footer\b/gi)].map((m) => m.index!);
  return firsts.flatMap((f, i): Posting[] => {
    const box = html.slice(f.at, Math.min(firsts[i + 1]?.at ?? html.length, ends.find((at) => at > f.at) ?? html.length));
    const before = html.slice(firsts[i - 1]?.at ?? 0, f.at);
    // The employer's own link, exactly its page: not its pages' numbers (&page=2) nor its categories.
    const company = [...box.matchAll(/<a\b[^>]*href=["'][^"']*Employer\/HP\/Default\.aspx\?cid=(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)].find((m) => text(m[2]) && !/^\d+$/.test(text(m[2])));
    if (cid !== undefined && company && Number(company[1]) !== cid) return [];
    const place = box.match(/job-content-top-location[^"']*["'][^>]*>([\s\S]*?)(?:<span\b|<div\b|<\/div>)/i)?.[1] ?? "";
    const cities = [...(box.match(/job-regions-content[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ?? "").matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => text(m[1])).filter(Boolean);
    const named = text(place).replace(/^((מיקום|location|המשרה)\s*:?\s*)+/i, "");
    const dates = [...before.matchAll(/job-content-top-date[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
    return [{
      title: f.title, company: company ? text(company[2]) : "",
      location: cities.length && /more than one|מספר|כמה/i.test(named) ? cities.join(", ") : named,
      date: dates.length ? postedOn(text(dates[dates.length - 1][1]), today) : "",
      url: `${ORIGIN.alljobs}/Search/UploadSingle.aspx?JobID=${f.id}`, source: "alljobs",
    }];
  });
}

// An AllJobs employer page's categories of jobs, each with how many there are.
export function allJobsCategories(html: string) {
  const out = new Map<number, { id: number; name: string; count: number }>();
  for (const m of html.replace(/&amp;/g, "&").matchAll(/<a\b[^>]*href=["'][^"']*JobCategoriesFilter=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = text(m[2]);
    const count = Number(label.match(/\((\d+)\)\s*$/)?.[1] ?? 0);
    const id = Number(m[1]);
    if (id > 0 && count > 0) out.set(id, { id, name: label.replace(/\s*\(\d+\)\s*$/, ""), count });
  }
  return [...out.values()];
}

// Drushim, a search or an employer's page: each card has its title, company and place marked for screen readers
// (data-nagish), then its "how long ago", then the link to the posting.
export function parseDrushim(html: string, today: string): Posting[] {
  const cards = html.split(/data-nagish=["']job-card-title["']/).slice(1);
  return cards.flatMap((card): Posting[] => {
    const title = text(card.match(/^[^>]*>([\s\S]*?)<\/h\d>/)?.[1] ?? "");
    const link = card.match(/href=["'](\/job\/\d+\/[0-9a-f]+\/?)["']/i)?.[1];
    if (!title || !link) return [];
    const metas = [...card.matchAll(/__text[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].map((m) => text(m[1])).filter(Boolean);
    const when = metas.find((m) => /לפני|היום|אתמול|\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(m)) ?? "";
    return [{
      title, company: text(card.match(/__companyName[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ""),
      location: metas.find((m) => m !== when && !/משרה|שעות|משמרות|היברידי|מהבית|זמני|נ[י]?סיון|שנ(ה|ים|תיים)/.test(m)) ?? "",
      date: when ? postedOn(when, today) : "", url: `${ORIGIN.drushim}${link}`, source: "drushim",
    }];
  });
}

// JobMaster's search: an article per posting, its title, "פורסם לפני", the company and the place.
export function parseJobMaster(html: string, today: string): Posting[] {
  const cards = html.split(/<article\b[^>]*id=["']misra(?=\d)/).slice(1);
  return cards.flatMap((card): Posting[] => {
    const key = card.match(/^(\d+)/)?.[1];
    const title = text(card.match(/class=["'][^"']*CardHeader[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
    if (!key || !title) return [];
    return [{
      title, company: text(card.match(/CompanyNameLink[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ""),
      location: text(card.match(/class=["']jobLocation["'][^>]*>([\s\S]*?)<\/li>/i)?.[1] ?? ""),
      date: postedOn(text(card.match(/(פורסם[^<]{0,40})</)?.[1] ?? ""), today),
      url: `${ORIGIN.jobmaster}/jobs/checknum.asp?key=${key}`, source: "jobmaster",
    }];
  });
}

const PARSE: Record<Board, (html: string, today: string) => Posting[]> = { alljobs: parseAllJobs, drushim: parseDrushim, jobmaster: parseJobMaster };

// ---------- fetching ----------

export type Fetch = (url: string, signal?: AbortSignal) => Promise<string | null>;

// One site's pages one after another, with a pause, however many searches want them at once.
const turns = new Map<string, Promise<void>>();
async function inTurn<T>(host: string, work: () => Promise<T>): Promise<T> {
  const before = turns.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  turns.set(host, before.then(() => mine));
  await before;
  try { return await work(); } finally { setTimeout(release, GAPS[host] ?? GAP_MS); }
}

// A page through tools/fetch_page.py, or null when the site said no (robots.txt), failed or answered with an error.
export function pageFetcher(run: Run = runTool): Fetch {
  return (url, signal) => inTurn(new URL(url).host, async () => {
    const out = path.join(os.tmpdir(), `ai-job-search-page-${crypto.randomUUID()}.html`);
    try {
      const got = await run([PYTHON, "tools/fetch_page.py", url, "--out", out, "--robots-cache"], { signal });
      const status = Number(got.out.match(/HTTP (\d+)/)?.[1] ?? 0);
      if (got.code !== 0 || status < 200 || status >= 300) return null;
      return readFileSync(out, "utf8");
    } catch {
      return null;
    } finally {
      rmSync(out, { force: true });
    }
  });
}

const fresh = (p: Posting, days: number, today: string) => {
  if (!p.date) return true;
  const age = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${p.date}T12:00:00Z`)) / 86_400_000;
  return age <= days;
};

// One search on one board: its postings from the last `days` days (those with no date are kept).
export async function searchBoard(board: Board, query: string, days: number, o: { fetch: Fetch; today: string; signal?: AbortSignal }) {
  const html = await o.fetch(SEARCH[board](query), o.signal);
  if (html === null) throw new Error(`${board} did not answer`);
  return PARSE[board](html, o.today).filter((p) => fresh(p, days, o.today));
}

// ---------- an employer's own jobs ----------

// AllJobs' categories, by name, that hold each field's postings at an employer; an employer outside high-tech files
// its analysts under finance and economics as often as under data.
const CATEGORY: Record<string, RegExp> = {
  software: /תוכנה|מחשבים|מערכות מידע|אינטרנט ודיגיטל|הייטק/,
  hardware: /חומרה|אלקטרוניקה|תוכנה|הייטק/,
  data: /דאטה|\bAI\b|ניתוח מערכות|מערכות מידע|כספים וכלכלה|מדעים מדו?ייקים|סטטיסטיקה|מחקר/,
  quality: /אבטחת איכות|QA/,
  infra: /מחשבים|מערכות מידע|תקשורת|תשתיות/,
  security: /סייבר|אבטחת מידע|מחשבים/,
  product: /אינטרנט ודיגיטל|ניתוח מערכות|מוצר|עיצוב|פרויקטים/,
  start: /סטודנטים|ללא ניסיון/,
};

export type Found = Posting & { portal: string };

// An employer's postings for the roles: on AllJobs its page, then, when that is full, the page of each of its
// categories the roles' fields are filed under (a second page of one that has more than ten), since a page with
// room left already has all of them; on Drushim a search for its name, keeping that company's postings. Only titles
// with one of the roles' words are kept, so the judging that follows reads only those.
const PAGE_JOBS = 10;
export async function readEmployer(p: Portal, roles: Role[], o: { fetch: Fetch; today: string; signal?: AbortSignal }): Promise<Found[]> {
  const words = titleWords(roles);
  const all: Posting[] = [];
  if (p.read && "alljobs" in p.read) {
    const cid = p.read.alljobs;
    const base = `${ORIGIN.alljobs}/Employer/HP/Default.aspx?cid=${cid}`;
    const first = await o.fetch(base, o.signal);
    if (first === null) throw new Error("AllJobs did not answer");
    // An employer with no jobs now has no categories, and its page shows other employers' jobs instead.
    const categories = allJobsCategories(first);
    if (!categories.length) return [];
    const own = parseAllJobs(first, o.today, cid);
    all.push(...own);
    const fields = fieldsOf(roles);
    const wanted = own.length < PAGE_JOBS ? [] : categories.filter((c) => fields.some((f) => CATEGORY[f]?.test(c.name)));
    for (const c of wanted) {
      if (o.signal?.aborted) break;
      for (let page = 1; page <= (c.count > 10 ? 2 : 1); page++) {
        const html = await o.fetch(`${base}&JobCategoriesFilter=${c.id}${page > 1 ? `&page=${page}` : ""}`, o.signal);
        if (html) all.push(...parseAllJobs(html, o.today, cid));
      }
    }
  } else if (p.read && "drushim" in p.read) {
    const name = p.read.drushim;
    const html = await o.fetch(DRUSHIM_SEARCH(name), o.signal);
    if (html === null) throw new Error("Drushim did not answer");
    const plain = (s: string) => s.replace(/["'״׳\-\s]/g, "");
    all.push(...parseDrushim(html, o.today).filter((x) => plain(x.company).includes(plain(name))));
  } else if (p.read) {
    all.push(...await readCareers(p.read, roles, o));
  }
  const seen = new Set<string>();
  return all.filter((x) => !seen.has(x.url) && seen.add(x.url) && titleMatches(x.title, words))
    .map((x) => ({ ...x, company: x.company || p.he, portal: p.id }));
}

// ---------- Matrix's careers site ----------

// matrix.co.il/jobs: a page of its categories, each with a page that lists all of its postings at once (its
// subcategories only filter that list in the browser, and its pages' numbers bring the same list again).
export const MATRIX = "https://www.matrix.co.il/jobs/";
// Its categories, by name, that hold each field's postings; the government ministries' few, of every kind, are every
// field's.
const MATRIX_CATEGORY: Record<string, RegExp> = {
  software: /פיתוח תוכנה|ארכיטקטורה|פיתוח אוטומציה|CRM|ERP|SAP|^RT$|משרדי ממשלה/i,
  hardware: /^RT$|משרדי ממשלה/i,
  data: /DATA|DBA|ניתוח מערכות|משרדי ממשלה/i,
  quality: /בדיקות|אוטומציה|משרדי ממשלה/,
  infra: /DevOps|תשתיות|סיסטם|CLOUD|תמיכה|משרדי ממשלה/i,
  security: /סייבר|אבטחת מידע|משרדי ממשלה/,
  product: /ניהול פרויקטים|UI\/UX|ניתוח מערכות|תמיכה|משרדי ממשלה/i,
  start: /בוגרים|תמיכה|משרדי ממשלה/,
};

// Matrix's jobs page: its categories, each with its list's address; not the subcategories, whose addresses go on
// from their category's, and once, though the page lists them twice.
export function matrixCategories(html: string) {
  const start = html.indexOf('id="jobs_category_list"');
  if (start < 0) return [];
  const end = html.indexOf('id="jobs_category_list"', start + 1);
  const all = [...html.slice(start, end > 0 ? end : undefined).matchAll(/<li\b[^>]*class=["']cat-item[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .flatMap((m) => {
      try { return [{ url: new URL(decode(m[1]), MATRIX).href, name: text(m[2]) }]; } catch { return []; }
    })
    .filter((c) => c.url.startsWith(MATRIX) && c.name);
  const seen = new Set<string>();
  return all.filter((c) => !all.some((p) => c.url !== p.url && c.url.startsWith(p.url)) && !seen.has(c.url) && Boolean(seen.add(c.url)));
}

// A Matrix category's list: each posting a job-item, its title linked to the posting on the site, and its areas.
export function parseMatrix(html: string): Posting[] {
  return html.split(/<div\b[^>]*class=["']job-item["']/i).slice(1).flatMap((item): Posting[] => {
    const link = item.match(/class=["']job-title["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) return [];
    let url: URL;
    try { url = new URL(decode(link[1]), MATRIX); } catch { return []; }
    const title = text(link[2]);
    if (!title || !url.href.startsWith(MATRIX)) return [];
    return [{ title, company: "", location: text(item.match(/class=["']job-areas["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? ""), date: "", url: url.href, source: "page" }];
  });
}

// Matrix's postings in the fields: its jobs page, then the list of each category the fields' postings are in.
async function readMatrix(fields: string[], o: { fetch: Fetch; signal?: AbortSignal }) {
  const first = await o.fetch(MATRIX, o.signal);
  if (first === null) throw new Error("Matrix did not answer");
  const categories = matrixCategories(first);
  if (!categories.length) throw new Error("Matrix's jobs page lists no categories");
  const all: Posting[] = [];
  for (const c of categories.filter((x) => fields.some((f) => MATRIX_CATEGORY[f]?.test(x.name)))) {
    if (o.signal?.aborted) break;
    const html = await o.fetch(c.url, o.signal);
    if (html) all.push(...parseMatrix(html));
  }
  return all;
}

// ---------- high-tech employers' own lists ----------

// Where a high-tech employer keeps its jobs (portals.ts's Read): a recruiting platform's public list of them
// (Greenhouse's, Lever's and Workable's APIs, Ashby's and Comeet's job board pages, no key used), its careers site's search
// (Eightfold's, Amazon's, Apple's, Google's), asked for Israel and for each of the roles, or a page of its own
// (Matrix's, Mobileye's). A list has every job the employer has open anywhere, so only those in Israel are kept.

// Places in Israel as job locations name them, in English and in Hebrew.
export const ISRAEL = /israel|tel[\s-]?aviv|herzl?iy?a|haifa|jerusalem|petah|petach|ra'?anana|netanya|be'?er[\s-]?sheva|yokneam|yoqneam|kfar[\s-]?saba|rosh[\s-]?ha'?ayin|ramat[\s-]?gan|hod[\s-]?hasharon|rehovot|caesarea|airport city|or[\s-]?yehuda|bnei[\s-]?brak|holon|givatayim|modi'?in|ashdod|ashkelon|\blod\b|ness[\s-]?ziona|rishon|kiryat|nazareth|karmiel|migdal|mig[\s-]?ha'?emek|ישראל|תל[\s-]?אביב|הרצליה|חיפה|ירושלים|פתח[\s-]?תקו?וה|רעננה|נתניה|באר[\s-]?שבע|יקנעם|כפר[\s-]?סבא|ראש[\s-]?העין|רמת[\s-]?גן|הוד[\s-]?השרון|רחובות|קיסריה|אור[\s-]?יהודה|בני[\s-]?ברק|חולון|גבעתיים|מודיעין|אשדוד|אשקלון|נס[\s-]?ציונה|ראשון[\s-]?לציון|מגדל[\s-]?העמק/i;
const inIsrael = (p: Posting) => ISRAEL.test(p.location);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// A day as YYYY-MM-DD, from an ISO time, seconds or milliseconds since 1970, or words ("September 2, 2026",
// "08 Nov 2026"); "" when there is none.
export function day(t: unknown): string {
  if (typeof t === "number" && t > 0) return new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10);
  const s = String(t ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const words = s.match(/^(?:(\d{1,2})\s+([a-z]{3})[a-z]*|([a-z]{3})[a-z]*\s+(\d{1,2}),?)\s+(\d{4})$/i);
  if (!words) return "";
  const month = MONTHS.indexOf((words[2] ?? words[3]).toLowerCase()) + 1;
  return month ? `${words[5]}-${String(month).padStart(2, "0")}-${(words[1] ?? words[4]).padStart(2, "0")}` : "";
}

// The JSON value (an object or a list) that starts at text[at], found by its brackets, minding strings.
export function jsonAt(text: string, at: number) {
  let depth = 0, inString = false;
  for (let i = at; i >= 0 && i < text.length; i++) {
    const ch = text[i];
    if (inString) { if (ch === "\\") i++; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if ((ch === "}" || ch === "]") && --depth === 0) return text.slice(at, i + 1);
  }
  return "";
}

// A link from a list, kept only where it points at the site it came from.
const onSite = (href: unknown, origin: string): string => {
  try { const url = new URL(String(href ?? ""), origin); return url.origin === new URL(origin).origin ? url.href : ""; } catch { return ""; }
};
const posting = (title: unknown, location: unknown, date: string, url: string): Posting[] => {
  const name = text(String(title ?? ""));
  return name && url ? [{ title: name, company: "", location: text(String(location ?? "")), date, url, source: "page" }] : [];
};

// Greenhouse's list of a board's jobs: each one's title, place and first day, linked to its page on the board.
export function parseGreenhouse(json: string, board: string): Posting[] {
  const jobs = JSON.parse(json)?.jobs;
  if (!Array.isArray(jobs)) throw new Error("not a Greenhouse list");
  return jobs.flatMap((j) => (/^\d+$/.test(String(j?.id)) ? posting(j.title, j.location?.name, day(j.first_published ?? j.updated_at), `https://job-boards.greenhouse.io/${board}/jobs/${j.id}`) : []));
}

// Lever's list: each posting's title, places and day, with its own page on Lever.
export function parseLever(json: string): Posting[] {
  const jobs = JSON.parse(json);
  if (!Array.isArray(jobs)) throw new Error("not a Lever list");
  return jobs.flatMap((j) => posting(j?.text, [j?.categories?.location, ...(j?.categories?.allLocations ?? [])].filter(Boolean).join(", "), day(j?.createdAt), onSite(j?.hostedUrl, "https://jobs.lever.co")));
}

// Workable's list of an account's jobs (the one its careers page's widget shows): each job's title, the places it
// shows, and its day, linked to its page on Workable.
export function parseWorkable(json: string): Posting[] {
  const jobs = JSON.parse(json)?.jobs;
  if (!Array.isArray(jobs)) throw new Error("not a Workable list");
  return jobs.flatMap((j) => {
    const places = (Array.isArray(j?.locations) && j.locations.length ? j.locations.filter((l: any) => !l?.hidden) : [j])
      .map((l: any) => [l?.city, l?.country].filter(Boolean).join(", "));
    return posting(j?.title, [...new Set(places)].filter(Boolean).join("; "), day(j?.published_on), onSite(j?.url, "https://apply.workable.com"));
  });
}

// Ashby's job board page: its jobs in the page's data (window.__appData), each with its places.
export function parseAshby(html: string, org: string): Posting[] {
  const at = html.indexOf("window.__appData");
  const jobs = at < 0 ? null : JSON.parse(jsonAt(html, html.indexOf("{", at)) || "null")?.jobBoard?.jobPostings;
  if (!Array.isArray(jobs)) throw new Error("not an Ashby job board");
  return jobs.flatMap((j) => (/^[\w-]+$/.test(String(j?.id)) ? posting(j.title, [j.locationName, ...(j.secondaryLocations ?? []).map((l: any) => l?.locationName)].filter(Boolean).join(", "), "", `https://jobs.ashbyhq.com/${encodeURIComponent(org)}/${j.id}`) : []));
}

// Comeet's job board page: its positions in the page's data (COMPANY_POSITIONS_DATA, given its value well after it is
// declared), each with its place and its country, and its own page on Comeet.
export function parseComeet(html: string): Posting[] {
  const at = html.search(/COMPANY_POSITIONS_DATA\s*=\s*\[/);
  const positions = at < 0 ? null : JSON.parse(jsonAt(html, html.indexOf("[", at)) || "null");
  if (!Array.isArray(positions)) throw new Error("not a Comeet job board");
  return positions.flatMap((p) => {
    const where = p?.location ?? {};
    const parts = [where.name, where.city, where.country === "IL" ? "Israel" : where.country].flatMap((x) => String(x ?? "").split(/,\s*/)).filter(Boolean);
    return posting(p?.name, [...new Set(parts)].join(", "), day(p?.time_updated), onSite(p?.url_comeet_hosted_page, "https://www.comeet.com"));
  }).filter((x) => x.url.startsWith("https://www.comeet.com/jobs/"));
}

// An Eightfold careers site's search: its positions, each with its places, day and page on the site.
export function parseEightfold(json: string, host: string): Posting[] {
  const positions = JSON.parse(json)?.data?.positions;
  if (!Array.isArray(positions)) throw new Error("not an Eightfold search");
  return positions.flatMap((p) => posting(p?.name, (p?.locations ?? []).join("; "), day(p?.postedTs), String(p?.positionUrl ?? "").startsWith("/") ? onSite(p.positionUrl, `https://${host}`) : ""));
}

// Amazon's job search: each job's title, place, day and page.
export function parseAmazon(json: string): Posting[] {
  const jobs = JSON.parse(json)?.jobs;
  if (!Array.isArray(jobs)) throw new Error("not an Amazon search");
  return jobs.flatMap((j) => posting(j?.title, j?.location ?? j?.city, day(j?.posted_date), String(j?.job_path ?? "").startsWith("/") ? onSite(j.job_path, "https://www.amazon.jobs") : ""));
}

// Apple's job search page: its results in the page's data (a JSON text handed to JSON.parse), each with its places,
// day and details page.
export function parseApple(html: string): Posting[] {
  const at = html.indexOf('JSON.parse("', html.indexOf("__staticRouterHydrationData"));
  let end = at + 12;
  while (end < html.length && html[end] !== '"') end += html[end] === "\\" ? 2 : 1;
  const find = (v: any): any[] | null => {
    if (!v || typeof v !== "object") return null;
    if (Array.isArray(v.searchResults)) return v.searchResults;
    for (const x of Object.values(v)) { const got = find(x); if (got) return got; }
    return null;
  };
  let results: any[] | null = null;
  try { results = at < 0 ? null : find(JSON.parse(JSON.parse(`"${html.slice(at + 12, end)}"`))); } catch { results = null; }
  if (!results) throw new Error("not an Apple job search");
  return results.flatMap((r) => posting(r?.postingTitle, (r?.locations ?? []).map((l: any) => [l?.name, l?.countryName].filter(Boolean).join(", ")).join("; "), day(r?.postDateInGMT),
    r?.id && r?.transformedPostingTitle ? `https://jobs.apple.com/en-il/details/${encodeURIComponent(r.id)}/${encodeURIComponent(r.transformedPostingTitle)}` : ""));
}

// Google's job search page: each card's title (its heading) and its place, before the card's link to the job.
export function parseGoogle(html: string): Posting[] {
  const links = [...html.matchAll(/href="(jobs\/results\/\d+[\w-]*)[^"]*"/g)];
  if (!links.length && !html.includes("Google Careers")) throw new Error("not a Google job search");
  const seen = new Set<string>();
  return links.flatMap((m, i): Posting[] => {
    const url = `https://www.google.com/about/careers/applications/${m[1]}`;
    if (seen.has(url)) return [];
    seen.add(url);
    const card = html.slice(links[i - 1]?.index ?? 0, m.index);
    const heading = card.lastIndexOf("<h3");
    const title = heading < 0 ? "" : card.slice(heading).match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1];
    const place = heading < 0 ? "" : card.slice(heading).match(/>([^<>]*Israel[^<>]*)</)?.[1];
    return posting(title, place, "", url);
  });
}

// Mobileye's jobs page: each job a card (jobItem), its title, then its place, and its page.
export const MOBILEYE = "https://careers.mobileye.com/jobs";
export function parseMobileye(html: string): Posting[] {
  const cards = html.split(/<div\b[^>]*class="jobItem\b/).slice(1);
  if (!cards.length) throw new Error("not Mobileye's jobs page");
  return cards.flatMap((card) => {
    const title = card.match(/class="jobTitle"[^>]*>([\s\S]*?)<\//)?.[1];
    const after = card.slice(card.indexOf("jobTitle"));
    const place = after.match(/<\/p>[\s\S]*?>([^<>]*\S[^<>]*)</)?.[1];
    return posting(title, place, "", onSite(card.match(/href="(\/jobs\/[^"]+)"/)?.[1], "https://careers.mobileye.com"));
  });
}

// Check Point's careers site: its list for Israel, ten to a page, in the page's data (Next.js), each job linked to its
// page there.
export const CHECKPOINT = "https://careers.checkpoint.com/jobs?country=Israel";
export function parseCheckPoint(html: string): { pages: number; found: Posting[] } {
  const data = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  const result = data ? JSON.parse(data)?.props?.pageProps?.result : null;
  if (!Array.isArray(result?.jobPostingsList)) throw new Error("not Check Point's jobs page");
  return {
    pages: Number(result.numberOfPages) || 1,
    found: result.jobPostingsList.flatMap((j: any) => (/^\d+$/.test(String(j?.id)) && /^[\w-]+$/.test(String(j?.slug))
      ? posting(j.title, [j.city, j.country].filter(Boolean).join(", "), day(j.datePosted), `https://careers.checkpoint.com/jobs/${j.id}/${j.slug}`) : [])),
  };
}

// Palo Alto Networks' careers site, CyberArk's now too (Radancy): its search for Israel, fifteen to a page, the pages
// by ?p= (its own next link goes by an address its robots.txt keeps closed), each result's title and place.
export const PALOALTO = "https://jobs.paloaltonetworks.com/en/search-jobs/Israel/47263/2/294640/31/35/50/2";
export function parseRadancy(html: string, origin: string): { pages: number; found: Posting[] } {
  const results = [...html.matchAll(/<a\b[^>]*href="(\/[a-z]{2}\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  if (!results.length && !/data-total-results/.test(html)) throw new Error("not a Radancy search");
  return {
    pages: Number(html.match(/data-total-pages="(\d+)"/)?.[1] ?? 1),
    found: results.flatMap((m) => posting(m[2].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/)?.[1], m[2].match(/class="[^"]*result-location[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1], "", onSite(m[1], origin))),
  };
}

// A page whose jobs are marked for search engines (JSON-LD JobPosting), as HiBob's careers page is: each one's title,
// places (a country's code standing for its name, as "IL") and day, with its link where it is on site's hosts.
export function parseJobPostings(html: string, site: string): Posting[] {
  const items = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => {
    try { const j = JSON.parse(m[1]); return Array.isArray(j) ? j : j?.["@graph"] ?? [j]; } catch { return []; }
  }).filter((j) => j?.["@type"] === "JobPosting");
  if (!items.length) throw new Error("no job postings marked on the page");
  const name = (x: unknown) => (x && typeof x === "object" ? (x as { name?: unknown }).name : x);
  return items.flatMap((j) => {
    const places = (Array.isArray(j.jobLocation) ? j.jobLocation : [j.jobLocation]).map((l: any) =>
      [l?.address?.addressLocality, l?.address?.addressRegion, name(l?.address?.addressCountry)].map((x) => (x === "IL" ? "Israel" : x)).filter(Boolean).join(", "));
    let url = "";
    try { const u = new URL(String(j.url ?? "")); if (u.protocol === "https:" && u.hostname.endsWith(site)) url = u.href; } catch { /* none */ }
    return posting(j.title, [...new Set(places)].filter(Boolean).join("; "), day(j.datePosted), url);
  });
}

// A Jobvite careers page (jobs.jobvite.com/<company>/jobs): each row's job, its place (the row's last mark: a place, or
// how many there are), and its page there.
export function parseJobvite(html: string, company: string): Posting[] {
  const rows = [...html.matchAll(new RegExp(`<a\\b[^>]*href="(/${company.replace(/\W/g, "")}/job/\\w+)[^"]*"[^>]*>([\\s\\S]*?)</a>`, "g"))];
  if (!rows.length && !html.includes("jv-job-list")) throw new Error("not a Jobvite list");
  return rows.flatMap((m) => {
    const spans = [...(m[2].match(/jv-job-list-location[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "").matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/g)].map((s) => s[1]);
    return posting(m[2].match(/jv-job-list-name[^>]*>([\s\S]*?)<\/div>/)?.[1], spans[spans.length - 1], "", `https://jobs.jobvite.com${m[1]}`);
  });
}

// Unity's positions page: each position in the page's data, its title, places and Workday page.
export function parseUnity(html: string): Posting[] {
  const items = [...html.replace(/\\"/g, '"').matchAll(/\{"title":"((?:[^"\\]|\\.)*)","locations":\[((?:"[^"]*",?)*)\][^{}]*?"externalUrl":"(https:\/\/unitytech\.wd1\.myworkdayjobs\.com\/[^"]+)"/g)];
  if (!items.length) throw new Error("not Unity's positions page");
  return items.flatMap((m) => {
    let title = m[1];
    try { title = JSON.parse(`"${m[1]}"`); } catch { /* kept as it came */ }
    return posting(title, [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("; "), "", m[3]);
  });
}

// The address of a recruiting platform board's list of jobs, "" for another kind of Read.
const boardUrl = (read: Read) =>
  "greenhouse" in read ? `https://boards-api.greenhouse.io/v1/boards/${read.greenhouse}/jobs`
  : "lever" in read ? `https://api.lever.co/v0/postings/${read.lever}?mode=json`
  : "workable" in read ? `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(read.workable)}`
  : "ashby" in read ? `https://jobs.ashbyhq.com/${encodeURIComponent(read.ashby)}`
  : "comeet" in read ? `https://www.comeet.com/jobs/${read.comeet}`
  : "";

// A recruiting platform's board read whole, for the list that grows by itself (discover.ts): every job on it with its
// place, and the company's name as the board gives it (Lever's list has none: its board page's title, then).
export async function readBoard(read: Read, o: { fetch: Fetch; signal?: AbortSignal }): Promise<{ name: string; postings: Posting[] }> {
  const page = async (url: string) => {
    const body = await o.fetch(url, o.signal);
    if (body === null) throw new Error(`${new URL(url).host} did not answer`);
    return body;
  };
  const url = boardUrl(read);
  if (!url) throw new Error("not a recruiting platform's board");
  const body = await page(url);
  if ("greenhouse" in read) {
    const about = JSON.parse(await page(`https://boards-api.greenhouse.io/v1/boards/${read.greenhouse}`));
    return { name: String(about?.name ?? ""), postings: parseGreenhouse(body, read.greenhouse) };
  }
  if ("lever" in read) {
    const title = (await page(`https://jobs.lever.co/${read.lever}`)).match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    return { name: text(title), postings: parseLever(body) };
  }
  if ("workable" in read) return { name: String(JSON.parse(body)?.name ?? ""), postings: parseWorkable(body) };
  if ("ashby" in read) {
    const at = body.indexOf("window.__appData");
    const data = at < 0 ? null : JSON.parse(jsonAt(body, body.indexOf("{", at)) || "null");
    return { name: String(data?.organization?.name ?? ""), postings: parseAshby(body, read.ashby) };
  }
  const title = body.match(/<title>\s*(?:Job opportunities at|Jobs at)\s+([^<]+?)(?:\s+-\s+Careers[^<]*)?\s*<\/title>/i)?.[1] ?? "";
  return { name: text(title), postings: parseComeet(body) };
}

// What a careers site is searched for: each role's title without its level, which big employers seldom put in a
// title, up to eight.
export const searchTerms = (roles: Role[]) =>
  [...new Set(roles.map((r) => r.query.replace(/^(junior|senior|graduate|student|intern)\s+/i, "").trim()).filter(Boolean))].slice(0, 8);

// A high-tech employer's jobs in Israel, from where it keeps them.
async function readCareers(read: Read, roles: Role[], o: { fetch: Fetch; signal?: AbortSignal }): Promise<Posting[]> {
  const page = async (url: string) => {
    const body = await o.fetch(url, o.signal);
    if (body === null) throw new Error(`${new URL(url).host} did not answer`);
    return body;
  };
  const search = async (url: (term: string) => string, parse: (body: string) => Posting[]) => {
    const all: Posting[] = [];
    for (const term of searchTerms(roles)) {
      if (o.signal?.aborted) break;
      all.push(...parse(await page(url(encodeURIComponent(term)))));
    }
    return all;
  };
  // A list over pages: the first, then each one after it it says there is, up to ten.
  const paged = async (first: string, next: (n: number) => string, parse: (body: string) => { pages: number; found: Posting[] }) => {
    const one = parse(await page(first));
    const all = [...one.found];
    for (let n = 2; n <= Math.min(one.pages, 10) && !o.signal?.aborted; n++) all.push(...parse(await page(next(n))).found);
    return all;
  };
  let found: Posting[];
  if ("greenhouse" in read) found = parseGreenhouse(await page(boardUrl(read)), read.greenhouse);
  else if ("jobvite" in read) found = parseJobvite(await page(`https://jobs.jobvite.com/${read.jobvite}/jobs`), read.jobvite);
  else if ("lever" in read) found = parseLever(await page(boardUrl(read)));
  else if ("workable" in read) found = parseWorkable(await page(boardUrl(read)));
  else if ("ashby" in read) found = parseAshby(await page(boardUrl(read)), read.ashby);
  else if ("comeet" in read) found = parseComeet(await page(boardUrl(read)));
  else if ("eightfold" in read) {
    const host = read.eightfold;
    found = await search((q) => `https://${host}/api/pcsx/search?domain=${host.split(".").slice(-2).join(".")}&query=${q}&location=Israel&start=0`, (b) => parseEightfold(b, host));
  } else if ("own" in read) {
    if (read.own === "matrix") return readMatrix(fieldsOf(roles), o);
    found = read.own === "amazon" ? await search((q) => `https://www.amazon.jobs/en/search.json?country=ISR&base_query=${q}&result_limit=50&sort=recent`, parseAmazon)
      : read.own === "apple" ? await search((q) => `https://jobs.apple.com/en-il/search?location=israel-ISR&search=${q}`, parseApple)
      : read.own === "google" ? await search((q) => `https://www.google.com/about/careers/applications/jobs/results?location=Israel&q=${q}`, parseGoogle)
      : read.own === "checkpoint" ? await paged(CHECKPOINT, (n) => `${CHECKPOINT}&page=${n}`, parseCheckPoint)
      : read.own === "paloalto" ? await paged(PALOALTO, (n) => `${PALOALTO}?p=${n}`, (b) => parseRadancy(b, "https://jobs.paloaltonetworks.com"))
      : read.own === "hibob" ? parseJobPostings(await page("https://hibob.teamme.link/"), ".careers.hibob.com")
      : read.own === "unity" ? parseUnity(await page("https://unity.com/careers/positions"))
      : parseMobileye(await page(MOBILEYE));
  } else return [];
  return found.filter(inIsrael);
}

// A careers page the user added (portals page): its links that look like a posting and have one of the roles' words.
// Only links on the same site are taken.
export async function readOwnPage(id: string, name: string, url: string, roles: Role[], o: { fetch: Fetch; today: string; signal?: AbortSignal }): Promise<Found[]> {
  const html = await o.fetch(url, o.signal);
  if (html === null) throw new Error("the page did not answer");
  const words = titleWords(roles);
  const host = new URL(url).host;
  const seen = new Set<string>();
  const found: Found[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = text(m[2]);
    let href: URL;
    try { href = new URL(decode(m[1]), url); } catch { continue; }
    if (!/^https?:$/.test(href.protocol) || href.host !== host || seen.has(href.href)) continue;
    if (title.length < 4 || title.length > 120 || !titleMatches(title, words)) continue;
    seen.add(href.href);
    found.push({ title, company: name, location: "", date: "", url: href.href, source: "page", portal: id });
  }
  return found.slice(0, 60);
}
