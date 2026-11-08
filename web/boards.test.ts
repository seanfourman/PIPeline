import { describe, expect, test } from "bun:test";
import {
  allJobsCategories, CHECKPOINT, day, MATRIX, matrixCategories, MOBILEYE, PALOALTO, parseAllJobs, parseAmazon, parseApple, parseAshby, parseCheckPoint, parseComeet,
  parseDrushim, parseEightfold, parseGoogle, parseGreenhouse, parseJobMaster, parseJobPostings, parseJobvite, parseLever, parseMatrix, parseMobileye, parseRadancy,
  parseUnity, parseWorkable, postedOn, readEmployer, readOwnPage, searchBoard, searchTerms, text, type Fetch,
} from "./boards";
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
// Matrix's careers site: its jobs page's list of categories, which the page shows twice, and a category's postings.
const matrixList = `<ul id="jobs_category_list" class="expanded">
  <li class="cat-item cat-item-20"><a href="https://www.matrix.co.il/jobs/משרות/%d7%a4%d7%99%d7%aa%d7%95%d7%97/">פיתוח תוכנה</a>
  <ul class='children'><li class="cat-item cat-item-21"><a href="https://www.matrix.co.il/jobs/משרות/%d7%a4%d7%99%d7%aa%d7%95%d7%97/java/">JAVA</a></li></ul></li>
  <li class="cat-item cat-item-30"><a href="https://www.matrix.co.il/jobs/משרות/data/">DATA</a></li>
  <li class="cat-item cat-item-40"><a href="https://www.matrix.co.il/jobs/משרות/%d7%9e%d7%98%d7%94/">מטה</a></li></ul>`;
const matrixPage = `<div class="jobs-categories-selector">${matrixList}</div><div class="jobs-categories-selector">${matrixList}</div>`;
const matrixItem = (id: number, title: string, slug: string, areas: string, site = "https://www.matrix.co.il") => `
  <div class="job-item" id="job-item-9161${id}" data-soc-url="${site}/jobs/משרה/${slug}/" data-profession-ids="33" job-id="${id}">
  <button class="add-to-my-jobs">הוספת משרה למשרות שלי</button>
  <h2 class="job-title"><a href="${site}/jobs/משרה/${slug}/">${title}</a></h2><br>
  <b>איזור: </b><b class="job-areas">${areas}</b><p>דרישות</p></div>`;
const matrixUrl = (rest: string) => new URL(`jobs/${rest}`, "https://www.matrix.co.il/").href;

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

  test("Matrix: its categories, once each, not their subcategories", () => {
    expect(matrixCategories(matrixPage)).toEqual([
      { url: matrixUrl("משרות/%d7%a4%d7%99%d7%aa%d7%95%d7%97/"), name: "פיתוח תוכנה" },
      { url: matrixUrl("משרות/data/"), name: "DATA" },
      { url: matrixUrl("משרות/%d7%9e%d7%98%d7%94/"), name: "מטה" },
    ]);
  });

  test("Matrix: each posting's title, its link on the site and its areas", () => {
    const html = matrixItem(79835, "מפתח/ת JAVA ג&#8217;וניור", "java-junior", "גוש דן, השרון") + matrixItem(2, "Data Analyst", "elsewhere", "צפון", "https://other.co.il");
    expect(parseMatrix(html)).toEqual([
      { title: "מפתח/ת JAVA ג’וניור", company: "", location: "גוש דן, השרון", date: "", url: matrixUrl("משרה/java-junior/"), source: "page" },
    ]);
  });

  test("Lever: each posting with its places, and only a link on Lever", () => {
    const json = JSON.stringify([
      { text: "Big Data Engineer", categories: { location: "Tel Aviv", allLocations: ["Tel Aviv"] }, hostedUrl: "https://jobs.lever.co/walkme/4c2c", createdAt: 1793694228000 },
      { text: "Data Engineer", categories: { location: "Tel Aviv" }, hostedUrl: "https://elsewhere.com/x", createdAt: 1793694228000 },
    ]);
    expect(parseLever(json)).toEqual([{ title: "Big Data Engineer", company: "", location: "Tel Aviv, Tel Aviv", date: "2026-11-03", url: "https://jobs.lever.co/walkme/4c2c", source: "page" }]);
  });

  test("Workable: each job with the places it shows, and only a link on Workable", () => {
    const json = JSON.stringify({ name: "Humanz", jobs: [
      { title: "Junior PPC", url: "https://apply.workable.com/j/AB12CD34EF", published_on: "2026-11-02", country: "Israel", city: "Ramat Gan",
        locations: [{ country: "Israel", countryCode: "IL", city: "Ramat Gan", hidden: false }, { country: "Israel", countryCode: "IL", city: "Haifa", hidden: true }] },
      { title: "Account Executive", url: "https://elsewhere.com/j/1", published_on: "2026-11-02", country: "United Kingdom", city: "London", locations: [] },
    ] });
    expect(parseWorkable(json)).toEqual([{ title: "Junior PPC", company: "", location: "Ramat Gan, Israel", date: "2026-11-02", url: "https://apply.workable.com/j/AB12CD34EF", source: "page" }]);
    expect(() => parseWorkable("{}")).toThrow();
  });

  test("Ashby: the job board's jobs from the page's data, though more script follows it", () => {
    const html = `<script>window.__appData = {"organization":{"name":"Moon Active"},"jobBoard":{"jobPostings":[
      {"id":"6f2a-11","title":"Backend Developer","locationName":"Tel Aviv","secondaryLocations":[{"locationName":"Remote, Israel"}]}]}};
      window.addEventListener("load", function () { loadBundle(); });</script>`;
    expect(parseAshby(html, "moonactive")).toEqual([{ title: "Backend Developer", company: "", location: "Tel Aviv, Remote, Israel", date: "", url: "https://jobs.ashbyhq.com/moonactive/6f2a-11", source: "page" }]);
  });

  test("Comeet: the positions from the page's data, past where it is declared empty, each with its country", () => {
    const position = (name: string, country: string, city: string) => ({ name, location: { name: city, country, city }, time_updated: "2026-11-05T20:38:43Z", url_comeet_hosted_page: `https://www.comeet.com/jobs/cyera/17.008/${name.toLowerCase().replace(/\W+/g, "-")}/AB.123` });
    const html = `<script>var COMPANY_DATA ;\n var COMPANY_POSITIONS_DATA ;\n var POSITION_DATA ;</script><script>
      COMPANY_POSITIONS_DATA = ${JSON.stringify([position("AI Researcher", "IL", "Tel Aviv"), position("Sales Lead", "US", "New York")])};\n</script>`;
    expect(parseComeet(html)).toEqual([
      { title: "AI Researcher", company: "", location: "Tel Aviv, Israel", date: "2026-11-05", url: "https://www.comeet.com/jobs/cyera/17.008/ai-researcher/AB.123", source: "page" },
      { title: "Sales Lead", company: "", location: "New York, US", date: "2026-11-05", url: "https://www.comeet.com/jobs/cyera/17.008/sales-lead/AB.123", source: "page" },
    ]);
  });

  test("Eightfold, Amazon, Apple: each search's results with their places, days and pages", () => {
    expect(parseEightfold(JSON.stringify({ data: { positions: [{ name: "Customer Engineer", locations: ["Mig Ha'emek,ISR"], postedTs: 1793836800, positionUrl: "/careers/job/790318821053" }] } }), "careers.appliedmaterials.com"))
      .toEqual([{ title: "Customer Engineer", company: "", location: "Mig Ha'emek,ISR", date: "2026-11-05", url: "https://careers.appliedmaterials.com/careers/job/790318821053", source: "page" }]);
    expect(parseAmazon(JSON.stringify({ jobs: [{ title: "Software Development Engineer", location: "IL, Haifa", posted_date: "September  2, 2026", job_path: "/en/jobs/10525878/sde" }] })))
      .toEqual([{ title: "Software Development Engineer", company: "", location: "IL, Haifa", date: "2026-09-02", url: "https://www.amazon.jobs/en/jobs/10525878/sde", source: "page" }]);
    const data = { loaderData: { search: { search: { searchResults: [{ id: "200694001-0865", postingTitle: "Cellular SW Engineer", transformedPostingTitle: "cellular-sw-engineer",
      postDateInGMT: "2026-11-08T10:32:48.962Z", locations: [{ name: "Herzliya", countryName: "Israel" }] }] } } } };
    const apple = `<script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify(data))});</script>`;
    expect(parseApple(apple)).toEqual([{ title: "Cellular SW Engineer", company: "", location: "Herzliya, Israel", date: "2026-11-08", url: "https://jobs.apple.com/en-il/details/200694001-0865/cellular-sw-engineer", source: "page" }]);
  });

  test("Google: each card's title and place, not the filters' headings over the list", () => {
    const card = (id: number, title: string, place: string) => `<li class="lLd3Je"><div><h3 class="QJPWVe">${title}</h3><span><i>place</i><span class="r0wTof">${place}</span></span>
      <p>Minimum qualifications</p><a class="WpHeLc" href="jobs/results/${id}-${title.toLowerCase().replace(/\W+/g, "-")}?location=Israel" aria-label="Learn more">Learn more</a></div></li>`;
    const html = `<title>Search Jobs — Google Careers</title><h3>Locations</h3><span>Israel</span><h3>Experience</h3><ul>${card(1338, "Software Engineer III", "Tel Aviv, Israel")}${card(1339, "Data Scientist", "Haifa, Israel")}</ul>`;
    expect(parseGoogle(html)).toEqual([
      { title: "Software Engineer III", company: "", location: "Tel Aviv, Israel", date: "", url: "https://www.google.com/about/careers/applications/jobs/results/1338-software-engineer-iii", source: "page" },
      { title: "Data Scientist", company: "", location: "Haifa, Israel", date: "", url: "https://www.google.com/about/careers/applications/jobs/results/1339-data-scientist", source: "page" },
    ]);
  });

  test("Mobileye: each card's title, the place after it, and its page", () => {
    const card = (title: string, place: string, slug: string) => `<div class="jobItem toggleClose" data-v-18ea0e85><p class="category" data-v-d5d26d91>Algorithms</p>
      <p class="jobTitle" data-v-d5d26d91>${title}</p><p class="location" data-v-d5d26d91>${place}</p><p>Full time</p><a href="/jobs/${slug}/e3011eb4" class="newTab">x</a></div>`;
    expect(parseMobileye(card("AI Algorithm Engineer", "Jerusalem", "ai-algorithm-engineer") + card("Account Manager", "Mumbai", "account-manager"))).toEqual([
      { title: "AI Algorithm Engineer", company: "", location: "Jerusalem", date: "", url: `${MOBILEYE}/ai-algorithm-engineer/e3011eb4`, source: "page" },
      { title: "Account Manager", company: "", location: "Mumbai", date: "", url: `${MOBILEYE}/account-manager/e3011eb4`, source: "page" },
    ]);
  });

  test("Check Point: a page of its list for Israel from the page's data, and how many pages there are", () => {
    const data = { props: { pageProps: { result: { numberOfMatches: 40, numberOfPages: 4, jobPostingsList: [
      { id: "2374789", title: "Backend Developer", city: "Tel Aviv-Yafo", country: "Israel", datePosted: "2026-11-04T10:00:00Z", slug: "backend-developer" },
    ] } } } };
    expect(parseCheckPoint(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`)).toEqual({ pages: 4, found: [
      { title: "Backend Developer", company: "", location: "Tel Aviv-Yafo, Israel", date: "2026-11-04", url: "https://careers.checkpoint.com/jobs/2374789/backend-developer", source: "page" },
    ] });
  });

  test("Radancy (Palo Alto): each result's title and place, and the pages", () => {
    const html = `<section data-total-results="114" data-total-pages="8" data-current-page="1"><ul><li>
      <a class="section29__search-results-link" href="/en/job/petach-tikva/senior-staff-software-engineer/47263/99" data-job-id="99"><h2 class="section29__search-results-job-title">Senior Staff Software Engineer</h2>
      <div><span class="section29__result-location newLoc">Petach Tikva, Israel</span></div></a></li></ul></section>`;
    expect(parseRadancy(html, "https://jobs.paloaltonetworks.com")).toEqual({ pages: 8, found: [
      { title: "Senior Staff Software Engineer", company: "", location: "Petach Tikva, Israel", date: "", url: "https://jobs.paloaltonetworks.com/en/job/petach-tikva/senior-staff-software-engineer/47263/99", source: "page" },
    ] });
  });

  test("marked job postings (HiBob): a country's code as its name, and only links on the site", () => {
    const posting = (title: string, locality: string, url: string) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title, datePosted: "2026-11-08T11:37:41.000Z",
      jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: locality } }, url })}</script>`;
    const html = posting("Frontend Engineer", "IL", "https://hibob-fa0ad69d0cb34a.careers.hibob.com/jobs/faa5807c/apply") + posting("Data Analyst", "IL", "https://evil.example.com/jobs/1");
    expect(parseJobPostings(html, ".careers.hibob.com")).toEqual([
      { title: "Frontend Engineer", company: "", location: "Israel", date: "2026-11-08", url: "https://hibob-fa0ad69d0cb34a.careers.hibob.com/jobs/faa5807c/apply", source: "page" },
    ]);
  });

  test("Jobvite (Varonis): each row's job and its place, the row's last mark", () => {
    const row = (id: string, title: string, team: string, place: string) => `<li class="row"><a href="/varonis/job/${id}?nl=1"><div class="job-item"><div class="jv-job-list-name"> ${title} </div>
      <div class="ml-auto jv-job-list-location"><span>${team}</span><span> ${place} </span></div></div></a></li>`;
    expect(parseJobvite(row("o5zVAfwT", "Senior Data Scientist", "R&amp;D", "Israel") + row("oAbc", "Account Manager", "Sales", "Dallas, Texas"), "varonis")).toEqual([
      { title: "Senior Data Scientist", company: "", location: "Israel", date: "", url: "https://jobs.jobvite.com/varonis/job/o5zVAfwT", source: "page" },
      { title: "Account Manager", company: "", location: "Dallas, Texas", date: "", url: "https://jobs.jobvite.com/varonis/job/oAbc", source: "page" },
    ]);
  });

  test("Unity: each position from the page's data, quotes and all", () => {
    const item = { title: "Senior SDK Developer, Monetization", locations: ["Tel Aviv, Israel"], department: "Engineering & R&D", id: "JOBREQ-1",
      externalUrl: "https://unitytech.wd1.myworkdayjobs.com/Unity/job/Tel-Aviv-Israel/Senior-SDK-Developer_JOBREQ-1" };
    const html = `<script>self.__next_f.push([1,${JSON.stringify(`5:["$","div",null,{"positions":[${JSON.stringify(item)}]}]`)}])</script>`;
    expect(parseUnity(html)).toEqual([{ title: "Senior SDK Developer, Monetization", company: "", location: "Tel Aviv, Israel", date: "", url: item.externalUrl, source: "page" }]);
  });

  test("Greenhouse: a list that isn't one fails, rather than say there are no jobs", () => {
    expect(() => parseGreenhouse(`{"error":"Job board not found"}`, "x")).toThrow();
    expect(parseGreenhouse(JSON.stringify({ jobs: [{ id: "x", title: "Data Analyst" }] }), "x")).toEqual([]);
  });

  test("the day from what the sites give, and the searches from the roles", () => {
    expect([day("2026-10-20T08:00:00-04:00"), day(1793694228), day(1793694228000), day("September  2, 2026"), day("08 Nov 2026"), day("soon")]).toEqual(["2026-10-20", "2026-11-03", "2026-11-03", "2026-09-02", "2026-11-08", ""]);
    expect(searchTerms([{ label: "a", query: "Junior Data Analyst" }, { label: "b", query: "Data Analyst" }, { label: "c", query: "Senior ML Engineer" }])).toEqual(["Data Analyst", "ML Engineer"]);
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

  test("on its own site (Matrix): its jobs page, then only the lists of the categories the roles' fields are in, and only titles for the roles", async () => {
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      if (url === MATRIX) return matrixPage;
      if (url === matrixUrl("משרות/data/")) return matrixItem(1, "Data Analyst לחברה פיננסית", "data-analyst", "גוש דן") + matrixItem(2, "נהג/ת", "driver", "גוש דן");
      return "";
    };
    const found = await readEmployer(portalById("matrix")!, roles, { fetch, today });
    expect(asked).toEqual([MATRIX, matrixUrl("משרות/data/")]);
    expect(found).toEqual([expect.objectContaining({ title: "Data Analyst לחברה פיננסית", company: "מטריקס", location: "גוש דן", portal: "matrix" })]);
  });

  test("on its own site (Matrix): a jobs page with no categories fails, rather than say there are no jobs", async () => {
    await expect(readEmployer(portalById("matrix")!, roles, { fetch: async () => "<html></html>", today })).rejects.toThrow();
  });

  test("on Greenhouse (Wiz): its board's list, only the jobs in Israel and for the roles, each linked on the board", async () => {
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      return JSON.stringify({ jobs: [
        { id: 11, title: "Data Analyst", location: { name: "Tel Aviv" }, updated_at: "2026-11-01T09:00:00-04:00", first_published: "2026-10-20T08:00:00-04:00" },
        { id: 12, title: "Data Analyst", location: { name: "New York, NY" }, updated_at: "2026-11-01T09:00:00-04:00" },
        { id: 13, title: "Account Executive", location: { name: "Tel Aviv" }, updated_at: "2026-11-01T09:00:00-04:00" },
      ] });
    };
    const found = await readEmployer(portalById("wiz")!, roles, { fetch, today });
    expect(asked).toEqual(["https://boards-api.greenhouse.io/v1/boards/wizinc/jobs"]);
    expect(found).toEqual([{ title: "Data Analyst", company: "וויז", location: "Tel Aviv", date: "2026-10-20", url: "https://job-boards.greenhouse.io/wizinc/jobs/11", source: "page", portal: "wiz" }]);
  });

  test("on Workable (Humanz): its account's list, only the jobs in Israel", async () => {
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      return JSON.stringify({ jobs: [
        { title: "Data Analyst", url: "https://apply.workable.com/j/1A", published_on: "2026-11-01", locations: [{ country: "Israel", city: "Ramat Gan" }] },
        { title: "Data Analyst", url: "https://apply.workable.com/j/2B", published_on: "2026-11-01", locations: [{ country: "United Kingdom", city: "London" }] },
      ] });
    };
    const found = await readEmployer(portalById("humanz")!, roles, { fetch, today });
    expect(asked).toEqual(["https://apply.workable.com/api/v1/widget/accounts/humanz"]);
    expect(found.map((p) => [p.title, p.location, p.url])).toEqual([["Data Analyst", "Ramat Gan, Israel", "https://apply.workable.com/j/1A"]]);
  });

  test("on a careers site's search (Nvidia, on Eightfold): asked for Israel and each role, without its level", async () => {
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      return JSON.stringify({ data: { positions: [{ name: "Data Analyst", locations: ["Israel, Yokneam"], postedTs: 1793694228, positionUrl: "/careers/job/893397629693" }] } });
    };
    const found = await readEmployer(portalById("nvidia")!, roles, { fetch, today });
    expect(asked).toEqual(["https://jobs.nvidia.com/api/pcsx/search?domain=nvidia.com&query=Data%20Analyst&location=Israel&start=0"]);
    expect(found).toEqual([expect.objectContaining({ title: "Data Analyst", location: "Israel, Yokneam", date: "2026-11-03", url: "https://jobs.nvidia.com/careers/job/893397629693", company: "אנבידיה" })]);
  });

  test("over pages (Check Point, Palo Alto): the first, then as many as it says there are, by the addresses that may be read", async () => {
    const asked: string[] = [];
    const page = (n: number) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { result: { numberOfPages: 2, jobPostingsList: [
      { id: String(n), title: `Data Analyst ${n}`, city: "Tel Aviv-Yafo", country: "Israel", slug: `data-analyst-${n}` }] } } } })}</script>`;
    const fetch: Fetch = async (url) => { asked.push(url); return page(asked.length); };
    expect((await readEmployer(portalById("check-point")!, roles, { fetch, today })).map((p) => p.title)).toEqual(["Data Analyst 1", "Data Analyst 2"]);
    expect(asked).toEqual([CHECKPOINT, `${CHECKPOINT}&page=2`]);
    asked.length = 0;
    const radancy = `<div data-total-pages="2"><a href="/en/job/tel-aviv/data-analyst/47263/1"><h2>Data Analyst</h2><span class="result-location">Tel Aviv-Yafo, Israel</span></a></div>`;
    await readEmployer(portalById("palo-alto")!, roles, { fetch: async (url) => { asked.push(url); return radancy; }, today });
    expect(asked).toEqual([PALOALTO, `${PALOALTO}?p=2`]);
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
