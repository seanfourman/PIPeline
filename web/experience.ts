// How much experience a job asks for, read from its words alone, no AI: the years its posting requires, in English or
// Hebrew ("4+ years of experience", "3-5 years", "at least 2 years", "3 שנות ניסיון", "ניסיון של שנתיים לפחות"), and
// whether its title is a senior one. A candidate looking for a junior role (the settings' seniority) is shown neither
// a job asking for three years or more nor a senior title: such a job is filtered out of Pip's list, and its page
// says why (levelGate).

export type Years = { min: number; max: number | null; quote: string };
export type Seniority = "any" | "junior" | "middle" | "senior";
// A junior search keeps jobs asking for up to two years; from this many, a job is filtered out.
export const JUNIOR_YEARS_OUT = 3;
// More years than this is a company's age or a typo, not what a job asks for.
const MOST_YEARS = 15;

const WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  "שלוש": 3, "שלושה": 3, "ארבע": 4, "ארבעה": 4, "חמש": 5, "חמישה": 5, "שש": 6, "שישה": 6, "שבע": 7, "שבעה": 7, "שמונה": 8, "תשע": 9, "עשר": 10,
};
const N = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)";
const HN = "(\\d{1,2}|שלושה|שלוש|ארבעה|ארבע|חמישה|חמש|שישה|שש|שבעה|שבע|שמונה|תשע|עשר)";
const YRS = "(?:years?|yrs?)['’]?";
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORD[s.toLowerCase()] ?? NaN);

// A line that counts something an advantage or a wish rather than a requirement: its years are not what the job asks.
export const PLUS = /\b(advantage|advantageous|(?:a|big|huge|great|strong)\s+plus|is\s+a\s+plus|will\s+be\s+a\s+plus|nice[- ]to[- ]have|bonus|preferred|preferably|desirable|desired)\b|יתרון|יתרונות|רצוי/i;
// Years that are not someone's experience: a company's age, a warranty, an age.
const NOT_EXPERIENCE = /\b(ago|years?\s+old|of\s+age|anniversary|founded|established|warranty|in\s+business|in\s+the\s+market|operating|since\s+\d{4}|for\s+over\s+\d+\s+years?|our\s+\d+\s+years?)\b|ותק החברה|הוקמה|קיימת|פועלת|לפני \d/i;

// Each pattern's groups: [min, max] for a range, else [min], a floor with no ceiling.
const PATTERNS: { re: RegExp; range?: boolean }[] = [
  // "3-5 years", "3 to 5 years", "3–5+ yrs".
  { re: new RegExp(`\\b${N}\\s*\\+?\\s*(?:-|–|—|to)\\s*${N}\\s*\\+?\\s*${YRS}`, "i"), range: true },
  // "4+ years", "4 + yrs".
  { re: new RegExp(`\\b${N}\\s*\\+\\s*${YRS}`, "i") },
  // "at least 3 years", "minimum of 5 years", "min. 2 years", "more than 3 years", "no less than 4 years".
  { re: new RegExp(`\\b(?:at\\s+least|minimum(?:\\s+of)?|min\\.?|more\\s+than|no\\s+less\\s+than)\\s+${N}\\s*${YRS}`, "i") },
  // "5 years of experience", "3 years hands-on experience", "2 years' professional experience".
  { re: new RegExp(`\\b${N}\\s*${YRS}\\s+(?:of\\s+)?(?:[\\w-]+\\s+){0,3}?(?:experience|exp\\b)`, "i") },
  // "5 years in backend development", "3 years as a developer", "2 years working with data".
  { re: new RegExp(`\\b${N}\\s*${YRS}\\s+(?:in|as|working|developing|building|programming|coding|designing|writing|with)\\b`, "i") },
  // "experience of 3 years".
  { re: new RegExp(`\\bexperience\\s+of\\s+${N}\\s*${YRS}`, "i") },
  // "3-5 שנות ניסיון", "ניסיון של 2-3 שנים".
  { re: new RegExp(`${HN}\\s*\\+?\\s*[-–—]\\s*${HN}\\s*\\+?\\s*(?:שנות|שנים)`), range: true },
  // "3+ שנות ניסיון", "3 שנות ניסיון", "שלוש שנות ניסיון".
  { re: new RegExp(`${HN}\\s*\\+?\\s*שנות\\s*(?:ה)?ניסיון`) },
  // "ניסיון של 3 שנים", "ניסיון מוכח של 4 שנים לפחות", "ניסיון של 3+ שנים".
  { re: new RegExp(`ניסיון[^.;\\n]{0,30}?של\\s*${HN}\\s*\\+?\\s*שנ(?:ים|ות)`) },
  // "לפחות 3 שנים", "מינימום 2 שנות", "מעל 4 שנים", in a line about experience.
  { re: new RegExp(`(?:לפחות|מינימום|מעל|יותר\\s+מ-?)\\s*${HN}\\s*\\+?\\s*שנ(?:ים|ות)(?=[^\\n]*ניסיון|[^\\n]*$)`) },
];
// Two years and one year are words of their own in Hebrew.
const HEB_TWO = /שנתיים/;
const HEB_ONE = /(?:של|לפחות)\s+שנה(?![\p{L}\d])|שנת\s+ניסיון/u;

// The years a single line asks for, or null when it asks for none.
function yearsIn(line: string): Years | null {
  if (PLUS.test(line) || NOT_EXPERIENCE.test(line)) return null;
  const quote = line.trim().slice(0, 200);
  for (const p of PATTERNS) {
    const m = p.re.exec(line);
    if (!m) continue;
    // A Hebrew floor names its experience somewhere in the line.
    if (/[א-ת]/.test(m[0]) && !/ניסיון|ניסון/.test(line)) continue;
    const min = num(m[1]);
    const max = p.range ? num(m[2]) : null;
    if (!Number.isFinite(min) || min > MOST_YEARS || (max !== null && (!Number.isFinite(max) || max < min || max > MOST_YEARS + 5))) continue;
    return { min, max, quote };
  }
  if (/ניסיון/.test(line) && HEB_TWO.test(line)) return { min: 2, max: null, quote };
  if (/ניסיון/.test(line) && HEB_ONE.test(line)) return { min: 1, max: null, quote };
  return null;
}

// The years the posting requires: of the lines that ask for some (an advantage's left out), the most asked, since a
// posting asking for "5+ years in software, 2+ in Python" asks for five. Null when it names no number of years.
export function requiredYears(text: string): Years | null {
  let best: Years | null = null;
  for (const raw of String(text ?? "").split(/\n|(?<=[.;])\s+(?=[A-Zא-ת•])/)) {
    const line = raw.replace(/^[\s•\-*#]+/, "");
    if (!line) continue;
    const found = yearsIn(line);
    if (found && (!best || found.min > best.min)) best = found;
  }
  return best;
}

// A title that names a senior role. "Senior" and its Hebrew names say so outright; otherwise lead, principal, staff,
// head, director, an architect or a manager of a team or of engineering do, unless the title also says junior,
// student, intern or graduate.
// A Hebrew title says so of the role (בכיר/ה, or right after the role's name), not of the employer ("לארגון בכיר").
const SAYS_SENIOR = /\b(senior|sr\.?)(?=[\s,/)-]|$)|בכיר\s*\/\s*ה|(?:מפתח|מהנדס|מתכנת|אנליסט|חוקר|מדען|מנהל|ראש)\S*\s+(?:\S+\s+)?בכיר|סניור/i;
const JUNIOR_TITLE = /\b(junior|jr\.?|entry|graduate|intern(ship)?|student|trainee|associate)\b|ג'וניור|ג׳וניור|גוניור|סטודנט|מתמחה|התמחות|בוגר|ללא ניסיון/i;
const LEADS = /\b(lead|leader|principal|staff|head|director|vp|vice president|chief|architect|(?:engineering|r&d|development|dev|software|team|group|qa|data|it|technical|tech)\s+manager)\b|ראש(?:\/?ת)?\s+(?:צוות|תחום|קבוצה|מחלקה)|ארכיטקט(?!ור)|מנהל(?:\/?ת)?\s+(?:צוות|פיתוח|מחלקת|קבוצת|תחום|הנדסה|מו"פ)/i;
export const seniorTitle = (title: string) => SAYS_SENIOR.test(title) || (!JUNIOR_TITLE.test(title) && LEADS.test(title));

// Whether a job is above the level the candidate looks for: for a junior search, a senior title or three years or
// more asked; any other search keeps every job. why says which, years how many.
export type Level = { verdict: "PASS" | "FAIL"; why?: "senior" | "years"; years?: number };
export function levelGate(o: { title: string; years: number | null | undefined; seniority: Seniority | string | undefined }): Level {
  if (o.seniority !== "junior") return { verdict: "PASS" };
  if (seniorTitle(String(o.title ?? ""))) return { verdict: "FAIL", why: "senior" };
  if (typeof o.years === "number" && o.years >= JUNIOR_YEARS_OUT) return { verdict: "FAIL", why: "years", years: o.years };
  return { verdict: "PASS" };
}
