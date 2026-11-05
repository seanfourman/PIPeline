// The Israeli job boards the system reads itself (portals.ts): AllJobs, Drushim and JobMaster searched for a role, and
// an employer's own list of jobs read for the fields of the roles in the settings. Every page comes through the
// project's own fetcher (tools/fetch_page.py: browser headers, robots.txt enforced, each site's kept for an hour,
// nothing saved in the project), one page at a time per site with a pause between them. What the pages say is
// third-party data: only a posting's title, company, place, date and link are taken from them, and a link only when
// it points at the board itself.
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DRUSHIM_SEARCH, type Portal } from "./portals";
import { PYTHON, runTool, type Run } from "./ranker";
import { fieldsOf, titleMatches, titleWords, type Role } from "./roles";

export type Board = "alljobs" | "drushim" | "jobmaster";
export const BOARDS: Board[] = ["alljobs", "drushim", "jobmaster"];
// source: the board, or "page" for a careers page the user added.
export type Posting = { title: string; company: string; location: string; date: string; url: string; source: Board | "page" };

// Between two pages from the same site.
const GAP_MS = 500;
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
  try { return await work(); } finally { setTimeout(release, GAP_MS); }
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
  }
  const seen = new Set<string>();
  return all.filter((x) => !seen.has(x.url) && seen.add(x.url) && titleMatches(x.title, words))
    .map((x) => ({ ...x, company: x.company || p.he, portal: p.id }));
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
