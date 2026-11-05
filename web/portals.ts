// The portals: every place the system looks for jobs, or offers to open, for the portals page (ui/views/portals.tsx),
// the searches (boards.ts, data.ts) and the daily run. Each says how it is covered:
//   search  the system searches it for every role: LinkedIn and freehire through their tools, and the Israeli boards
//           AllJobs, Drushim and JobMaster by reading their search pages (boards.ts)
//   read    the system reads the employer's own list of jobs, its page on AllJobs (by its AllJobs id) or a search
//           for its name on Drushim, for the fields of the roles in the settings
//   web     the daily run's agent looks for it through web search (renderBlock in settings.ts), since the site
//           can't be read directly
//   link    only to open: a group, a site that refuses automatic reading
// Employers outside high-tech ("low-tech": health funds, hospitals, insurers, banks, government) are read only while
// the setting is on, and only in the industries chosen, if any. Both the server and the browser use this, so nothing
// here needs Node. The AllJobs ids come from its company directory (Companies.aspx), November 2026.

export const INDUSTRIES = [
  { id: "hightech", he: "הייטק", en: "High-tech" },
  { id: "health", he: "בריאות", en: "Health" },
  { id: "insurance", he: "ביטוח", en: "Insurance" },
  { id: "finance", he: "בנקאות ופיננסים", en: "Banking and finance" },
  { id: "government", he: "ממשלה ושירות ציבורי", en: "Government and public service" },
  { id: "local", he: "רשויות מקומיות", en: "Local authorities" },
  { id: "academia", he: "אקדמיה ומחקר", en: "Academia and research" },
  { id: "telecom", he: "תקשורת ומדיה", en: "Telecom and media" },
  { id: "retail", he: "קמעונאות ומזון", en: "Retail and food" },
  { id: "industry", he: "תעשייה ופארמה", en: "Industry and pharma" },
  { id: "energy", he: "אנרגיה ותשתיות", en: "Energy and infrastructure" },
  { id: "transport", he: "תחבורה", en: "Transport" },
  { id: "defense", he: "ביטחון", en: "Defense" },
] as const;
export type Industry = (typeof INDUSTRIES)[number]["id"];
export const INDUSTRY_IDS: readonly string[] = INDUSTRIES.map((i) => i.id);

export type How = "search" | "read" | "web" | "link";
export type Kind = "board" | "employer" | "community";
// alljobs: the employer's AllJobs id; drushim: its name as Drushim shows it, searched there and matched on the company.
export type Read = { alljobs: number } | { drushim: string };
export type Portal = {
  id: string; kind: Kind; how: How; he: string; en: string; industry: Industry; url: string;
  // Outside high-tech: read only while the low-tech setting is on.
  lowTech?: boolean;
  read?: Read;
  // For web: the site the agent searches with site:, and for a community, what it is.
  site?: string; note?: { he: string; en: string };
};

const ALLJOBS = (cid: number) => `https://www.alljobs.co.il/Employer/HP/Default.aspx?cid=${cid}`;
export const DRUSHIM_SEARCH = (q: string) => `https://www.drushim.co.il/jobs/search/${encodeURIComponent(q)}/`;

// An employer read on AllJobs; its own careers page, when it has one that opens, is what the page opens.
const aj = (id: string, industry: Industry, he: string, en: string, cid: number, own?: string): Portal =>
  ({ id, kind: "employer", how: "read", he, en, industry, lowTech: industry !== "defense", read: { alljobs: cid }, url: own ?? ALLJOBS(cid) });
// One without a page on AllJobs, read through Drushim's search for its name.
const dr = (id: string, industry: Industry, he: string, en: string, name: string, own?: string): Portal =>
  ({ id, kind: "employer", how: "read", he, en, industry, lowTech: industry !== "defense", read: { drushim: name }, url: own ?? DRUSHIM_SEARCH(name) });
// One whose site can't be read: only opened.
const open = (id: string, industry: Industry, he: string, en: string, url: string): Portal =>
  ({ id, kind: "employer", how: "link", he, en, industry, lowTech: industry !== "defense", url });

export const PORTALS: Portal[] = [
  // Job sites.
  { id: "linkedin", kind: "board", how: "search", he: "LinkedIn", en: "LinkedIn", industry: "hightech", url: "https://www.linkedin.com/jobs/" },
  { id: "freehire", kind: "board", how: "search", he: "freehire", en: "freehire", industry: "hightech", url: "https://freehire.me" },
  { id: "alljobs", kind: "board", how: "search", he: "AllJobs", en: "AllJobs", industry: "hightech", url: "https://www.alljobs.co.il/" },
  { id: "drushim", kind: "board", how: "search", he: "דרושים IL", en: "Drushim", industry: "hightech", url: "https://www.drushim.co.il/" },
  { id: "jobmaster", kind: "board", how: "search", he: "JobMaster", en: "JobMaster", industry: "hightech", url: "https://www.jobmaster.co.il/" },
  { id: "hireme", kind: "board", how: "web", he: "HireMe Tech", en: "HireMe Tech", industry: "hightech", site: "hiremetech.com", url: "https://hiremetech.com/jobs-app/?view=jobs&sort_by=posted_date&sort_order=desc&country=Israel" },
  { id: "hireme-juniors", kind: "board", how: "web", he: "HireMe ג'וניורים", en: "HireMe Juniors", industry: "hightech", site: "juniors.hiremetech.com", url: "https://juniors.hiremetech.com/" },
  { id: "jobify", kind: "board", how: "web", he: "Jobify", en: "Jobify", industry: "hightech", site: "jobify360.co.il", url: "https://jobify360.co.il/" },
  { id: "jobnet", kind: "board", how: "web", he: "Jobnet", en: "Jobnet", industry: "hightech", site: "jobnet.co.il", url: "https://www.jobnet.co.il/" },
  { id: "indeed", kind: "board", how: "web", he: "Indeed", en: "Indeed", industry: "hightech", site: "il.indeed.com", url: "https://il.indeed.com/" },
  { id: "glassdoor", kind: "board", how: "web", he: "Glassdoor", en: "Glassdoor", industry: "hightech", site: "glassdoor.com", url: "https://www.glassdoor.com/Job/israel-jobs-SRCH_IL.0,6_IN119.htm" },
  { id: "gotfriends", kind: "board", how: "web", he: "Gotfriends", en: "Gotfriends", industry: "hightech", site: "gotfriends.co.il", url: "https://www.gotfriends.co.il/" },
  { id: "ethosia", kind: "board", how: "web", he: "אתוסיה", en: "Ethosia", industry: "hightech", site: "ethosia.co.il", url: "https://www.ethosia.co.il/" },
  { id: "nisha", kind: "board", how: "web", he: "נישה", en: "Nisha", industry: "hightech", site: "nisha.co.il", url: "https://www.nisha.co.il/" },
  { id: "civil-service", kind: "board", how: "link", he: "נציבות שירות המדינה", en: "Civil Service Commission", industry: "government", lowTech: true, url: "https://ejobs.gov.il/gius/" },
  { id: "taasuka", kind: "board", how: "link", he: "שירות התעסוקה", en: "Israeli Employment Service", industry: "government", lowTech: true, url: "https://www.taasuka.gov.il/" },

  // Posts and groups.
  { id: "linkedin-posts", kind: "community", how: "web", he: "פוסטים בלינקדאין", en: "LinkedIn posts", industry: "hightech", site: "linkedin.com/posts", url: "https://www.linkedin.com/search/results/content/?keywords=%D7%9E%D7%92%D7%99%D7%99%D7%A1%D7%99%D7%9D",
    note: { he: "פוסטים של מגייסים ועובדים שכתבו שהם מגייסים. החיפוש היומי מוצא את הפומביים שבהם דרך חיפוש ברשת.", en: "Posts by recruiters and employees saying they're hiring. The daily run finds the public ones through web search." } },
  { id: "facebook-posts", kind: "community", how: "web", he: "פוסטים בפייסבוק", en: "Facebook posts", industry: "hightech", site: "facebook.com", url: "https://www.facebook.com/search/posts/?q=%D7%93%D7%A8%D7%95%D7%A9%D7%99%D7%9D",
    note: { he: "פייסבוק לא מרשה לקרוא קבוצות אוטומטית. החיפוש היומי מוצא רק פוסטים פומביים, ואת הקבוצות שלך אפשר להוסיף למטה ולפתוח מכאן.", en: "Facebook doesn't allow reading groups automatically. The daily run finds only public posts; add your groups below to open them from here." } },
  { id: "wa-data", kind: "community", how: "link", he: "וואטסאפ: משרות דאטה", en: "WhatsApp: data jobs", industry: "hightech", url: "https://chat.whatsapp.com/FlnpLQVO5XS6eINB6J2aV1" },
  { id: "wa-junior-data", kind: "community", how: "link", he: "וואטסאפ: סטודנטים וג'וניור Data", en: "WhatsApp: student and junior data", industry: "hightech", url: "https://chat.whatsapp.com/FkCwCkTTj7p9rkNVWQtb6q" },
  { id: "wa-junior-dev", kind: "community", how: "link", he: "וואטסאפ: פיתוח ג'וניור", en: "WhatsApp: junior development", industry: "hightech", url: "https://chat.whatsapp.com/FivKeyb8zpXA9kcYmUMLoH" },
  { id: "wa-students", kind: "community", how: "link", he: "וואטסאפ: סטודנטים והתמחות - פיתוח, QA, DevOps", en: "WhatsApp: student and intern - development, QA, DevOps", industry: "hightech", url: "https://chat.whatsapp.com/IkZFRecPQSJGyN4UcSVkgD" },
  { id: "tg-hireme", kind: "community", how: "link", he: "טלגרם: הבוט של HireMe", en: "Telegram: HireMe's bot", industry: "hightech", url: "https://t.me/Hireme_israelbot" },

  // Health: the health funds, the hospitals, and the organisations around them.
  aj("clalit", "health", "כללית", "Clalit", 2090, "https://jobs.clalitapps.co.il/clalit/index.html"),
  aj("maccabi", "health", "מכבי שירותי בריאות", "Maccabi Healthcare", 143511, "https://www.maccabi4u.co.il/careers/"),
  aj("meuhedet", "health", "מאוחדת", "Meuhedet", 22770),
  aj("leumit", "health", "לאומית", "Leumit", 1401),
  dr("sheba", "health", "שיבא תל השומר", "Sheba Medical Center", "שיבא"),
  aj("ichilov", "health", "איכילוב", "Ichilov (Tel Aviv Sourasky)", 41441),
  aj("rambam", "health", "רמב\"ם", "Rambam", 12046),
  aj("hadassah", "health", "הדסה", "Hadassah", 51218, "https://www.hadassah.org.il/careers/"),
  aj("shaare-zedek", "health", "שערי צדק", "Shaare Zedek", 12012),
  aj("assuta", "health", "אסותא", "Assuta", 29568),
  aj("assuta-ashdod", "health", "אסותא אשדוד", "Assuta Ashdod", 53261),
  aj("herzliya-medical", "health", "הרצליה מדיקל סנטר", "Herzliya Medical Center", 53076),
  aj("mayanei", "health", "מעייני הישועה", "Mayanei Hayeshua", 124545),
  aj("mor", "health", "מכון מור למידע רפואי", "Mor Institute for Medical Data", 110875),
  aj("hatzalah", "health", "איחוד הצלה", "United Hatzalah", 176507),

  // Insurance.
  aj("harel", "insurance", "הראל", "Harel", 70365),
  aj("migdal", "insurance", "מגדל", "Migdal", 15163),
  aj("clal", "insurance", "כלל ביטוח", "Clal Insurance", 1954, "https://www.clalbit.co.il/careers/"),
  aj("phoenix", "insurance", "הפניקס", "The Phoenix", 173831, "https://www.fnx.co.il/careers/"),
  dr("menora", "insurance", "מנורה מבטחים", "Menora Mivtachim", "מנורה מבטחים"),
  aj("menora-pension", "insurance", "מנורה מבטחים פנסיה וגמל", "Menora Mivtachim Pension", 305081),
  aj("aig", "insurance", "AIG", "AIG Israel", 117679),
  aj("shomera", "insurance", "שומרה", "Shomera", 64712),
  aj("passportcard", "insurance", "פספורטכארד", "PassportCard", 277331),

  // Banks, cards, investment houses and the audit firms.
  aj("leumi", "finance", "בנק לאומי", "Bank Leumi", 125),
  aj("hapoalim", "finance", "בנק הפועלים", "Bank Hapoalim", 124),
  aj("discount", "finance", "בנק דיסקונט", "Discount Bank", 87),
  aj("mizrahi", "finance", "מזרחי טפחות", "Mizrahi Tefahot", 180495),
  aj("fibi", "finance", "הבנק הבינלאומי", "First International Bank", 225397),
  aj("jerusalem-bank", "finance", "בנק ירושלים", "Bank of Jerusalem", 24498),
  aj("max", "finance", "MAX", "Max", 182),
  aj("cal", "finance", "כאל", "Cal", 235543),
  dr("isracard", "finance", "ישראכרט", "Isracard", "ישראכרט"),
  aj("ibi", "finance", "IBI בית השקעות", "IBI Investment House", 367437),
  aj("pwc", "finance", "PwC ישראל", "PwC Israel", 921),
  aj("bdo", "finance", "BDO", "BDO Israel", 35967),

  // Government and the public service.
  aj("boi", "government", "בנק ישראל", "Bank of Israel", 79921),
  aj("cbs", "government", "הלשכה המרכזית לסטטיסטיקה", "Central Bureau of Statistics", 336721),
  aj("nii", "government", "ביטוח לאומי", "National Insurance Institute", 300262),
  aj("tax", "government", "רשות המסים", "Israel Tax Authority", 312237),
  aj("finance-ministry", "government", "משרד האוצר", "Ministry of Finance", 338257),
  aj("economy", "government", "משרד הכלכלה והתעשייה", "Ministry of Economy", 300373),
  aj("interior", "government", "משרד הפנים", "Ministry of the Interior", 94722),
  aj("courts", "government", "הרשות השופטת", "Judicial Authority", 304876),
  aj("isa", "government", "רשות ניירות ערך", "Israel Securities Authority", 268132),
  aj("lands", "government", "רשות מקרקעי ישראל", "Israel Land Authority", 301807),
  aj("police", "government", "משטרת ישראל", "Israel Police", 91064),
  aj("nrcn", "government", "הקריה למחקר גרעיני - נגב", "Negev Nuclear Research Center", 80984),
  aj("national-library", "government", "הספרייה הלאומית", "National Library of Israel", 111846),
  aj("post", "government", "דואר ישראל", "Israel Post", 9287),
  aj("standards", "government", "מכון התקנים", "Standards Institution of Israel", 15315),
  aj("nature", "government", "רשות הטבע והגנים", "Nature and Parks Authority", 151137),
  open("mossad", "defense", "המוסד", "Mossad", "https://www.mossad.gov.il/jobs-lobby"),
  open("shabak", "defense", "שב\"כ", "Shin Bet", "https://www.shabak.gov.il/"),

  // Local authorities.
  aj("tel-aviv", "local", "עיריית תל אביב-יפו", "Tel Aviv-Yafo Municipality", 101198),
  aj("herzliya", "local", "עיריית הרצליה", "Herzliya Municipality", 274568),
  open("haifa", "local", "עיריית חיפה", "Haifa Municipality", "https://www.haifa.muni.il/jobs/"),

  // Academia and research.
  aj("tau", "academia", "אוניברסיטת תל אביב", "Tel Aviv University", 326539, "https://www.tau.ac.il/jobs"),
  aj("technion", "academia", "הטכניון", "Technion", 55370),
  aj("huji", "academia", "האוניברסיטה העברית", "Hebrew University", 369382),
  aj("bgu", "academia", "אוניברסיטת בן-גוריון", "Ben-Gurion University", 136871),
  aj("haifa-u", "academia", "אוניברסיטת חיפה", "University of Haifa", 16374),
  aj("ariel", "academia", "אוניברסיטת אריאל", "Ariel University", 129238),
  aj("afeka", "academia", "מכללת אפקה", "Afeka College of Engineering", 170379),
  aj("ono", "academia", "הקריה האקדמית אונו", "Ono Academic College", 145380),

  // Telecom and media.
  aj("bezeq", "telecom", "בזק", "Bezeq", 6843),
  aj("cellcom", "telecom", "סלקום", "Cellcom", 109965),
  dr("partner", "telecom", "פרטנר", "Partner", "פרטנר"),
  aj("golan", "telecom", "גולן טלקום", "Golan Telecom", 360350),
  aj("yes", "telecom", "yes", "yes", 6951),
  aj("kan", "telecom", "כאן - תאגיד השידור", "Kan (public broadcaster)", 255266),
  aj("yedioth", "telecom", "ידיעות אחרונות", "Yedioth Ahronoth", 1065),

  // Retail and food.
  aj("shufersal", "retail", "שופרסל", "Shufersal", 10121),
  aj("rami-levy", "retail", "רמי לוי", "Rami Levy", 134064),
  aj("superpharm", "retail", "סופר-פארם", "Super-Pharm", 101074),
  aj("strauss", "retail", "שטראוס", "Strauss Group", 343433),
  aj("tnuva", "retail", "תנובה", "Tnuva", 83241),
  aj("osem", "retail", "אסם", "Osem", 26877),
  aj("cbc", "retail", "CBC (קוקה-קולה)", "CBC Israel (Coca-Cola)", 8055),
  aj("fox", "retail", "קבוצת פוקס", "Fox Group", 40615),
  aj("ikea", "retail", "איקאה", "IKEA Israel", 67266),

  // Industry and pharma.
  aj("teva", "industry", "טבע", "Teva", 120072, "https://careers.teva/"),
  aj("icl", "industry", "ICL", "ICL Group", 141082),
  aj("bazan", "industry", "בזן", "Bazan", 2784),
  aj("sodastream", "industry", "סודהסטרים", "SodaStream", 450),
  aj("dexcel", "industry", "דקסל פארמה", "Dexcel Pharma", 216750),
  aj("kamada", "industry", "קמהדע", "Kamada", 9564),
  aj("adama", "industry", "אדמה", "Adama", 6239),

  // Energy and infrastructure.
  aj("iec", "energy", "חברת החשמל", "Israel Electric", 197410),
  aj("noga", "energy", "נגה - ניהול מערכת החשמל", "Noga (electricity system operator)", 314305),
  aj("ingl", "energy", "נתיבי הגז הטבעי", "Israel Natural Gas Lines", 216697),
  aj("opc", "energy", "OPC אנרגיה", "OPC Energy", 276478),
  aj("sonol", "energy", "סונול", "Sonol", 56127),
  aj("electra", "energy", "קבוצת אלקטרה", "Electra Group", 150870),
  aj("shikun-binui", "energy", "שיכון ובינוי", "Shikun & Binui", 230535),

  // Transport.
  aj("rail", "transport", "רכבת ישראל", "Israel Railways", 289),
  aj("nta", "transport", "נת\"ע", "NTA (Tel Aviv light rail)", 106796),
  dr("elal", "transport", "אל על", "El Al", "אל על"),
  dr("egged", "transport", "אגד", "Egged", "אגד"),

  // Defense.
  aj("iai", "defense", "התעשייה האווירית", "Israel Aerospace Industries", 3714),
  aj("rafael", "defense", "רפאל", "Rafael", 226731),
  aj("elbit", "defense", "אלביט מערכות", "Elbit Systems", 47510),
];

const BY_ID = new Map(PORTALS.map((p) => [p.id, p]));
export const portalById = (id: string) => BY_ID.get(id);

// The user's own portals, added on the portals page: a careers page the system reads like an employer's, or a group
// or anything else only to open.
export type OwnPortal = { id: string; name: string; url: string; kind: "page" | "group" | "link" };
export type PortalSettings = { off: string[]; mine: OwnPortal[] };
type Picks = { industries: string[]; lowTech: boolean; portals: PortalSettings };

// Whether the system goes to a portal now: not switched off on the portals page; an employer outside high-tech only
// while the low-tech setting is on; and an employer only in the industries chosen, when some are.
export function portalOn(p: Portal, s: Picks) {
  if (s.portals.off.includes(p.id)) return false;
  if (p.lowTech && !s.lowTech) return false;
  if (p.kind === "employer" && s.industries.length && !s.industries.includes(p.industry)) return false;
  return true;
}

// The employers the system reads now, and the sites the daily run's agent looks through with web search.
export const employersToRead = (s: Picks) => PORTALS.filter((p) => p.how === "read" && portalOn(p, s));
export const webPortals = (s: Picks) => PORTALS.filter((p) => p.how === "web" && portalOn(p, s));
export const boardOn = (id: "linkedin" | "freehire" | "alljobs" | "drushim" | "jobmaster", s: Picks) => !s.portals.off.includes(id);
