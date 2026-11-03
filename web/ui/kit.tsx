// Shared building blocks. Text from postings and from the agent always goes in as text, never as HTML.
import React from "react";
import {
  createLucideIcon, FileText, Folder, LayoutGrid, ListChecks, LogOut, MessageCircle, Moon, Plus, Search, Settings, Sun, User, type LucideIcon,
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
  home: House, jobs: Search, apps: FileText, chat: MessageCircle, profile: User, settings: Settings,
  rules: ListChecks, tools: LayoutGrid, files: Folder, plus: Plus, sun: Sun, moon: Moon, logout: LogOut,
};

// filled is for the page you are on: the shape filled in, its inner lines cut out (see .icon.filled in the CSS).
export const Icon = ({ name, filled = false }: { name: string; filled?: boolean }) => {
  const Glyph = ICONS[name];
  return <Glyph className={`icon icon-${name}${filled ? " filled" : ""}`} aria-hidden="true" />;
};
