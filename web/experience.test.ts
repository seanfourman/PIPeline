import { describe, expect, test } from "bun:test";
import { levelGate, requiredYears, seniorTitle } from "./experience";

const min = (text: string) => requiredYears(text)?.min ?? null;

describe("experience", () => {
  test("reads the years an English posting asks for", () => {
    expect(min("4+ years of hands-on experience in machine/deep learning or computer vision.")).toBe(4);
    expect(min("• 3-5 years of experience as a backend developer")).toBe(3);
    expect(requiredYears("3 to 5 years building web services")).toMatchObject({ min: 3, max: 5 });
    expect(min("At least 2 years of experience with Python")).toBe(2);
    expect(min("Minimum of 5 years in software engineering")).toBe(5);
    expect(min("5 years of professional experience")).toBe(5);
    expect(min("2 years' experience in QA automation")).toBe(2);
    expect(min("Three years as a full stack developer")).toBe(3);
    expect(min("Experience of 3 years in a similar role")).toBe(3);
    expect(min("0-2 years of experience")).toBe(0);
  });

  test("reads the years a Hebrew posting asks for", () => {
    expect(min("ניסיון של 3 שנים לפחות בפיתוח Backend")).toBe(3);
    expect(min("3+ שנות ניסיון בפיתוח")).toBe(3);
    expect(min("• 4 שנות ניסיון ב-Python")).toBe(4);
    expect(min("ניסיון של שנתיים לפחות בתחום")).toBe(2);
    expect(min("ניסיון של שנה בפיתוח Full Stack")).toBe(1);
    expect(requiredYears("2-3 שנות ניסיון בבדיקות תוכנה")).toMatchObject({ min: 2, max: 3 });
    expect(min("שלוש שנות ניסיון לפחות")).toBe(3);
    expect(min("ניסיון מוכח של 5 שנים בניהול מערכות")).toBe(5);
    expect(min("לפחות 3 שנים ניסיון בעבודה עם SQL")).toBe(3);
  });

  test("takes the most a posting asks for, and leaves out what it counts an advantage", () => {
    expect(min("5+ years in software development\n2+ years with Python")).toBe(5);
    expect(min("1+ years of experience with React\n3+ years with Kubernetes - an advantage")).toBe(1);
    expect(min("ניסיון של שנה בפיתוח\nניסיון של 3 שנים ב-AWS - יתרון")).toBe(1);
    expect(min("3+ years of Go is a big plus")).toBeNull();
  });

  test("names no years when a posting gives none, or gives years that aren't experience", () => {
    expect(requiredYears("Experience with React and Node.js\nB.Sc. in Computer Science")).toBeNull();
    expect(requiredYears("We were founded 20 years ago and operate in 30 countries")).toBeNull();
    expect(requiredYears("A company operating for over 15 years in the market")).toBeNull();
    expect(requiredYears("החברה פועלת 20 שנים בתחום ומחפשת מפתח/ת עם ניסיון")).toBeNull();
    expect(requiredYears("3 days a week in the office")).toBeNull();
    expect(requiredYears("")).toBeNull();
  });

  test("knows a senior title in English and Hebrew, and that a junior one isn't", () => {
    for (const title of ["Senior Backend Engineer", "Sr. Data Scientist", "Team Lead, Platform", "Principal Engineer", "Staff Software Engineer", "Head of Data", "Engineering Manager", "Solutions Architect", "מפתח/ת Full Stack בכיר/ה", "מהנדס תוכנה בכיר", "ראש/ת צוות פיתוח", "מנהל/ת פיתוח", "ארכיטקט/ית מערכות"]) {
      expect(seniorTitle(title)).toBe(true);
    }
    for (const title of ["Junior Software Engineer", "Software Engineer", "Junior Team Lead Assistant", "QA Automation Engineer", "Product Manager", "Data Analyst Student", "מפתח/ת ג'וניור", "Seniority-free role: Developer", "רכז/ת תמיכה בפקולטה לארכיטקטורה", "מפתח /ת ABAP לארגון בטחוני בכיר"]) {
      expect(seniorTitle(title)).toBe(false);
    }
  });

  test("filters a junior search's jobs that ask for three years or more, or are senior, and keeps every job otherwise", () => {
    expect(levelGate({ title: "AI Engineer", years: 4, seniority: "junior" })).toEqual({ verdict: "FAIL", why: "years", years: 4 });
    expect(levelGate({ title: "AI Engineer", years: 3, seniority: "junior" }).verdict).toBe("FAIL");
    expect(levelGate({ title: "AI Engineer", years: 2, seniority: "junior" }).verdict).toBe("PASS");
    expect(levelGate({ title: "AI Engineer", years: null, seniority: "junior" }).verdict).toBe("PASS");
    expect(levelGate({ title: "Senior AI Engineer", years: null, seniority: "junior" })).toEqual({ verdict: "FAIL", why: "senior" });
    expect(levelGate({ title: "Senior AI Engineer", years: 6, seniority: "any" }).verdict).toBe("PASS");
    expect(levelGate({ title: "AI Engineer", years: 6, seniority: "middle" }).verdict).toBe("PASS");
  });
});
