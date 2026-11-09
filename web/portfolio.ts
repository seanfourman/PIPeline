// The user's portfolio, which the /portfolio skill builds in user/portfolio/: portfolio.json, the projects worth
// showing with what was written about each, for the portfolio page; and the pictures and videos it shows, served
// from user/portfolio/media/ only. A conversation writes the file from what it read in the user's projects, so it is
// read as data: each field cut to size and to its kind, links kept to the web's, and media kept to the media folder
// and to files that are there.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { clean } from "./settings";
import { USER_DIR } from "./user";

export const PORTFOLIO_DIR = path.join(USER_DIR, "portfolio");

export const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".mp4": "video/mp4", ".webm": "video/webm",
};

const TIERS = ["featured", "showcase"] as const;
const README_STATES = ["strong", "thin", "missing", "generated"] as const;

export type PortfolioProject = {
  slug: string; name: string; tier: (typeof TIERS)[number]; score: number | null; why: string;
  tagline: string; summary: string; highlights: string[]; stack: string[]; role: string;
  timeline: { from: string; to: string };
  links: { repo: string; live: string; video: string };
  media: { cover: string; reel: string; video: string; poster: string };
  source: { path: string; github: string };
  readme: { status: (typeof README_STATES)[number] | ""; path: string };
};
export type Portfolio = {
  updated: string;
  owner: { name: string; headline: string; github: string; links: { linkedin: string; site: string; email: string } };
  projects: PortfolioProject[];
  skipped: { name: string; why: string }[];
  // Whether the website the skill builds (user/portfolio/site/) is there.
  site: boolean;
};
// What the page gets: the portfolio once written, and the scan's count and time once the scan ran.
export type PortfolioState = { portfolio: Portfolio | null; scanned: { at: string; count: number } | null };

const MOST_PROJECTS = 60;
const MOST_SKIPPED = 200;

// Text from the file: a string or a number only, anything else is none.
const text = (value: unknown, max: number) => (typeof value === "string" || typeof value === "number" ? clean(value, max) : "");
const list = (value: unknown, most: number, max: number) =>
  (Array.isArray(value) ? value.map((v) => text(v, max)).filter(Boolean) : []).slice(0, most);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T | "") => (options.includes(value as T) ? value as T : fallback);

// A link the page may open: the web's only.
export function webLink(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!/^https?:\/\/[^\s<>"'`]+$/i.test(raw) || raw.length > 500) return "";
  try { return new URL(raw).href; } catch { return ""; }
}

const email = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^[^\s@<>"'`]{1,64}@[^\s@<>"'`]{1,190}\.[a-z]{2,24}$/i.test(raw) ? raw : "";
};

// A media file the page may show, as the file names it (relative to user/portfolio/): inside its media folder, of a
// picture's or a video's type, and there.
export function mediaFile(rel: unknown, dir = PORTFOLIO_DIR): string | null {
  if (typeof rel !== "string" || !rel || rel.length > 300 || rel.includes("\0")) return null;
  const parts = rel.replaceAll("\\", "/").split("/");
  if (parts[0] !== "media" || parts.length < 2 || parts.some((p) => !p || p === "." || p === ".." || p.includes(":"))) return null;
  if (!Object.hasOwn(MEDIA_TYPES, path.extname(rel).toLowerCase())) return null;
  const media = path.join(dir, "media");
  const abs = path.join(dir, ...parts);
  try {
    // Followed through any link, it must still be in the media folder.
    const real = realpathSync(abs);
    if (!real.startsWith(realpathSync(media) + path.sep) || !statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

const media = (value: unknown, dir: string) => {
  const rel = typeof value === "string" ? value.replaceAll("\\", "/").replace(/^\.\//, "") : "";
  return mediaFile(rel, dir) ? rel : "";
};

const slugOf = (value: unknown, name: string) => {
  const given = typeof value === "string" ? value.toLowerCase() : "";
  const made = (/^[a-z0-9][a-z0-9-]{0,63}$/.test(given) ? given : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64));
  return made || "project";
};

function project(raw: unknown, dir: string): PortfolioProject | null {
  const p = obj(raw);
  const name = text(p.name, 80);
  if (!name) return null;
  const score = Number(p.score);
  const links = obj(p.links);
  const m = obj(p.media);
  const timeline = obj(p.timeline);
  const source = obj(p.source);
  const readme = obj(p.readme);
  return {
    slug: slugOf(p.slug, name), name, tier: oneOf(p.tier, TIERS, "showcase") || "showcase",
    score: Number.isFinite(score) && score >= 0 && score <= 100 ? Math.round(score) : null,
    why: text(p.why, 300), tagline: text(p.tagline, 120), summary: text(p.summary, 900),
    highlights: list(p.highlights, 6, 300), stack: list(p.stack, 14, 40), role: text(p.role, 80),
    timeline: { from: text(timeline.from, 20), to: text(timeline.to, 20) },
    links: { repo: webLink(links.repo), live: webLink(links.live), video: webLink(links.video) },
    media: { cover: media(m.cover, dir), reel: media(m.reel, dir), video: media(m.video, dir), poster: media(m.poster, dir) },
    source: { path: text(source.path, 300), github: text(source.github, 120) },
    readme: { status: oneOf(readme.status, README_STATES, ""), path: text(readme.path, 300) },
  };
}

// The portfolio as the page shows it, and whether the scan ran; none of either until the skill writes them.
export function readPortfolio(dir = PORTFOLIO_DIR): PortfolioState {
  let scanned: PortfolioState["scanned"] = null;
  try {
    const inventory = JSON.parse(readFileSync(path.join(dir, "inventory.json"), "utf8"));
    if (Array.isArray(inventory?.projects)) scanned = { at: text(inventory.generated, 40), count: inventory.projects.length };
  } catch { /* not scanned yet */ }
  let raw: Record<string, unknown>;
  try {
    raw = obj(JSON.parse(readFileSync(path.join(dir, "portfolio.json"), "utf8")));
  } catch {
    return { portfolio: null, scanned };
  }
  const seen = new Set<string>();
  const projects: PortfolioProject[] = [];
  for (const one of Array.isArray(raw.projects) ? raw.projects.slice(0, MOST_PROJECTS) : []) {
    const p = project(one, dir);
    if (!p) continue;
    // Each slug once, so the page can tell the projects apart.
    let slug = p.slug;
    for (let n = 2; seen.has(slug); n++) slug = `${p.slug}-${n}`;
    seen.add(slug);
    projects.push({ ...p, slug });
  }
  // Featured first, each tier in the file's order.
  projects.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  const owner = obj(raw.owner);
  const links = obj(owner.links);
  return {
    portfolio: {
      updated: text(raw.updated, 40),
      owner: {
        name: text(owner.name, 80), headline: text(owner.headline, 160), github: webLink(owner.github),
        links: { linkedin: webLink(links.linkedin), site: webLink(links.site), email: email(links.email) },
      },
      projects,
      skipped: (Array.isArray(raw.skipped) ? raw.skipped : []).slice(0, MOST_SKIPPED)
        .map((s) => ({ name: text(obj(s).name, 80), why: text(obj(s).why, 300) })).filter((s) => s.name),
      site: existsSync(path.join(dir, "site", "index.html")),
    },
    scanned,
  };
}

// The bytes a Range header asks for, of a file this size: null for the whole file (no header, or one this doesn't
// read), "bad" for a range past its end.
export function byteRange(header: string | null, size: number): { start: number; end: number } | null | "bad" {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1] && Number(m[2]) === 0) return "bad";
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) return "bad";
  return { start, end };
}
