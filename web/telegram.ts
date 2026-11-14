// The public Telegram channels of job posts on the portals page (portals.ts channel), read with no AI: each channel's
// page of newest posts (t.me/s/<channel>), the posts of the last two weeks, and in each the jobs it names. Before
// this the daily run's agent read them with WebFetch, at the cost of a model reading every page.
//
// A post comes one of two ways. Some channels list jobs in a fixed form, a title and under it a line with the company
// after 🏢 and the place after 📍, several to a post; each is a job of its own, its link the post's with ?job=<n>
// after it (its place in the post), so that two jobs of one post stay two (the job list keys a job by its link, and a post's reader takes
// the link as it is, posting-read.ts telegramEmbed). The rest are free text: the post is one job, its title the first
// line in the roles' field, its company and place where the post names them ("חברה:", "Company:", 🏢, 📍), or else
// the place by a name the settings' areas know. Only jobs whose title is in the roles' field are kept, as with an
// employer's own list (boards.ts), and the post's text is never followed anywhere: links in it stay where they are.
import { text } from "./boards";
import { titleMatches } from "./roles";

export type ChannelJob = { title: string; company: string; location: string; date: string; url: string };

const DAY = 86_400_000;
const POST_DAYS = 14;
// The mark a line opens with in a list (an emoji, a bullet, a dash), and the marks of a fixed-form job's line.
const LEAD = /^[\s\p{Extended_Pictographic}\p{So}‍️•▪◾◽▫️\-–—*·|:]+/u;
const COMPANY_MARK = "🏢";
const PLACE_MARK = "📍";
const COMPANY_LINE = /^(?:חברה|החברה|מעסיק|company|employer)\s*[:：-]\s*(.+)$/i;
const PLACE_LINE = /^(?:מיקום|איפה|אזור|location|where)\s*[:：-]\s*(.+)$/i;
const MAX_TITLE = 140;
// A free-text post about an event, not a job: a lecture, a webinar, a meetup.
const EVENT = /הרצאה|הרצאות|וובינר|מיטאפ|כנס|סדנה|webinar|meetup|lecture|workshop|conference/i;
// "Telephony Network Engineer, TSM at NICE": the company a title names at its end, when the post names none.
const AT_COMPANY = /\s(?:at|@|ב-)\s?([A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*){0,3})\s*$/;

const clean = (line: string) => line.replace(LEAD, "").trim();

// A post's text, a line at a time: its markup gone, each <br> a line of its own, no invisible or direction marks.
export function postLines(html: string) {
  return html.replace(/&(?:lrm|rlm|zwj|zwnj);/gi, "").split(/<br\s*\/?>/i).map((piece) => text(piece, 400)).filter(Boolean);
}

// A way to apply that a free-text post names: a link, an address to write to, or words that ask for a CV. The
// search settings count a post only when it has one (a post about a lecture names none).
const APPLY = /href="https?:|[\w.+-]+@[\w-]+\.[\w.]+|\bapply\b|\bcv\b|resume|להגשה|להגיש|הגשת|קו"ח|קורות חיים|שלחו|לשלוח|מגייס|מגייסת|מגייסים|דרוש|דרושה|דרושים|hiring/i;

// The company and the place on a fixed-form job's line: "🏢 IAI · 📍 Lod".
function marked(line: string) {
  const company = line.includes(COMPANY_MARK) ? clean(line.split(COMPANY_MARK)[1].split(/[·|]|📍/)[0]) : "";
  const place = line.includes(PLACE_MARK) ? clean(line.split(PLACE_MARK)[1].split(/[·|]/)[0]) : "";
  return { company, place };
}

// The jobs one post names, by the roles' field words (roles.ts fieldWords, which leave out the words that only say a
// level), and places is every name the settings' areas know, for a free-text post's place.
export function postJobs(lines: string[], field: string[], places: string[] = []) {
  const inField = (title: string) => !field.length || titleMatches(title, field);
  // The fixed form: a title, and right under it the company and the place. n is the job's place in the post, before
  // any is left out, so that its link stays the same whatever the roles are.
  const listed: { title: string; company: string; location: string; n?: number }[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i + 1].includes(COMPANY_MARK) || lines[i].includes(COMPANY_MARK)) continue;
    const { company, place } = marked(lines[i + 1]);
    const placeLine = !place && lines[i + 2]?.includes(PLACE_MARK) ? marked(lines[i + 2]).place : "";
    listed.push({ title: clean(lines[i]).slice(0, MAX_TITLE), company, location: place || placeLine, n: listed.length + 1 });
  }
  if (listed.length) return listed.filter((j) => j.title && inField(j.title));
  // Free text: one job, its title the first line in the field; none for a post about an event.
  const title = lines.map(clean).find((l) => l.length > 2 && l.length <= MAX_TITLE && inField(l));
  if (!title || EVENT.test(title)) return [];
  let company = "";
  let location = "";
  for (const line of lines) {
    const bare = clean(line);
    if (!company) company = line.includes(COMPANY_MARK) ? marked(line).company : bare.match(COMPANY_LINE)?.[1]?.trim() ?? "";
    if (!location) location = line.includes(PLACE_MARK) ? marked(line).place : bare.match(PLACE_LINE)?.[1]?.trim() ?? "";
  }
  if (!company) company = title.match(AT_COMPANY)?.[1] ?? "";
  if (!location) {
    const all = lines.join(" ").toLowerCase();
    location = places.find((p) => p.length > 2 && all.includes(p.toLowerCase())) ?? "";
  }
  return [{ title, company: company.slice(0, 80), location: location.slice(0, 80) } as { title: string; company: string; location: string; n?: number }];
}

// A channel's page: its posts of the last two weeks (now for today), and the jobs each names.
export function channelJobs(html: string, field: string[], places: string[] = [], now = Date.now()): ChannelJob[] {
  const out: ChannelJob[] = [];
  for (const piece of html.split(/<div class="tgme_widget_message_wrap/).slice(1)) {
    const post = /data-post="([A-Za-z0-9_]{3,64})\/(\d{1,12})"/.exec(piece);
    const when = /<time[^>]*datetime="([^"]+)"/.exec(piece)?.[1] ?? "";
    const body = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(piece)?.[1] ?? "";
    if (!post || !body) continue;
    const at = Date.parse(when);
    if (!Number.isFinite(at) || now - at > POST_DAYS * DAY) continue;
    const lines = postLines(body);
    const listed = lines.some((l) => l.includes(COMPANY_MARK));
    if (!listed && !APPLY.test(body)) continue;
    const link = `https://t.me/${post[1]}/${post[2]}`;
    for (const { n, ...job } of postJobs(lines, field, places)) out.push({ ...job, date: new Date(at).toISOString().slice(0, 10), url: n ? `${link}?job=${n}` : link });
  }
  return out;
}

// The channel's name from its page's address on the portals page (t.me/s/<name>).
export const channelName = (url: string) => /t\.me\/s\/([A-Za-z0-9_]{3,64})/.exec(url)?.[1] ?? "";
