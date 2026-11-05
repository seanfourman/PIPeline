import { describe, expect, test } from "bun:test";
import { allJobsCategories, parseAllJobs, parseDrushim, parseJobMaster, postedOn, readEmployer, readOwnPage, searchBoard, text, type Fetch } from "./boards";
import { portalById } from "./portals";
import { boardQueries, fieldsOf, titleMatches, titleWords } from "./roles";

const today = "2026-11-05";

// The boards' markup, cut down to what the parsers read, as the sites served it in November 2026.
const allJobsBox = (id: number, title: string, cid: number, company: string, place: string, when = "לפני 20 שעות") => `
  <div class="job-content-top-date"> ${when} </div>
  <div class="job-content-top-title"><a title="דרושים | ${title}" href="/Search/UploadSingle.aspx?JobID=${id}" class="N"><h2 style="font-size:22px">${title}</h2></a></div>
  <div class="T14"><a href="/Employer/HP/Default.aspx?cid=${cid}">${company}</a></div>
  <div class="job-content-top-location"><b>מיקום:</b> ${place}</div>
  <a href="/Search/UploadSingle.aspx?JobID=${id}">לפרטים</a>`;
const drushimCard = (id: number, title: string, company: string, place: string, when = "לפני 3 שעות") => `
  <div class="job-card-header-module-scss-module__X__titleRow"><h3 data-nagish="job-card-title" class="t" dir="rtl">${title}</h3>
  <span class="job-card-header-module-scss-module__X__companyName">${company}</span></div>
  <span class="job-card-meta-module-scss-module__Y__text">${place}</span><span class="job-card-meta-module-scss-module__Y__text">משרה מלאה</span>
  <span class="job-card-meta-module-scss-module__Y__text">${when}</span>
  <a data-nagish="job-card-details-link" href="/job/${id}/c48b7a5f/">פרטי המשרה</a>`;
const jobMasterCard = (key: number, title: string, company: string, place: string) => `
  <article id="misra${key}" class="CardStyle JobItem"><a class="CardHeader View_Job_Details" href='/jobs/checknum.asp?key=${key}'> ${title} </a>
  <span class="Gray"> פורסם לפני 26 דקות </span> ע"י <a class="font14 CompanyNameLink" href="checkhevra.asp?cs=X"><span>${company}</span></a>
  <li class="jobLocation"><a href="/jobs/l-x">${place}</a></li></article>`;

describe("reading the boards' pages", () => {
  test("AllJobs: each posting once, with its company, place and date", () => {
    const html = allJobsBox(1, "אנליסט /ית נתונים", 15163, "מגדל ביטוח ופיננסים", "המשרה: פתח תקווה") + allJobsBox(2, "data &amp; Business Analyst", 1, "אלעד מערכות", "תל אביב", "לפני 3 ימים");
    expect(parseAllJobs(html, today)).toEqual([
      { title: "אנליסט /ית נתונים", company: "מגדל ביטוח ופיננסים", location: "פתח תקווה", date: "2026-11-05", url: "https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=1", source: "alljobs" },
      { title: "data & Business Analyst", company: "אלעד מערכות", location: "תל אביב", date: "2026-11-02", url: "https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=2", source: "alljobs" },
    ]);
  });

  test("AllJobs: the page numbers after the last posting are not its company", () => {
    const html = allJobsBox(1, "מפתח/ת BI", 70365, "הראל", "רמת גן").replace(/<div class="T14">[\s\S]*?<\/div>/, "")
      + `<a href="/Employer/HP/Default.aspx?cid=70365&amp;page=2">2</a>`;
    expect(parseAllJobs(html, today, 70365)[0].company).toBe("");
  });

  test("AllJobs: the employers in the footer are not the company of a last posting that names none", () => {
    const html = allJobsBox(1, "מפתח/ת BI", 55370, "הטכניון", "חיפה") + allJobsBox(2, "סטודנט/ית לצוות המחשוב", 0, "", "חיפה").replace(/<div class="T14">[\s\S]*?<\/div>/, "")
      + `<footer><a class="footer__link" href="https://www.alljobs.co.il/Employer/HP/Default.aspx?cid=29512">אורמת דרושים</a></footer>`;
    expect(parseAllJobs(html, today).map((p) => p.company)).toEqual(["הטכניון", ""]);
  });

  test("AllJobs: an employer's page keeps its last posting, though similar companies follow the list", () => {
    const own = (id: number, title: string) => allJobsBox(id, title, 0, "", "יבנה").replace(/<div class="T14">[\s\S]*?<\/div>/, "");
    const html = own(1, "כלכלן/ית תכנון ובקרה") + own(2, "קניין/ית קבלנות משנה") + `<div class="jobs-paging"><a href="#">1</a></div>
      <div class="similarCompaniesContainer"><a href="/Employer/HP/default.aspx?cid=83241">תנובה</a></div>`;
    expect(parseAllJobs(html, today, 29512).map((p) => p.title)).toEqual(["כלכלן/ית תכנון ובקרה", "קניין/ית קבלנות משנה"]);
  });

  test("AllJobs: an employer's page keeps only that employer's postings", () => {
    const html = allJobsBox(1, "מפתח/ת BI", 70365, "הראל", "רמת גן") + allJobsBox(2, "מפתח/ת BI", 999, "אחרת", "חיפה");
    expect(parseAllJobs(html, today, 70365).map((p) => p.url)).toEqual(["https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=1"]);
  });

  test("AllJobs: an employer's categories with their counts", () => {
    const html = `<a href="https://www.alljobs.co.il/Employer/HP/default.aspx?cid=70365&amp;JobCategoriesFilter=235">תוכנה (12)</a>
      <a href="/Employer/HP/default.aspx?cid=70365&amp;JobCategoriesFilter=-1">נקה הכל</a><a href="x?JobCategoriesFilter=1806">דאטה (3)</a>`;
    expect(allJobsCategories(html)).toEqual([{ id: 235, name: "תוכנה", count: 12 }, { id: 1806, name: "דאטה", count: 3 }]);
  });

  test("Drushim: title, company and place from the screen-reader marks, the experience left out of the place", () => {
    const html = drushimCard(38893136, "Data Analyst להראל ביטוח ופיננסים!", "הראל ביטוח ופיננסים", "רמת גן") + drushimCard(2, "Online Data Analyst", "TELUS", "ללא נסיון", "אתמול");
    const found = parseDrushim(html, today);
    expect(found[0]).toEqual({ title: "Data Analyst להראל ביטוח ופיננסים!", company: "הראל ביטוח ופיננסים", location: "רמת גן", date: "2026-11-05", url: "https://www.drushim.co.il/job/38893136/c48b7a5f/", source: "drushim" });
    expect(found[1].location).toBe("");
    expect(found[1].date).toBe("2026-11-04");
  });

  test("JobMaster: one article per posting", () => {
    expect(parseJobMaster(jobMasterCard(9878661, "Data Systems Analyst", "MalamTeam", "ירושלים"), today)).toEqual([
      { title: "Data Systems Analyst", company: "MalamTeam", location: "ירושלים", date: "2026-11-05", url: "https://www.jobmaster.co.il/jobs/checknum.asp?key=9878661", source: "jobmaster" },
    ]);
  });

  test("the date from the board's words", () => {
    expect(postedOn("לפני 26 דקות", today)).toBe("2026-11-05");
    expect(postedOn("לפני יומיים", today)).toBe("2026-11-03");
    expect(postedOn("לפני 3 ימים", today)).toBe("2026-11-02");
    expect(postedOn("לפני שבוע", today)).toBe("2026-10-29");
    expect(postedOn("פורסם ב-21/10/2026", today)).toBe("2026-10-21");
    expect(postedOn("משרה מלאה", today)).toBe("");
  });

  test("text from markup carries no tags, entities or hidden characters", () => {
    expect(text("<b>BI&nbsp;Developer</b>‏ &#1497;<script>x()</script>")).toBe("BI Developer י");
  });

  test("a search keeps what is recent, and one that doesn't answer fails", async () => {
    const fetch: Fetch = async (url) => (url.includes("drushim") ? drushimCard(1, "Data Analyst", "A", "לוד", "לפני חודשיים") + drushimCard(2, "Data Analyst", "B", "לוד") : null);
    expect((await searchBoard("drushim", "data analyst", 14, { fetch, today })).map((p) => p.company)).toEqual(["B"]);
    await expect(searchBoard("alljobs", "x", 14, { fetch, today })).rejects.toThrow();
  });
});

describe("an employer's own jobs", () => {
  const roles = [{ id: "analyst", label: "Data Analyst", query: "Junior Data Analyst" }];

  test("on AllJobs: its page, full, then only the categories the roles' fields are filed under, and only titles for the roles", async () => {
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      if (url.endsWith("cid=70365")) {
        return `<a href="/x?cid=70365&amp;JobCategoriesFilter=366">ביטוח (105)</a><a href="/x?cid=70365&amp;JobCategoriesFilter=1806">דאטה (3)</a>`
          + Array.from({ length: 10 }, (_, i) => allJobsBox(10 + i, "נציג/ת שימור", 70365, "הראל", "רמת גן")).join("");
      }
      if (url.includes("JobCategoriesFilter=1806")) return allJobsBox(2, "אנליסט/ית נתונים", 70365, "הראל", "רמת גן") + allJobsBox(3, "מתאם/ת פגישות", 70365, "הראל", "רמת גן");
      return "";
    };
    const found = await readEmployer(portalById("harel")!, roles, { fetch, today });
    expect(asked).toEqual(["https://www.alljobs.co.il/Employer/HP/Default.aspx?cid=70365", "https://www.alljobs.co.il/Employer/HP/Default.aspx?cid=70365&JobCategoriesFilter=1806"]);
    expect(found).toEqual([expect.objectContaining({ title: "אנליסט/ית נתונים", company: "הראל", portal: "harel" })]);
  });

  test("on AllJobs: a page with room left has all of the employer's jobs, so no category of them is read", async () => {
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      return `<a href="/x?cid=70365&amp;JobCategoriesFilter=1806">דאטה (1)</a>` + allJobsBox(1, "אנליסט/ית נתונים", 70365, "הראל", "רמת גן");
    };
    const found = await readEmployer(portalById("harel")!, roles, { fetch, today });
    expect(asked).toEqual(["https://www.alljobs.co.il/Employer/HP/Default.aspx?cid=70365"]);
    expect(found.map((p) => p.title)).toEqual(["אנליסט/ית נתונים"]);
  });

  test("on AllJobs: an employer with no jobs now gives none, though its page shows others'", async () => {
    const fetch: Fetch = async () => allJobsBox(9, "כלכלן/ית מתחיל/ה", 0, "", "ירושלים");
    expect(await readEmployer(portalById("cbs")!, roles, { fetch, today })).toEqual([]);
  });

  test("on Drushim: a search for its name, keeping that company's postings", async () => {
    const fetch: Fetch = async () => drushimCard(1, "Data Analyst", "מרכז רפואי שיבא", "רמת גן") + drushimCard(2, "Data Analyst", "שמירה וביטחון", "רמת גן");
    const found = await readEmployer(portalById("sheba")!, roles, { fetch, today });
    expect(found.map((p) => p.company)).toEqual(["מרכז רפואי שיבא"]);
  });

  test("a careers page the user added: only its own site's links with the roles' words", async () => {
    const fetch: Fetch = async () => `<a href="/jobs/1">Data Analyst</a><a href="https://other.com/jobs/2">Data Analyst</a><a href="/jobs/3">נהג/ת</a><a href="javascript:x">Data</a>`;
    const found = await readOwnPage("own-abcd", "Acme", "https://careers.acme.co.il/", roles, { fetch, today });
    expect(found.map((p) => p.url)).toEqual(["https://careers.acme.co.il/jobs/1"]);
  });
});

describe("the roles' words", () => {
  test("a role's fields, and the words its postings' titles carry, in both languages", () => {
    expect(fieldsOf([{ id: "analyst", label: "", query: "Data Analyst" }])).toEqual(["data"]);
    expect(fieldsOf([{ label: "x", query: "Senior QA Lead" }])).toContain("quality");
    const words = titleWords([{ id: "bi", label: "BI", query: "Junior BI Developer" }]);
    expect(titleMatches("מפתח/ת BI לאגף המידע", words)).toBe(true);
    expect(titleMatches("לאנליסט/ית נתונים", words)).toBe(true);
    expect(titleMatches("נציג/ת שירות לקוחות", words)).toBe(false);
  });

  test("a short word must end where the word does", () => {
    expect(titleMatches("Airline pilot", ["ai"])).toBe(false);
    expect(titleMatches("AI Engineer", ["ai"])).toBe(true);
  });

  test("a role is searched on the boards by its title and its Hebrew name", () => {
    expect(boardQueries({ id: "analyst", label: "", query: "Junior Data Analyst" })).toEqual(["Junior Data Analyst", "אנליסט נתונים"]);
    expect(boardQueries({ label: "x", query: "Actuary" })).toEqual(["Actuary"]);
  });
});
