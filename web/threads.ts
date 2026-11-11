// A conversation's place in the list, as a chat app keeps it (2026-11-10): pinned to the top, archived out of the
// way, or in a project; renamed; and found by a search through its title and its words. Pure helpers, so agent.ts,
// which holds the conversations, and the tests share them; the projects themselves are in projects.ts.

export type Meta = { title?: string; pinned?: number | null; archived?: boolean; project?: string | null };

// A name as it may stand: one line, its spaces made single, at most so long.
export const cleanName = (raw: unknown, max: number) => String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// A change asked for, each field checked: a title of 1 to 200 characters; pinned true (now) or false; archived true
// or false (an archived conversation is no longer pinned); a project that exists, or "" or null to take it out of its
// project. Fields not asked for stay out; null when nothing asked for holds up.
export function metaChange(body: Record<string, unknown>, projects: string[], now = Date.now()): Meta | null {
  const out: Meta = {};
  if ("title" in body) {
    const title = cleanName(body.title, 200);
    if (!title) return null;
    out.title = title;
  }
  if ("pinned" in body) {
    if (typeof body.pinned !== "boolean") return null;
    out.pinned = body.pinned ? now : null;
  }
  if ("archived" in body) {
    if (typeof body.archived !== "boolean") return null;
    out.archived = body.archived;
    if (body.archived) out.pinned = null;
  }
  if ("project" in body) {
    const project = body.project === null ? "" : String(body.project);
    if (project && !projects.includes(project)) return null;
    out.project = project || null;
  }
  return Object.keys(out).length ? out : null;
}

// Whether a conversation answers a search: every word asked for is in its title or in its words (yours or Pip's),
// without case.
export function matches(c: { title: string; events: { t: string; text?: unknown }[] }, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const texts = [c.title, ...c.events.filter((e) => e.t === "user" || e.t === "text").map((e) => String(e.text ?? ""))].map((t) => t.toLowerCase());
  return words.every((w) => texts.some((t) => t.includes(w)));
}
