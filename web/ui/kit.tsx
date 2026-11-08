// Shared building blocks. Text from postings and from the agent always goes in as text, never as HTML.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, CircleEllipsis, ClipboardCheck, Cpu, createLucideIcon, Download, ExternalLink, Feather, FileText, Folder, Gauge,
  Gem, LayoutGrid, Leaf, ListChecks, LogOut, MapPin, MessageCircle, Moon, Plus, RefreshCw, Search, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal,
  Sparkles, Square, Sun, TriangleAlert, User, X, Zap,
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

// A small Markdown reader that builds elements, so nothing the agent writes is parsed as HTML.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:[^)\s]+\)|https?:\/\/[^\s)<>]+|\*[^*\s][^*]*\*)/g;

function inline(text: string, key = ""): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} dir="ltr">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label, url] = t.match(/^\[([^\]]+)\]\((.+)\)$/)!;
      out.push(<a key={k} href={url} target="_blank" rel="noopener noreferrer">{label}</a>);
    } else if (t.startsWith("http")) out.push(<a key={k} href={t} target="_blank" rel="noopener noreferrer" dir="ltr">{t}</a>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRule = (line = "") => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line);
const isList = (line: string) => /^\s*([-*]|\d+\.)\s+/.test(line);

export function Markdown({ src, className = "md", dir }: { src: string; className?: string; dir?: string }) {
  const lines = src.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
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
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 1, 4)}` as "h2";
      blocks.push(<Tag key={k} dir="auto">{inline(heading[2], k)}</Tag>);
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
        <thead><tr>{head.map((c, j) => <th key={j} dir="auto">{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
        <tbody>{body.map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n} dir="auto">{inline(c, `${k}${j}-${n}`)}</td>)}</tr>)}</tbody>
      </table></div>);
      continue;
    }
    if (isList(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: React.ReactNode[] = [];
      while (i < lines.length && isList(lines[i])) {
        items.push(<li key={i} dir="auto">{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""), String(i))}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k} dir="auto">{inline(quote.join(" "), k)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>)/.test(lines[i]) && !isList(lines[i])) {
      if (lines[i].includes("|") && isTableRule(lines[i + 1])) break;
      para.push(lines[i++]);
    }
    if (para.length) blocks.push(<p key={k} dir="auto">{inline(para.join(" "), k)}</p>);
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

// Icons from Lucide, an open icon set (ISC licence); only these are bundled.
const ICONS: Record<string, LucideIcon> = {
  home: House, jobs: Search, saved: Bookmark, apps: FileText, chat: MessageCircle, profile: User, settings: Settings,
  rules: ListChecks, tools: LayoutGrid, files: Folder, more: CircleEllipsis, plus: Plus, sun: Sun, moon: Moon, logout: LogOut, filters: SlidersHorizontal,
  ai: Sparkles, open: ExternalLink, apply: ClipboardCheck, pin: MapPin, close: X, onward: ChevronLeft, back: ChevronRight, down: ChevronDown, check: Check, find: Search,
  warn: TriangleAlert, send: ArrowUp, stop: Square, download: Download, file: FileText, portals: Office, refresh: RefreshCw, gauge: Gauge,
  "access-ask": ShieldCheck, "access-auto": Zap, "access-full": ShieldAlert,
  "model-default": Cpu, "model-opus": Gem, "model-sonnet": Feather, "model-haiku": Leaf,
};

// filled is for the page you are on: the shape filled in, its inner lines cut out (see .icon.filled in the CSS).
export const Icon = ({ name, filled = false }: { name: string; filled?: boolean }) => {
  const Glyph = ICONS[name];
  return <Glyph className={`icon icon-${name}${filled ? " filled" : ""}`} aria-hidden="true" />;
};

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
