// The jobs the user saved themselves, from a search's results or from what Pip found. They are kept apart from the
// list Pip's own searches fill (user/job_scraper/seen_jobs.json, which the ranking and the daily run work from), so
// saving one changes nothing those do. Each is known by its address, with what was shown of it when it was saved,
// the newest first.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EditError } from "./edit";
import { clean } from "./settings";
import { APP_DIR } from "./user";

export const SAVED_FILE = path.join(APP_DIR, "saved_jobs.json");
// The most kept; saving past it lets the oldest go.
const MOST = 500;

export type SavedJob = { url: string; title: string; company: string; location: string; date: string; saved: string };

export function readSaved(file = SAVED_FILE): SavedJob[] {
  try {
    const list = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(list) ? list.filter((j) => typeof j?.url === "string") : [];
  } catch {
    return [];
  }
}

// One job saved, or taken off with save: false. Its address must be the web's; what is shown of it is cleaned and
// cut to size, as everything a page sends is.
export function setSaved(input: any, file = SAVED_FILE, now = new Date().toISOString()): SavedJob[] {
  const url = String(input?.url ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) throw new EditError("bad_url");
  const list = readSaved(file).filter((j) => j.url !== url);
  if (input?.save !== false) {
    list.unshift({
      url, title: clean(input?.title, 200), company: clean(input?.company, 120), location: clean(input?.location, 120), date: clean(input?.date, 40), saved: now,
    });
    list.length = Math.min(list.length, MOST);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(list, null, 2));
  return list;
}
