// Shared building blocks. Text from postings and from the agent always goes in as text, never as HTML.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp, Bookmark, Check, ChevronDown, ChevronLeft, ClipboardCheck, Cpu, createLucideIcon, Download, ExternalLink, Feather, FileText, Folder, Gem,
  LayoutGrid, Leaf, ListChecks, LogOut, MapPin, MessageCircle, Moon, Plus, Search, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles,
  Square, Sun, TriangleAlert, User, X, Zap,
  type LucideIcon,
} from "lucide-react";
import { translate, type Lang } from "./i18n";

export type ApiError = Error & { code?: string; params?: Record<string, string | number>; status?: number };

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  // The server restarted or the session ended, so the login comes back.
  if (res.status === 401 && data.error === "login_required" && path !== "me") dispatchEvent(new Event("pip-login-required"));
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

export function External({ url, className = "btn", children }: { url: string; className?: string; children: React.ReactNode }) {
  const href = safeUrl(url);
  return href ? <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : null;
}

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

// Icons from Lucide, an open icon set (ISC licence); only these are bundled.
const ICONS: Record<string, LucideIcon> = {
  home: House, jobs: Search, saved: Bookmark, apps: FileText, chat: MessageCircle, profile: User, settings: Settings,
  rules: ListChecks, tools: LayoutGrid, files: Folder, plus: Plus, sun: Sun, moon: Moon, logout: LogOut, filters: SlidersHorizontal,
  ai: Sparkles, open: ExternalLink, apply: ClipboardCheck, pin: MapPin, close: X, onward: ChevronLeft, down: ChevronDown, check: Check, find: Search,
  warn: TriangleAlert, send: ArrowUp, stop: Square, download: Download, file: FileText,
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

// Claude's mark, from Simple Icons (CC0, simple-icons@15.0.0). It is Anthropic's trademark, so it is shown only
// beside what runs on Claude, to say so; its colour is in .claude-mark.
const CLAUDE_PATH = "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z";
export const ClaudeMark = () => <svg className="claude-mark" viewBox="0 0 24 24" aria-hidden="true"><path d={CLAUDE_PATH} /></svg>;

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
