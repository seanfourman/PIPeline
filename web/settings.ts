// Search settings: which markets and areas to search, and how to tell the agent about them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  roles: { label: string; query: string }[];
  salaryMin: number;
  salaryMax: number;
  salaryCurrency: string;
  fields: string;
  studentJobs: "normal" | "low" | "exclude";
  language: "he" | "en";
  // The server runs the automation, so none of this reaches the agent's files.
  automation: { enabled: boolean; email: string; maxPerDay: number; runAt: string; minScore: number };
};

export const REMOTE = "REMOTE";
const TIERS: Tier[] = ["near", "ok", "edge", "far"];
const SETTINGS_FILE = path.join(import.meta.dir, "data", "settings.json");

export const EMPTY_SETTINGS: Settings = {
  displayName: "", home: "", markets: [], areas: [], workMode: "any", seniority: "any", relocate: false,
  roles: [{ label: "Software Engineer", query: "Software Engineer" }],
  salaryMin: 0, salaryMax: 0, salaryCurrency: "", fields: "", studentJobs: "normal", language: "he",
  automation: { enabled: false, email: "", maxPerDay: 3, runAt: "09:00", minScore: 60 },
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

// These values end up in files the agent reads, so they stay single-line, short and plain.
export const clean = (value: unknown, max = 80) =>
  String(value ?? "").replace(/[\u0000-\u001f\u007f<>`|]/g, " ").replace(/\s+/g, " ").trim().replace(/^-+/, "").slice(0, max);

const wholeNumber = (value: unknown, max: number) => {
  const number = Math.round(Number(value));
  return number > 0 && number <= max ? number : 0;
};

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
  const roles = (Array.isArray(input?.roles) ? input.roles : []).slice(0, 30).flatMap((r: any) => {
    const query = clean(r?.query ?? r, 120);
    return query ? [{ label: clean(r?.label, 40) || query, query }] : [];
  });
  const pick = <T extends string>(value: unknown, options: readonly T[]): T =>
    options.includes(value as T) ? (value as T) : options[0];
  const salary = [wholeNumber(input?.salaryMin, 10_000_000), wholeNumber(input?.salaryMax, 10_000_000)];
  const [salaryMin, salaryMax] = salary[0] && salary[1] ? salary.sort((a, b) => a - b) : salary;
  const email = clean(input?.automation?.email, 120);
  const runAt = String(input?.automation?.runAt ?? "");
  return {
    displayName: clean(input?.displayName, 40),
    home: clean(input?.home),
    markets,
    areas,
    workMode: pick(input?.workMode, ["any", "remote", "hybrid", "onsite"] as const),
    seniority: pick(input?.seniority, ["any", "junior", "middle", "senior"] as const),
    relocate: input?.relocate === true,
    roles,
    salaryMin,
    salaryMax,
    salaryCurrency: clean(input?.salaryCurrency, 8),
    fields: clean(input?.fields, 200),
    studentJobs: pick(input?.studentJobs, ["normal", "low", "exclude"] as const),
    language: pick(input?.language, ["he", "en"] as const),
    automation: {
      enabled: input?.automation?.enabled === true,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
      maxPerDay: Math.min(wholeNumber(input?.automation?.maxPerDay, 1000) || 3, 10),
      runAt: /^([01]\d|2[0-3]):[0-5]\d$/.test(runAt) ? runAt : "09:00",
      minScore: wholeNumber(input?.automation?.minScore, 100) || 60,
    },
  };
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

function renderBlock(s: Settings) {
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

const AGENT_FILES = ["CLAUDE.md", ".claude/skills/job-scraper/search-queries.md"];

export function syncWorkspace(settings: Settings, repo: string) {
  const block = renderBlock(settings);
  for (const rel of AGENT_FILES) {
    const file = path.join(repo, rel);
    writeFileSync(file, replaceBlock(readFileSync(file, "utf8"), block));
  }
}

export function saveSettings(input: unknown, repo: string, file = SETTINGS_FILE): Settings {
  const settings = validateSettings(input);
  syncWorkspace(settings, repo);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2));
  return settings;
}
