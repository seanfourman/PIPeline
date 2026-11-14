import { describe, expect, test } from "bun:test";
import {
  allJobsCategories, AMAN, CHECKPOINT, day, dayMonthYear, DIALOG, dialogFields, ELAD, MATRIX, parseAman, parseDialog, matrixCategories, MIMUN_YASHIR, MOBILEYE, NESS, PALOALTO, parseAllJobs, parseElad, parseNess, parseAmazon, parseApple, parseAshby, parseCheckPoint, parseComeet,
  parseDrushim, parseEightfold, parseGoogle, parseGreenhouse, parseJobMaster, parseJobPostings, parseJobvite, parseLever, parseMatrix, parseMobileye, parseRadancy,
  embeddedBoard, forgetGovList, jsonPoster, nuxtState, parseGotfriends, textBlocks, parseJobFeed, parseJobnet, parseNisha, parseRedmatch, parseWorkday, parseUnity, parseWorkable, postedOn, readEmployer, readLinks, readOwnPage, searchBoard, searchTerms, text, type Fetch, type Post,
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

  test("reads Elbit's own list from the file its site reads: each open job's title, city or area, day and page", async () => {
    const file = JSON.stringify([
      { jobId: 21218, jobTitle: "Junior Data Analyst", openDate: "2026-11-11T11:46:00", status: 1, area: "North", extendedProperties: [{ PropertyName: "Area", Value: "North" }, { PropertyName: "Cities", Value: "1227" }] },
      { jobId: 21219, jobTitle: "Data Analyst", openDate: "2026-11-10T09:00:00", status: 1, area: "Sharon", extendedProperties: [{ PropertyName: "Cities", Value: "799" }] },
      { jobId: 21220, jobTitle: "Data Analyst", openDate: "2026-11-10T09:00:00", status: 0, area: "Sharon" },
    ]);
    const asked: string[] = [];
    const found = await readEmployer(portalById("elbit")!, roles, { fetch: async (url) => (asked.push(url), url === "https://elbitsystemscareer.com/cron/jobs.json" ? file : null), today });
    expect(found.map((j) => [j.title, j.location, j.date, j.url, j.company])).toEqual([
      ["Junior Data Analyst", "יקנעם", "2026-11-11", "https://elbitsystemscareer.com/job?jid=21218", "אלביט מערכות"],
      ["Data Analyst", "שרון", "2026-11-10", "https://elbitsystemscareer.com/job?jid=21219", "אלביט מערכות"],
    ]);
    expect(asked).toEqual(["https://elbitsystemscareer.com/cron/jobs.json"]);
    expect(portalById("elbit")!.url).toBe("https://elbitsystemscareer.com/jobs");
  });

  test("reads the Ministry of Defense's tenders, a Jibe site's list, HOT's service and a Topmatch board", async () => {
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      if (url === "https://jobs.mod.gov.il/api/TenderPublish/GetAllPublished") return JSON.stringify({ HasError: false, Data: [
        { Id: 35071, TenderPublish: { StartDate: "2026-11-08T00:00:00" }, BankJob: { JobName: "Junior Data Analyst", HrJob: { JobAreaDescription: "תל אביב-יפו" } } },
      ] });
      if (url === "https://careers.se.com/api/jobs?location=Israel&page=1") return JSON.stringify({ totalCount: 1, jobs: [
        { data: { title: "Junior Data Analyst", full_location: "Central, Israel", posted_date: "24 March 2026", meta_data: { canonical_url: "https://careers.se.com/jobs/134243?lang=en-us" } } },
      ] });
      return null;
    };
    const posted: [string, unknown][] = [];
    const post: Post = async (url, body) => {
      posted.push([url, body]);
      if (url === "https://www.hot.net.il/HotCmsApiFront/api/MarketingJob/GetJobs") return JSON.stringify(JSON.stringify({ isError: false, data: { vacanciesDetails: [{ vacancyName: "JB-187", jobTitle: "Junior Data Analyst", location: "יקום" }] } }));
      if (url.startsWith("https://careers.topmatch.co.il/CandidateAPI/api/position/Search/")) return JSON.stringify({ positions: [{ compPositionID: "199649", jobTitleText: "Junior Data Analyst", displayLocation: "רמת גן", activationDate: "2026-11-11T09:00:00" }] });
      return null;
    };
    expect((await readEmployer(portalById("mod")!, roles, { fetch, today })).map((j) => [j.title, j.location, j.date, j.url]))
      .toEqual([["Junior Data Analyst", "תל אביב-יפו", "2026-11-08", "https://jobs.mod.gov.il/?tender=35071#/Tenders/35071"]]);
    expect((await readEmployer(portalById("schneider-electric")!, roles, { fetch, today })).map((j) => [j.title, j.date, j.url]))
      .toEqual([["Junior Data Analyst", "2026-03-24", "https://careers.se.com/jobs/134243?lang=en-us"]]);
    expect((await readEmployer(portalById("hot")!, roles, { fetch, post, today })).map((j) => [j.title, j.url]))
      .toEqual([["Junior Data Analyst", "https://www.hot.net.il/heb/careersearch/?pip-job=JB-187"]]);
    expect((await readEmployer(portalById("bar-ilan")!, roles, { fetch, post, today })).map((j) => j.url))
      .toEqual(["https://careers.topmatch.co.il/biu/redmatch-apply/redmatch.apply.html?compPositionID=199649"]);
    expect(posted.map(([url]) => url)).toEqual(["https://www.hot.net.il/HotCmsApiFront/api/MarketingJob/GetJobs", "https://careers.topmatch.co.il/CandidateAPI/api/position/Search/D8D6FFC7-31E2-46C1-94B4-985C99B9A913"]);
    expect(asked.some((u) => /alljobs|drushim/.test(u))).toBe(false);
  });

  test("a list written out in full whose jobs have pages of their own their ids make is read with those pages", async () => {
    const row = (id: number, title: string) => `<div class="table-row"><input type="checkbox" name="job_checkbox" value="${id}"><div class="role"><button aria-expanded="false">${title}</button></div>
      <div class="area"><div class="area-title">אזור</div><span>\n${" ".repeat(200)}המרכז והשפלה\n</span></div></div>`;
    const found = await readEmployer(portalById("leumi")!, roles, { fetch: async () => row(2670, "Junior Data Analyst 2920") + row(793, "יועץ/ת השקעות"), today });
    expect(found.map((j) => [j.title, j.location, j.url])).toEqual([["Junior Data Analyst 2920", "המרכז והשפלה", "https://www.leumi.co.il/he/node/2670"]]);
  });

  test("reads a government body's tenders from the civil service's list, read once for all of them", async () => {
    forgetGovList();
    const feed = JSON.stringify({ d: { results: [
      { RequestId: "07933531", OfficeNumber: "0510", OfficeName: "שירות עיבודים ממוחשבים", TenderName: "Junior Data Analyst", LocationName: "ירושלים", TenderPublicationDate: "/Date(1794268800000)/" },
      { RequestId: "07933532", OfficeNumber: "0560", TenderName: "מפקח/ת מס", LocationName: "חיפה" },
      { RequestId: "07933533", OfficeNumber: "1870", TenderName: "Data Analyst", LocationName: "תל אביב - יפו" },
    ] } });
    const asked: string[] = [];
    const fetch: Fetch = async (url) => (asked.push(url), url.includes("GIUS_PUBLIC_AREA_SRV") ? feed : null);
    const tax = await readEmployer(portalById("tax")!, roles, { fetch, today });
    expect(tax.map((j) => [j.title, j.location, j.date, j.url])).toEqual([["Junior Data Analyst", "ירושלים", "2026-11-10", "https://merkava.mrp.gov.il/giusp/index.html?position=07933531#/position/07933531"]]);
    const welfare = await readEmployer(portalById("welfare")!, roles, { fetch, today });
    expect(welfare.map((j) => j.title)).toEqual(["Data Analyst"]);
    expect(asked.filter((u) => u.includes("GIUS_PUBLIC_AREA_SRV"))).toHaveLength(1);
    expect(portalById("tax")!.url).toBe("https://merkava.mrp.gov.il/giusp/index.html");
    forgetGovList();
  });

  test("reads a WordPress site's own list of its jobs, page by page, and a WordPress feed of them", async () => {
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      if (url.includes("/wp-json/wp/v2/career?")) return JSON.stringify([
        { id: 1, date: "2026-11-02T10:00:00", link: "https://amit.org.il/career/junior-data-analyst/", title: { rendered: "Junior Data Analyst &#8211; R&amp;D" } },
        { id: 2, date: "2026-11-02T10:00:00", link: [], title: { rendered: "Data Analyst" } },
      ]);
      if (url === "https://www.histadrut.org.il/jobs/feed/") return `<rss><channel><item><title>Data Analyst</title><link>https://www.histadrut.org.il/jobs/data-analyst/</link><pubDate>Mon, 09 Nov 2026 08:00:00 +0000</pubDate></item></channel></rss>`;
      return null;
    };
    const amit = await readEmployer(portalById("amit")!, roles, { fetch, today });
    expect(amit.map((j) => [j.title, j.date, j.url])).toEqual([["Junior Data Analyst – R&D", "2026-11-02", "https://amit.org.il/career/junior-data-analyst/"]]);
    expect(asked[0]).toBe("https://amit.org.il/wp-json/wp/v2/career?per_page=100&page=1&_fields=id,date,link,title");
    const histadrut = await readEmployer(portalById("histadrut")!, roles, { fetch, today });
    expect(histadrut.map((j) => [j.title, j.url])).toEqual([["Data Analyst", "https://www.histadrut.org.il/jobs/data-analyst/"]]);
  });

  test("reads a job's link from its share buttons, one page however its escapes are written, a title inside a card's link", () => {
    // One1's jobs: no link of their own but the ones its share buttons pass on; their words are the network's.
    const shared = `<span class="job_title">Junior Python Developer</span><p>${"תיאור ".repeat(800)}</p><h3 class="social-share-title">שיתוף עם</h3>
      <a href="https://api.whatsapp.com/send?text=https%3A%2F%2Fwww.one1.co.il%2F%3Fshare_job_id%3D3598">send</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fwww.one1.co.il%2F%3Fshare_job_id%3D3598">sharer</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fevil.example%2F%3Fshare_job_id%3D1">sharer</a>`;
    expect(readLinks(shared, "https://www.one1.co.il/careers/", "share_job_id=[0-9]+", 'class="job_title">([^<]{3,140})</span>'))
      .toEqual([{ title: "Junior Python Developer", company: "", location: "", date: "", url: "https://www.one1.co.il/?share_job_id=3598", source: "page" }]);
    // Shapir writes the same page's address with %D7 and with %d7.
    const cased = `<a href="https://www.shapir.co.il/%D7%9E%D7%A9%D7%A8%D7%95%D7%AA/qa/">QA Engineer</a><a href="https://www.shapir.co.il/%d7%9e%d7%a9%d7%a8%d7%95%d7%aa/qa/">QA Engineer</a>`;
    expect(readLinks(cased, "https://www.shapir.co.il/en/careers/", "^/משרות/[^/]+/?$").map((j) => j.url)).toEqual(["https://www.shapir.co.il/%D7%9E%D7%A9%D7%A8%D7%95%D7%AA/qa/"]);
    // A card that is all one link: its category and title inside it, the title by the site's pattern.
    const card = `<a href="https://www.mymc.co.il/jobs/plumber-wanted/"><div><span>כוח עזר</span></div><h2 class="elementor-heading-title elementor-size-default">דרוש אינסטלטור</h2><p>לעבודה במשמרות</p></a>`;
    expect(readLinks(card, "https://www.mymc.co.il/jobs/", "^/jobs/[^/]+/$", '<h2 class="elementor-heading-title[^"]*">([^<]{3,140})</h2>').map((j) => j.title)).toEqual(["דרוש אינסטלטור"]);
  });

  test("reads a list written out in full: each job its block, known by the list's address and its id or its title's hash", async () => {
    const section = (id: string, title: string) => `<section   id="section_${id}" style="border-bottom: 1px solid #adc0c4;">\n  <h2>${title}</h2>\n<p>תיאור התפקיד</p></section>`;
    const page = `<h1>משרות פנויות</h1>${section("28a349fc-9b28", "מדיניות הפרטיות למועמדים לעבודה")}${section("1021d133-9f07", "Junior Data Analyst&#xA0;")}${section("b5d37895-4f15", "מנהל/ת השקעות")}`;
    const asked: string[] = [];
    const found = await readEmployer(portalById("fibi")!, roles, { fetch: async (url) => (asked.push(url), page), today });
    expect(found.map((j) => [j.title, j.url])).toEqual([["Junior Data Analyst", "https://www.fibi.co.il/private/general/about/jobs/jobsfibi/?pip-job=section_1021d133-9f07"]]);
    expect(asked).toEqual(["https://www.fibi.co.il/private/general/about/jobs/jobsfibi/"]);
    const blocks = textBlocks(page, { url: "https://x.example/jobs", item: "<h2>(?<title>[^<]+)</h2>" });
    expect(blocks.map((b) => b.id)).toEqual([expect.stringMatching(/^[0-9a-f]{8}$/), expect.stringMatching(/^[0-9a-f]{8}$/), expect.stringMatching(/^[0-9a-f]{8}$/)]);
    expect(blocks[1].html).toStartWith("<h2>Junior Data Analyst");
    expect(blocks[1].html).not.toContain("מנהל/ת השקעות");
    // The same title twice is two jobs.
    const twice = textBlocks("<h2>Data Analyst</h2>a<h2>Data Analyst</h2>b", { url: "https://x.example/jobs", item: "<h2>(?<title>[^<]+)</h2>" });
    expect(twice[1].id).toBe(`${twice[0].id}-2`);
  });

  test("reads a Nuxt page's state as data: the values its short names stand for, a number without its 0 too", () => {
    const html = `<script>window.__NUXT__=(function(a,b,c,d,e){return {x:a,y:{z:"}{"},w:[b,c]}}(false,.5,"Y",-12,"ראשון לציון\\u002Fב"));</script>`;
    const state = nuxtState(html)!;
    expect([...state.values]).toEqual([["a", false], ["b", 0.5], ["c", "Y"], ["d", -12], ["e", "ראשון לציון/ב"]]);
    expect(state.body).toBe('{return {x:a,y:{z:"}{"},w:[b,c]}}');
    expect(nuxtState("<html></html>")).toBeNull();
  });

  test("reads the Phoenix's own list from its careers page's state: only what it shows on its site", async () => {
    const page = `<script>window.__NUXT__=(function(a,b,c,d){return {state:{career:{positions:[`
      + `{positionCode:"50400118",positionDesc:"Junior Data Analyst",displayOrgUnit:d,marketingSite:a,positionLocation:"07",positionLocationText:b,lastModifiedOn:c,positionText:[{line:"SQL"}]},`
      + `{positionCode:"50400119",positionDesc:"Data Analyst",marketingSite:"N",positionLocationText:b,lastModifiedOn:c}`
      + `]}}}}("Y","ראשון לציון",1794276000000,""));</script>`;
    const asked: string[] = [];
    const found = await readEmployer(portalById("phoenix")!, roles, { fetch: async (url) => (asked.push(url), page), today });
    expect(found.map((j) => [j.title, j.location, j.date, j.url])).toEqual([["Junior Data Analyst", "ראשון לציון", "2026-11-10", "https://www.fnx.co.il/career/open-positions/50400118/"]]);
    expect(asked).toEqual(["https://www.fnx.co.il/career/open-positions/"]);
  });

  test("reads Bezeq's own list from its service, each job linked to its page", async () => {
    const list = JSON.stringify({ isSuccessfull: true, data: [
      { order_id: 2995, description: "Junior Data Analyst", tat_profession_name: "Junior Data Analyst", work_area: "גוש דן", orderDate: "2026-10-21T00:00:00", email_rakaz: "someone@bezeq.co.il", rakaz: "Someone" },
      { order_id: "x", description: "Data Analyst" },
    ] });
    const asked: string[] = [];
    const found = await readEmployer(portalById("bezeq")!, roles, { fetch: async (url) => (asked.push(url), list), today });
    expect(found).toEqual([{ title: "Junior Data Analyst", company: "בזק", location: "גוש דן", date: "2026-10-21", url: "https://www.bezeq.co.il/career/jobs/form/?jobs=2995", source: "page", portal: "bezeq" }]);
    expect(asked).toEqual(["https://d-api.bezeq.co.il/api/Adam/GetActiveJobs"]);
  });

  test("reads Menora's own list from its careers page's data, for its pension company too", async () => {
    const data = { props: { initialReduxState: { metadata: { positions: [
      { positionId: "c1798b004c4a9df6794cf4bb956baa80", positionName: "Junior Data Analyst | אגף מערכות מידע", positionDisplayName: "Junior Data Analyst | אגף מערכות מידע", fromDate: "09/06/2026", localityLongName: "גוש דן" },
      { positionId: "../evil", positionName: "Data Analyst" },
    ] } } } };
    const page = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
    for (const id of ["menora", "menora-pension"]) {
      const asked: string[] = [];
      const found = await readEmployer(portalById(id)!, roles, { fetch: async (url) => (asked.push(url), page), today });
      expect(found.map((j) => [j.title, j.location, j.date, j.url])).toEqual([["Junior Data Analyst | אגף מערכות מידע", "גוש דן", "2026-06-09", "https://www.menoramivt.co.il/job-posting/details?entityId=c1798b004c4a9df6794cf4bb956baa80"]]);
      expect(asked).toEqual(["https://www.menoramivt.co.il/job-posting/jobs"]);
    }
  });

  test("reads IAI's own list from the file its site names, each job linked to its page", async () => {
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      if (url === "https://jobs.iai.co.il/jobs/") return `<script>const _jobsFile = "\\/wp-content\\/themes\\/tyco-wp\\/assets\\/json\\/jobs.json?v=1794492619";</script>`;
      if (url.startsWith("https://jobs.iai.co.il/wp-content/")) return JSON.stringify([
        { id: 76050663, tl: "Junior Data Analyst ", ct: 'נתב"ג', cd: "147769", dc: "קצת על התפקיד" },
        { id: 76050689, tl: "מנהל/ת M&A", ct: 'נתב"ג' },
        { id: "x", tl: "No number" },
      ]);
      return null;
    };
    const found = await readEmployer(portalById("iai")!, roles, { fetch, today });
    expect(found.map((j) => [j.title, j.location, j.url, j.company])).toEqual([["Junior Data Analyst", 'נתב"ג', "https://jobs.iai.co.il/job/76050663", "התעשייה האווירית"]]);
    expect(asked).toEqual(["https://jobs.iai.co.il/jobs/", "https://jobs.iai.co.il/wp-content/themes/tyco-wp/assets/json/jobs.json?v=1794492619"]);
    expect(portalById("iai")!.url).toBe("https://jobs.iai.co.il/jobs/");
  });

  test("reads Ethosia's jobs through its WordPress list: a junior search asks only for the starting levels, the areas by name", async () => {
    const recent = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 19);
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 19);
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      asked.push(url);
      if (url.includes("/job?")) return JSON.stringify([
        { id: 1, date: recent, link: "https://ethosia.co.il/content/junior-data-analyst/", title: { rendered: "Junior Data Analyst %28BI%29" }, "closed-jobs": [], "area-in-the-country": [83, 85] },
        { id: 2, date: recent, link: "https://ethosia.co.il/content/data-analyst-closed/", title: { rendered: "Data Analyst" }, "closed-jobs": [4787], "area-in-the-country": [83] },
        { id: 3, date: old, link: "https://ethosia.co.il/content/data-analyst-old/", title: { rendered: "Data Analyst" }, "closed-jobs": [], "area-in-the-country": [83] },
      ]);
      if (url.includes("/area-in-the-country?")) return JSON.stringify([{ id: 83, name: "מרכז" }, { id: 85, name: "שפלה" }]);
      return null;
    };
    const found = await readEmployer(portalById("ethosia")!, roles, { fetch, today, seniority: "junior" });
    expect(found.map((j) => [j.title, j.location, j.url, j.company])).toEqual([["Junior Data Analyst (BI)", "מרכז, שפלה", "https://ethosia.co.il/content/junior-data-analyst/", "אתוסיה"]]);
    expect(asked[0]).toContain("&job-type=88,78,486&");
    expect(asked[1]).toContain("include=83,85&");
    asked.length = 0;
    await readEmployer(portalById("ethosia")!, roles, { fetch, today });
    expect(asked[0]).not.toContain("job-type");
  });

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

  test("on its own site (Ness): its whole list from the site's job service, each job linked to its page there", async () => {
    const list = { getTotalCount: 3, allOrderDetailsList: [
      { index: "43535", title: "בודק/ת תוכנה ג'וניור", posLocation: "אזור המרכז", lastUpdated: "05/11/2026", rakazEmail: "someone@example.com", posDescription: "..." },
      { index: "42814", title: "מיישמ/ת SAP SD", posLocation: "אזור המרכז", lastUpdated: "28/07/2026" },
      { index: "x", title: "No number", posLocation: "צפון", lastUpdated: "" },
    ] };
    expect(dayMonthYear("5/1/2026")).toBe("2026-01-05");
    expect(parseNess(JSON.stringify(list))).toEqual([
      { title: "בודק/ת תוכנה ג'וניור", company: "", location: "אזור המרכז", date: "2026-11-05", url: "https://www.ness-tech.co.il/careers/job/43535", source: "page" },
      { title: "מיישמ/ת SAP SD", company: "", location: "אזור המרכז", date: "2026-07-28", url: "https://www.ness-tech.co.il/careers/job/42814", source: "page" },
    ]);
    expect(() => parseNess("<html>maintenance</html>")).toThrow();
    const asked: string[] = [];
    const found = await readEmployer(portalById("ness")!, [{ id: "qa", label: "QA", query: "Junior QA Engineer" }], { fetch: async (url) => { asked.push(url); return JSON.stringify(list); }, today });
    // One read; only the titles for the roles; the regions, all in Israel, kept though the place check doesn't know them.
    expect(asked).toEqual([NESS]);
    expect(found).toEqual([expect.objectContaining({ title: "בודק/ת תוכנה ג'וניור", company: "נס טכנולוגיות", location: "אזור המרכז", portal: "ness" })]);
  });

  test("on its own site (Elad): its list's pages in turn, each card's title and regions, the jobs abroad left out", async () => {
    const card = (id: number, title: string, areas: [number, string][]) => `<article class="job-card flex-column">
      <h3 class="job-title">
        <a href="https://elad.a-2-z.co.il/jobs/${id}/" aria-label="קישור לעמוד המשרה: ${title}">
        ${title}                            </a>
      </h3><span class="job-id">משרה מס׳: ${id}</span>
      ${areas.map(([n, name]) => `<a href="https://elad.a-2-z.co.il/jobs/?area=${n}" class="tag"><img src="/location.svg" alt="מיקום המשרה"> ${name}</a>`).join("")}
    </article>`;
    const pages: Record<string, string> = {
      [ELAD]: `<form method="GET" id="jobs-filter"></form>${card(1007770, "AI-Driven QA Automation Lead", [[40, "גוש דן"]])}${card(1007771, "QA Engineer", [[71, 'חו"ל']])}
        <a href="https://elad.a-2-z.co.il/jobs/?pg=2">2</a>`,
      [`${ELAD}?pg=2`]: `<form id="jobs-filter"></form>${card(1006726, "בודק/ת תוכנה", [[60, 'ירושלים יו"ש'], [50, "השפלה"]])}`,
    };
    expect(parseElad(pages[ELAD]).pages).toBe(2);
    const asked: string[] = [];
    const found = await readEmployer(portalById("elad-systems")!, [{ id: "qa", label: "QA", query: "Junior QA Engineer" }], { fetch: async (url) => { asked.push(url); return pages[url] ?? null; }, today });
    expect(asked).toEqual([ELAD, `${ELAD}?pg=2`]);
    expect(found).toEqual([
      expect.objectContaining({ title: "AI-Driven QA Automation Lead", location: "גוש דן", url: "https://elad.a-2-z.co.il/jobs/1007770/", company: "אלעד מערכות", portal: "elad-systems" }),
      expect.objectContaining({ title: "בודק/ת תוכנה", location: 'ירושלים יו"ש, השפלה', url: "https://elad.a-2-z.co.il/jobs/1006726/" }),
    ]);
    expect(() => parseElad("<html>other</html>")).toThrow();
  });

  test("on its own site (Aman): its list's pages in turn, each card's title linked to its page there", async () => {
    const card = (slug: string, title: string) => `<div class="positions_page__application" data-position-id="1" data-location="" data-job-title="${title}">
      <article class="aman-job-card" dir="rtl"><h3 class="aman-job-card__title"><a class="aman-job-card__title-link" href="https://www.aman.co.il/careers/qa/${slug}/">${title}</a></h3></article></div>`;
    const pages: Record<string, string> = {
      [AMAN]: `${card("qa-engineer", "QA Engineer")}<a href="https://www.aman.co.il/careers/%D7%A4%D7%99%D7%AA%D7%95%D7%97/page/7/">7</a><a href="https://www.aman.co.il/careers/page/2/">2</a>`,
      [`${AMAN}page/2/`]: card("abap", "מפתח/ת ABAP"),
    };
    // Its own pages (2), not a field's (7).
    expect(parseAman(pages[AMAN]).pages).toBe(2);
    const asked: string[] = [];
    const found = await readEmployer(portalById("aman")!, [{ id: "qa", label: "QA", query: "Junior QA Engineer" }], { fetch: async (url) => { asked.push(url); return pages[url] ?? null; }, today });
    expect(asked).toEqual([AMAN, `${AMAN}page/2/`]);
    expect(found).toEqual([expect.objectContaining({ title: "QA Engineer", url: "https://www.aman.co.il/careers/qa/qa-engineer/", company: "קבוצת Aman", portal: "aman" })]);
    expect(() => parseAman("<html>other</html>")).toThrow();
  });

  test("on its own site (Dialog): only the fields the roles are in, their pages in turn, each card's title, region and page", async () => {
    const card = (id: number, title: string, region: string) => `<div class="item_job"><div class="inner font_s"><div class="right"><div class="top">
      <h3 class="title_job"> <a href="/high-tech/jobs/jobpage?positionId=${id}" class=""> ${title}<span class="icon "></span> </a> </h3></div></div>
      <ul class="job_info"><li><a href="/high-tech/jobs/qa?regions=1"><span class="icon icon-location"></span>${region} </a></li></ul></div></div>`;
    const qa = [{ id: "qa", label: "QA", query: "Junior QA Engineer" }];
    expect(dialogFields(qa)).toEqual(["qa"]);
    expect(dialogFields([{ id: "analyst", label: "Data Analyst", query: "Data Analyst" }])).toEqual(["data", "research"]);
    const pages: Record<string, string> = {
      [`${DIALOG}qa`]: `${card(95370, "QA Automation Engineer", 'ת"א והמרכז')}<a href="?page=2">2</a>`,
      [`${DIALOG}qa?page=2`]: card(95371, "בודק/ת תוכנה", "חיפה והצפון"),
    };
    const asked: string[] = [];
    const found = await readEmployer(portalById("dialog")!, qa, { fetch: async (url) => { asked.push(url); return pages[url] ?? null; }, today });
    expect(asked).toEqual([`${DIALOG}qa`, `${DIALOG}qa?page=2`]);
    expect(found).toEqual([
      expect.objectContaining({ title: "QA Automation Engineer", location: 'ת"א והמרכז', url: "https://www.dialog.co.il/high-tech/jobs/jobpage?positionId=95370", company: "דיאלוג", portal: "dialog" }),
      expect.objectContaining({ title: "בודק/ת תוכנה", location: "חיפה והצפון", url: "https://www.dialog.co.il/high-tech/jobs/jobpage?positionId=95371" }),
    ]);
  });

  test("on its own site (Mimun Yashir): the sitemap's recent job pages for the roles, each opened for its name, the closed left out", async () => {
    const site = "https://www.5555.co.il";
    const entry = (path: string, date: string) => `<url><loc>${site}${path}</loc><lastmod>${date}</lastmod><priority>0.8</priority></url>`;
    const sitemap = `<urlset>${[
      entry("/", "2026-06-29"), entry("/קצת-עלינו/", "2026-03-23"), entry("/דרושים/", "2026-11-01"), entry("/דרושים/כל-המשרות/", "2026-11-01"),
      entry("/דרושים/אנליסטית-מטה-וחווית-לקוח/", "2026-11-04"), entry("/דרושים/data-analyst/", "2026-10-20"),
      entry("/דרושים/נציגת-שירות-לקוחות/", "2026-11-02"), entry("/דרושים/data-scientist/", "2025-05-28"),
    ].join("\n")}</urlset>`;
    const page = (name: string, closed = false) => `<main><h1 class="tw-text-40"> ${name} </h1>${closed ? "<p>משרה זו אינה זמינה</p>" : ""}<p>מה כולל התפקיד?</p></main>`;
    const asked: string[] = [];
    const fetch: Fetch = async (url) => {
      const plain = decodeURIComponent(url);
      asked.push(plain);
      if (url === MIMUN_YASHIR) return sitemap;
      if (plain.includes("אנליסטית")) return page("אנליסט.ית מטה וחווית לקוח");
      if (plain.includes("data-analyst")) return page("Data Analyst", true);
      return null;
    };
    const found = await readEmployer(portalById("mimun-yashir")!, roles, { fetch, today });
    // The sitemap, then only the recent pages for the roles, the newest first: not the service representative's, nor last
    // year's data scientist.
    expect(asked).toEqual([MIMUN_YASHIR, `${site}/דרושים/אנליסטית-מטה-וחווית-לקוח/`, `${site}/דרושים/data-analyst/`]);
    expect(found).toEqual([{
      title: "אנליסט.ית מטה וחווית לקוח", company: "מימון ישיר", location: "", date: "2026-11-04", source: "page", portal: "mimun-yashir",
      url: new URL(`${site}/דרושים/אנליסטית-מטה-וחווית-לקוח/`).href,
    }]);
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

  test("reads a careers page's own list by its job links, and finds a title where the link only says 'read more'", () => {
    const html = `<nav><a href="/about/">אודות</a></nav>
      <h2>משרות פנויות</h2>
      <div class="card"><h3>מפתח/ת Full Stack</h3><a href="/jobs/full-stack/">קרא עוד</a></div>
      <div class="card"><a href="/jobs/qa-engineer/">בודק/ת תוכנה</a><a href="/jobs/qa-engineer/">לעמוד המשרה</a></div>
      <div><a href="/jobs/data/">לפרטים</a><a href="mailto:?subject=אנליסט/ית נתונים&amp;body=https://x.co.il/jobs/data/">מייל</a></div>`;
    expect(readLinks(html, "https://x.co.il/careers/", "^/jobs/[^/]+/$").map((p) => [p.title, p.url])).toEqual([
      ["מפתח/ת Full Stack", "https://x.co.il/jobs/full-stack/"],
      ["בודק/ת תוכנה", "https://x.co.il/jobs/qa-engineer/"],
      ["אנליסט/ית נתונים", "https://x.co.il/jobs/data/"],
    ]);
  });

  test("takes a heading three jobs share for the section's, and reads their titles from their links then", () => {
    const html = `<h2>משרות פנויות</h2>` + ["מפתח-ת-full-stack-1202", "נציג-ת-מכירות-1116", "כלכלן-ית-1104"]
      .map((slug) => `<div class="item"><div>${slug}</div><a href="/career/${encodeURIComponent(slug)}/">צפיה במשרה</a></div>`).join("");
    expect(readLinks(html, "https://w.co.il/", "^/career/").map((p) => p.title)).toEqual(["מפתח ת full stack 1202", "נציג ת מכירות 1116", "כלכלן ית 1104"]);
  });

  test("finds a title by the site's own pattern, and a job link in a share button's data-href", () => {
    const html = `<div class="job"><div>שם המשרה: <strong>מנתח/ת מערכות</strong></div><div class="fb-share-button" data-href="https://c.co.il/jobs/?job=6798"></div></div>`;
    expect(readLinks(html, "https://c.co.il/jobs/", "[?&]job=[0-9]+", "שם המשרה:[^<]*<strong>([^<]{3,140})</strong>").map((p) => [p.title, p.url]))
      .toEqual([["מנתח/ת מערכות", "https://c.co.il/jobs/?job=6798"]]);
  });

  test("reads an employer's own site first, its pages too, and its job board only when the site gives nothing", async () => {
    const page = (n: number, jobs: string[]) => jobs.map((j) => `<a href="/Jobs/JobDetails?token=t&eid=${j}">מפתח/ת ${j}</a>`).join("") + (n < 2 ? `<a href="/Home/Index?page=${n + 1}&amp;token=t">עמוד הבא</a>` : "");
    const asked: string[] = [];
    const site: Fetch = async (url) => {
      asked.push(url);
      if (url.includes("alljobs")) return null;
      return url.includes("page=2") ? page(2, ["b"]) : page(1, ["a"]);
    };
    const employer = { id: "x", kind: "employer" as const, how: "read" as const, he: "איקס", en: "X", industry: "insurance" as const, url: "", read: { alljobs: 1 },
      direct: { links: { url: "https://career.example/?token=t", path: "/Jobs/JobDetails", pages: "/Home/Index[?]page=[0-9]+" } } };
    const roles = [{ label: "Dev", query: "Junior Software Engineer" }];
    const jobs = await readEmployer(employer, roles, { fetch: site, today: "2026-11-14" });
    expect(jobs.map((j) => j.title)).toEqual(["מפתח/ת a", "מפתח/ת b"]);
    expect(asked.some((u) => u.includes("alljobs"))).toBe(false);
    // The site down: the board, as before.
    const down: Fetch = async (url) => { asked.push(url); return url.includes("alljobs") ? `<div class="job-content-top-date">היום</div>` : null; };
    asked.length = 0;
    await readEmployer(employer, roles, { fetch: down, today: "2026-11-14" });
    expect(asked.some((u) => u.includes("alljobs"))).toBe(true);
  });

  test("reads Gotfriends' list: each job's title, place and page", () => {
    const html = `<div class="item"> <a href="/jobslobby/software/data-engineer/155487/" class="position p-1108"> <h2 class="title">Data Engineer בחברה מובילה</h2> </a>
      <div class="item_content"><section class="info meta"><dl><dd> <span class="info-label">מיקום:</span> <span class="info-data"> ת&quot;א והמרכז </span> </dd></dl></section></div></div>
      <a class="" href="/jobslobby/software/full-stack-developer/">מפתח Full Stack</a>`;
    expect(parseGotfriends(html)).toEqual([
      { title: "Data Engineer בחברה מובילה", company: "", location: 'ת"א והמרכז', date: "", url: "https://www.gotfriends.co.il/jobslobby/software/data-engineer/155487/", source: "page" },
    ]);
  });

  test("reads Nisha's list: each job's title and page", () => {
    const html = `<div class="item-job job-main"> <div class="title-bar"> <h3 class="job-title"><a href="https://www.nisha.co.il/job/12917/">מפתח/ת Full stack</a></h3></div></div>
      <a href="https://www.nisha.co.il/positions/devops/">DevOps</a>`;
    expect(parseNisha(html)).toEqual([{ title: "מפתח/ת Full stack", company: "", location: "", date: "", url: "https://www.nisha.co.il/job/12917/", source: "page" }]);
  });

  test("reads a WordPress job board's feed: each job's title, employer, place and day, only its links on the board", () => {
    const item = (title: string, link: string, extra = "") => `<item><title>${title}</title><link>${link}</link>
      <pubDate>Mon, 09 Nov 2026 12:00:00 +0000</pubDate><description><![CDATA[<p>About it</p>]]></description>${extra}</item>`;
    const xml = `<?xml version="1.0"?><rss><channel><title>Jobs</title>
      ${item("AI Software Engineer", "https://www.nbn.org.il/jobboard/job/ai-software-engineer/", "<job_listing:location><![CDATA[North, Haifa]]></job_listing:location><job_listing:company><![CDATA[NBN Recruitment]]></job_listing:company>")}
      ${item("Data &#038; Research Analyst", "https://www.nbn.org.il/jobboard/job/data-research-analyst/")}
      ${item("Elsewhere", "https://elsewhere.example/job/1")}
      </channel></rss>`;
    expect(parseJobFeed(xml, "https://www.nbn.org.il")).toEqual([
      { title: "AI Software Engineer", company: "NBN Recruitment", location: "North, Haifa", date: "2026-11-09", url: "https://www.nbn.org.il/jobboard/job/ai-software-engineer/", source: "page" },
      { title: "Data & Research Analyst", company: "", location: "", date: "2026-11-09", url: "https://www.nbn.org.il/jobboard/job/data-research-analyst/", source: "page" },
    ]);
  });

  test("reads Jobnet's list: each job's title, employer, day and regions, without the regions' lists of towns", () => {
    const card = (id: number, title: string, regions: string[]) => `<td><div itemscope itemtype="https://schema.org/JobPosting" class='whitebox'>
      <a data-sharer="email" data-url='https://www.jobnet.co.il/newstyle/internalpages/searchresults.aspx?returned=true&positionid=${id}' data-title='${title}'></a>
      <a style='display:block' href='/jobs?positionid=${id}' target="_blank"><h2 itemprop="title" >${title}</h2></a>
      <p itemprop="hiringOrganization"><a target="_blank" href='/Company?companyID=4136'> SQLink</a></p>
      <p class="boxDateCls" itemprop="datePosted">14/11/2026</p>
      ${regions.map((r) => `<span itemprop="address"><span itemprop='addressLocality'></span><span itemprop='addressRegion'><a href='/jobs?searchtype=byareas&checkarea=2'>${r}</a></span><span class="reg"> - תל אביב, מודיעין, שוהם</span></span>`).join("")}
      </div></td>`;
    const html = card(13591440, "Backend Developer", ["מרכז", "שרון"]) + card(13594647, "בודק/ת תוכנה &amp; QA", ["צפון"]) + `<a href='/jobs?subprofid=1252'>ללא נסיון</a>`;
    expect(parseJobnet(html)).toEqual([
      { title: "Backend Developer", company: "SQLink", location: "מרכז, שרון", date: "2026-11-14", url: "https://www.jobnet.co.il/jobs?positionid=13591440", source: "page" },
      { title: "בודק/ת תוכנה & QA", company: "SQLink", location: "צפון", date: "2026-11-14", url: "https://www.jobnet.co.il/jobs?positionid=13594647", source: "page" },
    ]);
  });

  test("reads a Redmatch careers app's list, each position linked to its page in the app", () => {
    const json = "﻿" + JSON.stringify({ responseStatus: 0, positions: [
      { compPositionID: "50468", jobTitleText: "מפתח/ת Full Stack", displayLocation: "פתח תקווה", activationDate: "2026-11-12T14:29:39.103" },
      { compPositionID: "50469", jobTitleText: "סגורה", isActivePosition: "False" },
    ] });
    expect(parseRedmatch(json, "https://jobs.example/clalit/")).toEqual([
      { title: "מפתח/ת Full Stack", company: "", location: "פתח תקווה", date: "2026-11-12", url: "https://jobs.example/clalit/redmatch-apply/redmatch.apply.html?compPositionID=50468", source: "page" },
    ]);
    expect(() => parseRedmatch("{}", "https://jobs.example/clalit/")).toThrow();
  });

  test("reads a Workday career site's jobs searched for Israel, over its pages, kept to places in Israel", async () => {
    const page = (offset: number) => JSON.stringify({ total: 23, jobPostings: offset === 0
      ? [{ title: "Software Engineer", externalPath: "/job/Haifa/Software-Engineer_R1", locationsText: "Haifa, Israel" }, { title: "Buyer", externalPath: "/job/Austin/Buyer_R2", locationsText: "Austin, TX" }]
      : [{ title: "Data Analyst", externalPath: "/job/Migdal-HaEmek/Data-Analyst_R3", locationsText: "Migdal HaEmek, Israel" }] });
    expect(parseWorkday(page(0), "https://t.wd1.myworkdayjobs.com/en-US/Careers").found[0]).toMatchObject({ title: "Software Engineer", url: "https://t.wd1.myworkdayjobs.com/en-US/Careers/job/Haifa/Software-Engineer_R1" });
    const asked: unknown[] = [];
    const post = async (url: string, body: any) => { asked.push(body); return url.includes("/wday/cxs/t/Careers/jobs") ? page(body.offset) : null; };
    const employer = { id: "t", kind: "employer" as const, how: "read" as const, he: "T", en: "T", industry: "hightech" as const, url: "", read: { workday: { host: "t.wd1.myworkdayjobs.com", tenant: "t", site: "Careers" } } };
    const jobs = await readEmployer(employer, [{ label: "x", query: "Junior Software Engineer" }, { label: "y", query: "Junior Data Engineer" }], { fetch: async () => null, post, today: "2026-11-14" });
    expect(jobs.map((j) => j.title)).toEqual(["Software Engineer", "Data Analyst"]);
    expect(asked).toEqual([{ appliedFacets: {}, limit: 20, offset: 0, searchText: "Israel" }, { appliedFacets: {}, limit: 20, offset: 20, searchText: "Israel" }]);
  });

  test("asks a service that answers only a POST after robots.txt allows it, over https only, and never follows a redirect", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const send = (async (url: string, init: RequestInit) => { sent.push({ url, init }); return new Response('{"ok":1}'); }) as unknown as typeof fetch;
    const allowed = async () => ({ code: 0, out: "ALLOWED", err: "" });
    const post = jsonPoster(allowed, send);
    expect(await post("https://jobs.example/api/search-a", { q: "" })).toBe('{"ok":1}');
    expect(sent[0].init).toMatchObject({ method: "POST", body: '{"q":""}', redirect: "error" });
    expect(await post("http://jobs.example/api/search-b", {})).toBeNull();
    const refused = jsonPoster(async () => ({ code: 1, out: "DISALLOWED", err: "" }), send);
    expect(await refused("https://other.example/api/search-c", {})).toBeNull();
    expect(sent).toHaveLength(1);
  });

  test("knows the recruiting platform a careers page embeds, whose jobs a script fills in", () => {
    expect(embeddedBoard(`<script>COMEET.init({\n "token": "2F4E", "company-uid": "F2.004", "company-name": "claroty" });</script>`)).toEqual({ comeet: "claroty/f2.004" });
    expect(embeddedBoard(`<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>`)).toEqual({ greenhouse: "acme" });
    expect(embeddedBoard(`<a href="https://job-boards.greenhouse.io/beta/jobs/1">x</a>`)).toEqual({ greenhouse: "beta" });
    expect(embeddedBoard(`<iframe src="https://jobs.lever.co/gamma"></iframe>`)).toEqual({ lever: "gamma" });
    expect(embeddedBoard(`<a href="https://jobs.ashbyhq.com/Delta%20Inc">jobs</a>`)).toEqual({ ashby: "Delta Inc" });
    expect(embeddedBoard(`<a href="https://apply.workable.com/epsilon/">jobs</a>`)).toEqual({ workable: "epsilon" });
    expect(embeddedBoard(`<a href="/careers/backend">Backend Developer</a>`)).toBeNull();
  });

  test("reads a careers page that embeds a platform there, by the employer's name", async () => {
    const page = `<script>COMEET.init({"company-uid": "F2.004", "company-name": "claroty"});</script>`;
    const positions = [{ name: "Backend Developer", location: { name: "Tel Aviv", country: "IL", city: "Tel Aviv" }, time_updated: "2026-11-10T08:00:00Z", url_comeet_hosted_page: "https://www.comeet.com/jobs/claroty/F2.004/backend-developer/0A.374" }];
    const board = `<script>COMPANY_POSITIONS_DATA = ${JSON.stringify(positions)};</script>`;
    const fetch: Fetch = async (url) => (url.startsWith("https://claroty.example") ? page : url.includes("comeet.com") ? board : null);
    const jobs = await readOwnPage("mine-claroty", "Claroty", "https://claroty.example/open-positions/", [{ label: "Backend", query: "Junior Backend Developer" }], { fetch, today: "2026-11-14" });
    expect(jobs.map((j) => [j.title, j.company])).toEqual([["Backend Developer", "Claroty"]]);
  });
});
