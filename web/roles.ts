// The ready-made roles the settings screen offers, by field, for anyone to choose from. Each is a plain job title,
// and the search for it adds the experience level from the settings ("Junior Backend Developer" for a junior),
// except the few that are a level of their own, like graduate positions. Both the server and the browser use
// this, so nothing here needs Node.

export type Level = "any" | "junior" | "middle" | "senior";
// he and en are the short names on the jobs page's buttons.
export type ListedRole = { id: string; title: string; he: string; en: string; fixed?: boolean };
// A role as the settings keep it: id for one from the list, none for one typed in by hand.
export type Role = { label: string; query: string; id?: string };

export const ROLE_FIELDS: { id: string; he: string; en: string; roles: ListedRole[] }[] = [
  { id: "software", he: "פיתוח תוכנה", en: "Software development", roles: [
    { id: "software", title: "Software Engineer", he: "Software", en: "Software" },
    { id: "fullstack", title: "Full Stack Developer", he: "Full Stack", en: "Full Stack" },
    { id: "backend", title: "Backend Developer", he: "Backend", en: "Backend" },
    { id: "frontend", title: "Frontend Developer", he: "Frontend", en: "Frontend" },
    { id: "mobile", title: "Mobile Developer", he: "מובייל", en: "Mobile" },
    { id: "embedded", title: "Embedded Software Engineer", he: "Embedded", en: "Embedded" },
    { id: "python", title: "Python Developer", he: "Python", en: "Python" },
    { id: "java", title: "Java Developer", he: "Java", en: "Java" },
    { id: "dotnet", title: ".NET Developer", he: ".NET", en: ".NET" },
  ] },
  { id: "data", he: "Data ו-AI", en: "Data and AI", roles: [
    { id: "ml", title: "Machine Learning Engineer", he: "AI / ML", en: "AI / ML" },
    { id: "ai", title: "AI Engineer", he: "AI Engineer", en: "AI Engineer" },
    { id: "vision", title: "Computer Vision Engineer", he: "Computer Vision", en: "Computer Vision" },
    { id: "algorithms", title: "Algorithm Developer", he: "אלגוריתמים", en: "Algorithms" },
    { id: "datascience", title: "Data Scientist", he: "Data Science", en: "Data Science" },
    { id: "dataeng", title: "Data Engineer", he: "Data", en: "Data" },
    { id: "analyst", title: "Data Analyst", he: "אנליסט נתונים", en: "Data Analyst" },
    { id: "bi", title: "BI Developer", he: "BI", en: "BI" },
  ] },
  { id: "quality", he: "QA ואוטומציה", en: "QA and automation", roles: [
    { id: "qa", title: "QA Engineer", he: "QA", en: "QA" },
    { id: "automation", title: "QA Automation Engineer", he: "אוטומציה", en: "Automation" },
    { id: "validation", title: "Validation Engineer", he: "ולידציה", en: "Validation" },
  ] },
  { id: "infra", he: "DevOps ותשתיות", en: "DevOps and infrastructure", roles: [
    { id: "devops", title: "DevOps Engineer", he: "DevOps", en: "DevOps" },
    { id: "cloud", title: "Cloud Engineer", he: "Cloud", en: "Cloud" },
    { id: "sre", title: "Site Reliability Engineer", he: "SRE", en: "SRE" },
    { id: "integration", title: "System Integration Engineer", he: "אינטגרציה", en: "Integration" },
    { id: "sysadmin", title: "System Administrator", he: "ניהול מערכות", en: "SysAdmin" },
    { id: "network", title: "Network Engineer", he: "רשתות", en: "Networking" },
  ] },
  { id: "security", he: "סייבר", en: "Security", roles: [
    { id: "security", title: "Security Engineer", he: "סייבר", en: "Security" },
    { id: "soc", title: "SOC Analyst", he: "SOC", en: "SOC" },
  ] },
  { id: "product", he: "מוצר, עיצוב ותמיכה", en: "Product, design and support", roles: [
    { id: "product", title: "Product Manager", he: "מוצר", en: "Product" },
    { id: "ux", title: "UX/UI Designer", he: "UX/UI", en: "UX/UI" },
    { id: "support", title: "Technical Support Engineer", he: "תמיכה טכנית", en: "Tech Support" },
    { id: "solutions", title: "Solutions Engineer", he: "Solutions", en: "Solutions" },
  ] },
  { id: "start", he: "תחילת הדרך", en: "Starting out", roles: [
    { id: "graduate", title: "Graduate Software Engineer", he: "בוגרים", en: "Graduates", fixed: true },
    { id: "student", title: "Student Software Engineer", he: "סטודנטים", en: "Students", fixed: true },
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
