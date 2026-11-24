// Shared building blocks. Text from postings and from the agent always goes in as text, never as HTML.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Archive, ArchiveRestore, ArrowLeftRight, ArrowUp, Award, Bookmark, BookOpenText, BriefcaseBusiness, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, CircleEllipsis, Clapperboard, Cpu, createLucideIcon, Download, Ellipsis, ExternalLink, Feather, FileText, Folder, FolderGit2, FolderInput, FolderOpen, FolderPlus, Gauge,
  Gem, Globe, GraduationCap, Palette, LayoutGrid, Leaf, Link, ListChecks, LogIn, LogOut, Mail, MapPin, MessageCircle, MessageCircleDashed, Mic, Minus, Moon, PanelLeft, PanelRight, Pause, Pencil, Phone, Pin, PinOff, Play, Plus, RefreshCw, Search, Send, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal,
  Bell, Sparkles, Square, SquarePen, Sun, Trash2, TriangleAlert, Upload, User, UserPlus, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { translate, type Lang } from "./i18n";

export type ApiError = Error & { code?: string; params?: Record<string, string | number>; status?: number };

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch (err) {
    // Nothing answered: the program isn't running (app.tsx's Offline).
    if ((err as Error).name !== "AbortError") dispatchEvent(new Event("pip-offline"));
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  // The server restarted or the session ended, so the login comes back.
  if (res.status === 401 && data.error === "login_required" && path !== "me") dispatchEvent(new Event("pip-login-required"));
  // From a phone, the site answered for the computer: it is off, or Pip isn't running on it (site/server.ts).
  if (data.error === "pc_offline" || data.error === "pc_no_answer") dispatchEvent(new Event("pip-offline"));
  if (!res.ok) {
    const err: ApiError = new Error(data.error || String(res.status));
    err.code = String(data.error ?? "").replaceAll(" ", "_");
    err.params = data.params ?? {};
    err.status = res.status;
    throw err;
  }
  return data;
}

// Words a server error in the reader's language. An unknown code shows as it came.
export function errorText(err: ApiError, lang: Lang) {
  const known = err.code && translate(lang, `errors.${err.code}`, err.params);
  if (known && known !== `errors.${err.code}`) return known;
  return err.status && !err.code ? translate(lang, "errors.generic", { status: err.status }) : err.message;
}

export const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

// The app's pages are addresses of their own (/jobs, /chat/<id>) in its one page, which shows the one the address
// names (app.tsx). Going to one in the page, as its links do: a new step in the browser's history, or in place of
// this one; App hears of it (ROUTED) as it does of Back and Forward.
export const ROUTED = "pip-routed";
export function goTo(path: string, replace = false) {
  history[replace ? "replaceState" : "pushState"](null, "", path);
  dispatchEvent(new Event(ROUTED));
}

// Values side by side on one line, a company, a place and a date, kept apart by a space wider than a word's and
// nothing drawn in it: a mark between them reads as clutter.
export function Spaced({ parts }: { parts: React.ReactNode[] }) {
  return <>{parts.map((p, i) => <React.Fragment key={i}>{i > 0 && <span className="spaced-gap" aria-hidden="true" />}{p}</React.Fragment>)}</>;
}

export function External({ url, className = "btn", children }: { url: string; className?: string; children: React.ReactNode }) {
  const href = safeUrl(url);
  return href ? <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : null;
}

// A computer rather than a phone or a tablet: it can hover, or its pointer is fine.
export const isComputer = () => !matchMedia("(hover: none) and (pointer: coarse)").matches;
// What a computer runs, for the installer to offer: "windows", "mac", or "" for anything else.
export function desktopSystem(): "windows" | "mac" | "" {
  const platform = String((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "").toLowerCase();
  return platform.startsWith("win") ? "windows" : platform.startsWith("mac") ? "mac" : "";
}
// The command that installs Pip on a Mac from the site this page is on (install.sh there), to paste into Terminal.
export const macCommand = () => `curl -fsSL ${location.origin}/install.sh | bash`;
// Whether the browser let it onto the clipboard.
export const copyText = (text: string) => navigator.clipboard.writeText(text).then(() => true, () => false);

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "" | "primary" | "cta" | "danger" | "ghost" };
export const Btn = ({ kind = "", className = "", type = "button", ...rest }: BtnProps) => <button type={type} className={`btn ${kind} ${className}`} {...rest} />;

export const Card = ({ className = "", ...rest }: React.HTMLAttributes<HTMLElement>) => <section className={`card ${className}`} {...rest} />;
export const Spinner = () => <span className="spinner" aria-hidden="true" />;

export function Page({ title, sub, actions, wide, children }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; wide?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`page ${wide ? "wide" : ""}`}>
      <header className="page-head">
        <div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>
        {actions && <div className="row">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export const Badge = ({ tone = "", children }: { tone?: string; children: React.ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;

export function Field({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <small className="note">{hint}</small>}</label>;
}

// A small Markdown reader that builds elements, so nothing the agent writes is parsed as HTML. A link may point to a
// web page or, as the agent sometimes writes one, to a file here, in angle brackets or not.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:<[^>\n]+>|[^)\s]+)\)|<https?:\/\/[^>\s]+>|https?:\/\/[^\s)<>]+|\*[^*\s][^*]*\*)/g;

// A document of the project an answer names, as the page can open it (data.ts resolveDocument): the path from "user/"
// on, whatever came before it (an absolute path, a drive), its spaces written out or not.
const OPENABLE = /(?:^|\/)(user\/(?:(?:cv|cover_letters|reports)\/[^/]+\.(?:pdf|html)|documents\/applications\/[A-Za-z0-9_-]+\/[^/]+\.pdf))$/i;
function documentHref(target: string) {
  let p = target;
  try { p = decodeURIComponent(target); } catch { /* as it is */ }
  const m = p.replaceAll("\\", "/").match(OPENABLE);
  return m ? `/file?path=${encodeURIComponent(m[1])}` : "";
}
// A path to a file, folders and all, with no command around it: "user/documents/applications/x/Dana Levi - Resume.pdf".
const FILE_PATH = /^(?:[A-Za-z]:[\\/]|\/)?(?:[\w.@-]+[\\/])+[^\\/\n]+\.[A-Za-z0-9]{1,5}$/;
// In a chat answer, what the page can't draw or the user shouldn't have to read: a maqaf, which the user asked never to
// see, is a space, and a dash between words a comma (Sean's rule for everything written to him); a line break in HTML
// is a space.
const tidy = (s: string) => s.replace(/־/g, " ").replace(/\s+[—–]\s+/g, ", ").replace(/<br\s*\/?>/gi, " ");

// chat: a chat answer's (Markdown's chat), where a path or a link to a file shows as the file's name, opening it when
// the page can, and the words are tidied.
function inlineOf(text: string, key = "", chat = false): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const words = (s: string) => (chat ? tidy(s) : s);
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(words(text.slice(last, m.index)));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{inlineOf(t.slice(2, -2), k, chat)}</strong>);
    else if (t.startsWith("`")) {
      const code = t.slice(1, -1);
      const href = chat && FILE_PATH.test(code) ? documentHref(code) : "";
      const name = chat && FILE_PATH.test(code) ? code.split(/[\\/]/).pop()! : code;
      out.push(href ? <a key={k} className="md-file" href={href} target="_blank" rel="noopener noreferrer" dir="auto">{name}</a> : <code key={k} dir="ltr">{name}</code>);
    } else if (t.startsWith("[")) {
      const [, label, raw] = t.match(/^\[([^\]]+)\]\((.+)\)$/)!;
      const url = raw.replace(/^<|>$/g, "");
      // A file here opens when the page can open it, and is otherwise only its label, never its path.
      const href = /^https?:/i.test(url) ? url : documentHref(url);
      out.push(href ? <a key={k} href={href} target="_blank" rel="noopener noreferrer">{inlineOf(label, k, chat)}</a> : <span key={k}>{inlineOf(label, k, chat)}</span>);
    } else if (t.startsWith("<")) out.push(<a key={k} href={t.slice(1, -1)} target="_blank" rel="noopener noreferrer" dir="ltr">{t.slice(1, -1)}</a>);
    else if (t.startsWith("http")) out.push(<a key={k} href={t} target="_blank" rel="noopener noreferrer" dir="ltr">{t}</a>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(words(text.slice(last)));
  return out;
}

const isTableRule = (line = "") => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line);
const LIST_MARK = /^\s*([-*]|\d+\.)\s+/;
const isList = (line: string) => LIST_MARK.test(line);
const indentOf = (line: string) => line.match(/^\s*/)![0].replace(/\t/g, "  ").length;
// A list item's box, "[ ]" or "[x]", as a mark: done or still to do.
const BOX = /^\[([ xX])\]\s+/;

// dir "rtl": words in Hebrew (a conversation in Hebrew), where every block with a Hebrew word in it reads from the
// right and every list keeps its bullets there, even one whose items start with an English name or a link, as a list
// of sources does (Sean 2026-11-17: "במקורות ביקשתי שזה תמיד יהיה מצד ימין אם השיחה בעברית"). Otherwise each block
// goes by its own first letter (dir="auto"), and a list by most of its items.
// chat: a chat answer (chat.tsx), whose paths and file links show as file names and whose words are tidied (inline).
export function Markdown({ src, className = "md", dir, chat = false }: { src: string; className?: string; dir?: string; chat?: boolean }) {
  const lines = src.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  const blockDir = (text: string) => (dir === "rtl" && HEBREW.test(text) ? "rtl" : "auto");
  const inline = (text: string, key = "") => inlineOf(text, key, chat);
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const k = String(i);
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    // Five and six hashes are headings too, drawn as the smallest, where they once showed as the hashes themselves.
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 1, 4)}` as "h2";
      blocks.push(<Tag key={k} dir={blockDir(heading[2])}>{inline(heading[2], k)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { blocks.push(<hr key={k} />); i++; continue; }
    if (line.includes("|") && isTableRule(lines[i + 1])) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) body.push(cells(lines[i++]));
      blocks.push(<div key={k} className="tablebox"><table>
        <thead><tr>{head.map((c, j) => <th key={j} dir={blockDir(c)}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
        <tbody>{body.map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n} dir={blockDir(c)}>{inline(c, `${k}${j}-${n}`)}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }
    if (isList(line)) {
      // Items at the first item's depth; one indented under an item is its sub-item, one level deep (deeper ones join
      // it), and an indented line that isn't an item goes on with the item above it. They were all flattened into one
      // list before. A numbered list starts at its first number, so one that goes on after a paragraph or a heading
      // doesn't count from 1 again.
      const base = indentOf(line);
      const ordered = /^\s*\d+\./.test(line);
      const first = Number(line.match(/^\s*(\d+)\./)?.[1] ?? 1);
      type Entry = { text: string; kids: string[]; kidsOrdered: boolean };
      const entries: Entry[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const last = entries[entries.length - 1];
        if (isList(l) && indentOf(l) <= base + 1) entries.push({ text: l.replace(LIST_MARK, ""), kids: [], kidsOrdered: false });
        else if (last && isList(l)) {
          if (!last.kids.length) last.kidsOrdered = /^\s*\d+\./.test(l);
          last.kids.push(l.replace(LIST_MARK, ""));
        } else if (last && l.trim() && indentOf(l) > base) {
          if (last.kids.length) last.kids[last.kids.length - 1] += ` ${l.trim()}`;
          else last.text += ` ${l.trim()}`;
        } else break;
        i++;
      }
      // A list keeps one direction, that of most of its items (the page's on a tie), so its bullets stay on one side; an
      // item in the other language is set apart in its own (Sean 2026-11-12: "שהכל יהיה פה בצד ימין גם הזה של הטקסט
      // האנגלית").
      const dirs = entries.map((e) => langDir(e.text));
      const rtl = dirs.filter((d) => d === "rtl").length;
      const ltr = dirs.filter((d) => d === "ltr").length;
      const page = typeof document !== "undefined" && document.documentElement.dir === "ltr" ? "ltr" : "rtl";
      const side = dir === "rtl" ? "rtl" : rtl > ltr ? "rtl" : ltr > rtl ? "ltr" : dir === "ltr" ? dir : page;
      // In a list read from the right, an item with any Hebrew in it reads from the right too; only one all in another
      // language is set apart in its own. A box ("[x]", "[ ]") is a mark, done or to do, where it once showed as typed.
      const item = (text: string, key: string) => {
        const box = text.match(BOX);
        const words = box ? text.slice(box[0].length) : text;
        const own = langDir(words);
        const apart = side === "rtl" && HEBREW.test(words) ? undefined : own && own !== side ? own : undefined;
        const body = inline(words, key);
        const mark = box ? <span className={`md-box${box[1] === " " ? "" : " done"}`} aria-label={box[1] === " " ? "☐" : "☑"}>{box[1] === " " ? null : <Icon name="check" />}</span> : null;
        return <>{mark}{apart ? <bdi dir={apart}>{body}</bdi> : body}</>;
      };
      const items = entries.map((e, n) => {
        const kids = e.kids.map((kid, j) => <li key={j}>{item(kid, `${k}-${n}-${j}`)}</li>);
        return (
          <li key={n}>
            {item(e.text, `${k}-${n}`)}
            {kids.length > 0 && (e.kidsOrdered ? <ol>{kids}</ol> : <ul>{kids}</ul>)}
          </li>
        );
      });
      blocks.push(ordered ? <ol key={k} dir={side} start={first !== 1 ? first : undefined}>{items}</ol> : <ul key={k} dir={side}>{items}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k} dir={blockDir(quote.join(" "))}>{inline(quote.join(" "), k)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>)/.test(lines[i]) && !isList(lines[i])) {
      if (lines[i].includes("|") && isTableRule(lines[i + 1])) break;
      para.push(lines[i++]);
    }
    if (para.length) blocks.push(<p key={k} dir={blockDir(para.join(" "))}>{inline(para.join(" "), k)}</p>);
    else i++;
  }
  return <div className={className} dir={dir}>{blocks}</div>;
}

// Lucide's house without the line under the door, so the door opens onto the ground. Walls and door are one
// outline, so when filled the door stays open in the background colour.
const House = createLucideIcon("house-open", [
  ["path", { d: "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-4v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8H5a2 2 0 0 1-2-2z", key: "walls" }],
]);

// Lucide's building with its walls drawn first, so when filled the windows and the door, drawn over them, stay open
// in the background colour.
const Office = createLucideIcon("building-front", [
  ["rect", { x: "4", y: "2", width: "16", height: "20", rx: "2", key: "walls" }],
  ["path", { d: "M9 22v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3", key: "door" }],
  ...["M8 6h.01", "M12 6h.01", "M16 6h.01", "M8 10h.01", "M12 10h.01", "M16 10h.01", "M8 14h.01", "M12 14h.01", "M16 14h.01"].map((d, i) => ["path", { d, key: `window-${i}` }] as ["path", Record<string, string>]),
]);

// Lucide's briefcase with its body drawn first, so when filled its seam and clasp, drawn over it, stay open in the
// background colour (.icon-portfolio.filled in the CSS).
const Case = createLucideIcon("briefcase-front", [
  ["rect", { width: "20", height: "14", x: "2", y: "6", rx: "2", key: "body" }],
  ["path", { d: "M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2", key: "handle" }],
  ["path", { d: "M22 13a18.15 18.15 0 0 1-20 0", key: "seam" }],
  ["path", { d: "M12 12h.01", key: "clasp" }],
]);

// Icons from Lucide, an open icon set (ISC licence); only these are bundled.
const ICONS: Record<string, LucideIcon> = {
  home: House, jobs: Search, saved: Bookmark, apps: FileText, chat: MessageCircle, profile: User, settings: Settings,
  rules: ListChecks, tools: LayoutGrid, files: Folder, more: CircleEllipsis, dots: Ellipsis, plus: Plus, sun: Sun, moon: Moon, login: LogIn, logout: LogOut, signup: UserPlus, filters: SlidersHorizontal,
  ai: Sparkles, open: ExternalLink, apply: Send, pin: MapPin, close: X, onward: ChevronLeft, back: ChevronRight, down: ChevronDown, check: Check, minus: Minus, find: Search,
  warn: TriangleAlert, hidden: ArrowLeftRight, temporary: MessageCircleDashed, send: ArrowUp, stop: Square, download: Download, file: FileText, portals: Office, companies: BriefcaseBusiness, refresh: RefreshCw, gauge: Gauge,
  portfolio: Case, repo: FolderGit2, video: Clapperboard, readme: BookOpenText, site: Globe, play: Play, pause: Pause,
  mic: Mic, mail: Mail, phone: Phone, link: Link, school: GraduationCap, edit: Pencil, compose: SquarePen, award: Award,
  "thread-pin": Pin, unpin: PinOff, archive: Archive, unarchive: ArchiveRestore, runs: CalendarClock, trash: Trash2, folder: Folder, "folder-open": FolderOpen,
  "folder-plus": FolderPlus, move: FolderInput, "panel-left": PanelLeft, "panel-right": PanelRight,
  "access-ask": ShieldCheck, "access-auto": Zap, "access-full": ShieldAlert,
  "model-default": Cpu, "model-opus": Gem, "model-sonnet": Feather, "model-haiku": Leaf,
  palette: Palette, bell: Bell, upload: Upload,
};

// filled is for the page you are on: the shape filled in, its inner lines cut out (see .icon.filled in the CSS).
export const Icon = ({ name, filled = false }: { name: string; filled?: boolean }) => {
  const Glyph = ICONS[name];
  return <Glyph className={`icon icon-${name}${filled ? " filled" : ""}`} aria-hidden="true" />;
};

// A button's name floating over it on hover or keyboard focus: the page's own label (.act-label in styles.css), never
// the browser's title= tooltip, and the same pill everywhere: it carries its own font, so the button it sits in can't
// change it. The button needs position: relative, an aria-label of its own, and a place in the .act-label hover rule.
export const ActLabel = ({ children, dir }: { children: React.ReactNode; dir?: string }) => <span className="act-label" dir={dir} aria-hidden="true">{children}</span>;

// The AI's colours, as the sparkles have them on the jobs page (.ai-sky in styles.css): the forest rainbow in clouds
// drifting over the sky's blue, behind whatever stands for the AI, a button or a round mark, and in its shape. orb is
// for a small round one, with five small clouds about its middle.
// In a button, the colours move faster while the pointer is on it or the keyboard is, where they once grew brighter
// (Sean 2026-11-17: "אל תעשה שזה יהיה יותר SATURATED תעשה שהוא יהיה מהיר יותר בפנים"). The speed changes from where
// each cloud is, as the animations' own rate changes, never their place; with reduced motion nothing moves at all.
const SKY_QUICK = 2.6;
export function AiSky({ orb = false }: { orb?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const sky = ref.current;
    const host = sky?.parentElement?.closest<HTMLElement>("button, a, [role='button']");
    if (!sky || !host) return;
    // The rate set once, each cloud going on from where it is. It was eased in over a third of a second by setting it
    // on every frame, and while that went on, newer Chromes (Brave 157) held back every other change the hover made on
    // the same button, its transitions starting only once the easing ended (Sean 2026-11-17: "its still insanely
    // delayed"; measured: 360 ms, against none without it).
    const set = (rate: number) => { for (const a of sky.getAnimations({ subtree: true })) a.updatePlaybackRate(rate); };
    const quick = () => { if (!host.matches(":disabled")) set(SKY_QUICK); };
    const calm = () => set(1);
    const focus = () => { if (host.matches(":focus-visible")) quick(); };
    host.addEventListener("pointerenter", quick);
    host.addEventListener("pointerleave", calm);
    host.addEventListener("focusin", focus);
    host.addEventListener("focusout", calm);
    return () => {
      host.removeEventListener("pointerenter", quick);
      host.removeEventListener("pointerleave", calm);
      host.removeEventListener("focusin", focus);
      host.removeEventListener("focusout", calm);
    };
  }, []);
  return (
    <span ref={ref} className={`ai-sky ${orb ? "orb" : ""}`} aria-hidden="true">
      {Array.from({ length: orb ? 5 : 7 }, (_, i) => <i key={i} />)}
    </span>
  );
}

// A new conversation: the sidebar's call to act, in the place of its main button (Sean 2026-11-17: "הכפתור של השיחה
// חדשה מכוער רצח הוא צריך להיות יותר מיוחד"; "אולי זז בסיבובים כזה עם גלים סוג של ואז כששמים את העכבר זה מתפרש על כל
// הכפתור"; and that its colours should move as the AI's do behind the microphone, not in a straight sweep; first at the
// conversation list's top, then moved here, 2026-11-18: "שם את הכפתור הזה שעשינו ב SIDEBAR הימני"). Its ground is the
// AI's own (AiSky). Over it lies a pill of the page's own colour a little in from the rim, its edge rippling in waves
// that run round it (HOLE_WAVES, a SMIL animation of its outline), so at rest the clouds show as a wavy ring. Hovered,
// the pill shrinks away, its waves still running, until the clouds fill the button and the words are white; off it,
// the pill comes back (styles.css .new-chat). Its words never wrap. Where the sidebar keeps only its icons it is a
// round plus on the clouds alone.
// The waves are few, long and soft, and the outline a smooth curve through its points: ten short waves drawn as
// straight segments looked sharp, all bends and corners (Sean 2026-11-18: "לא רציתי שזה יהיה כזה חד ויראה ככה בכאלה
// פניות חדות").
const HOLE_INSET = 8;
const HOLE_AMP = 2.5;
const HOLE_WAVE = 105;
const HOLE_POINTS = 48;
const HOLE_STEPS = 12;
// The hole's outline at one phase of its waves: a pill HOLE_INSET in from the 200 by 60 field's rim, each point pushed
// out along the edge's normal by a wave of the distance round it, a whole number of waves so they meet where they
// began, joined by a closed Catmull-Rom curve (as cubic Béziers). The same commands at every phase, so one outline can
// move into the next.
function holeOutline(phase: number) {
  const W = 200, H = 60, r = H / 2 - HOLE_INSET, x0 = HOLE_INSET + r, x1 = W - HOLE_INSET - r, cy = H / 2;
  const straight = x1 - x0, arc = Math.PI * r, round = 2 * (straight + arc);
  const k = (2 * Math.PI * Math.max(1, Math.round(round / HOLE_WAVE))) / round;
  const p: [number, number][] = [];
  for (let i = 0; i < HOLE_POINTS; i++) {
    const s = (i / HOLE_POINTS) * round;
    let x: number, y: number, nx: number, ny: number;
    if (s < straight) { x = x0 + s; y = HOLE_INSET; nx = 0; ny = -1; }
    else if (s < straight + arc) { const a = -Math.PI / 2 + (s - straight) / r; x = x1 + r * Math.cos(a); y = cy + r * Math.sin(a); nx = Math.cos(a); ny = Math.sin(a); }
    else if (s < 2 * straight + arc) { x = x1 - (s - straight - arc); y = H - HOLE_INSET; nx = 0; ny = 1; }
    else { const a = Math.PI / 2 + (s - 2 * straight - arc) / r; x = x0 + r * Math.cos(a); y = cy + r * Math.sin(a); nx = Math.cos(a); ny = Math.sin(a); }
    const d = HOLE_AMP * Math.sin(k * s - phase);
    p.push([x + nx * d, y + ny * d]);
  }
  const at = (i: number) => p[(i + HOLE_POINTS) % HOLE_POINTS];
  const f = (n: number) => n.toFixed(2);
  let path = `M${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 0; i < HOLE_POINTS; i++) {
    const [a, b, c, e] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    path += ` C${f(b[0] + (c[0] - a[0]) / 6)} ${f(b[1] + (c[1] - a[1]) / 6)} ${f(c[0] - (e[0] - b[0]) / 6)} ${f(c[1] - (e[1] - b[1]) / 6)} ${f(c[0])} ${f(c[1])}`;
  }
  return `${path} Z`;
}
// The outlines the waves run through, back to the first, for the animation's values.
const HOLE_WAVES = Array.from({ length: HOLE_STEPS + 1 }, (_, i) => holeOutline((i / HOLE_STEPS) * 2 * Math.PI)).join(";");
export function AiNewChat({ label }: { label: string }) {
  return (
    <a className="new-chat" href="/chat/new">
      <AiSky />
      <svg className="new-chat-hole" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d={holeOutline(0)}>
          <animate attributeName="d" dur="5s" repeatCount="indefinite" values={HOLE_WAVES} />
        </path>
      </svg>
      <Icon name="plus" />
      <span className="new-chat-words">{label}</span>
    </a>
  );
}

// Hebrew words with English names among them: each name kept whole in its own direction, so "C++" at a line's start
// doesn't show as "++C", nor ".NET" as "NET.", and a Hebrew line that starts with a name still runs right to left.
// English words in a row are one name, so "Full Stack" doesn't show as "Stack Full".
export const HEBREW = /[\u0590-\u05FF]/;
const NAME = /(\.?[A-Za-z][A-Za-z0-9]*(?:[.\-/][A-Za-z0-9]+)*[+#]*(?: \.?[A-Za-z][A-Za-z0-9]*(?:[.\-/][A-Za-z0-9]+)*[+#]*)*)/;
// Which way a piece of text runs, by most of its letters (web addresses left out): right to left when at least half are
// Hebrew, so "Wix Code, מהנדס פול סטאק" is a Hebrew line though it starts in English; none when it has no letters.
export function langDir(text: string): "rtl" | "ltr" | undefined {
  const words = text.replace(/\]\([^)]*\)|https?:\/\/\S+/g, "");
  const hebrew = (words.match(/\p{Script=Hebrew}/gu) ?? []).length;
  const letters = (words.match(/\p{L}/gu) ?? []).length;
  return letters === 0 ? undefined : hebrew * 2 >= letters ? "rtl" : "ltr";
}
export function Words({ text }: { text: string }) {
  if (!HEBREW.test(text)) return <>{text}</>;
  return <>{text.split(NAME).map((part, i) => (i % 2 ? <bdi key={i}>{part}</bdi> : part))}</>;
}

// The roll of a round box's go button (the jobs search, the chat's box) in or out of its end; matches .seek-go's
// transition in styles.css.
export const GO_ROLL_MS = 450;

// The go button's place at the end of a round box (.seek-go-slot): open at once when there is something to go
// with (on), so the words typed keep still; once there is nothing, kept open while the button rolls back out,
// then closed, which an empty box shows nothing of. Worked out as on changes, so the place never closes for a
// frame in between. The buttons beside it (slide, inside row) slide over by its width, 44 pixels and a gap, as it
// opens or closes, rather than jump. Returns whether the place is open.
export function useGoSlot(on: boolean, row: React.RefObject<HTMLElement>, slide: string) {
  const [leaving, setLeaving] = useState(false);
  const [was, setWas] = useState(on);
  if (was !== on) {
    setWas(on);
    setLeaving(!on);
  }
  useEffect(() => {
    if (!leaving) return;
    // A little past the roll, so it has surely ended: the transition starts a frame or so after this.
    const timer = setTimeout(() => setLeaving(false), GO_ROLL_MS + 40);
    return () => clearTimeout(timer);
  }, [leaving]);
  const open = on || leaving;
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const out = document.documentElement.dir === "rtl" ? -1 : 1;
    for (const el of row.current?.querySelectorAll<HTMLElement>(slide) ?? []) {
      el.animate([{ translate: `${(open ? 50 : -50) * out}px 0` }, { translate: "0 0" }], { duration: 350, easing: "cubic-bezier(0.22, 0.8, 0.3, 1)" });
    }
  }, [open]);
  return open;
}

// How far the slim bar keeps from the top and bottom of its area.
const BAR_GAP = 10;

// A slim scrollbar of our own for a small scrolling area, in place of the browser's (hidden in the CSS): a thin
// round bar with nothing behind it and no arrows, showing while the area scrolls or the pointer is in it and
// fading a moment after, and draggable. It stands in the area's frame, so only its length and place are worked
// out here, from how far down the area is.
export function ThinBar({ target }: { target: React.RefObject<HTMLElement> }) {
  const [bar, setBar] = useState<{ top: number; height: number } | null>(null);
  const [awake, setAwake] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y: number; scroll: number } | null>(null);
  const sleep = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const measure = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= clientHeight + 1) return setBar(null);
      const room = clientHeight - 2 * BAR_GAP;
      const height = Math.max(32, (room * clientHeight) / scrollHeight);
      setBar({ top: BAR_GAP + (scrollTop / (scrollHeight - clientHeight)) * (room - height), height });
    };
    const wake = () => {
      setAwake(true);
      clearTimeout(sleep.current);
      sleep.current = setTimeout(() => setAwake(false), 1000);
    };
    const scrolled = () => { measure(); wake(); };
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    for (const child of el.children) sizes.observe(child);
    el.addEventListener("scroll", scrolled, { passive: true });
    el.addEventListener("pointermove", wake);
    measure();
    // Seen for a moment on opening, so it shows there is more below.
    wake();
    return () => { sizes.disconnect(); el.removeEventListener("scroll", scrolled); el.removeEventListener("pointermove", wake); clearTimeout(sleep.current); };
  }, [target]);
  if (!bar) return null;
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { y: e.clientY, scroll: target.current!.scrollTop };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = target.current;
    if (!el || !drag.current) return;
    el.scrollTop = drag.current.scroll + ((e.clientY - drag.current.y) / (el.clientHeight - 2 * BAR_GAP - bar.height)) * (el.scrollHeight - el.clientHeight);
  };
  const up = () => { drag.current = null; setDragging(false); };
  return (
    <div
      className={`thin-bar ${awake || dragging ? "awake" : ""} ${dragging ? "dragging" : ""}`} aria-hidden="true" style={{ top: bar.top, height: bar.height }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
    />
  );
}
