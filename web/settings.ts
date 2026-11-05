// Search settings: which markets and areas to search, and how to tell the agent about them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { INDUSTRIES, INDUSTRY_IDS, portalById, webPortals, type OwnPortal, type PortalSettings } from "./portals";
import { fromList, listedRole, matchListed, type Role } from "./roles";
import { APP_DIR } from "./user";

export type Tier = "near" | "ok" | "edge" | "far";
export type Area = { name: string; places: string[]; tier: Tier };
export type Market = { code: string; country: string; city: string; label: string };
export type Settings = {
  displayName: string;
  home: string;
  markets: Market[];
  areas: Area[];
  workMode: "any" | "remote" | "hybrid" | "onsite";
  seniority: "any" | "junior" | "middle" | "senior";
  relocate: boolean;
  roles: Role[];
  salaryMin: number;
  salaryMax: number;
  salaryCurrency: string;
  fields: string;
  studentJobs: "normal" | "low" | "exclude";
  language: "he" | "en";
  // The AI the site works with first, the others connected taking over when it fails (ai.ts).
  aiPrimary: "claude" | "openai";
  // The server runs the automation, so none of this reaches the agent's files.
  automation: { enabled: boolean; email: string; maxPerDay: number; runTimes: string[]; minScore: number };
  // The quick search's own choices on the jobs page, kept from one visit to the next: how recent, which market
  // ("all" or a code), the work type ("" follows workMode), and which areas show. Only the page uses these.
  quickSearch: { days: "1" | "7" | "14" | "30"; market: string; mode: "" | "any" | "remote" | "hybrid" | "onsite"; areas: "relevant" | "listed" | "all" };
  // Whether the introduction for a new user was finished or put aside (ui/views/welcome.tsx).
  introDone: boolean;
  // The industries wanted (portals.ts INDUSTRIES), none meaning all; whether employers outside high-tech (health
  // funds, hospitals, insurers, banks, government) are read; and the portals page's own choices: the portals
  // switched off, and the user's own.
  industries: string[];
  lowTech: boolean;
  portals: PortalSettings;
};

export const REMOTE = "REMOTE";
const TIERS: Tier[] = ["near", "ok", "edge", "far"];
const SETTINGS_FILE = path.join(APP_DIR, "settings.json");

export const EMPTY_SETTINGS: Settings = {
  displayName: "", home: "", markets: [], areas: [], workMode: "any", seniority: "any", relocate: false,
  roles: [{ id: "software", label: "Software", query: "Software Engineer" }],
  salaryMin: 0, salaryMax: 0, salaryCurrency: "", fields: "", studentJobs: "normal", language: "he", aiPrimary: "claude",
  automation: { enabled: false, email: "", maxPerDay: 3, runTimes: ["09:00"], minScore: 60 },
  quickSearch: { days: "14", market: "all", mode: "", areas: "relevant" },
  introDone: false,
  industries: [], lowTech: true, portals: { off: [], mine: [] },
};

// Ready-made areas for countries whose job locations are hard to type by hand.
export const REGION_PRESETS: Record<string, { name: string; places: string[] }[]> = {
  IL: [
    { name: "שרון", places: ["netanya", "hadera", "even yehuda", "kadima", "tel mond", "kfar saba", "ra'anana", "raanana", "herzliya", "hod hasharon", "ramat hasharon", "ha'sharon", "hasharon"] },
    { name: "מרכז וגוש דן", places: ["tel aviv", "ramat gan", "givatayim", "bnei brak", "petah", "rosh ha", "holon", "bat yam", "rishon", "rehovot", "ness ziona", "yehud", "airport city", "lod", "ramla", "kiryat ono", "center district", "central district"] },
    { name: "צפון וחיפה", places: ["haifa", "yokne", "caesarea", "tirat", "nesher", "migdal", "afula", "nazareth", "karmiel", "carmiel", "beit shean", "kiryat bialik", "kiryat ata", "kiryat motzkin", "kiryat yam", "kiryat haim", "kiryat tivon", "kiryat shmona", "north district", "akko", "acre", "nahariya", "tiberias", "zichron", "binyamina"] },
    { name: "מודיעין", places: ["modi'in", "modiin"] },
    { name: "ירושלים", places: ["jerusalem", "beit shemesh"] },
    { name: "דרום", places: ["ashdod", "ashkelon", "kiryat gat", "kiryat malakhi", "be'er sheva", "beer sheva", "beersheba", "yeruham", "dimona", "arad", "eilat", "south district", "sderot", "netivot", "ofakim"] },
  ],
};

// The Israeli boards (boards.ts) name places in Hebrew, the areas above in English: each Hebrew name stands for the
// English one the areas use, so a posting in "פתח תקווה" falls in the area with "petah". "קריית" is written "קרית"
// and "תקוה" "תקווה" before they are looked up.
export const HEBREW_PLACES: [string, string][] = [
  ["תל אביב", "tel aviv"], ["רמת גן", "ramat gan"], ["גבעתיים", "givatayim"], ["בני ברק", "bnei brak"], ["פתח תקווה", "petah tikva"],
  ["ראש העין", "rosh haayin"], ["חולון", "holon"], ["בת ים", "bat yam"], ["ראשון לציון", "rishon lezion"], ["רחובות", "rehovot"],
  ["נס ציונה", "ness ziona"], ["יהוד", "yehud"], ["איירפורט סיטי", "airport city"], ["לוד", "lod"], ["רמלה", "ramla"],
  ["קרית אונו", "kiryat ono"], ["אור יהודה", "or yehuda"], ["גבעת שמואל", "givat shmuel"], ["שוהם", "shoham"], ["יבנה", "yavne"],
  ["נתניה", "netanya"], ["חדרה", "hadera"], ["אבן יהודה", "even yehuda"], ["קדימה", "kadima"], ["תל מונד", "tel mond"],
  ["כפר סבא", "kfar saba"], ["רעננה", "raanana"], ["הרצליה", "herzliya"], ["הוד השרון", "hod hasharon"], ["רמת השרון", "ramat hasharon"],
  ["כפר יונה", "kfar yona"], ["פרדס חנה", "pardes hanna"], ["אור עקיבא", "or akiva"], ["זכרון יעקב", "zichron"], ["בנימינה", "binyamina"],
  ["חיפה", "haifa"], ["יקנעם", "yokneam"], ["קיסריה", "caesarea"], ["טירת כרמל", "tirat carmel"], ["נשר", "nesher"],
  ["מגדל העמק", "migdal haemek"], ["עפולה", "afula"], ["נצרת", "nazareth"], ["נוף הגליל", "nof hagalil"], ["כרמיאל", "karmiel"],
  ["בית שאן", "beit shean"], ["קרית ביאליק", "kiryat bialik"], ["קרית אתא", "kiryat ata"], ["קרית מוצקין", "kiryat motzkin"],
  ["קרית ים", "kiryat yam"], ["קרית חיים", "kiryat haim"], ["קרית טבעון", "kiryat tivon"], ["קרית שמונה", "kiryat shmona"],
  ["עכו", "akko"], ["נהריה", "nahariya"], ["טבריה", "tiberias"], ["צפת", "safed"],
  ["מודיעין", "modiin"], ["ירושלים", "jerusalem"], ["בית שמש", "beit shemesh"], ["מבשרת ציון", "mevaseret"], ["מעלה אדומים", "maale adumim"],
  ["אשדוד", "ashdod"], ["אשקלון", "ashkelon"], ["קרית גת", "kiryat gat"], ["קרית מלאכי", "kiryat malakhi"], ["באר שבע", "beer sheva"],
  ["ירוחם", "yeruham"], ["דימונה", "dimona"], ["ערד", "arad"], ["אילת", "eilat"], ["שדרות", "sderot"], ["נתיבות", "netivot"], ["אופקים", "ofakim"],
  ["גדרה", "gedera"], ["אריאל", "ariel"],
];
export function inEnglish(place: string) {
  const he = place.replace(/קריית/g, "קרית").replace(/תקוה/g, "תקווה");
  return HEBREW_PLACES.filter(([h]) => he.includes(h)).map(([, en]) => en).join(", ");
}

// These values end up in files the agent reads, so they stay single-line, short and plain.
export const clean = (value: unknown, max = 80) =>
  String(value ?? "").replace(/[\u0000-\u001f\u007f<>`|]/g, " ").replace(/\s+/g, " ").trim().replace(/^-+/, "").slice(0, max);

const wholeNumber = (value: unknown, max: number) => {
  const number = Math.round(Number(value));
  return number > 0 && number <= max ? number : 0;
};

// A web address the user added as a portal: http or https on a named host, never this computer or its network,
// since the portals check fetches a careers page added here.
export function portalUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase();
    if (!/^https?:$/.test(url.protocol) || !host.includes(".") || url.username || url.password) return "";
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)|^172\.(1[6-9]|2\d|3[01])\.|\.local$|^\[/.test(host)) return "";
    return url.href.slice(0, 500);
  } catch {
    return "";
  }
}

function portalSettings(input: any): PortalSettings {
  const mine = (Array.isArray(input?.mine) ? input.mine : []).slice(0, 60).flatMap((p: any): OwnPortal[] => {
    const id = String(p?.id ?? "");
    const url = portalUrl(p?.url);
    const name = clean(p?.name, 60) || (url ? new URL(url).hostname.replace(/^www\./, "") : "");
    return /^own-[a-z0-9]{4,16}$/.test(id) && url ? [{ id, name, url, kind: (["page", "group", "link"] as const).find((k) => k === p?.kind) ?? "link" }] : [];
  });
  const known = (id: string) => Boolean(portalById(id)) || mine.some((p) => p.id === id);
  const off = [...new Set((Array.isArray(input?.off) ? input.off : []).map(String))].filter(known);
  return { off, mine };
}

export function validateSettings(input: any): Settings {
  const markets = (Array.isArray(input?.markets) ? input.markets : []).slice(0, 3).flatMap((m: any): Market[] => {
    const code = String(m?.code ?? "").toUpperCase();
    if (code !== REMOTE && !/^[A-Z]{2}$/.test(code)) return [];
    const country = clean(m?.country) || code;
    return [{ code, country, city: code === REMOTE ? "" : clean(m?.city), label: clean(m?.label) || country }];
  });
  const areas = (Array.isArray(input?.areas) ? input.areas : []).slice(0, 30).flatMap((a: any): Area[] => {
    const name = clean(a?.name);
    const places = (Array.isArray(a?.places) ? a.places : [name]).slice(0, 40).map((p: unknown) => clean(p).toLowerCase()).filter(Boolean);
    return name && places.length && TIERS.includes(a?.tier) ? [{ name, places, tier: a.tier }] : [];
  });
  const pick = <T extends string>(value: unknown, options: readonly T[]): T =>
    options.includes(value as T) ? (value as T) : options[0];
  const seniority = pick(input?.seniority, ["any", "junior", "middle", "senior"] as const);
  // A role from the ready-made list is rebuilt from it, so its search always carries the level set here.
  const seen = new Set<string>();
  const roles = (Array.isArray(input?.roles) ? input.roles : []).slice(0, 30).flatMap((r: any): Role[] => {
    const query = clean(typeof r === "string" ? r : r?.query, 120);
    const listed = listedRole(r?.id) ?? matchListed(query, seniority);
    const role = listed ? fromList(listed, seniority) : query ? { label: clean(r?.label, 40) || query, query } : null;
    if (!role || seen.has(role.query.toLowerCase())) return [];
    seen.add(role.query.toLowerCase());
    return [role];
  });
  const salary = [wholeNumber(input?.salaryMin, 10_000_000), wholeNumber(input?.salaryMax, 10_000_000)];
  const [salaryMin, salaryMax] = salary[0] && salary[1] ? salary.sort((a, b) => a - b) : salary;
  const email = clean(input?.automation?.email, 120);
  // Up to three run times a day, in order; a settings file from before keeps its one runAt.
  const times = (Array.isArray(input?.automation?.runTimes) ? input.automation.runTimes : [input?.automation?.runAt])
    .map(String).filter((t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
  return {
    displayName: clean(input?.displayName, 40),
    home: clean(input?.home),
    markets,
    areas,
    workMode: pick(input?.workMode, ["any", "remote", "hybrid", "onsite"] as const),
    seniority,
    relocate: input?.relocate === true,
    roles,
    salaryMin,
    salaryMax,
    salaryCurrency: clean(input?.salaryCurrency, 8),
    fields: clean(input?.fields, 200),
    studentJobs: pick(input?.studentJobs, ["normal", "low", "exclude"] as const),
    language: pick(input?.language, ["he", "en"] as const),
    aiPrimary: pick(input?.aiPrimary, ["claude", "openai"] as const),
    automation: {
      enabled: input?.automation?.enabled === true,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
      maxPerDay: Math.min(wholeNumber(input?.automation?.maxPerDay, 1000) || 3, 10),
      runTimes: times.length ? [...new Set<string>(times)].sort().slice(0, 3) : ["09:00"],
      minScore: wholeNumber(input?.automation?.minScore, 100) || 60,
    },
    // pick's first option is the one a missing or strange value gets; a market no longer chosen falls back to all.
    quickSearch: {
      days: pick(String(input?.quickSearch?.days ?? ""), ["14", "1", "7", "30"] as const),
      market: markets.some((m) => m.code === input?.quickSearch?.market) ? input.quickSearch.market : "all",
      mode: pick(input?.quickSearch?.mode, ["", "any", "remote", "hybrid", "onsite"] as const),
      areas: pick(input?.quickSearch?.areas, ["relevant", "listed", "all"] as const),
    },
    introDone: input?.introDone === true,
    industries: [...new Set((Array.isArray(input?.industries) ? input.industries : []).map(String))].filter((i) => INDUSTRY_IDS.includes(i)),
    // On unless switched off, so settings saved before it existed get it.
    lowTech: input?.lowTech !== false,
    portals: portalSettings(input?.portals),
  };
}

// The roles /setup chooses from the list (pick-roles.ts), in its order, at a level if it gives one. They replace
// those chosen from the list before; any typed in by hand stay, after them.
export function pickRoles(settings: Settings, ids: string[], level?: Settings["seniority"]): Settings {
  const seniority = level ?? settings.seniority;
  const own = settings.roles.filter((r) => !listedRole(r.id));
  return validateSettings({ ...settings, seniority, roles: [...ids.flatMap((id) => listedRole(id) ? [{ id }] : []), ...own] });
}

export function loadSettings(file = SETTINGS_FILE): Settings {
  if (!existsSync(file)) return EMPTY_SETTINGS;
  try {
    return validateSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    console.error("Could not read settings:", err);
    return EMPTY_SETTINGS;
  }
}

export const linkedinPlace = (m: Market) =>
  m.code === REMOTE ? "Remote" : m.city ? `${m.city}, ${m.country}` : m.country;

const STUDENT_JOBS = {
  normal: "treat them like any other position",
  low: "less relevant, because the degree is finished. Do not exclude them, but rank them low and flag them",
  exclude: "not wanted, so skip them and say so",
};

function salaryLine({ salaryMin: min, salaryMax: max, salaryCurrency: currency }: Settings) {
  if (!min && !max) return "not set, so ask the candidate before stating a number";
  const amount = (n: number) => `${n.toLocaleString("en-US")}${currency ? ` ${currency}` : ""}`;
  const range = min && max ? `Between ${amount(min)} and ${amount(max)}` : `About ${amount(min || max)}`;
  return `${range} gross a month, depending on the role and the experience it asks for. This is for application forms and interviews, and never goes on a CV. Confirm the number with the candidate before submitting it anywhere`;
}

// Also what the ranking tells the model about where the candidate works (ranker.ts).
export function renderBlock(s: Settings) {
  const names =(tier: Tier) => s.areas.filter((a) => a.tier === tier).map((a) => `${a.name} (${a.places.join(", ")})`).join("; ") || "none set";
  const market = (m: Market) => m.code === REMOTE
    ? `Remote from anywhere (linkedin-search --location "Remote" --remote remote; freehire-search --remote remote)`
    : `${linkedinPlace(m)} (linkedin-search --location "${linkedinPlace(m)}"; freehire-search --country ${m.code}${m.city ? ` --city "${m.city}"` : ""})`;
  return [
    BEGIN,
    "### Search settings",
    "Set by the candidate on the web interface's settings screen. These are authoritative for where and what to search, and for the location verdict in every evaluation. They override any other location detail in this workspace.",
    `- **Home base:** ${s.home || "not set"}`,
    `- **Markets:** ${s.markets.map(market).join("; ") || "none set, ask the candidate"}. \`[MARKET]\` in the query templates means each of these.`,
    `- **Work mode:** ${s.workMode}`,
    `- **Seniority:** ${s.seniority}. For freehire-search use ${s.seniority === "any" ? "no --seniority flag" : `--seniority ${s.seniority}`}.`,
    `- **Relocation:** ${s.relocate ? "acceptable, so a posting in a listed market passes the location check" : "not wanted, so a posting that requires it is a location FAIL"}`,
    `- **Preferred areas:** ${names("near")}`,
    `- **Acceptable areas:** ${names("ok")}`,
    `- **Borderline areas, FLAG these:** ${names("edge")}`,
    `- **Excluded areas, location FAIL when the job has regular office days:** ${names("far")}`,
    "- **Anything else:** Inside a listed market but not in a listed area, FLAG it when areas are set, otherwise PASS. Remote and hybrid jobs that hire in a listed market PASS unless the work mode above excludes them. Outside every listed market, FAIL.",
    `- **Role focus:** ${s.roles.map((r) => r.query).join("; ") || "not set"}`,
    `- **Fields of interest:** ${s.fields || "not set"}`,
    `- **Industries wanted:** ${s.industries.map((id) => INDUSTRIES.find((i) => i.id === id)?.en).filter(Boolean).join(", ") || "any"}`,
    `- **Employers outside high-tech:** ${s.lowTech ? "wanted (health funds, hospitals, insurers, banks, government, academia and the like), and rank them like any other employer" : "not wanted, so skip them"}.`,
    "- **Read by the web interface itself:** the Israeli boards AllJobs, Drushim and JobMaster, and the employers on its portals page, are searched by the server's portals check in the same daily run, so don't search those here.",
    `- **Also search with WebSearch** (sites the search tools don't cover; run each role, in English and in Hebrew, with site:): ${webPortals(s).map((p) => `site:${p.site}`).join(", ") || "none"}. For posts, add words like hiring, מגייסים or דרושים to the role; a post only counts when it names an employer and a way to apply.`,
    `- **Student positions:** ${STUDENT_JOBS[s.studentJobs]}.`,
    `- **Salary expectations:** ${salaryLine(s)}.`,
    `- **Conversation language:** ${s.language === "en" ? "English" : "Hebrew"}. Talk to the candidate in this language. CVs and application material keep their own language rules.`,
    END,
  ].join("\n");
}

const BEGIN = "<!-- BEGIN WEB-SETTINGS (written by the web interface's settings screen, do not edit by hand) -->";
const END = "<!-- END WEB-SETTINGS -->";

function replaceBlock(text: string, block: string) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1) return `${text.replace(/\s*$/, "")}\n\n${block}\n`;
  return text.slice(0, start) + block + text.slice(end + END.length);
}

// The user's own instructions and queries, in user/ (user.ts); one not there yet starts from templates/user/.
const AGENT_FILES = ["user/CLAUDE.md", "user/search-queries.md"];

export function syncWorkspace(settings: Settings, repo: string) {
  const block = renderBlock(settings);
  for (const rel of AGENT_FILES) {
    const file = path.join(repo, rel);
    const starting = path.join(repo, "templates", rel);
    const text = existsSync(file) ? readFileSync(file, "utf8") : existsSync(starting) ? readFileSync(starting, "utf8") : "";
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, replaceBlock(text, block));
  }
}

export function saveSettings(input: unknown, repo: string, file = SETTINGS_FILE): Settings {
  const settings = validateSettings(input);
  syncWorkspace(settings, repo);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2));
  return settings;
}
