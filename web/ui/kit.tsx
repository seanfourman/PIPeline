// Shared building blocks. Text from postings and from the agent always goes in as text, never as HTML.
import React from "react";
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

const LINE_ICONS: Record<string, string> = {
  home: "M3 11l9-8 9 8M5 9.5V20h14V9.5M10 20v-6h4v6",
  jobs: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  apps: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6",
  chat: "M4 5h16v11H9l-5 4z",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  rules: "M10 6h10M10 12h10M10 18h10M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  tools: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  files: "M3 6h6l2 2h10v11H3z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  logout: "M9 4H5v16h4M15 8l4 4-4 4M19 12H9",
};

export const Icon = ({ name }: { name: string }) => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={LINE_ICONS[name]} /></svg>
);
