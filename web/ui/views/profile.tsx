// The profile, as a careers site shows a candidate's: who they are and how to reach them, their skills, roles,
// education, projects and the rest, each part a card read from user/profile/01-candidate-profile.md
// (profile-parse.ts), beside how complete it is (the profile's health), a ring Pip peeks over. The cards run the way
// the profile's own words do (profileDir): an English profile reads from the left on a Hebrew page, its dates as the
// file writes them. A line on its own runs the way its words do (lineDir), so a card's Hebrew title, a label or "show
// more" stays on the right in an English card; the page's words inside a line of the profile's keep their own
// direction (bdi). Each card's pencil edits its part of the file as text, saving itself a moment later; the whole file
// can still be read and edited as it is (DocumentCard), and changed by talking to Pip (ViaChat).
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../app";
import { SaveNote, useAutoSave } from "../autosave";
import { api, Btn, Icon, Markdown, safeUrl, Spinner } from "../kit";
import { Pip, type Mood } from "../pip";
import { dirOf, parseProfile, parts, profileDir, profileHealth, type Profile, type Role } from "../profile-parse";
import { DocumentCard, ViaChat, type Doc } from "./docs";
import { Initial, Sky, tint } from "./jobs";

type T = (key: string, params?: Record<string, string | number>) => string;
type Health = ReturnType<typeof profileHealth>;
type Dir = "ltr" | "rtl";

// A card shows this many of a list before "show more".
const SKILLS_SHOWN = 14;
const BULLETS_SHOWN = 3;

// The part of the file each card edits, by its heading there (the template's), and what to call it when the file
// has no such part yet.
const PART = { who: "Identity", skills: "Technical Skills", roles: "Professional Experience", education: "Education", projects: "Independent Projects", awards: "Awards", publications: "Publications", references: "References" };

// How long a role lasted, in words: 4 months, a year and 4 months, two years.
function lasted(months: number, t: T) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const year = y === 0 ? "" : y === 1 ? t("profile.dur.year") : y === 2 ? t("profile.dur.twoYears") : t("profile.dur.years", { n: y });
  if (!m) return year || t("profile.dur.months", { n: 0 });
  const month = m === 1 ? t("profile.dur.month") : m === 2 ? t("profile.dur.twoMonths") : t("profile.dur.months", { n: m });
  if (!year) return month;
  return m === 1 ? t("profile.dur.andMonth", { a: year }) : m === 2 ? t("profile.dur.andTwoMonths", { a: year }) : t("profile.dur.and", { a: year, n: m });
}
// A role's dates and a study's period as the file writes them, in the file's language, with one kind of dash.
const dates = (start: string, end: string) => [start, end].filter(Boolean).join(" – ");
const period = (text: string) => text.trim().replace(/\s*[-–—]\s*/g, " – ");
// The way a line on its own runs: a Hebrew one from the right, an English one from the left.
const lineDir = (text: string) => dirOf(text) ?? undefined;
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
// A profile's address without its "https://" and "www.", as people write it: linkedin.com/in/name.
const short = (value: string) => value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
const href = (value: string) => (/^https?:\/\//i.test(value) ? value : /^[\w.-]+\.[a-z]{2,}\//i.test(value) ? `https://${value}` : "");

// A person's initials on a round tile in their forest colour: the first letters of their first and last names.
function Avatar({ name }: { name: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? [words[0], words[words.length - 1]] : words).map((w) => [...w][0]?.toUpperCase() ?? "").join("") || "?";
  return <span className="prof-avatar" aria-hidden="true" style={{ "--tint": tint(name) } as React.CSSProperties}>{initials}</span>;
}

// ---------- the profile's health ----------

const moodOf = (score: number): Mood => (score >= 100 ? "love" : score >= 80 ? "happy" : score >= 50 ? "idle" : "worried");
// The score's colour: a full profile's deep green at 100, the site's green from 80, amber from 50, red below.
const bandOf = (score: number) => (score >= 100 ? "full" : score >= 80 ? "good" : score >= 50 ? "mid" : "low");

// A check's mark: a solid green circle with a white tick once done, an amber ring with a plus while missing.
function Tick({ ok }: { ok: boolean }) {
  return ok
    ? <svg className="prof-tick ok" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" /><path d="M7.2 12.4l3.2 3.2 6.4-6.6" /></svg>
    : <svg className="prof-tick todo" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" /></svg>;
}

// A ring that fills round from the top as the score does, in the score's colour, around what it holds; on a white
// disc, so what stands behind it is hidden.
function Ring({ score, children }: { score: number; children: React.ReactNode }) {
  const size = 156;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const round = 2 * Math.PI * r;
  return (
    <div className="prof-ring" style={{ "--round": round } as React.CSSProperties}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="prof-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="prof-ring-fill" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={round} strokeDashoffset={round * (1 - score / 100)} />
      </svg>
      <div className="prof-ring-inner">{children}</div>
    </div>
  );
}

// The health as a card, the way Microsoft's careers site shows it: the score in a ring with Pip peeking over it from
// behind (his feet hidden by it), and each check under its group, a group's head folding it.
function HealthCard({ health }: { health: Health }) {
  const { t } = useApp();
  const [shut, setShut] = useState<Record<string, boolean>>({});
  return (
    <section className={`prof-card prof-health ${bandOf(health.score)}`} aria-label={t("profile.health.title")}>
      <div className="prof-health-top">
        <Pip mood={moodOf(health.score)} className="prof-health-pip" />
        <Ring score={health.score}><b className="prof-health-num">{health.score}</b></Ring>
      </div>
      <p className="prof-health-label">{t("profile.health.title")}</p>
      <div className="prof-checks">
        {health.groups.map((g) => (
          <section key={g.id} className="prof-check-group">
            <button type="button" className="prof-check-head" aria-expanded={!shut[g.id]} onClick={() => setShut({ ...shut, [g.id]: !shut[g.id] })}>
              <span className="prof-check-name">{t(`profile.health.groups.${g.id}`)}</span>
              <span className="prof-chev"><Icon name="down" /></span>
            </button>
            {!shut[g.id] && (
              <ul className="prof-check-rows">
                {g.checks.map((c) => (
                  <li key={c.id} className={c.ok ? "ok" : "todo"}>
                    <Tick ok={c.ok} /><span className="prof-check-text">{t(`profile.health.checks.${c.id}`)}</span>
                    {!c.ok && <span className="prof-check-add">{t("profile.health.add")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

// ---------- editing a part ----------

// A card's part of the file as text, each change saving itself a moment later into the whole file, in place of the
// part it was (found again by its heading, which may change), from the version last saved.
function PartEditor({ part, doc, onSaved, onDone }: { part: string; doc: Doc; onSaved: (doc: Doc) => void; onDone: () => void }) {
  const { t } = useApp();
  const at = parts(doc.text).find((p) => p.title === part);
  const [text, setText] = useState(() => (at ? doc.text.slice(at.start, at.end).replace(/\s+$/, "") : `## ${part}\n`));
  const latest = useRef(doc);
  latest.current = doc;
  const heading = useRef(part);
  const saving = useAutoSave(text, async (next) => {
    const title = /^## +(.+?)\s*$/.exec(next.trimStart().split("\n")[0])?.[1];
    if (!title) throw new Error(t("profile.needsHeading"));
    const cur = latest.current;
    const here = parts(cur.text).find((p) => p.title === heading.current);
    const body = `${next.trim()}\n\n`;
    const full = here ? cur.text.slice(0, here.start) + body + cur.text.slice(here.end) : `${cur.text.replace(/\s+$/, "")}\n\n${body}`;
    const saved = await api<Doc>("profile", { text: full, base: cur.version });
    heading.current = title;
    onSaved(saved);
  }, { wait: 1000 });
  return (
    <div className="prof-editor">
      <textarea className="code-box" dir="ltr" rows={Math.min(24, Math.max(8, text.split("\n").length + 2))} value={text} onChange={(e) => setText(e.target.value)} aria-label={part} autoFocus />
      <div className="row spread" dir={lineDir(t("common.backToView"))}>
        <Btn onClick={onDone}>{t("common.backToView")}</Btn>
        <SaveNote state={saving} />
      </div>
    </div>
  );
}

// A card: its title and its pencil on a line running the way the title does, then its contents, running the way the
// profile's words do, or its part being edited in their place.
type Edit = { editing: string | null; setEditing: (part: string | null) => void; doc: Doc; setDoc: (doc: Doc) => void; dir: Dir };
function Card({ id, title, part, edit, children }: { id: string; title: string; part: string; edit: Edit; children: React.ReactNode }) {
  const { t } = useApp();
  const open = edit.editing === part;
  return (
    <section className={`prof-card prof-${id}`} dir={edit.dir} aria-labelledby={`prof-${id}-title`}>
      <div className="prof-card-head" dir={lineDir(title)}>
        <h2 id={`prof-${id}-title`}>{title}</h2>
        {!open && (
          <button type="button" className="result-act" aria-label={`${t("profile.edit")}: ${title}`} onClick={() => edit.setEditing(part)}>
            <Icon name="edit" /><span className="act-label" aria-hidden="true">{t("profile.edit")}</span>
          </button>
        )}
      </div>
      {open ? <PartEditor part={part} doc={edit.doc} onSaved={edit.setDoc} onDone={() => edit.setEditing(null)} /> : children}
    </section>
  );
}

// "Show more" for what a card holds back, and "show less" once it shows it.
function More({ open, count, onToggle }: { open: boolean; count: number; onToggle: () => void }) {
  const { t } = useApp();
  const label = open ? t("profile.less") : t("profile.more", { n: count });
  return <div className="prof-more-line" dir={lineDir(label)}><button type="button" className="prof-more" aria-expanded={open} onClick={onToggle}>{label}</button></div>;
}

function Empty() {
  const { t } = useApp();
  return <p className="prof-empty" dir={lineDir(t("profile.empty"))}>{t("profile.empty")}</p>;
}

// ---------- the cards ----------

// Who the candidate is: their initials, name and status, how to reach them, the identity's other facts, their
// languages with their levels, and their interests.
function Who({ p, edit }: { p: Profile; edit: Edit }) {
  const { t } = useApp();
  const contact: [string, string, string][] = [
    ["pin", p.location, ""], ["mail", p.email, p.email ? `mailto:${p.email}` : ""], ["phone", p.phone, p.phone ? `tel:${p.phone.replace(/[^\d+]/g, "")}` : ""],
    ["link", short(p.linkedin), href(p.linkedin)], ["link", short(p.github), href(p.github)],
  ];
  return (
    <Card id="who" title={t("profile.parts.who")} part={PART.who} edit={edit}>
      <div className="prof-person">
        <Avatar name={p.name || "?"} />
        <div className="prof-person-text">
          <p className="prof-name"><bdi>{p.name || t("profile.noName")}</bdi></p>
          {p.status && <p className="prof-status" dir="auto">{p.status}</p>}
          <ul className="prof-contact">
            {contact.filter(([, value]) => value).map(([icon, value, link], i) => {
              const web = Boolean(safeUrl(link));
              return (
                <li key={i}><Icon name={icon} />
                  {web || /^(mailto|tel):/.test(link) ? <a href={link} target={web ? "_blank" : undefined} rel="noopener noreferrer" dir="ltr">{value}</a> : <bdi>{value}</bdi>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {p.facts.length > 0 && (
        <dl className="prof-facts">{p.facts.map((f) => <div key={f.key}><dt><bdi>{f.key}</bdi></dt><dd dir="auto">{f.value}</dd></div>)}</dl>
      )}
      {p.languages.length > 0 && (
        <div className="prof-sub"><h3 dir={lineDir(t("profile.languages"))}>{t("profile.languages")}</h3>
          <ul className="prof-chips">{p.languages.map((l) => <li key={l.name} className="prof-chip"><bdi>{l.name}</bdi>{l.level && <small><bdi>{l.level}</bdi></small>}</li>)}</ul>
        </div>
      )}
      {p.interests.length > 0 && (
        <div className="prof-sub"><h3 dir={lineDir(t("profile.interests"))}>{t("profile.interests")}</h3>
          <ul className="prof-chips">{p.interests.map((x) => <li key={x} className="prof-chip"><bdi>{x}</bdi></li>)}</ul>
        </div>
      )}
    </Card>
  );
}

// The skills by their groups, as chips; a chip with a note shows it under its group when picked.
function Skills({ p, edit }: { p: Profile; edit: Edit }) {
  const { t } = useApp();
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  let left = all ? Infinity : SKILLS_SHOWN;
  const total = p.skills.reduce((n, g) => n + g.items.length, 0);
  return (
    <Card id="skills" title={t("profile.parts.skills")} part={PART.skills} edit={edit}>
      {!total && <Empty />}
      {p.skills.map((g) => {
        const shown = g.items.slice(0, Math.max(0, left));
        left -= shown.length;
        if (!shown.length) return null;
        const note = g.items.find((s) => `${g.group}/${s.name}` === picked)?.note;
        return (
          <div key={g.group || "skills"} className="prof-sub">
            {g.group && <h3 dir={lineDir(g.group)}>{g.group}</h3>}
            <ul className="prof-chips">
              {shown.map((s) => {
                const id = `${g.group}/${s.name}`;
                return (
                  <li key={id}>
                    {s.note ? <button type="button" className={`prof-chip has-note ${picked === id ? "on" : ""}`} aria-expanded={picked === id} onClick={() => setPicked(picked === id ? null : id)}><bdi>{s.name}</bdi><Icon name="down" /></button>
                      : <span className="prof-chip"><bdi>{s.name}</bdi></span>}
                  </li>
                );
              })}
            </ul>
            {note && <p className="prof-note" dir="auto">{note}</p>}
          </div>
        );
      })}
      {total > SKILLS_SHOWN && <More open={all} count={total - SKILLS_SHOWN} onToggle={() => setAll(!all)} />}
    </Card>
  );
}

// A role: the company's initial, the title, the company, how long it lasted, its dates, its notes and its first
// points, the rest on asking.
function RoleItem({ r }: { r: Role }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const held = r.bullets.length - BULLETS_SHOWN + (r.notes.length ? 1 : 0);
  return (
    <li className="prof-item">
      <Initial name={r.company || r.title} />
      <div className="prof-item-text">
        <div className="prof-item-head">
          <div>
            <p className="prof-item-title"><bdi>{r.title}</bdi></p>
            {r.company && <p className="prof-item-sub"><bdi>{r.company}</bdi>{r.months !== null && <span className="prof-badge"><bdi>{lasted(r.months, t)}</bdi></span>}</p>}
          </div>
          <span className="prof-dates" dir="ltr">{dates(r.start, r.end)}</span>
        </div>
        <div className="prof-item-body" dir="auto">
          {open && r.notes.map((n, i) => <p key={`n${i}`} className="prof-item-note">{n}</p>)}
          <ul>
            {(open ? r.bullets : r.bullets.slice(0, BULLETS_SHOWN)).map((b, i) => (
              <li key={i}>{b.text}{open && b.more.length > 0 && <ul>{b.more.map((m, j) => <li key={j}>{m}</li>)}</ul>}</li>
            ))}
          </ul>
        </div>
        {held > 0 && <More open={open} count={Math.max(1, held)} onToggle={() => setOpen(!open)} />}
      </div>
    </li>
  );
}

function Roles({ p, edit }: { p: Profile; edit: Edit }) {
  const { t } = useApp();
  return (
    <Card id="roles" title={t("profile.parts.roles")} part={PART.roles} edit={edit}>
      {p.roles.length ? <ul className="prof-items">{p.roles.map((r, i) => <RoleItem key={i} r={r} />)}</ul> : <Empty />}
    </Card>
  );
}

function Education({ p, edit }: { p: Profile; edit: Edit }) {
  const { t } = useApp();
  return (
    <Card id="education" title={t("profile.parts.education")} part={PART.education} edit={edit}>
      {p.education.length ? (
        <ul className="prof-items">
          {p.education.map((e, i) => (
            <li key={i} className="prof-item">
              <span className="prof-icon" aria-hidden="true"><Icon name="school" /></span>
              <div className="prof-item-text">
                <div className="prof-item-head">
                  <div>
                    <p className="prof-item-title"><bdi>{e.degree}</bdi></p>
                    {e.institution && <p className="prof-item-sub"><bdi>{e.institution}</bdi></p>}
                  </div>
                  {e.period && <span className="prof-dates" dir="ltr">{period(e.period)}</span>}
                </div>
                {e.topics && <p className="prof-item-note" dir="auto">{e.topics}</p>}
              </div>
            </li>
          ))}
        </ul>
      ) : <Empty />}
    </Card>
  );
}

function Project({ x }: { x: Profile["projects"][number] }) {
  const [open, setOpen] = useState(false);
  const long = x.text.length > 220 || x.more.length > 0;
  return (
    <li className="prof-project">
      <div className="prof-project-head">
        <p className="prof-item-title"><bdi>{x.name}</bdi></p>
        {x.links.filter((l) => safeUrl(l)).map((l) => <a key={l} className="prof-link" href={l} target="_blank" rel="noopener noreferrer"><Icon name="link" /><span dir="ltr">{host(l)}</span></a>)}
      </div>
      {x.text && <p className={`prof-project-text ${open ? "" : "clamped"}`} dir="auto">{x.text}</p>}
      {open && x.more.length > 0 && <ul className="prof-item-body" dir="auto">{x.more.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {long && <More open={open} count={x.more.length || 1} onToggle={() => setOpen(!open)} />}
    </li>
  );
}

function Projects({ p, edit }: { p: Profile; edit: Edit }) {
  const { t } = useApp();
  return (
    <Card id="projects" title={t("profile.parts.projects")} part={PART.projects} edit={edit}>
      {p.projects.length ? <ul className="prof-project-list">{p.projects.map((x) => <Project key={x.name} x={x} />)}</ul> : <Empty />}
    </Card>
  );
}

// Awards, publications and references, each a card of its own when it has something.
function Lists({ p, edit }: { p: Profile; edit: Edit }) {
  const { t } = useApp();
  return (
    <>
      {(["awards", "publications", "references"] as const).filter((k) => p[k].length).map((k) => (
        <Card key={k} id={k} title={t(`profile.parts.${k}`)} part={PART[k]} edit={edit}>
          <ul className="prof-list">{p[k].map((x, i) => <li key={i} dir="auto">{x}</li>)}</ul>
        </Card>
      ))}
    </>
  );
}

// Parts this page has no card of its own for, as the file writes them.
function Others({ p, edit }: { p: Profile; edit: Edit }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {p.others.map((o) => (
        <Card key={o.title} id={`other-${o.title.replace(/\W+/g, "-").toLowerCase()}`} title={o.title} part={o.title} edit={edit}>
          {open === o.title ? <Markdown src={o.markdown} className="md doc-text" dir="auto" /> : null}
          <More open={open === o.title} count={o.markdown.split("\n").filter((l) => l.trim()).length} onToggle={() => setOpen(open === o.title ? null : o.title)} />
        </Card>
      ))}
    </>
  );
}

// ---------- the page ----------

export function ProfilePage() {
  const { t, err, lang } = useApp();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [asText, setAsText] = useState(false);
  // Read again when the text view closes, which may have changed it.
  useEffect(() => { if (!asText) api<Doc>("profile").then(setDoc).catch((e) => setError(err(e))); }, [asText]);
  const p = doc ? parseProfile(doc.markdown) : null;
  const health = p ? profileHealth(p) : null;
  // A profile with nothing written yet runs the page's way.
  const dir: Dir = (p && profileDir(p)) || (lang === "he" ? "rtl" : "ltr");
  const edit: Edit | null = doc ? { editing, setEditing, doc, setDoc, dir } : null;
  return (
    <div className="page prof-page">
      <div className="prof-top">
        <Sky />
        <h1 className="saved-title">{t("docs.profileTitle")}</h1>
        <div className="prof-top-acts">
          <ViaChat draftKey="docs.profileDraft" />
          <Btn onClick={() => { setEditing(null); setAsText(!asText); }}>{t(asText ? "profile.asCards" : "profile.asText")}</Btn>
        </div>
      </div>
      {asText ? <div className="prof-text"><DocumentCard kind="profile" /></div>
        : !p || !edit || !health ? (error ? <p className="error-line" role="alert">{error}</p> : <div className="row note"><Spinner />{t("common.loading")}</div>)
        : (
          <div className="prof-grid">
            <div className="prof-main">
              <Who p={p} edit={edit} />
              <Skills p={p} edit={edit} />
              <Roles p={p} edit={edit} />
              <Education p={p} edit={edit} />
              <Projects p={p} edit={edit} />
              <Lists p={p} edit={edit} />
              <Others p={p} edit={edit} />
            </div>
            <aside className="prof-side"><HealthCard health={health} /></aside>
          </div>
        )}
    </div>
  );
}
