// Pip's emails as pages (Sean 2026-11-20: "אתה יכול לעצב את המיילים שנשלחים בצורה הרבה יותר טובה?"), sent beside their
// plain words (send_mail.py), which a mail program without pages shows instead. In the site's look: a white card on a
// pale ground, Pip in his pixel blocks at its top beside his name, a big line saying what came, the jobs as cards with
// their place and day and a round mint button to open each, and a quiet line at the foot. Mail programs keep only
// simple markup, so it is tables with the styles written on each element, no pictures to load (Pip is a table of
// coloured cells), and no scripts. Everything that comes from a job or the agent is escaped, and a link is kept only
// when it is a web page's.
import { ICON, ICON_COLORS } from "./ui/pip";

export type Lang = "he" | "en";

const INK = "#0f1419";
const INK_2 = "#536471";
const INK_3 = "#7b8a96";
const LINE = "#e1e8ed";
const GROUND = "#f3f5f4";
const ACCENT = "#137c60";
const MINT = "#b9f4e4";
const MINT_INK = "#1a212e";
const SOFT = "#f7f9f9";
const WARN_SOFT = "#fff8e1";
const WARN = "#a86b00";
const FONT = "'Rubik', 'Segoe UI', Arial, Helvetica, sans-serif";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// A web page's address, else nothing.
export const webLink = (url: unknown) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(url ?? "").trim()) ? String(url).trim() : "");
const side = (lang: Lang) => (lang === "he" ? "right" : "left");
// Which way a piece of text runs, by most of its letters: right to left when at least half are Hebrew. Mail programs
// don't all keep dir="auto", so each piece from a job or the agent gets its direction written out. A title or a place
// stays on the page's side, so a card's lines keep one edge; the agent's words, a paragraph or a list, go to their own.
const isRtl = (text: string, lang: Lang) => {
  const hebrew = (text.match(/\p{Script=Hebrew}/gu) ?? []).length;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return letters ? hebrew * 2 >= letters : lang === "he";
};
const flow = (text: string, lang: Lang) => (isRtl(text, lang) ? `dir="rtl"` : `dir="ltr"`);
const along = (text: string, lang: Lang) => `text-align:${isRtl(text, lang) ? "right" : "left"};`;

// Pip as his icon's blocks, each a cell of its colour, a dot an empty one.
function pip(block = 5) {
  const rows = ICON.map((row) => `<tr>${[...row].map((key) => {
    const color = ICON_COLORS[key];
    return `<td width="${block}" height="${block}" style="width:${block}px;height:${block}px;padding:0;font-size:0;line-height:0;${color ? `background:${color};` : ""}"${color ? ` bgcolor="${color}"` : ""}></td>`;
  }).join("")}</tr>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="ltr" style="border-collapse:collapse;">${rows}</table>`;
}

// A round mint button, as the site's main buttons are, its words and arrow pointing on in the page's direction.
export function button(label: string, url: string, lang: Lang) {
  const href = webLink(url) || (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) ? url : "");
  if (!href) return "";
  const arrow = lang === "he" ? "&larr;" : "&rarr;";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td bgcolor="${MINT}" style="background:${MINT};border-radius:999px;">`
    + `<a href="${esc(href)}" style="display:inline-block;padding:9px 18px;font-family:${FONT};font-size:14px;font-weight:700;color:${MINT_INK};text-decoration:none;border-radius:999px;">${esc(label)} ${arrow}</a>`
    + `</td></tr></table>`;
}

// A small rounded label: a job's day, its group, a score.
export function chip(text: string, tone: "plain" | "green" | "amber" = "plain") {
  const [bg, fg] = tone === "green" ? ["#e8f8f2", ACCENT] : tone === "amber" ? [WARN_SOFT, WARN] : [SOFT, INK_2];
  return `<span style="display:inline-block;margin:0 3px 4px;padding:3px 10px;border-radius:999px;background:${bg};color:${fg};font-family:${FONT};font-size:12px;font-weight:600;line-height:18px;">${esc(text)}</span>`;
}

// A section's name over its cards, with how many are in it.
export function sectionHead(name: string, count: number | null, lang: Lang) {
  return `<tr><td style="padding:22px 28px 8px;text-align:${side(lang)};font-family:${FONT};font-size:13px;font-weight:700;color:${ACCENT};">${esc(name)}${count != null ? ` <span style="color:${INK_3};font-weight:500;">(${count})</span>` : ""}</td></tr>`;
}

// One job as a card: its title (a link to its page), the company and the place, its chips, more words, a button.
export function jobCard(o: { title: string; company?: string; location?: string; url?: string; chips?: string[]; note?: { text: string; html: string }; action?: string; lang: Lang }) {
  const place = `${o.company ?? ""} ${o.location ?? ""}`;
  const href = webLink(o.url);
  const title = href ? `<a href="${esc(href)}" style="color:${INK};text-decoration:none;">${esc(o.title)}</a>` : esc(o.title);
  const where = [o.company, o.location].map((s) => String(s ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).map(esc).join(` <span style="color:${LINE};">|</span> `);
  return `<tr><td style="padding:6px 28px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${LINE};border-radius:14px;"><tr><td style="padding:16px 18px;text-align:${side(o.lang)};">`
    + `<div ${flow(o.title, o.lang)} style="text-align:${side(o.lang)};font-family:${FONT};font-size:17px;font-weight:700;line-height:1.35;color:${INK};">${title}</div>`
    + (where ? `<div ${flow(place, o.lang)} style="text-align:${side(o.lang)};margin-top:4px;font-family:${FONT};font-size:14px;line-height:1.5;color:${INK_2};">${where}</div>` : "")
    + (o.chips?.length ? `<div style="margin-top:10px;">${o.chips.join("")}</div>` : "")
    + (o.note ? `<div ${flow(o.note.text, o.lang)} style="${along(o.note.text, o.lang)}margin-top:12px;padding:12px 14px;border-radius:10px;background:${SOFT};font-family:${FONT};font-size:13.5px;line-height:1.6;color:${INK_2};">${o.note.html}</div>` : "")
    + (o.action && href ? `<div style="margin-top:14px;">${button(o.action, href, o.lang)}</div>` : "")
    + `</td></tr></table></td></tr>`;
}

// A box of words in amber, for what went wrong.
export function warnBox(title: string, lines: string[], lang: Lang) {
  return `<tr><td style="padding:14px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-radius:12px;background:${WARN_SOFT};"><tr><td style="padding:14px 18px;text-align:${side(lang)};font-family:${FONT};font-size:13.5px;line-height:1.6;color:${WARN};">`
    + `<div style="font-weight:700;margin-bottom:4px;">${esc(title)}</div>${lines.map((l) => `<div ${flow(l, lang)} style="${along(l, lang)}">${esc(l)}</div>`).join("")}</td></tr></table></td></tr>`;
}

// A plain paragraph in the card.
export function para(html: string, lang: Lang, o: { muted?: boolean; top?: number } = {}) {
  return `<tr><td style="padding:${o.top ?? 10}px 28px 0;text-align:${side(lang)};font-family:${FONT};font-size:15px;line-height:1.6;color:${o.muted ? INK_2 : INK};">${html}</td></tr>`;
}

// What the agent wrote, as words for a card's note: bold where it marked it, its list lines with a dot, each line its
// own; text is the words alone, for their direction.
export function agentWords(text: string) {
  const html = esc(text.trim()).split("\n").map((line) => line
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/^\s*[-*]\s+/, "&bull; ")
    .replace(/^#{1,6}\s+(.*)$/, "<b>$1</b>")).join("<br>");
  return { text, html };
}

// The whole page: the ground, the card with Pip and his name and the kind of email, the big line and the one under
// it, the parts (rows of the card's table, from the helpers above), a link at the card's foot, and the quiet line
// under the card. preheader is what a mail list shows after the subject.
export function mailPage(o: { lang: Lang; kind: string; title: string; lead?: string; parts?: string[]; link?: { label: string; url: string }; footer: string; preheader?: string }) {
  const dir = o.lang === "he" ? "rtl" : "ltr";
  const s = side(o.lang);
  const name = o.lang === "he" ? "פיפ" : "Pip";
  const link = o.link && (webLink(o.link.url) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(o.link.url))
    ? `<tr><td style="padding:22px 28px 0;text-align:${s};font-family:${FONT};font-size:14px;"><a href="${esc(o.link.url)}" style="color:${ACCENT};font-weight:600;text-decoration:none;">${esc(o.link.label)}</a></td></tr>` : "";
  return `<!doctype html><html lang="${o.lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.title)}</title></head>`
    + `<body dir="${dir}" style="margin:0;padding:0;background:${GROUND};">`
    + (o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(o.preheader)}</div>` : "")
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="background:${GROUND};"><tr><td align="center" style="padding:28px 12px;">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:100%;max-width:600px;border-collapse:separate;background:#ffffff;border-radius:18px;" bgcolor="#ffffff">`
    + `<tr><td style="padding:24px 28px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="${dir}"><tr>`
    + `<td style="vertical-align:middle;">${pip()}</td>`
    + `<td style="vertical-align:middle;padding-${s}:12px;text-align:${s};font-family:${FONT};"><div style="font-size:18px;font-weight:800;color:${INK};line-height:1.2;">${name}</div><div style="font-size:13px;color:${INK_3};line-height:1.4;">${esc(o.kind)}</div></td>`
    + `</tr></table></td></tr>`
    + `<tr><td style="padding:22px 28px 0;text-align:${s};font-family:${FONT};font-size:26px;font-weight:700;line-height:1.25;color:${INK};">${esc(o.title)}</td></tr>`
    + (o.lead ? `<tr><td style="padding:8px 28px 10px;text-align:${s};font-family:${FONT};font-size:15px;line-height:1.6;color:${INK_2};">${esc(o.lead)}</td></tr>` : "")
    + (o.parts ?? []).join("")
    + link
    + `<tr><td style="padding:28px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>`
    + `</table>`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;"><tr><td style="padding:16px 28px 0;text-align:${s};font-family:${FONT};font-size:12px;line-height:1.6;color:${INK_3};">${esc(o.footer)}</td></tr></table>`
    + `</td></tr></table></body></html>`;
}
