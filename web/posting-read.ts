// A job's own words, read from where each site keeps them, for the ranking (ranker.ts fetchPosting) and the job page
// (postings.ts). Most pages show their posting as text, which posting_guard.py reads. Others draw it in the browser
// from data in the page (Comeet, Apple), give a clean copy written for Google (schema.org's JobPosting), or keep it
// behind their own public list (Greenhouse's API), and a Telegram post is read from its embed. Each reader here only
// finds that HTML and the facts beside it (job type, place, dates); posting_guard.py still cleans every word of it,
// hidden content and all, before anything reads it.
import { BEZEQ_JOBS, ELBIT_FILE, GOV_FEED, hotVacancies, jsonAt, MOD_JOBS, odataDay, textBlocks, type TextList } from "./boards";

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

// ---------- the part of a page that holds its job ----------

// A page read whole, with no data of its own for the job, still carries its menus, its header and footer, and lists
// of other jobs. Its job is the part most of its words are in: the page as a tree, with what is never the job left out
// (scripts and styles, hidden elements, the head, nav, header, footer and aside, and blocks named as menus, banners,
// cookie notices, sharing or related jobs, unless one holds half the page's words, as a wrapper named
// "content-footer-wrapper" does), then from the body down into the child that holds most of its words that aren't
// links, while one does; inside that, blocks mostly of links go too. Null when no part has a posting's words, and the
// whole page is read as before. posting_guard.py still cleans every word of what is kept.
type PageNode = { name: string; attrs: string; kids: (PageNode | string)[]; out?: boolean };
const VOID_TAGS = new Set(["br", "img", "input", "meta", "link", "hr", "wbr", "source", "area", "base", "col", "embed", "param", "track"]);
const BLOCK_TAGS = new Set(["p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article", "header", "footer", "table", "thead", "tbody", "blockquote", "pre", "dd", "dt", "dl", "nav", "main", "aside", "figure", "form", "fieldset", "address", "td", "th"]);
const ENDS_ITSELF = new Set(["p", "li", "dd", "dt", "tr", "td", "th", "option"]);
// What may stand in a page's head. Anything else opening there ends the head, as browsers read it: a page that never
// closed its head had its whole body read inside it, as chrome.
const HEAD_KIDS = new Set(["title", "meta", "link", "base", "style", "script", "noscript", "template"]);
const CHROME_TAGS = new Set(["head", "nav", "header", "footer", "aside", "button", "select", "dialog", "label"]);
const CHROME_ROLES = /^(navigation|banner|contentinfo|complementary|dialog|alertdialog|menu|menubar|search)$/i;
const CHROME_NAMES = /(^|[\s_-])(nav|navbar|navigation|menu|menus|topbar|footer|header|breadcrumbs?|cookies?|consent|banner|sidebar|share|sharing|social|related|recommended|similar|modal|popup|login|signup|newsletter|skip|advert)(?=$|[\s_-])/i;
// A block named for the job itself stays, whatever else its name says ("job-header", "position-details"), but for a
// site's own offer beside it ("job-upgrade-box", a box to sign up or download the app).
const JOB_NAMES = /job|position|vacanc|posting|description|משרה/i;
const PROMO_NAMES = /upgrade|upsell|promo|subscribe|download-app|app-banner/i;
// The posting's words, at least, for a part to be taken for it.
const MIN_PART = 200;
// How much of its parent's words a child must hold to be gone down into, and what may be: a box of the page's (a site's
// own elements too, as Google's c-wiz), never a paragraph, a list, a heading or words, whose heading and other parts
// beside it are the posting too.
const DOMINANT = 0.8;
const TEXTUAL = new Set(["p", "ul", "ol", "dl", "li", "dd", "dt", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "span", "a", "b", "strong", "em", "i", "u", "small", "code", "font"]);

const attrOf = (attrs: string, name: string) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  return m ? m[1] ?? m[2] ?? m[3] ?? "" : "";
};
// Hidden by its attribute, its style, or the classes Bootstrap and Tailwind hide with, unless another of its classes
// shows it on a wider screen ("d-none d-lg-block", "hidden md:flex").
const hiddenClass = (classes: string[]) =>
  classes.some((c) => c === "sr-only" || c === "visually-hidden" || c === "invisible")
  || (classes.includes("d-none") && !classes.some((c) => /^d-(?:sm|md|lg|xl|xxl)-(?!none)/.test(c)))
  || (classes.includes("hidden") && !classes.some((c) => /^(?:sm|md|lg|xl|2xl):(?!hidden)/.test(c)));
// The hidden attribute by its name, not a value with the word in it (style="overflow: hidden !important").
const hiddenNode = (attrs: string) =>
  /(?:^|\s)hidden(?=[\s=/]|$)/i.test(attrs.replace(/"[^"]*"|'[^']*'/g, '""')) || /^true$/i.test(attrOf(attrs, "aria-hidden"))
  || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrOf(attrs, "style")) || hiddenClass(attrOf(attrs, "class").split(/\s+/));
// Never the job, by what it is: hidden, or a page's chrome by its tag or its role. The page itself, its html and its
// body, is never out: sites hide it until their scripts run, and it is still the page.
const chromeTag = (n: PageNode) => n.name !== "html" && n.name !== "body"
  && (hiddenNode(n.attrs) || CHROME_TAGS.has(n.name) || CHROME_ROLES.test(attrOf(n.attrs, "role")));
// Chrome by its name only, which a wrapper of the whole page can carry too.
const chromeName = (n: PageNode) => {
  const names = `${attrOf(n.attrs, "class")} ${attrOf(n.attrs, "id")}`;
  return PROMO_NAMES.test(names) || (CHROME_NAMES.test(names) && !JOB_NAMES.test(names));
};

function pageTree(html: string): PageNode {
  const markup = html.replace(/<!--[\s\S]*?(?:-->|$)/g, " ").replace(/<(script|style|noscript|svg|template|iframe|object)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ");
  const root: PageNode = { name: "#root", attrs: "", kids: [] };
  const stack: PageNode[] = [root];
  const top = () => stack[stack.length - 1];
  let pos = 0;
  for (const m of markup.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    if (m.index! > pos) top().kids.push(markup.slice(pos, m.index));
    pos = m.index! + m[0].length;
    const name = m[2].toLowerCase();
    if (m[1]) {
      // A closer ends its own element and all left open inside it; one with no opener is ignored, as browsers do.
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === name) { stack.length = i; break; }
      continue;
    }
    const node: PageNode = { name, attrs: m[3], kids: [] };
    const head = stack.findIndex((s) => s.name === "head");
    if (head > 0 && !HEAD_KIDS.has(name)) stack.length = head;
    if (VOID_TAGS.has(name)) { top().kids.push(node); continue; }
    if (ENDS_ITSELF.has(name) && top().name === name) stack.pop();
    else if (BLOCK_TAGS.has(name) && top().name === "p") stack.pop();
    top().kids.push(node);
    stack.push(node);
  }
  if (pos < markup.length) top().kids.push(markup.slice(pos));
  return root;
}

export function mainContent(html: string): string | null {
  const root = pageTree(html);
  const each = (n: PageNode, visit: (n: PageNode) => void) => {
    visit(n);
    if (!n.out) for (const k of n.kids) if (typeof k !== "string") each(k, visit);
  };
  each(root, (n) => { n.out = chromeTag(n); });
  // Each element's words outside links and inside them, its out elements' none.
  const weight = new Map<PageNode, { text: number; links: number }>();
  const weigh = (n: PageNode, link: boolean): { text: number; links: number } => {
    let text = 0;
    let links = 0;
    if (!n.out) {
      const inLink = link || n.name === "a";
      for (const k of n.kids) {
        if (typeof k === "string") {
          const len = decode(k).replace(/\s+/g, " ").trim().length;
          if (inLink) links += len; else text += len;
        } else {
          const w = weigh(k, inLink);
          text += w.text;
          links += w.links;
        }
      }
    }
    const w = { text, links };
    weight.set(n, w);
    return w;
  };
  weigh(root, false);
  // Then what is chrome by its name, unless it holds half the page's words, and the words weighed again without it.
  const page = weight.get(root)!.text;
  each(root, (n) => { if (n !== root && chromeName(n) && weight.get(n)!.text < page / 2) n.out = true; });
  weigh(root, false);
  // The body, through what is in: one inside something out was never weighed. An element never weighed has no words.
  const find = (n: PageNode, name: string): PageNode | null => {
    if (n.name === name) return n;
    if (n.out) return null;
    for (const k of n.kids) if (typeof k !== "string") { const f = find(k, name); if (f) return f; }
    return null;
  };
  const words = (n: PageNode) => weight.get(n)?.text ?? 0;
  let part = find(root, "body") ?? root;
  for (;;) {
    const total = words(part);
    let best: PageNode | null = null;
    for (const k of part.kids) if (typeof k !== "string" && !k.out && (!best || words(k) > words(best))) best = k;
    if (!best || TEXTUAL.has(best.name) || words(best) < DOMINANT * total) break;
    part = best;
  }
  if (part.out || words(part) < MIN_PART) return null;
  // Inside it, a block of more words in links than out of them, and not many of either, is a list of links.
  const linky = (n: PageNode) => {
    const w = weight.get(n);
    return Boolean(w && BLOCK_TAGS.has(n.name) && w.links > w.text && w.text < MIN_PART);
  };
  const write = (n: PageNode): string => {
    if (n.out || (n !== part && linky(n))) return "";
    const inner = n.kids.map((k) => (typeof k === "string" ? k : write(k))).join("");
    if (n.name === "#root") return inner;
    if (VOID_TAGS.has(n.name)) return `<${n.name}${n.attrs}>`;
    return `<${n.name}${n.attrs}>${inner}</${n.name}>`;
  };
  return write(part);
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

// Ness's job pages (ness-tech.co.il/careers/job/<n>) fill in their posting from the site's job service, which its
// robots.txt leaves open and the portals check reads for the list (boards.ts): the job's title, then its description,
// its lines broken at <BR>, and its day ("05/11/2026").
export const nessApi = (url: string) => {
  const m = /^https?:\/\/(?:www\.)?ness-tech\.co\.il\/careers\/job\/(\d{1,9})(?:[/?#]|$)/.exec(url);
  return m ? `https://www.ness-tech.co.il/careers/api/Careers/GetOrderDetails/?orderId=${m[1]}` : "";
};
export function nessPosting(json: string): Found | null {
  let j: any;
  try { j = JSON.parse(json); } catch { return null; }
  const body = decode(str(j?.posDescription));
  if (!body.replace(/<[^>]+>/g, "").trim()) return null;
  const title = str(j.title).replace(/[<>&]/g, " ");
  const posted = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str(j.lastUpdated).trim());
  return {
    html: `<h1>${title}</h1><p>${body.replace(/<br\s*\/?>/gi, "</p><p>")}</p>`,
    facts: clean<Facts>({ posted: posted ? `${posted[3]}-${posted[2].padStart(2, "0")}-${posted[1].padStart(2, "0")}` : undefined }),
  };
}

// Sites whose job's page draws the job in the browser, or keeps its words hidden until a click, from one list of
// all their open jobs, the one the portals check reads (boards.ts): the job is read from that list, and a job the
// list no longer has is closed.
// - Elbit (elbitsystemscareer.com/job?jid=<n>, ELBIT_FILE): its title, words, requirements and skills (escaped for
//   HTML) and its first day.
// - Bezeq (bezeq.co.il/career/jobs/form/?jobs=<n>, BEZEQ_JOBS): its title, area, words (HTML or text), first day and
//   last day to apply ("05/12/2026").
export type Listed = { file: string; name: string; read: (body: string) => Found | "closed" | null };
export function listedJob(url: string): Listed | null {
  const elbit = /^https?:\/\/(?:www\.)?elbitsystemscareer\.com\/job\?jid=(\d{1,9})(?:[&#]|$)/.exec(url);
  if (elbit) return { file: ELBIT_FILE, name: "Elbit's list", read: (body) => elbitPosting(body, Number(elbit[1])) };
  const bezeq = /^https?:\/\/(?:www\.)?bezeq\.co\.il\/career\/jobs\/form\/\?jobs=(\d{1,9})(?:[&#]|$)/.exec(url);
  if (bezeq) return { file: BEZEQ_JOBS, name: "Bezeq's list", read: (body) => bezeqPosting(body, Number(bezeq[1])) };
  const gov = /^https:\/\/merkava\.mrp\.gov\.il\/giusp\/index\.html\?position=(\d{1,12})(?:[&#]|$)/.exec(url);
  if (gov) return { file: GOV_FEED, name: "the civil service's list", read: (body) => govPosting(body, gov[1]) };
  const mod = /^https:\/\/jobs\.mod\.gov\.il\/\?tender=(\d{1,9})(?:[&#]|$)/.exec(url);
  if (mod) return { file: MOD_JOBS, name: "the Ministry of Defense's list", read: (body) => modPosting(body, Number(mod[1])) };
  return null;
}
// HOT's jobs (hot.net.il/heb/careersearch/?pip-job=JB-<n>, boards.ts HOT_JOBS) come from a service that answers only a
// POST, which the posting reader sends (ranker.ts): the job's title, place and its words (brief, detailed, what it asks).
export const hotJob = (url: string) => /^https:\/\/www\.hot\.net\.il\/heb\/careersearch\/\?pip-job=(JB-\d{1,6})$/.exec(url)?.[1] ?? null;
export function hotPosting(answer: string, id: string): Found | "closed" | null {
  let jobs: any[];
  try { jobs = hotVacancies(answer); } catch { return null; }
  if (!jobs.length) return null;
  const v = jobs.find((x) => str(x?.vacancyName) === id);
  if (!v) return "closed";
  const words = [v.briefDescription, v.detailedDescription, v.jobRequirements].map((s) => str(s).trim()).filter(Boolean);
  if (!words.length) return null;
  const esc = (s: unknown) => str(s).replace(/[<>&]/g, " ");
  return { html: `<h1>${esc(v.jobTitle)}</h1><p>${esc(v.location)}</p>${words.map((w) => `<div>${w}</div>`).join("")}`, facts: {} };
}
// - The Ministry of Defense (jobs.mod.gov.il/?tender=<Id>, MOD_JOBS): the tender's title, place, summary (its lines
//   joined by "|"), the education and experience it asks for, its first day and its last.
export function modPosting(json: string, id: number): Found | "closed" | null {
  const jobs = listOf(json, (o) => o?.Data);
  if (!jobs) return null;
  const t = jobs.find((x) => x?.Id === id);
  if (!t) return "closed";
  const job = t.BankJob?.HrJob ?? {};
  const esc = (v: unknown) => str(v).replace(/[<>&]/g, " ");
  const lines = (v: unknown) => esc(v).split(/\||\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${l}</p>`).join("");
  const words = [job.GeneralSummary, job.Education, job.Experience].map(lines).filter(Boolean);
  if (!words.length) return null;
  return {
    html: `<h1>${esc(t.BankJob?.JobName ?? job.JobName)}</h1><p>${esc(job.JobAreaDescription)}</p>${words.join("")}`,
    facts: clean<Facts>({ posted: day(t.TenderPublish?.StartDate), deadline: day(t.NomineesApplyingDate) }),
  };
}
// - The civil service (merkava.mrp.gov.il/giusp/index.html?position=<RequestId>, GOV_FEED): the tender's title, place,
//   words (its description, requirements and remarks, broken at <br>), first day and last day to apply.
export function govPosting(json: string, id: string): Found | "closed" | null {
  const jobs = listOf(json, (o) => o?.d?.results);
  if (!jobs) return null;
  const j = jobs.find((x) => str(x?.RequestId) === id);
  if (!j) return "closed";
  const esc = (v: unknown) => str(v).replace(/[<>&]/g, " ");
  const words = [j.JobDes, j.JobRequirements, j.JobRemarks].map((v) => str(v).trim()).filter(Boolean);
  if (!words.length) return null;
  return {
    html: `<h1>${esc(j.TenderName || j.JobName)}</h1><p>${esc(j.OfficeName)}, ${esc(j.LocationName || j.Area)}</p>${words.map((w) => `<div>${w}</div>`).join("")}`,
    facts: clean<Facts>({ posted: odataDay(j.TenderPublicationDate) || undefined, deadline: odataDay(j.LastSubmittingDate) || undefined }),
  };
}
const listOf = (json: string, at: (o: any) => unknown) => {
  let parsed: any;
  try { parsed = at(JSON.parse(json)); } catch { return null; }
  return Array.isArray(parsed) && parsed.length ? parsed : null;
};
const ddmmyyyy = (v: unknown) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str(v).trim());
  return m && m[3] !== "1900" ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
};
export function elbitPosting(json: string, id: number): Found | "closed" | null {
  const jobs = listOf(json, (o) => o);
  if (!jobs) return null;
  const j = jobs.find((x) => x?.jobId === id);
  if (!j) return "closed";
  const parts = [j.description, j.requirements, j.skills].map((s) => decode(str(s))).filter((s) => s.replace(/<[^>]+>/g, "").trim());
  if (!parts.length) return null;
  const title = str(j.jobTitle).replace(/[<>&]/g, " ");
  return { html: `<h1>${title}</h1>${parts.map((p) => `<div>${p}</div>`).join("")}`, facts: clean<Facts>({ posted: day(j.openDate) }) };
}
export function bezeqPosting(json: string, id: number): Found | "closed" | null {
  const jobs = listOf(json, (o) => o?.data);
  if (!jobs) return null;
  const j = jobs.find((x) => x?.order_id === id);
  if (!j) return "closed";
  const esc = (v: unknown) => str(v).replace(/[<>&]/g, " ");
  const words = j.is_html_notes === 1 && str(j.notes).trim() ? str(j.notes) : `<p>${esc(j.notes_text).replace(/\n+/g, "</p><p>")}</p>`;
  if (!words.replace(/<[^>]+>/g, "").trim()) return null;
  return {
    html: `<h1>${esc(j.tat_profession_name || j.description)}</h1><p>${esc(j.work_area || j.living_area1)}</p>${words}`,
    facts: clean<Facts>({ posted: day(j.orderDate), deadline: ddmmyyyy(j.deadline_date) }),
  };
}

// A job from a list written out in full (boards.ts textBlocks): its own block of the list's page, found by its id. A
// list that still reads but no longer has it has closed it; a page where the list's pattern finds nothing says
// nothing about the job.
export function textPosting(html: string, job: { list: TextList; id: string }): Found | "closed" | null {
  const blocks = textBlocks(html, job.list);
  if (!blocks.length) return null;
  const block = blocks.find((b) => b.id === job.id);
  return block ? { html: block.html, facts: {} } : "closed";
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
