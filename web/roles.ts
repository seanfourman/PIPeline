// The ready-made roles the settings screen offers, by field, for anyone to choose from. Each is a plain job title,
// and the search for it adds the experience level from the settings ("Junior Backend Developer" for a junior),
// except the few that are a level of their own, like graduate positions. Both the server and the browser use
// this, so nothing here needs Node.

export type Level = "any" | "junior" | "middle" | "senior";
// he and en are the short names on the jobs page's buttons. hebrew is how Israeli job boards' postings name the role,
// searched there beside the English title (boards.ts), since postings outside high-tech are mostly in Hebrew.
export type ListedRole = { id: string; title: string; he: string; en: string; fixed?: boolean; hebrew?: string };
// A role as the settings keep it: id for one from the list, none for one typed in by hand.
export type Role = { label: string; query: string; id?: string };

// words are what a posting's title in the field contains, in either language, for picking the field's postings
// out of an employer's whole list (boards.ts); they are matched from the start of a word, in lower case.
export const ROLE_FIELDS: { id: string; he: string; en: string; words: string[]; roles: ListedRole[] }[] = [
  { id: "software", he: "פיתוח תוכנה", en: "Software development",
    words: ["software", "developer", "engineer", "programmer", "full stack", "fullstack", "backend", "back-end", "frontend", "front-end", "mobile", "android", "ios", "embedded", "python", "java", ".net", "c#", "react", "node", "פיתוח", "מפתח", "מתכנת", "תוכנה", "תכנות", "מהנדס"],
    roles: [
      { id: "software", title: "Software Engineer", he: "Software", en: "Software", hebrew: "מפתח תוכנה" },
      { id: "fullstack", title: "Full Stack Developer", he: "Full Stack", en: "Full Stack", hebrew: "מפתח פול סטאק" },
      { id: "backend", title: "Backend Developer", he: "Backend", en: "Backend", hebrew: "מפתח צד שרת" },
      { id: "frontend", title: "Frontend Developer", he: "Frontend", en: "Frontend", hebrew: "מפתח צד לקוח" },
      { id: "mobile", title: "Mobile Developer", he: "מובייל", en: "Mobile", hebrew: "מפתח מובייל" },
      { id: "embedded", title: "Embedded Software Engineer", he: "Embedded", en: "Embedded", hebrew: "מפתח Embedded" },
      { id: "python", title: "Python Developer", he: "Python", en: "Python", hebrew: "מפתח Python" },
      { id: "java", title: "Java Developer", he: "Java", en: "Java", hebrew: "מפתח Java" },
      { id: "dotnet", title: ".NET Developer", he: ".NET", en: ".NET", hebrew: "מפתח .NET" },
    ] },
  { id: "data", he: "Data ו-AI", en: "Data and AI",
    words: ["data", "analyst", "analytics", "bi", "sql", "machine learning", "ml", "ai", "algorithm", "statistic", "scientist", "דאטה", "נתונים", "אנליסט", "אנליטי", "מידע", "סטטיסט", "כלכלן", "אלגוריתם", "בינה", "למידת מכונה", "מודל"],
    roles: [
      { id: "ml", title: "Machine Learning Engineer", he: "AI / ML", en: "AI / ML", hebrew: "למידת מכונה" },
      { id: "ai", title: "AI Engineer", he: "AI Engineer", en: "AI Engineer", hebrew: "בינה מלאכותית" },
      { id: "vision", title: "Computer Vision Engineer", he: "Computer Vision", en: "Computer Vision", hebrew: "ראייה ממוחשבת" },
      { id: "algorithms", title: "Algorithm Developer", he: "אלגוריתמים", en: "Algorithms", hebrew: "אלגוריתמים" },
      { id: "datascience", title: "Data Scientist", he: "Data Science", en: "Data Science", hebrew: "דאטה סיינטיסט" },
      { id: "dataeng", title: "Data Engineer", he: "Data", en: "Data", hebrew: "מהנדס נתונים" },
      { id: "analyst", title: "Data Analyst", he: "אנליסט נתונים", en: "Data Analyst", hebrew: "אנליסט נתונים" },
      { id: "bi", title: "BI Developer", he: "BI", en: "BI", hebrew: "מפתח BI" },
    ] },
  { id: "quality", he: "QA ואוטומציה", en: "QA and automation",
    words: ["qa", "quality", "test", "automation", "validation", "verification", "בדיקות", "בודק", "אוטומציה", "ולידציה", "איכות"],
    roles: [
      { id: "qa", title: "QA Engineer", he: "QA", en: "QA", hebrew: "בודק תוכנה" },
      { id: "automation", title: "QA Automation Engineer", he: "אוטומציה", en: "Automation", hebrew: "בודק אוטומציה" },
      { id: "validation", title: "Validation Engineer", he: "ולידציה", en: "Validation", hebrew: "מהנדס ולידציה" },
    ] },
  { id: "infra", he: "DevOps ותשתיות", en: "DevOps and infrastructure",
    words: ["devops", "cloud", "sre", "infrastructure", "integration", "system", "sysadmin", "network", "it", "helpdesk", "תשתיות", "מחשוב", "מערכות", "סיסטם", "רשת", "רשתות", "אינטגרציה", "ענן", "הלפדסק"],
    roles: [
      { id: "devops", title: "DevOps Engineer", he: "DevOps", en: "DevOps", hebrew: "DevOps" },
      { id: "cloud", title: "Cloud Engineer", he: "Cloud", en: "Cloud", hebrew: "מהנדס ענן" },
      { id: "sre", title: "Site Reliability Engineer", he: "SRE", en: "SRE" },
      { id: "integration", title: "System Integration Engineer", he: "אינטגרציה", en: "Integration", hebrew: "מהנדס אינטגרציה" },
      { id: "sysadmin", title: "System Administrator", he: "ניהול מערכות", en: "SysAdmin", hebrew: "מנהל מערכות" },
      { id: "network", title: "Network Engineer", he: "רשתות", en: "Networking", hebrew: "מהנדס רשתות" },
    ] },
  { id: "security", he: "סייבר", en: "Security",
    words: ["security", "cyber", "soc", "siem", "סייבר", "אבטחת מידע", "הגנת"],
    roles: [
      { id: "security", title: "Security Engineer", he: "סייבר", en: "Security", hebrew: "אבטחת מידע" },
      { id: "soc", title: "SOC Analyst", he: "SOC", en: "SOC", hebrew: "אנליסט SOC" },
    ] },
  { id: "product", he: "מוצר, עיצוב ותמיכה", en: "Product, design and support",
    words: ["product", "ux", "ui", "designer", "support", "solutions", "implementation", "מוצר", "מעצב", "חוויית משתמש", "תמיכה", "הטמעה", "דיגיטל", "מנתח מערכות", "ניתוח מערכות"],
    roles: [
      { id: "product", title: "Product Manager", he: "מוצר", en: "Product", hebrew: "מנהל מוצר" },
      { id: "ux", title: "UX/UI Designer", he: "UX/UI", en: "UX/UI", hebrew: "מעצב UX" },
      { id: "support", title: "Technical Support Engineer", he: "תמיכה טכנית", en: "Tech Support", hebrew: "תמיכה טכנית" },
      { id: "solutions", title: "Solutions Engineer", he: "Solutions", en: "Solutions", hebrew: "מהנדס פתרונות" },
    ] },
  { id: "start", he: "תחילת הדרך", en: "Starting out",
    words: ["student", "intern", "graduate", "junior", "entry", "סטודנט", "מתמחה", "התמחות", "בוגר", "ג'וניור", "ללא ניסיון"],
    roles: [
      { id: "graduate", title: "Graduate Software Engineer", he: "בוגרים", en: "Graduates", fixed: true, hebrew: "בוגרי תואר" },
      { id: "student", title: "Student Software Engineer", he: "סטודנטים", en: "Students", fixed: true, hebrew: "סטודנט" },
    ] },
];

const LISTED = new Map(ROLE_FIELDS.flatMap((f) => f.roles.map((r) => [r.id, r] as const)));
// Mid-level postings rarely say so, so that level, like any level, searches the title alone.
const PREFIX: Record<Level, string> = { any: "", middle: "", junior: "Junior ", senior: "Senior " };

export const listedRole = (id: unknown) => (typeof id === "string" ? LISTED.get(id) : undefined);
export const roleQuery = (r: ListedRole, level: Level) => (r.fixed ? r.title : PREFIX[level] + r.title);
export const fromList = (r: ListedRole, level: Level): Role => ({ id: r.id, label: r.en, query: roleQuery(r, level) });

// A role saved before the list existed, or typed in by hand, that is exactly one from the list at this level
// counts as that one, so it follows the level from then on.
export function matchListed(query: string, level: Level) {
  const wanted = query.trim().toLowerCase();
  for (const r of LISTED.values()) if (roleQuery(r, level).toLowerCase() === wanted) return r;
  return undefined;
}

// The name on a role's button, in the page's language: the list's for one from it, otherwise the one given.
export const roleLabel = (role: Role, lang: "he" | "en") => listedRole(role.id)?.[lang] ?? role.label;

const FIELD_OF = new Map(ROLE_FIELDS.flatMap((f) => f.roles.map((r) => [r.id, f] as const)));
const lower = (s: string) => s.toLowerCase().replace(/[׳']/g, "'");
// From the start of a word, so "it" doesn't match "with", nor "bi" "mobile"; a Hebrew word may carry the letters
// that join a word at its front (ו, ה, ל, ב, מ, ש, כ), so "לאנליסט" still matches "אנליסט", and may go on
// ("אנליסטית"), but a short one must end there, so "ai" isn't "airline".
const wordAt = (text: string, word: string) => {
  const w = lower(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const end = word.length <= 3 ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(`(^|[^\\p{L}\\p{N}])(?:[והלבמשכ]{0,2})${w}${end}`, "u").test(lower(text));
};

// The fields the roles are in: a role from the list by its field, one typed by hand by the fields whose words it
// has. No field at all means every field, so nothing is left out.
export function fieldsOf(roles: Role[]) {
  const ids = new Set<string>();
  for (const r of roles) {
    const listed = FIELD_OF.get(r.id ?? "");
    if (listed) ids.add(listed.id);
    else for (const f of ROLE_FIELDS) if (f.words.some((w) => wordAt(r.query, w))) ids.add(f.id);
  }
  return ids.size ? [...ids] : ROLE_FIELDS.map((f) => f.id);
}

// The words a posting's title needs one of to be worth judging for these roles: their fields' words, and each
// role's own title and Hebrew name, word by word.
export function titleWords(roles: Role[]) {
  const words = new Set(ROLE_FIELDS.filter((f) => fieldsOf(roles).includes(f.id)).flatMap((f) => f.words));
  const GENERIC = new Set(["junior", "senior", "graduate", "student", "and", "or", "the"]);
  for (const r of roles) {
    for (const w of `${r.query} ${listedRole(r.id)?.hebrew ?? ""}`.split(/[\s/,]+/)) if (w.length > 1 && !GENERIC.has(lower(w))) words.add(lower(w));
  }
  return [...words];
}

export const titleMatches = (title: string, words: string[]) => words.some((w) => wordAt(title, w));

// A role's searches on the Israeli boards: its title, and its Hebrew name when it has one.
export const boardQueries = (role: Role) => [...new Set([role.query, listedRole(role.id)?.hebrew].filter((q): q is string => Boolean(q)))];
