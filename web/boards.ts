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

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
  // The punctuation a site's editor writes by name ("We&rsquo;re Hiring", "Daycare &ndash; Center").
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", middot: "·",
};
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

// One site's pages one after another, with a pause, however many searches want them at once. A page of a search
// that was stopped leaves no pause after it, so the pages waiting behind it go at once, those stopped too, as nothing.
const turns = new Map<string, Promise<void>>();
async function inTurn<T>(host: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const before = turns.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  turns.set(host, before.then(() => mine));
  await before;
  try { return await work(); } finally { setTimeout(release, signal?.aborted ? 0 : GAPS[host] ?? GAP_MS); }
}

// A page through tools/fetch_page.py, or null when the site said no (robots.txt), failed or answered with an error.
export function pageFetcher(run: Run = runTool): Fetch {
  return (url, signal) => inTurn(new URL(url).host, async () => {
    if (signal?.aborted) return null;
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
  }, signal);
}

// A job-search service that answers only a POST: Clalit's careers app (Redmatch), and the like. Sean allowed it on
// 2026-11-14 for employers' own job lists. Only ever to an address written in the code (portals.ts), never to one a
// posting gives; robots.txt asked first, by the same tool fetch_page.py uses; https only; JSON out, a page of text
// back, capped in time and size; one request at a time to a site, as its pages are. null when the site said no,
// failed or answered with an error.
export type Post = (url: string, body: unknown, signal?: AbortSignal) => Promise<string | null>;
const POST_TIMEOUT_MS = 45_000;
const POST_MAX = 10 * 1024 * 1024;
const POST_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const robotsSaid = new Map<string, { ok: boolean; at: number }>();
export function jsonPoster(run: Run = runTool, send: typeof fetch = fetch): Post {
  return (url, body, signal) => inTurn(new URL(url).host, async () => {
    if (signal?.aborted || !url.startsWith("https://")) return null;
    const known = robotsSaid.get(url);
    const ok = known && Date.now() - known.at < 3_600_000 ? known.ok : (await run([PYTHON, "tools/robots_check.py", url], { signal }).catch(() => ({ code: 1 }))).code === 0;
    robotsSaid.set(url, { ok, at: Date.now() });
    if (!ok) return null;
    try {
      const res = await send(url, {
        method: "POST", body: JSON.stringify(body), redirect: "error",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/plain, */*", "User-Agent": POST_AGENT },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(POST_TIMEOUT_MS)]) : AbortSignal.timeout(POST_TIMEOUT_MS),
      });
      if (!res.ok || Number(res.headers.get("content-length") ?? 0) > POST_MAX) return null;
      const text = await res.text();
      return text.length > POST_MAX ? null : text;
    } catch {
      return null;
    }
  }, signal);
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
export async function readEmployer(p: Portal, roles: Role[], o: { fetch: Fetch; post?: Post; today: string; signal?: AbortSignal; seniority?: string }): Promise<Found[]> {
  const words = titleWords(roles);
  const all: Posting[] = [];
  // Its own careers site first, when it has one that can be read (Sean 2026-11-14: "כל אתר שמפרסם בעצמו אני לא
  // רוצה לקחת את זה ממקומות אחרים כל עוד זה אפשרי"); the job board only when the site doesn't answer, or shows no
  // jobs at all, which is more likely a reader a redesign broke than an employer with nothing open.
  const direct = p.direct ? await readCareers(p.direct, roles, o).catch(() => [] as Posting[]) : [];
  if (direct.length) all.push(...direct);
  else if (p.read && "alljobs" in p.read) {
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

// ---------- Mimun Yashir's careers pages (5555.co.il) ----------

// Its list shows five jobs a page and a script turns the pages, but each job has a page of its own under /דרושים/, and
// all of them are in the sitemap its robots.txt names, the closed ones too, which say so on their page. Those changed in
// the last four months whose address has one of the roles' words are opened one by one, for their names, up to twenty a
// read, the newest first; the closed ones are left out.
export const MIMUN_YASHIR = "https://www.5555.co.il/api/Cms/GetSiteMapXml";
const MIMUN_JOBS = "/דרושים/";
const MIMUN_DAYS = 120;
const MIMUN_MOST = 20;
export function mimunYashirJobs(xml: string, today: string): { url: string; date: string; words: string }[] {
  const out: { url: string; date: string; words: string }[] = [];
  for (const m of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)) {
    let loc = m[1].trim();
    try { loc = decodeURIComponent(loc); } catch { /* kept as it came */ }
    const at = loc.indexOf(MIMUN_JOBS);
    if (!loc.startsWith("https://www.5555.co.il/") || at < 0) continue;
    const slug = loc.slice(at + MIMUN_JOBS.length).replace(/\/+$/, "");
    if (!slug || slug.includes("/") || slug === "כל-המשרות") continue;
    const date = day(m[2] ?? "");
    if (date && (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000 > MIMUN_DAYS) continue;
    out.push({ url: new URL(loc).href, date, words: slug.replace(/-/g, " ") });
  }
  return out;
}
// One job's page: its name, the page's heading; none when the page says the job is closed.
export function parseMimunYashirJob(html: string, url: string, date: string): Posting[] {
  if (/משרה זו אינה זמינה/.test(html)) return [];
  return posting(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1], "", date, url);
}
async function readMimunYashir(roles: Role[], o: { fetch: Fetch; today?: string; signal?: AbortSignal }) {
  const xml = await o.fetch(MIMUN_YASHIR, o.signal);
  if (xml === null) throw new Error("5555.co.il did not answer");
  const words = titleWords(roles);
  const all: Posting[] = [];
  const jobs = mimunYashirJobs(xml, o.today ?? new Date().toISOString().slice(0, 10)).filter((j) => titleMatches(j.words, words))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, MIMUN_MOST);
  for (const job of jobs) {
    if (o.signal?.aborted) break;
    const html = await o.fetch(job.url, o.signal);
    if (html) all.push(...parseMimunYashirJob(html, job.url, job.date));
  }
  return all;
}

// ---------- Ness's and Elad's careers sites ----------

// Ness (ness-tech.co.il/careers): its whole list at once, from the job service its careers page reads, which its
// robots.txt leaves open; each job's title, region and day ("05/11/2026"), linked to its page on the site. Its regions
// ("אזור המרכז") are all in Israel.
export const NESS = "https://www.ness-tech.co.il/careers/api/Careers/GetOrderDetailsList?profId=&areasId=&freeText=&isHot=false&rows=1000&page=1";
export const dayMonthYear = (s: unknown) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? "").trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
};
export function parseNess(json: string): Posting[] {
  let list: unknown;
  try { list = JSON.parse(json)?.allOrderDetailsList; } catch { /* not its list */ }
  if (!Array.isArray(list)) throw new Error("not Ness's job list");
  return list.flatMap((j: any) => (/^\d+$/.test(String(j?.index))
    ? posting(j.title, j.posLocation, dayMonthYear(j.lastUpdated), `https://www.ness-tech.co.il/careers/job/${j.index}`) : []));
}

// Elad Systems (elad.a-2-z.co.il): all its jobs, ten a page, the newest first. Its robots.txt keeps its searches closed
// but not its pages, so the pages are read in turn; each card's title, its regions and its page there.
export const ELAD = "https://elad.a-2-z.co.il/jobs/";
export function parseElad(html: string): { pages: number; found: Posting[] } {
  const cards = html.split(/<article\b[^>]*class="job-card\b/).slice(1);
  if (!cards.length && !/id="jobs-filter"/.test(html)) throw new Error("not Elad's jobs page");
  return {
    pages: Math.max(1, ...[...html.matchAll(/[?&]pg=(\d+)/g)].map((m) => Number(m[1]))),
    found: cards.flatMap((card) => {
      const a = card.match(/<h3 class="job-title">\s*<a href="(https:\/\/elad\.a-2-z\.co\.il\/jobs\/\d+\/)"[^>]*>([\s\S]*?)<\/a>/);
      const places = [...card.matchAll(/<a href="https:\/\/elad\.a-2-z\.co\.il\/jobs\/\?area=\d+"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[1]));
      return a ? posting(a[2], places.join(", "), "", a[1]) : [];
    }),
  };
}
// Elad's jobs abroad (חו"ל as their only region) are left out.
const ABROAD_ONLY = /^חו"ל$/;

// ---------- Aman's and Dialog's careers sites (IT placement houses) ----------

// Aman (aman.co.il/careers): all its jobs, ten a page, the newest first, each card's title linked to its page there; the
// pages by /page/N/.
export const AMAN = "https://www.aman.co.il/careers/";
export function parseAman(html: string): { pages: number; found: Posting[] } {
  const cards = [...html.matchAll(/<a class="aman-job-card__title-link" href="(https:\/\/www\.aman\.co\.il\/careers\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  if (!cards.length && !/aman-job-card|positions_page/.test(html)) throw new Error("not Aman's jobs page");
  return {
    pages: Math.max(1, ...[...html.matchAll(/\/careers\/page\/(\d+)\//g)].map((m) => Number(m[1]))),
    found: cards.flatMap((m) => posting(m[2], "", "", m[1])),
  };
}

// Dialog (dialog.co.il/high-tech/jobs): its jobs by field, twenty a page by ?page=N, each card's title, region and page
// there. Only the fields the roles are in are read.
export const DIALOG = "https://www.dialog.co.il/high-tech/jobs/";
const DIALOG_FIELDS: Record<string, string[]> = {
  software: ["software"], hardware: ["hardware"], data: ["data", "research"], quality: ["qa"], infra: ["system"], security: ["system"],
};
export const dialogFields = (roles: Role[]) => {
  const fields = [...new Set(fieldsOf(roles).flatMap((f) => DIALOG_FIELDS[f] ?? []))];
  return fields.length ? fields : ["software"];
};
export function parseDialog(html: string): { pages: number; found: Posting[] } {
  const cards = html.split(/<div class="item_job">/).slice(1);
  if (!cards.length && !/high-tech\/jobs\//.test(html)) throw new Error("not Dialog's jobs page");
  return {
    pages: Math.max(1, ...[...html.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1]))),
    found: cards.flatMap((card) => {
      const a = card.match(/<h3 class="title_job">\s*<a href="(\/high-tech\/jobs\/jobpage\?positionId=\d+)"[^>]*>([\s\S]*?)<\/a>/);
      const place = card.match(/<span class="icon icon-location"><\/span>([^<]*)</)?.[1];
      return a ? posting(a[2], place, "", `https://www.dialog.co.il${a[1]}`) : [];
    }),
  };
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
  // No address at all is none, not the site's home page it would resolve to.
  if (typeof href !== "string" || !href.trim()) return "";
  try { const url = new URL(href, origin); return url.origin === new URL(origin).origin ? url.href : ""; } catch { return ""; }
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
  // Comeet's page title once named the company; since it became Spark Hire Recruit (November 2026) the title is the
  // platform's own, and the name is in the page's data and in its og:title.
  const named = body.match(/"company_name"\s*:\s*("(?:[^"\\]|\\.)+")/)?.[1];
  let fromData = "";
  try { fromData = named ? String(JSON.parse(named)) : ""; } catch { /* not plain JSON: the og:title, then */ }
  const title = fromData
    || body.match(/<meta[^>]+property="og:title"[^>]+content="\s*(?:Job opportunities at|Jobs at)\s+([^"]+?)\s*"/i)?.[1]
    || body.match(/<title>\s*(?:Job opportunities at|Jobs at)\s+([^<]+?)(?:\s+-\s+Careers[^<]*)?\s*<\/title>/i)?.[1] || "";
  return { name: text(title), postings: parseComeet(body) };
}

// What a careers site is searched for: each role's title without its level, which big employers seldom put in a
// title, up to eight.
export const searchTerms = (roles: Role[]) =>
  [...new Set(roles.map((r) => r.query.replace(/^(junior|senior|graduate|student|intern)\s+/i, "").trim()).filter(Boolean))].slice(0, 8);

// A high-tech employer's jobs in Israel, from where it keeps them.
async function readCareers(read: Read, roles: Role[], o: { fetch: Fetch; post?: Post; today?: string; signal?: AbortSignal; seniority?: string }): Promise<Posting[]> {
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
  // A Redmatch careers app: its whole list in Israel (country 2), in one answer to a POST.
  if ("redmatch" in read) {
    if (!o.post) throw new Error("no way to ask a service that answers only a POST");
    const { api, guid, site } = read.redmatch;
    const body = await o.post(`${api}position/Search/${guid}`, { KeyWords: "", CategoryId: [], countryId: 2, cityId: [] }, o.signal);
    if (body === null) throw new Error(`${new URL(api).host} did not answer`);
    return parseRedmatch(body, site);
  }
  // A Workday career site: its jobs found for "Israel", twenty to a page, up to five pages; kept to places in Israel
  // below, as a global employer's are.
  let found: Posting[];
  if ("workday" in read) {
    if (!o.post) throw new Error("no way to ask a service that answers only a POST");
    const { host, tenant, site } = read.workday;
    found = [];
    for (let offset = 0; offset < 100 && !o.signal?.aborted; offset += 20) {
      const body = await o.post(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText: "Israel" }, o.signal);
      if (body === null) throw new Error(`${host} did not answer`);
      const page = parseWorkday(body, `https://${host}/en-US/${site}`);
      found.push(...page.found);
      if (offset + 20 >= page.total) break;
    }
    return found.filter(inIsrael);
  }
  // An Israeli employer's own list, whose links name no place: all of it, with no check that a place is in Israel,
  // page after page when it has them.
  if ("links" in read) {
    const { url, path, title, pages, step } = read.links;
    const found = new Map<string, Posting>();
    const queue = [url];
    const visited = new Set<string>();
    const nextPage = pages ? new RegExp(pages, "i") : null;
    for (let n = 0; n < 10 && queue.length && !o.signal?.aborted; n++) {
      const at = queue.shift()!;
      visited.add(at);
      const html = await page(at);
      const before = found.size;
      for (const p of readLinks(html, at, path, title)) if (!found.has(p.url)) found.set(p.url, p);
      if (nextPage) {
        for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
          let to = "";
          try { to = new URL(decode(m[1]), at).href; } catch { continue; }
          if (nextPage.test(to) && !visited.has(to) && !queue.includes(to)) queue.push(to);
        }
      }
      if (step && found.size > before) {
        const to = new URL(url);
        to.searchParams.set(step.param, String(step.size * (n + 1)));
        if (!visited.has(to.href)) queue.push(to.href);
      }
    }
    return [...found.values()];
  }
  // The civil service's tenders of a government body's offices.
  if ("gov" in read) return readGov(read.gov, o);
  // A careers site on Jibe: its own search's list.
  if ("jibe" in read) return readJibe(read.jibe, o);
  // A WordPress site's own list of its jobs, and its feed of them.
  if ("wp" in read) return readWp(read.wp, o);
  if ("feed" in read) return parseJobFeed(await page(read.feed), new URL(read.feed).origin);
  // A list written out in full: the jobs as its page has them, in Israel or not, as a page of links has.
  if ("text" in read) {
    const all: Posting[] = [];
    for (const at of [read.text.url, ...(read.text.more ?? [])]) {
      if (o.signal?.aborted) break;
      all.push(...parseTextList(await page(at), read.text, at));
    }
    return all;
  }
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
    if (read.own === "mimunyashir") return readMimunYashir(roles, o);
    if (read.own === "gotfriends") return readGotfriends(roles, o);
    if (read.own === "nisha") return readNisha(roles, o);
    if (read.own === "jobnet") return readJobnet(roles, o);
    if (read.own === "nbn") return parseJobFeed(await page(NBN_FEED), "https://www.nbn.org.il");
    if (read.own === "ethosia") return readEthosia(o);
    if (read.own === "iai") return readIai(o);
    if (read.own === "elbit") return parseElbit(await page(ELBIT_FILE));
    if (read.own === "menora") return parseMenora(await page(`${MENORA}jobs`));
    if (read.own === "bezeq") return parseBezeq(await page(BEZEQ_JOBS));
    if (read.own === "phoenix") return parsePhoenix(await page(PHOENIX));
    if (read.own === "mod") return parseMod(await page(MOD_JOBS));
    if (read.own === "hot") {
      const answer = await (o.post ?? jsonPoster())(HOT_JOBS, {}, o.signal);
      if (answer === null) throw new Error("HOT's job service did not answer");
      return parseHot(answer);
    }
    // Israeli employers whose regions the place check doesn't know.
    if (read.own === "ness") return parseNess(await page(NESS));
    if (read.own === "elad") return (await paged(ELAD, (n) => `${ELAD}?pg=${n}`, parseElad)).filter((p) => !ABROAD_ONLY.test(p.location));
    if (read.own === "aman") return paged(AMAN, (n) => `${AMAN}page/${n}/`, parseAman);
    if (read.own === "dialog") {
      const all: Posting[] = [];
      for (const field of dialogFields(roles)) {
        if (o.signal?.aborted) break;
        all.push(...await paged(`${DIALOG}${field}`, (n) => `${DIALOG}${field}?page=${n}`, parseDialog));
      }
      return all;
    }
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

// ---------- Gotfriends ----------

// A placement agency's board (gotfriends.co.il): its jobs listed by category, ten to a page, each with its title, its
// place and its own page, the employer unnamed. Read by the categories of the roles' fields (roles.ts fieldsOf), the
// graduates' always for a search that starts out, the first two pages of each.
const GOTFRIENDS = "https://www.gotfriends.co.il/jobslobby/";
const GOTFRIENDS_LOBBIES: Record<string, string[]> = {
  start: ["graduates/", "software/graduate-with-high-honors/"],
  software: ["software/full-stack-developer/", "software/backend-developer/", "software/frontend-developer/", "software/python-developer/", "software/nodejs-developer/", "software/react-developer/", "software/net-developer/", "software/java-developer/"],
  data: ["software/data-engineer/", "algorithm/machine-learning/", "algorithm/computer-vision/", "algorithm/data-scientist/", "ai/ai-engineer/", "ai/llm-engineer/", "bibig_data/data-analyst/", "bibig_data/bi-developer/"],
  quality: ["qa/qa-positions/", "qa/automation-developer/"],
  infra: ["system/"],
  hardware: ["hardware/verification-engineer/", "software/real-time-engineerembedded-engineer/"],
  security: ["datasecurity/security-analyst/"],
};

export function parseGotfriends(html: string): Posting[] {
  const out: Posting[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="(\/jobslobby\/[a-z0-9_-]+\/[a-z0-9_-]+\/\d+\/)"[^>]*class="position[^"]*"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const card = html.slice(m.index ?? 0, (m.index ?? 0) + 2500);
    const place = /מיקום:\s*<\/span>\s*<span class="info-data">([\s\S]*?)<\/span>/.exec(card)?.[1] ?? "";
    out.push(...posting(decode(m[2]), decode(place), "", `https://www.gotfriends.co.il${m[1]}`));
  }
  return out;
}

async function readGotfriends(roles: Role[], o: { fetch: Fetch; signal?: AbortSignal }) {
  const fields = fieldsOf(roles);
  const lobbies = [...new Set(["start", ...fields].flatMap((f) => GOTFRIENDS_LOBBIES[f] ?? []))];
  const all: Posting[] = [];
  for (const lobby of lobbies) {
    if (o.signal?.aborted) break;
    const first = await o.fetch(`${GOTFRIENDS}${lobby}`, o.signal);
    if (first === null) continue;
    all.push(...parseGotfriends(first));
    const second = /href="(\?page=2&(?:amp;)?total=\d+)"/.exec(first)?.[1];
    if (second && !o.signal?.aborted) {
      const html = await o.fetch(`${GOTFRIENDS}${lobby}${decode(second)}`, o.signal);
      if (html) all.push(...parseGotfriends(html));
    }
  }
  if (!all.length && lobbies.length) throw new Error("Gotfriends gave no jobs");
  const seen = new Set<string>();
  return all.filter((p) => !seen.has(p.url) && seen.add(p.url));
}

// ---------- Nisha ----------

// A placement agency's board (nisha.co.il): a page per role (/positions/<role>/), each job a heading linked to its own
// page (/job/<number>/), the next page at page/2/. Read by the roles of the roles' fields, two pages of each.
const NISHA = "https://www.nisha.co.il/positions/";
const NISHA_ROLES: Record<string, string[]> = {
  start: ["software-engineer/"],
  software: ["software-engineer/", "full-stack-developer/", "backend-engineer/", "frontend-developer/", "python-developer/", "react-developer/", "java-developer/"],
  data: ["data-engineer/", "data-scientist/", "machine-learning/", "algorithm-developer/", "data-analyst/", "bi-developer/"],
  quality: ["automation-engineer/"],
  infra: ["devops/", "system-engineer/"],
  hardware: ["rt-embedded/", "fpga-engineer/", "hardware-developer/"],
  security: ["cyber-security/"],
};

export const parseNisha = (html: string) =>
  [...html.matchAll(/<h3 class="job-title">\s*<a href="(https:\/\/www\.nisha\.co\.il\/job\/\d+\/)">([\s\S]*?)<\/a>/gi)].flatMap((m) => posting(decode(m[2]), "", "", m[1]));

async function readNisha(roles: Role[], o: { fetch: Fetch; signal?: AbortSignal }) {
  const pages = [...new Set(["start", ...fieldsOf(roles)].flatMap((f) => NISHA_ROLES[f] ?? []))];
  const all: Posting[] = [];
  for (const page of pages) {
    for (const at of [`${NISHA}${page}`, `${NISHA}${page}page/2/`]) {
      if (o.signal?.aborted) break;
      const html = await o.fetch(at, o.signal);
      if (html === null) break;
      const found = parseNisha(html);
      all.push(...found);
      if (!html.includes(`${page}page/2/`)) break;
    }
  }
  if (!all.length && pages.length) throw new Error("Nisha gave no jobs");
  const seen = new Set<string>();
  return all.filter((p) => !seen.has(p.url) && seen.add(p.url));
}

// ---------- Jobnet ----------

// A job board (jobnet.co.il): a list per profession (/jobs?profid=<n>), the newest fifteen on the first page, each job
// marked up as a schema.org JobPosting with its title, employer, day and regions. Its next pages are a form posted
// back to the server, so only the first page of each list is read, which a daily run keeps up with. The regions' long
// lists of towns are left out: a job in "מרכז" lists Modi'in among them. Its list of jobs needing no experience
// (/jobs?subprofid=1252) is cleaners and call centres, so it isn't read.
const JOBNET = "https://www.jobnet.co.il/jobs?";
const JOBNET_LISTS: Record<string, string[]> = {
  start: ["profid=669"],
  software: ["profid=669", "profid=641"],
  data: ["profid=669"],
  quality: ["profid=646"],
  infra: ["profid=658"],
  hardware: ["profid=648"],
  security: ["profid=658"],
};

export function parseJobnet(html: string): Posting[] {
  const out: Posting[] = [];
  for (const card of html.split(/itemtype="https:\/\/schema\.org\/JobPosting"/i).slice(1)) {
    const job = /href='\/jobs\?positionid=(\d+)'[^>]*>\s*<h2 itemprop="title"\s*>([\s\S]*?)<\/h2>/i.exec(card);
    if (!job) continue;
    const company = /itemprop="hiringOrganization"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i.exec(card)?.[1] ?? "";
    const d = /itemprop="datePosted"[^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(card);
    const towns = [...card.matchAll(/itemprop='addressLocality'>([^<]*)</gi)].map((m) => text(m[1])).filter(Boolean);
    const regions = [...card.matchAll(/itemprop='addressRegion'>(?:<a[^>]*>)?([^<]*)</gi)].map((m) => text(m[1])).filter(Boolean);
    out.push(...posting(decode(job[2]), [...new Set(towns.length ? towns : regions)].join(", "), d ? `${d[3]}-${d[2]}-${d[1]}` : "", `https://www.jobnet.co.il/jobs?positionid=${job[1]}`)
      .map((p) => ({ ...p, company: text(company) })));
  }
  return out;
}

async function readJobnet(roles: Role[], o: { fetch: Fetch; signal?: AbortSignal }) {
  const lists = [...new Set(["start", ...fieldsOf(roles)].flatMap((f) => JOBNET_LISTS[f] ?? []))];
  const all: Posting[] = [];
  for (const list of lists) {
    if (o.signal?.aborted) break;
    const html = await o.fetch(`${JOBNET}${list}`, o.signal);
    if (html) all.push(...parseJobnet(html));
  }
  if (!all.length && lists.length) throw new Error("Jobnet gave no jobs");
  const seen = new Set<string>();
  return all.filter((p) => !seen.has(p.url) && seen.add(p.url));
}

// ---------- Israel Aerospace Industries ----------

// IAI's careers site (jobs.iai.co.il) draws its list in the browser from one file of all its jobs, which the page
// names (_jobsFile): each job's title, city and number, a job's page being /job/<number>. The file's name is taken
// from the page, as it changes with each version, and only a file of the site's theme is read.
const IAI = "https://jobs.iai.co.il";
const IAI_FILE = "/wp-content/themes/tyco-wp/assets/json/jobs.json";

export function parseIai(json: string): Posting[] {
  const jobs = JSON.parse(json);
  if (!Array.isArray(jobs)) throw new Error("not IAI's list");
  return jobs.flatMap((j: any) => (/^\d+$/.test(String(j?.id)) ? posting(j.tl, j.ct, "", `${IAI}/job/${j.id}`) : []));
}

async function readIai(o: { fetch: Fetch; signal?: AbortSignal }) {
  const html = await o.fetch(`${IAI}/jobs/`, o.signal);
  const named = /_jobsFile\s*=\s*"([^"]+)"/.exec(html ?? "")?.[1]?.replace(/\\\//g, "/") ?? "";
  const file = /^\/wp-content\/themes\/[\w-]+\/assets\/json\/jobs\.json(\?v=\d+)?$/.test(named) ? named : IAI_FILE;
  const body = await o.fetch(`${IAI}${file}`, o.signal);
  if (body === null) throw new Error("jobs.iai.co.il did not answer");
  return parseIai(body);
}

// ---------- Elbit Systems ----------

// Elbit's careers site (elbitsystemscareer.com) draws its list in the browser from one file of all its open jobs
// (/cron/jobs.json, some 550 jobs and 2 MB on 2026-11-14): each job's title, first day, city (a number, named by the
// site's own list below) and area, a job's page being /job?jid=<n>. The file has no job's page of its own to read, so
// the posting is read from the same file (posting-read.ts elbitPosting, ranker.ts).
export const ELBIT_FILE = "https://elbitsystemscareer.com/cron/jobs.json";
const ELBIT_CITIES: Record<string, string> = {
  2191: "נצרת עלית", 416: "חיפה", 104: "קריית שמונה", 524: "כרמיאל", 106: "פארק הייטק בר לב", 966: "רמת השרון", 975: "רמלה",
  109: "איירפורט סיטי", 816: "נתניה", 1137: "תל אביב", 1203: "יבנה", 134: "באר שבע", 443: "חצרים", 812: "נס ציונה", 992: "רחובות",
  1008: "ראש העין", 960: "רעננה", 467: "חולון", 72: "ערד", 149: "בני ברק", 1050: "שדרות", 878: "אופקים", 85: "אשדוד", 628: "לוד",
  935: "קיסריה", 129: "תל חי", 964: "רמת גן", 770: "מודיעין", 1227: "יקנעם",
};
const ELBIT_AREAS: Record<string, string> = { North: "צפון", Haifa: "חיפה", Sharon: "שרון", Center: "מרכז", Shfela: "שפלה", South: "דרום", "Jerusalem Area": "ירושלים" };

export function parseElbit(json: string): Posting[] {
  const jobs = JSON.parse(json);
  if (!Array.isArray(jobs)) throw new Error("not Elbit's list");
  return jobs.flatMap((j: any) => {
    if (!/^\d+$/.test(String(j?.jobId)) || (j.status !== undefined && j.status !== 1)) return [];
    const props = Array.isArray(j.extendedProperties) ? j.extendedProperties : [];
    const city = ELBIT_CITIES[String(props.find((p: any) => p?.PropertyName === "Cities")?.Value ?? "").trim()];
    const area = ELBIT_AREAS[String(j.area ?? "")] ?? "";
    return posting(j.jobTitle, city || area, /^\d{4}-\d{2}-\d{2}/.test(String(j.openDate)) ? String(j.openDate).slice(0, 10) : "", `https://elbitsystemscareer.com/job?jid=${j.jobId}`);
  });
}

// ---------- Bezeq ----------

// Bezeq's careers page (bezeq.co.il/career_new) fills its list from Bezeq's own service, read with a GET
// (d-api.bezeq.co.il/api/Adam/GetActiveJobs, 32 jobs on 2026-11-14): each job's title, area, first day and number, a
// job's page being career/jobs/form/?jobs=<number>. That page keeps the job's words hidden until a click, which the
// posting guard drops, so the posting is read from the same list (posting-read.ts bezeqPosting, ranker.ts).
export const BEZEQ_JOBS = "https://d-api.bezeq.co.il/api/Adam/GetActiveJobs";

export function parseBezeq(json: string): Posting[] {
  const jobs = JSON.parse(json)?.data;
  if (!Array.isArray(jobs)) throw new Error("not Bezeq's list");
  return jobs.flatMap((j: any) => (/^\d+$/.test(String(j?.order_id))
    ? posting(j.tat_profession_name || j.description, j.work_area || j.living_area1, /^\d{4}-\d{2}-\d{2}/.test(String(j.orderDate)) ? String(j.orderDate).slice(0, 10) : "", `https://www.bezeq.co.il/career/jobs/form/?jobs=${j.order_id}`)
    : []));
}

// ---------- The civil service ----------

// The civil service's jobs site (merkava.mrp.gov.il/giusp) is filled from one public list of all its open tenders,
// read with a GET (194 tenders and 2 MB on 2026-11-14), each with its office's number, title, place, first day and
// words. A government body's jobs are its offices' (portals.ts { gov }). The list is read once for all of them (kept
// ten minutes). A tender's page on the site is index.html#/position/<RequestId>, and the job list keys a job by its
// address without its #, so the id is in the address's query too; the posting is read from the same list
// (posting-read.ts govPosting).
export const GOV_FEED = "https://merkava.mrp.gov.il/sap/opu/odata/ILG/GIUS_PUBLIC_AREA_SRV/SearchDataIdSet?$filter=isPublis%20eq%20true&$format=json";
export const govJobUrl = (id: string) => `https://merkava.mrp.gov.il/giusp/index.html?position=${id}#/position/${id}`;
export const odataDay = (v: unknown) => {
  const ms = /\/Date\((\d+)\)\//.exec(String(v ?? ""))?.[1];
  return ms ? new Date(Number(ms)).toISOString().slice(0, 10) : "";
};
const GOV_KEEP_MS = 10 * 60_000;
let govRead: { at: number; body: Promise<string | null> } | null = null;

export function parseGov(json: string, offices: string[]): Posting[] {
  const items = JSON.parse(json)?.d?.results;
  if (!Array.isArray(items)) throw new Error("not the civil service's list");
  return items.flatMap((j: any) => (offices.includes(String(j?.OfficeNumber)) && /^\d{1,12}$/.test(String(j?.RequestId))
    ? posting(j.TenderName || j.JobName, j.LocationName || j.Area, odataDay(j.TenderPublicationDate), govJobUrl(String(j.RequestId)))
    : []));
}

async function readGov(offices: string[], o: { fetch: Fetch; signal?: AbortSignal }) {
  if (!govRead || Date.now() - govRead.at > GOV_KEEP_MS) govRead = { at: Date.now(), body: o.fetch(GOV_FEED, o.signal) };
  const body = await govRead.body;
  if (body === null) { govRead = null; throw new Error("the civil service's list did not answer"); }
  return parseGov(body, offices);
}
export const forgetGovList = () => { govRead = null; };

// ---------- The Ministry of Defense ----------

// The ministry's own jobs site (jobs.mod.gov.il, not the civil service's) draws its tenders in the browser from its
// service's list, read with a GET (13 tenders on 2026-11-14): each one's title, place, first and last day, and words.
// A tender's page on the site is #/Tenders/<Id>, so its id is in the address's query too; the posting is read from the
// same list (posting-read.ts modPosting).
export const MOD_JOBS = "https://jobs.mod.gov.il/api/TenderPublish/GetAllPublished";
export function parseMod(json: string): Posting[] {
  const items = JSON.parse(json)?.Data;
  if (!Array.isArray(items)) throw new Error("not the Ministry of Defense's list");
  return items.flatMap((t: any) => (/^\d{1,9}$/.test(String(t?.Id))
    ? posting(t.BankJob?.JobName ?? t.BankJob?.HrJob?.JobName, t.BankJob?.HrJob?.JobAreaDescription, /^\d{4}-\d{2}-\d{2}/.test(String(t.TenderPublish?.StartDate)) ? String(t.TenderPublish.StartDate).slice(0, 10) : "", `https://jobs.mod.gov.il/?tender=${t.Id}#/Tenders/${t.Id}`)
    : []));
}

// ---------- HOT ----------

// HOT's careers page (hot.net.il/heb/careersearch) draws its jobs from its own service, which answers only a POST
// (12 jobs on 2026-11-14), its answer JSON written inside a JSON string: each job's number (JB-<n>), title, place and
// words. A job opens on the page itself, with no page of its own, so it is known by the page with its number
// (pip-job=JB-<n>), and its posting is read from the same service (posting-read.ts hotPosting, ranker.ts).
export const HOT_JOBS = "https://www.hot.net.il/HotCmsApiFront/api/MarketingJob/GetJobs";
export const HOT_PAGE = "https://www.hot.net.il/heb/careersearch/";
export function hotVacancies(answer: string): any[] {
  let data: any = JSON.parse(answer);
  if (typeof data === "string") data = JSON.parse(data);
  const jobs = data?.data?.vacanciesDetails;
  if (!Array.isArray(jobs)) throw new Error("not HOT's list");
  return jobs;
}
export const parseHot = (answer: string): Posting[] =>
  hotVacancies(answer).flatMap((v) => (/^JB-\d{1,6}$/.test(String(v?.vacancyName)) ? posting(v.jobTitle, v.location, "", textJobUrl(HOT_PAGE, v.vacancyName)) : []));

// ---------- Jibe ----------

// A careers site on iCIMS' Jibe (careers.se.com): its own search's list, read with a GET (/api/jobs?<query>&page=<n>,
// ten to a page, with the total): each job's title, place, day ("24 March 2026") and page (canonical_url).
export type JibeList = { host: string; query: string };
export function parseJibe(json: string, host: string): { total: number; found: Posting[] } {
  const data = JSON.parse(json);
  if (!Array.isArray(data?.jobs)) throw new Error("not a Jibe list");
  return {
    total: Number(data.totalCount) || 0,
    found: data.jobs.flatMap(({ data: j }: any) => {
      const when = new Date(String(j?.posted_date ?? ""));
      return posting(j?.title, j?.full_location || j?.location_name, Number.isNaN(when.getTime()) ? "" : when.toISOString().slice(0, 10), onSite(j?.meta_data?.canonical_url, `https://${host}`));
    }),
  };
}

async function readJibe(list: JibeList, o: { fetch: Fetch; signal?: AbortSignal }) {
  const all: Posting[] = [];
  for (let n = 1; n <= 5; n++) {
    if (o.signal?.aborted) break;
    const body = await o.fetch(`https://${list.host}/api/jobs?${list.query}&page=${n}`, o.signal);
    if (body === null) { if (n === 1) throw new Error(`${list.host} did not answer`); break; }
    const { total, found } = parseJibe(body, list.host);
    all.push(...found);
    if (!found.length || all.length >= total) break;
  }
  return all;
}

// ---------- WordPress ----------

// A WordPress site whose jobs are a type of its own, read through the site's own list (wp-json/wp/v2/<type>, a query
// such as a category's after it): a hundred to a page, each with its title, page and first day. At most five pages.
export type WpList = { site: string; type: string; query?: string };
export function parseWpList(json: string, origin: string): Posting[] {
  const items = JSON.parse(json);
  if (!Array.isArray(items)) throw new Error("not a WordPress list");
  return items.flatMap((j: any) => {
    let title = String(j?.title?.rendered ?? "");
    try { title = decodeURIComponent(title); } catch { /* a % that isn't an escape */ }
    return posting(decode(title), "", /^\d{4}-\d{2}-\d{2}/.test(String(j?.date)) ? String(j.date).slice(0, 10) : "", onSite(j?.link, origin));
  });
}

async function readWp(list: WpList, o: { fetch: Fetch; signal?: AbortSignal }) {
  const origin = new URL(list.site).origin;
  const all: Posting[] = [];
  for (let n = 1; n <= 5; n++) {
    if (o.signal?.aborted) break;
    // Past the last page the list answers an error, which the fetch gives as nothing.
    const body = await o.fetch(`${origin}/wp-json/wp/v2/${list.type}?per_page=100&page=${n}&_fields=id,date,link,title${list.query ? `&${list.query}` : ""}`, o.signal);
    if (body === null) { if (n === 1) throw new Error(`${new URL(origin).host} did not answer`); break; }
    const page = parseWpList(body, origin);
    all.push(...page);
    if (JSON.parse(body).length < 100) break;
  }
  return all;
}

// ---------- Lists written out in full ----------

// A careers page that writes its jobs out in full, none with a page of its own (to apply by email, say): each job's
// block starts where the site's pattern matches (portals.ts { text }: its named group title, id when the site gives
// each block one, as FIBI's sections have, and place when the block names one) and runs to the next, at most 12,000
// characters. The job list keys a
// job by its address without its #, so a job is known by the list's address with pip-job=<its id, or a short hash of
// its title>; the posting reader reads that block alone (posting-read.ts textPosting). A list over several pages (more,
// Bank of Jerusalem's one per field) knows each job by the page it is on. A job that has a page of its own the list
// gives no link to, but its id makes (link, Leumi's /he/node/{id}), is known by that page.
export type TextList = { url: string; item: string; more?: string[]; link?: string };
const TEXT_BLOCK = 12_000;
const shortHash = (s: string) => {
  let h = 0x811c9dc5;
  for (const ch of s) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
};

export function textBlocks(html: string, list: TextList): { id: string; title: string; place: string; html: string }[] {
  const found = [...html.matchAll(new RegExp(list.item, "gi"))];
  const seen = new Map<string, number>();
  return found.flatMap((m, i) => {
    const title = text(m.groups?.title ?? m[1] ?? "");
    if (title.length < 3) return [];
    const start = m.index ?? 0;
    const end = Math.min(i + 1 < found.length ? found[i + 1].index ?? html.length : html.length, start + TEXT_BLOCK);
    let id = String(m.groups?.id ?? "").replace(/[^\w-]/g, "").slice(0, 60) || shortHash(title);
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    return [{ id, title, place: text(m.groups?.place ?? ""), html: html.slice(start, end) }];
  });
}

export const TEXT_JOB = "pip-job";
export function textJobUrl(list: string, id: string) {
  const url = new URL(list);
  url.searchParams.set(TEXT_JOB, id);
  return url.href;
}

export const parseTextList = (html: string, list: TextList, at = list.url): Posting[] =>
  textBlocks(html, list).flatMap((b) => posting(b.title, b.place, "", list.link ? onSite(list.link.replace("{id}", encodeURIComponent(b.id)), at) : textJobUrl(at, b.id)));

// ---------- Nuxt pages (the Phoenix) ----------

// A Nuxt 2 page writes its state as a function called with the values it repeats:
// window.__NUXT__=(function(a,b,…){return {…}}(value, value, …)). The values each short name stands for are read
// here as data (strings, numbers, true, false, null), and nothing of the page is run.
export function nuxtState(html: string): { body: string; values: Map<string, unknown> } | null {
  const start = html.indexOf("window.__NUXT__=(function(");
  if (start < 0) return null;
  const open = start + "window.__NUXT__=(function(".length;
  const close = html.indexOf(")", open);
  const names = html.slice(open, close).split(",");
  const bodyAt = html.indexOf("{", close);
  // The function's body ends where its braces close, strings skipped.
  let depth = 0, i = bodyAt;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '"') { for (i++; i < html.length && html[i] !== '"'; i++) if (html[i] === "\\") i++; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) break;
  }
  if (html[i + 1] !== "(") return null;
  const values = new Map<string, unknown>();
  const args = html.slice(i + 2, html.indexOf("</script>", i));
  let n = 0;
  // A number may leave out its 0 (".5").
  for (const m of args.matchAll(/\s*("(?:[^"\\]|\\.)*"|-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?|true|false|null|void 0|\{\}|\[\])\s*(?:,|\)\);?\s*$)/gy)) {
    const token = m[1];
    let value: unknown;
    if (token.startsWith('"')) { try { value = JSON.parse(token); } catch { value = undefined; } }
    else value = token === "void 0" ? undefined : token === "{}" ? {} : token === "[]" ? [] : token === "true" ? true : token === "false" ? false : token === "null" ? null : Number(token);
    if (n < names.length) values.set(names[n], value);
    n++;
  }
  return { body: html.slice(bodyAt, i + 1), values };
}

// The Phoenix's careers page (fnx.co.il/career/open-positions) is such a page, its open positions in its state
// (career.positions): each one's number, title, place and last change, those it shows on the site marked
// marketingSite "Y", a job's page being open-positions/<number>/.
const PHOENIX = "https://www.fnx.co.il/career/open-positions/";

export function parsePhoenix(html: string): Posting[] {
  const state = nuxtState(html);
  const at = state?.body.indexOf("career:{positions:[") ?? -1;
  if (!state || at < 0) throw new Error("not the Phoenix's list");
  const value = (token: string | undefined): unknown => token === undefined ? undefined
    : token.startsWith('"') ? (() => { try { return JSON.parse(token); } catch { return undefined; } })()
    : /^-?\d/.test(token) ? Number(token) : state.values.get(token);
  const items = state.body.slice(at).split("{positionCode:").slice(1);
  return items.flatMap((item) => {
    const field = (name: string) => value(new RegExp(`(?:^|[,{])${name}:("(?:[^"\\\\]|\\\\.)*"|[\\w$]+)`).exec(name === "positionCode" ? `positionCode:${item}` : item)?.[1]);
    const code = String(field("positionCode") ?? "");
    if (!/^\d{4,12}$/.test(code) || field("marketingSite") !== "Y") return [];
    const changed = Number(field("lastModifiedOn"));
    return posting(field("positionDesc"), field("positionLocationText"), Number.isFinite(changed) && changed > 0 ? new Date(changed).toISOString().slice(0, 10) : "", `${PHOENIX}${code}/`);
  });
}

// ---------- Menora Mivtachim ----------

// Menora's careers site (menoramivt.co.il/job-posting/jobs) is a Next.js page that carries its whole list in the
// page's own data (__NEXT_DATA__, props.initialReduxState.metadata.positions): each position's title, area and first
// day ("16/09/2026"), a job's page being details?entityId=<its id>.
const MENORA = "https://www.menoramivt.co.il/job-posting/";

export function parseMenora(html: string): Posting[] {
  const data = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  const positions = data ? JSON.parse(data)?.props?.initialReduxState?.metadata?.positions : null;
  if (!Array.isArray(positions)) throw new Error("not Menora's list");
  return positions.flatMap((p: any) => {
    if (!/^[0-9a-f]{16,40}$/i.test(String(p?.positionId))) return [];
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(p.fromDate ?? "").trim());
    return posting(p.positionDisplayName || p.positionName, p.localityLongName, d ? `${d[3]}-${d[2]}-${d[1]}` : "", `${MENORA}details?entityId=${p.positionId}`);
  });
}

// ---------- Ethosia ----------

// A placement agency (ethosia.co.il) whose jobs are a type of its WordPress site, read through the site's own list
// (wp-json/wp/v2/job): a hundred to a page, newest first, each with its title, day, page and areas, which are terms
// named in one more ask. Each job has a level, and a junior search asks only for the levels that start out (מתחיל,
// מתמחה, סטודנט). An agency leaves old jobs up, so only those of the last four months are kept.
const ETHOSIA = "https://ethosia.co.il/wp-json/wp/v2/";
const ETHOSIA_STARTING = "88,78,486";
const ETHOSIA_DAYS = 120;

export function parseEthosia(json: string, areas: Map<number, string>): Posting[] {
  const jobs = JSON.parse(json);
  if (!Array.isArray(jobs)) throw new Error("not a WordPress list");
  return jobs.flatMap((j: any) => {
    if (Array.isArray(j?.["closed-jobs"]) && j["closed-jobs"].length) return [];
    // Some titles keep their brackets escaped for an address ("BackEnd %28Physical design%29 Engineer").
    let title = String(j?.title?.rendered ?? "");
    try { title = decodeURIComponent(title); } catch { /* a % that isn't an escape, as in "100% remote" */ }
    const place = (Array.isArray(j?.["area-in-the-country"]) ? j["area-in-the-country"] : []).map((id: unknown) => areas.get(Number(id)) ?? "").filter(Boolean).join(", ");
    return posting(decode(title), place, /^\d{4}-\d{2}-\d{2}/.test(String(j?.date)) ? String(j.date).slice(0, 10) : "", onSite(j?.link, "https://ethosia.co.il"));
  });
}

async function readEthosia(o: { fetch: Fetch; signal?: AbortSignal; seniority?: string }) {
  const levels = o.seniority === "junior" ? `&job-type=${ETHOSIA_STARTING}` : "";
  const since = new Date(Date.now() - ETHOSIA_DAYS * 86_400_000).toISOString().slice(0, 10);
  const jobs: any[] = [];
  for (let n = 1; n <= 5; n++) {
    if (o.signal?.aborted) break;
    // Past the last page the list answers an error, which the fetch gives as nothing.
    const body = await o.fetch(`${ETHOSIA}job?per_page=100&page=${n}${levels}&_fields=id,date,link,title,closed-jobs,area-in-the-country`, o.signal);
    const page = body === null ? null : JSON.parse(body);
    if (!Array.isArray(page)) break;
    jobs.push(...page.filter((j) => String(j?.date ?? "").slice(0, 10) >= since));
    if (page.length < 100 || page.some((j) => String(j?.date ?? "").slice(0, 10) < since)) break;
  }
  if (!jobs.length) return [];
  const ids = [...new Set(jobs.flatMap((j) => (Array.isArray(j?.["area-in-the-country"]) ? j["area-in-the-country"] : [])).filter((id) => Number.isInteger(id)))];
  const areas = new Map<number, string>();
  if (ids.length && !o.signal?.aborted) {
    const named = await o.fetch(`${ETHOSIA}area-in-the-country?include=${ids.slice(0, 100).join(",")}&per_page=100&_fields=id,name`, o.signal);
    try { for (const t of JSON.parse(named ?? "[]")) if (Number.isInteger(t?.id)) areas.set(t.id, decode(String(t.name ?? ""))); } catch { /* the places stay blank */ }
  }
  return parseEthosia(JSON.stringify(jobs), areas);
}

// ---------- Nefesh B'Nefesh's job board ----------

// A WordPress job board (nbn.org.il/jobboard, WP Job Manager), read through its own feed of the technical categories,
// which names each job's employer, place and day. The feed takes the categories by their names in the address, not by
// their numbers.
const NBN_FEED = "https://www.nbn.org.il/jobboard/?feed=job_feed&job_categories=hi-tech,it,programming,data-analyst,ai,engineering&posts_per_page=50";

export function parseJobFeed(xml: string, origin: string): Posting[] {
  const field = (item: string, name: string) => {
    const m = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, "i").exec(item);
    return m ? decode(m[1]) : "";
  };
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap(([, item]) => {
    const url = onSite(field(item, "link").trim(), origin);
    const when = new Date(field(item, "pubDate"));
    return posting(field(item, "title"), field(item, "job_listing:location"), Number.isNaN(when.getTime()) ? "" : when.toISOString().slice(0, 10), url)
      .map((p) => ({ ...p, company: text(field(item, "job_listing:company")) }));
  });
}

// A Redmatch careers app's list (position/Search): each open position's title, place and first day, and its page in
// the app (redmatch-apply/redmatch.apply.html?compPositionID=<id>), which the job's own page reads (ranker.ts).
export function parseRedmatch(json: string, site: string): Posting[] {
  const positions = JSON.parse(json.replace(/^﻿/, ""))?.positions;
  if (!Array.isArray(positions)) throw new Error("not a Redmatch list");
  return positions.flatMap((p: any) => (/^\d+$/.test(String(p?.compPositionID)) && p?.isActivePosition !== false && p?.isActivePosition !== "False"
    ? posting(p.jobTitleText, p.displayLocation || p.location, /^\d{4}-\d{2}-\d{2}/.test(String(p.activationDate)) ? String(p.activationDate).slice(0, 10) : "", `${site}redmatch-apply/redmatch.apply.html?compPositionID=${p.compPositionID}`)
    : []));
}

// A Workday career site's page of jobs (its service's answer): each job's title, places and posted words, and its
// page on the site (base, then its externalPath); total is how many the search found in all.
export function parseWorkday(json: string, base: string): { total: number; found: Posting[] } {
  const data = JSON.parse(json);
  if (!Array.isArray(data?.jobPostings)) throw new Error("not a Workday list");
  return {
    total: Number(data.total) || 0,
    found: data.jobPostings.flatMap((j: any) => (typeof j?.externalPath === "string" && j.externalPath.startsWith("/job/")
      ? posting(j.title, j.locationsText, "", `${base}${j.externalPath}`) : [])),
  };
}

// A job link's words that say nothing of the job: "to the job's page", "read more", "apply".
const GENERIC_LINK = /^(?:לעמוד המשרה|קרא(?:\/י)? עוד|לקריאה|ל?פרטים(?: נוספים)?(?: והגשת מועמדות)?|למידע נוסף|פרטי משרה|צפי(?:י)?ה במשרה>?|הגש(?:\/י|ת)? מועמדות(?: למשרה)?|הגשת מועמדות|שליחת קו["״]ח|כניסה|לעמוד המכרז|שיתוף(?: עם)?|שתפו|view(?: job)?|read more|more|details|apply(?: now)?|view & apply|learn more|share(?: with)?)\W*$/i;
// What a card adds after its title: its category, its scope, a "read more" and what follows.
const CARD_TAIL = /\s+(?:קטגוריה|היקף משרה|מיקום|תחום|סוג משרה)\s*:.*$|\s+(?:קרא עוד|לפרטים נוספים|למידע נוסף|לדף המשרה|view & apply)(?:\s.*)?$/i;

// A job's title when its link's words say nothing: where the site's own pattern finds it last before the link (titleRe,
// its first group), the last heading before the link in its card, or else the words of the link's own last path
// segment, when they are words and not a number.
function titleNear(html: string, at: number, href: URL, titleRe?: RegExp) {
  if (titleRe) {
    // The site's own pattern is looked for further back than a heading: a card's text may stand between its title
    // and its links (one1.co.il's descriptions run to thousands of characters).
    const own = [...html.slice(Math.max(0, at - 20000), at).matchAll(titleRe)].pop()?.[1];
    if (own && text(own).length >= 3) return text(own);
  }
  const before = html.slice(Math.max(0, at - 3000), at);
  const heads = [...before.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<[a-z]+\b[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/[a-z]+>/gi)];
  for (const h of heads.reverse()) {
    const words = text(h[2] ?? h[3] ?? "");
    if (words.length >= 3 && words.length <= 140 && !GENERIC_LINK.test(words)) return words;
  }
  return slugTitle(href);
}

// The words of a link's last path segment, when they are words and not a number: "מפתח-ת-full-stack-junior-1202".
function slugTitle(href: URL) {
  let slug = href.pathname.split("/").filter(Boolean).pop() ?? "";
  try { slug = decodeURIComponent(slug); } catch { /* left as it is */ }
  slug = slug.replace(/\.\w+$/, "").replace(/[-_]+/g, " ").trim();
  return /\p{L}{3}/u.test(slug) && !/^\d+$/.test(slug) ? slug : "";
}

// A share button's link (WhatsApp, Facebook, LinkedIn, X, Telegram) stands for the page it shares when that page is on
// the list's own site (one1.co.il's jobs have no link of their own but these); any other link to those sites is none.
const SHARE_HOSTS = /(^|\.)(whatsapp\.com|wa\.me|facebook\.com|twitter\.com|x\.com|linkedin\.com|t\.me|telegram\.me)$/i;
function unshared(href: URL, base: string): { href: URL; shared: boolean } | null {
  if (!SHARE_HOSTS.test(href.hostname)) return { href, shared: false };
  const host = (h: string) => h.toLowerCase().replace(/^www\./, "");
  for (const value of href.searchParams.values()) {
    const inner = /https?:\/\/[^\s"'<>]+/.exec(value)?.[0];
    if (!inner) continue;
    try {
      const page = new URL(inner);
      if (host(page.hostname) === host(new URL(base).hostname)) return { href: page, shared: true };
    } catch { /* not a link */ }
  }
  return null;
}

// A careers page that lists its jobs in its own markup: each link whose path fits the site's job pattern (portals.ts
// links), its words the job's title, or when they only say "read more", the title near it (titleNear), or the one
// its "share by email" link gives (mailto:?subject=<title>&body=<link>, as many sites have). A job linked twice, its
// title and its "read more", is one job, by the link that names it. A link may sit in a share button's data-href
// too. It may lead off the page's host, as to the careers system the site uses, but only over https or http.
export function readLinks(html: string, page: string, path: string, title?: string): Posting[] {
  const job = new RegExp(path, "i");
  // A page's links are relative to its <base href> when it has one (the municipalities' sites have "/": their
  // "./wanted/12/" is the site's /wanted/12/, whatever page lists it).
  let base = page;
  try {
    const declared = /<base\b[^>]*\bhref=["']([^"']+)["']/i.exec(html)?.[1];
    if (declared) base = new URL(decode(declared), page).href;
  } catch { /* the page's own address, then */ }
  const titleRe = title ? new RegExp(title, "gi") : undefined;
  const shared = new Map<string, string>();
  for (const m of html.matchAll(/mailto:\?subject=([^&"']+)&(?:amp;)?body=([^"'\s]+)/gi)) {
    try { shared.set(new URL(decode(decodeURIComponent(m[2])), base).href, text(decodeURIComponent(m[1]))); } catch { /* not a link */ }
  }
  const titles = new Map<string, string>();
  const links = [
    ...[...html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ href: m[1], words: m[2], at: m.index ?? 0 })),
    ...[...html.matchAll(/\bdata-(?:href|url)=["'](https?:[^"']+)["']/gi)].map((m) => ({ href: m[1], words: "", at: m.index ?? 0 })),
  ];
  for (const link of links) {
    let href: URL;
    try { href = new URL(decode(link.href), base); } catch { continue; }
    const real = unshared(href, base);
    if (!real) continue;
    // One page written with its escapes in capitals and in small letters (%D7, %d7) is one page.
    href = new URL(real.href.href.replace(/%[0-9a-f]{2}/gi, (e) => e.toUpperCase()));
    let where = href.pathname + href.search;
    try { where = decodeURIComponent(where); } catch { /* matched as it is */ }
    if (!/^https?:$/.test(href.protocol) || !job.test(where)) continue;
    // A share button's words are the network's ("send"), not the job's.
    const own = real.shared ? "" : text(link.words).replace(CARD_TAIL, "").trim();
    const known = titles.get(href.href);
    if (known && !GENERIC_LINK.test(known)) continue;
    // The site's own title pattern first, when it has one, inside the link (a card that is all one link) or before
    // it; then the link's own words, when they name the job; then its share-by-email subject; then a title already
    // seen for it, a heading near it, or its path's words.
    const inside = titleRe ? text([...link.words.matchAll(titleRe)][0]?.[1] ?? "") : "";
    const name = (inside.length >= 3 ? inside : "") || (titleRe ? titleNear(html, link.at, href, titleRe) : "")
      || (own && !GENERIC_LINK.test(own) ? own : "")
      || shared.get(href.href) || known || titleNear(html, link.at, href) || own;
    if (name.length >= 3 && name.length <= 140) titles.set(href.href, name);
  }
  // One title found for three jobs or more is the section's heading ("open positions"), not theirs: their links'
  // own words, then.
  const count = new Map<string, number>();
  for (const t of titles.values()) count.set(t, (count.get(t) ?? 0) + 1);
  for (const [url, t] of titles) if ((count.get(t) ?? 0) >= 3) titles.set(url, slugTitle(new URL(url)) || t);
  return [...titles].filter(([, t]) => t && !GENERIC_LINK.test(t)).flatMap(([url, t]) => posting(t, "", "", url));
}

// The recruiting platform a careers page shows its jobs from, when it embeds one: Comeet's script with the company's
// uid and name in COMEET.init (Claroty's page, Sean 2026-11-14), or a board's address on Greenhouse, Lever, Ashby or
// Workable. Such a page has its jobs filled in by a script, so its own links name none of them.
export function embeddedBoard(html: string): Read | null {
  const uid = /["']company-uid["']\s*:\s*["']([0-9A-F]{2}\.[0-9A-F]{3})["']/i.exec(html)?.[1];
  const company = /["']company-name["']\s*:\s*["']([\w.-]{1,60})["']/i.exec(html)?.[1];
  if (uid && company) return { comeet: `${company}/${uid}`.toLowerCase() };
  const greenhouse = /(?:boards\.greenhouse\.io\/embed\/job_board(?:\/js)?\?for=|(?:job-)?boards\.greenhouse\.io\/)(?!embed\b)([\w-]{2,60})/i.exec(html)?.[1];
  if (greenhouse) return { greenhouse: greenhouse.toLowerCase() };
  const lever = /jobs\.lever\.co\/([\w-]{2,60})/i.exec(html)?.[1];
  if (lever) return { lever };
  const ashby = /jobs\.ashbyhq\.com\/([\w%.-]{2,60})/i.exec(html)?.[1];
  if (ashby && ashby !== "api") return { ashby: decodeURIComponent(ashby) };
  const workable = /apply\.workable\.com\/([\w-]{2,60})/i.exec(html)?.[1];
  if (workable && workable !== "api") return { workable };
  return null;
}

// A careers page the user added (portals page): the recruiting platform it embeds, when it embeds one, or else its
// links that look like a posting and have one of the roles' words. Only links on the same site are taken.
export async function readOwnPage(id: string, name: string, url: string, roles: Role[], o: { fetch: Fetch; post?: Post; today: string; signal?: AbortSignal }): Promise<Found[]> {
  const html = await o.fetch(url, o.signal);
  if (html === null) throw new Error("the page did not answer");
  // A page that embeds a recruiting platform is read there, all of its jobs, by the employer's name.
  const board = embeddedBoard(html);
  if (board) {
    const jobs = await readEmployer({ id, kind: "employer", how: "read", he: name, en: name, industry: "hightech", read: board, url }, roles, o);
    if (jobs.length) return jobs.map((j) => ({ ...j, company: name }));
  }
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
