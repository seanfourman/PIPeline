// The candidate profile (user/profile/01-candidate-profile.md, from templates/user/profile) read into its parts, for
// the profile page to show as cards: who the candidate is, their languages, education, roles, projects and skills.
// The file stays the one source: a part this doesn't know is kept as it is written (others), and each "## " part
// can be edited as text on its own (parts), so nothing is lost by showing it this way.

export type Field = { key: string; value: string };
export type Role = { title: string; company: string; start: string; end: string; months: number | null; notes: string[]; bullets: { text: string; more: string[] }[] };
export type Project = { name: string; links: string[]; text: string; more: string[] };
export type Skill = { name: string; note: string };
export type Profile = {
  name: string; status: string; location: string; email: string; phone: string; linkedin: string; github: string;
  // The identity's other lines (notice period, clearance, constraints), as written.
  facts: Field[];
  languages: { name: string; level: string; notes: string }[];
  interests: string[];
  education: { degree: string; period: string; institution: string; topics: string }[];
  roles: Role[];
  projects: Project[];
  skills: { group: string; items: Skill[] }[];
  awards: string[]; publications: string[]; references: string[];
  // Parts this page doesn't know, as written, to show as they are.
  others: { title: string; markdown: string }[];
};

// A placeholder the template leaves until /setup fills it, or a line that says there is nothing.
const EMPTY = /^\[[A-Z_ ,.'"/-]+\]$|^\[.*\]$|^(none|n\/a|-|—)\.?$/i;
const isEmpty = (s: string) => !s.trim() || EMPTY.test(s.trim());
const FIELD = /^- \*\*([^*]+?):\*\*\s*(.*)$/;
const BULLET = /^(\s*)[-*]\s+(.*)$/;

// The text's "## " parts in order, each with where it starts and ends, for editing one on its own.
export function parts(text: string) {
  const out: { title: string; start: number; end: number }[] = [];
  const re = /^## +(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ title: m[1], start: m.index, end: text.length });
  out.forEach((p, i) => { if (out[i + 1]) p.end = out[i + 1].start; });
  return out;
}

// The rows of a Markdown table, header row left out.
function table(lines: string[]) {
  const rows = lines.filter((l) => /^\s*\|/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  return rows.filter((r, i) => i > 0 && !r.every((c) => /^:?-{2,}:?$/.test(c)));
}

// "### Heading" sub-parts of a part, each with its lines.
function subparts(lines: string[]) {
  const out: { title: string; lines: string[] }[] = [{ title: "", lines: [] }];
  for (const line of lines) {
    const h = /^### +(.+?)\s*$/.exec(line);
    if (h) out.push({ title: h[1], lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\s+/g, " ").trim();
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// A date as a role writes it (Aug 2025, 2023, Present), as a count of months, or null.
function monthOf(s: string, end: boolean, now = new Date()) {
  const t = s.trim().toLowerCase();
  if (/^(present|now|current|today|היום|כיום|עכשיו)/.test(t)) return now.getFullYear() * 12 + now.getMonth();
  const m = /^([a-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(t);
  if (m && MONTHS.includes(m[1])) return Number(m[2]) * 12 + MONTHS.indexOf(m[1]);
  const y = /^(\d{4})$/.exec(t);
  return y ? Number(y[1]) * 12 + (end ? 11 : 0) : null;
}

// "### Title - Company (Start - End)": the title up to the last " - " before the dates.
export function roleHead(head: string, now = new Date()) {
  const m = /^(.*)\s+[-–—]\s+([^()]+?)\s*\(([^()]*)\)\s*$/.exec(head);
  if (!m) return { title: plain(head), company: "", start: "", end: "", months: null };
  const [start = "", end = ""] = m[3].split(/\s+[-–—]\s+/);
  const a = monthOf(start, false, now);
  const b = monthOf(end || start, true, now);
  return { title: plain(m[1]), company: plain(m[2]), start: start.trim(), end: end.trim(), months: a !== null && b !== null && b >= a ? b - a + 1 : null };
}

// A skill line into the names it lists: its bold name, or the words before a colon, or a short list split at its
// commas and semicolons; what a name carries in brackets or after its colon is its note.
export function skillsOf(line: string): Skill[] {
  const bold = /^\*\*([^*]+?)\*\*\s*(.*)$/.exec(line);
  if (bold) {
    const name = bold[1].replace(/:$/, "").trim();
    return [{ name, note: plain(bold[2].replace(/^[:\s]+/, "")) }];
  }
  const text = plain(line);
  const colon = text.indexOf(":");
  if (colon > 0 && colon <= 40) return [{ name: text.slice(0, colon).trim(), note: text.slice(colon + 1).trim() }];
  const items: Skill[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of `${text},`) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      const note = (/\(([^)]*)\)/.exec(cur)?.[1] ?? "").trim();
      const name = cur.replace(/\([^)]*\)/g, "").trim();
      if (name) items.push({ name, note });
      cur = "";
    } else cur += ch;
  }
  // A sentence, not a list: one name for all of it.
  return items.length && items.every((s) => s.name.length <= 40) ? items : [{ name: text.length > 40 ? `${text.slice(0, 38).trim()}…` : text, note: text.length > 40 ? text : "" }];
}

export function parseProfile(markdown: string, now = new Date()): Profile {
  const p: Profile = {
    name: "", status: "", location: "", email: "", phone: "", linkedin: "", github: "", facts: [], languages: [], interests: [],
    education: [], roles: [], projects: [], skills: [], awards: [], publications: [], references: [], others: [],
  };
  const text = markdown.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n");
  for (const part of parts(text)) {
    const body = text.slice(part.start, part.end).split("\n").slice(1);
    const title = part.title.toLowerCase();
    if (/^identity|^contact|^personal/.test(title)) {
      for (const sub of subparts(body)) {
        const t = sub.title.toLowerCase();
        if (/language/.test(t)) {
          p.languages = table(sub.lines).filter((r) => !isEmpty(r[0] ?? "")).map(([name = "", level = "", notes = ""]) => ({ name: plain(name), level: plain(level), notes: isEmpty(notes) ? "" : plain(notes) }));
          continue;
        }
        if (/interest|hobb/.test(t)) {
          p.interests = sub.lines.map((l) => BULLET.exec(l)?.[2] ?? "").filter((l) => l && !isEmpty(l)).map((l) => plain(l.replace(/^\*\*([^*]+?):?\*\*:?.*$/, "$1")));
          continue;
        }
        for (const line of sub.lines) {
          const f = FIELD.exec(line.trim());
          if (!f || isEmpty(f[2])) continue;
          const [key, value] = [f[1].trim(), plain(f[2])];
          const k = key.toLowerCase();
          if (k === "name") p.name = value;
          else if (k === "status") p.status = value;
          else if (/^(location|address|home)/.test(k)) p.location = value;
          else if (k === "email") p.email = value;
          else if (k === "phone") p.phone = value;
          else if (k === "linkedin") p.linkedin = value;
          else if (k === "github") p.github = value;
          else p.facts.push({ key, value });
        }
      }
    } else if (/^education/.test(title)) {
      p.education = table(body).filter((r) => !isEmpty(r[0] ?? "")).map(([degree = "", period = "", institution = "", topics = ""]) => ({ degree: plain(degree), period: plain(period), institution: plain(institution), topics: isEmpty(topics) ? "" : plain(topics) }));
    } else if (/experience|employment|work history/.test(title)) {
      for (const sub of subparts(body).slice(1)) {
        const role: Role = { ...roleHead(sub.title, now), notes: [], bullets: [] };
        for (const line of sub.lines) {
          const b = BULLET.exec(line);
          if (b && b[1].length >= 2 && role.bullets.length) role.bullets[role.bullets.length - 1].more.push(plain(b[2]));
          else if (b) role.bullets.push({ text: plain(b[2]), more: [] });
          else if (line.trim() && !role.bullets.length) role.notes.push(plain(line));
        }
        if (!isEmpty(role.title)) p.roles.push(role);
      }
    } else if (/project/.test(title)) {
      for (const line of body) {
        const b = BULLET.exec(line);
        if (!b) continue;
        if (b[1].length >= 2 && p.projects.length) { p.projects[p.projects.length - 1].more.push(plain(b[2])); continue; }
        const m = /^\*\*([^*]+?)\*\*\s*(?:\(([^)]*)\))?\s*:?\s*(.*)$/.exec(b[2]);
        if (!m || isEmpty(m[1])) continue;
        p.projects.push({ name: m[1].replace(/:$/, ""), links: (m[2] ?? "").match(/https?:\/\/[^\s,;)]+/g) ?? [], text: plain(m[3]), more: [] });
      }
    } else if (/skill/.test(title)) {
      for (const sub of subparts(body)) {
        const items = sub.lines.map((l) => BULLET.exec(l)).filter((b): b is RegExpExecArray => Boolean(b) && b![1].length < 2 && !isEmpty(b![2])).flatMap((b) => skillsOf(b[2]));
        if (items.length) p.skills.push({ group: sub.title, items });
      }
    } else if (/^award|^honou?r/.test(title) || /^publication/.test(title) || /^reference/.test(title)) {
      const list = body.map((l) => (BULLET.exec(l)?.[2] ?? /^\d+\.\s+(.*)$/.exec(l)?.[1] ?? l).trim()).filter((l) => l && !isEmpty(l) && !/^none\b/i.test(l)).map(plain);
      if (/^award|^honou?r/.test(title)) p.awards = list;
      else if (/^publication/.test(title)) p.publications = list;
      else p.references = list;
    } else {
      const md = body.join("\n").trim();
      if (md) p.others.push({ title: part.title, markdown: md });
    }
  }
  return p;
}

// Which way a line runs, by its first letter: right to left in Hebrew or Arabic, left to right in any other script,
// null when it has no letters.
export function dirOf(text: string): "ltr" | "rtl" | null {
  const first = /\p{L}/u.exec(text)?.[0];
  return !first ? null : /[\p{Script=Hebrew}\p{Script=Arabic}]/u.test(first) ? "rtl" : "ltr";
}

// Which way the profile's own words run: the way most of its written lines do, null while it has none. The page lays
// the cards out that way, so an English profile reads from the left on a Hebrew page. Names of skills and people are
// left out: they are often in English letters whatever the profile is written in.
export function profileDir(p: Profile): "ltr" | "rtl" | null {
  const dirs = [
    p.status, ...p.facts.map((f) => f.value), ...p.interests, ...p.awards,
    ...p.roles.flatMap((r) => [r.title, ...r.notes, ...r.bullets.map((b) => b.text)]),
    ...p.education.flatMap((e) => [e.degree, e.topics]), ...p.projects.map((x) => x.text),
  ].map(dirOf).filter(Boolean);
  if (!dirs.length) return null;
  return dirs.filter((d) => d === "rtl").length * 2 > dirs.length ? "rtl" : "ltr";
}

// How complete the profile is, as a careers site's profile check does it: each check by its part, and the share met.
export function profileHealth(p: Profile) {
  const groups = [
    { id: "basics", checks: [["name", Boolean(p.name)], ["email", Boolean(p.email)], ["phone", Boolean(p.phone)], ["location", Boolean(p.location)], ["linkedin", Boolean(p.linkedin)]] },
    { id: "languages", checks: [["languages", p.languages.length > 0]] },
    { id: "skills", checks: [["skills", p.skills.reduce((n, g) => n + g.items.length, 0) >= 5]] },
    { id: "experience", checks: [["roles", p.roles.length > 0], ["dates", p.roles.length > 0 && p.roles.every((r) => Boolean(r.start))], ["bullets", p.roles.length > 0 && p.roles.every((r) => r.bullets.length > 0)]] },
    { id: "education", checks: [["education", p.education.length > 0]] },
    { id: "projects", checks: [["projects", p.projects.length > 0]] },
  ].map((g) => ({ id: g.id, checks: g.checks.map(([id, ok]) => ({ id: id as string, ok: ok as boolean })) }));
  const all = groups.flatMap((g) => g.checks);
  return { score: Math.round((100 * all.filter((c) => c.ok).length) / all.length), groups };
}
