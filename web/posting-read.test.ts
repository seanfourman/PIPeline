import { describe, expect, test } from "bun:test";
import { applePosting, comeetPosting, greenhouseApi, greenhousePosting, jsonLdPosting, markedLines, pageData, portalPlain, telegramEmbed, telegramPosting } from "./posting-read";
import { jobId, plainUrl } from "./ui/jobid";

const LONG = "You will build and run our data pipelines with Python and SQL, and work closely with the analytics team. ".repeat(4);

describe("posting-read", () => {
  test("lines come without blanks, and a mark alone on its line joins the words after it", () => {
    expect(markedLines("## About\n\n  We   build. \n•\n3 years\n• Python\n##\n")).toEqual(["## About", "We build.", "• 3 years", "• Python"]);
  });

  test("reads the copy for Google: its description and facts, in a list or a graph", () => {
    const ld = { "@context": "https://schema.org", "@type": "JobPosting", description: `<p>${LONG}</p><ul><li>Python</li></ul>`, employmentType: ["FULL_TIME"], datePosted: "2026-11-02T08:00:00Z", validThrough: "2026-12-01", jobLocationType: "TELECOMMUTE", identifier: { value: "R-123" }, baseSalary: { currency: "ILS", value: { minValue: 20000, maxValue: 26000, unitText: "MONTH" } } };
    const got = jsonLdPosting(`<html><script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "Organization" }, ld] })}</script></html>`)!;
    expect(got.html).toContain("<li>Python</li>");
    expect(got.facts).toEqual({ employment: "full_time", workMode: "remote", posted: "2026-11-02", deadline: "2026-12-01", jobNumber: "R-123", salary: { min: 20000, max: 26000, currency: "ILS", unit: "month" } });
    // A line or two there is not the posting; nor is broken JSON or another type.
    expect(jsonLdPosting(`<script type="application/ld+json">${JSON.stringify({ ...ld, description: "Short." })}</script>`)).toBeNull();
    expect(jsonLdPosting(`<script type="application/ld+json">{ not json</script><script type="application/ld+json">{"@type":"Organization"}</script>`)).toBeNull();
    // Escaped HTML is read as HTML.
    const escaped = jsonLdPosting(`<script type="application/ld+json">${JSON.stringify({ ...ld, description: `&lt;p&gt;${LONG}&lt;/p&gt;` })}</script>`)!;
    expect(escaped.html.startsWith("<p>")).toBe(true);
    expect(escaped.flat).toBe(false);
    // A description with its line breaks taken out is flat: the page's own text reads better.
    expect(jsonLdPosting(`<script type="application/ld+json">${JSON.stringify({ ...ld, description: LONG })}</script>`)!.flat).toBe(true);
  });

  test("reads a Comeet position's parts, in their order, from the value given after the declaration", () => {
    const data = { name: "Junior QA", employment_type: "Full-time", experience_level: "Entry-level", workplace_type: "Hybrid", time_updated: "2026-11-09T19:37:03Z", custom_fields: { details: [{ name: "Requirements", value: "<ul><li>Selenium</li></ul>", order: 3 }, { name: "Description", value: "<p>We test things.</p>", order: 1 }, { name: "Qualifications", value: "", order: 4 }] } };
    const html = `<script>var POSITION_DATA ; var X;</script><script>POSITION_DATA = ${JSON.stringify(data)};</script>`;
    const got = comeetPosting(html)!;
    expect(got.html).toBe("<h2>Description</h2><p>We test things.</p><h2>Requirements</h2><ul><li>Selenium</li></ul>");
    expect(got.facts).toEqual({ employment: "full_time", workMode: "hybrid", level: "entry", posted: "2026-11-09" });
    expect(comeetPosting("<p>Spark Hire Recruit {{position.name}}</p>")).toBeNull();
  });

  test("reads Apple's job from the router data inside a JSON text", () => {
    const data = { loaderData: { job: { jobsData: { postingTitle: "RF Engineer", jobNumber: "200693637", postDateInGMT: "2026-10-20T00:00:00Z", jobSummary: "Imagine what you could do here.\nJoin us.", minimumQualifications: "BSc in EE", preferredQualifications: "" } } } };
    const html = `<script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify(data))});</script>`;
    const got = applePosting(html)!;
    expect(got.html).toBe("<h2>Summary</h2><p>Imagine what you could do here.<br>Join us.</p><h2>Minimum Qualifications</h2><p>BSc in EE</p>");
    expect(got.facts).toEqual({ posted: "2026-10-20", jobNumber: "200693637" });
  });

  test("reads a Telegram post's own words from its embed, and makes the embed's link", () => {
    const html = `<div class="tgme_widget_message_text js-message_text" dir="auto">Junior dev at <b>Acme</b><br><a href="https://acme.example/jobs/1">apply</a><div class="inner">x</div></div><div class="tgme_widget_message_footer"><time datetime="2026-10-25T06:00:53+00:00"></time></div>`;
    const got = telegramPosting(html)!;
    expect(got.html).toContain("Junior dev at <b>Acme</b>");
    expect(got.html).toContain('<div class="inner">x</div>');
    expect(got.html).not.toContain("footer");
    expect(got.facts).toEqual({ posted: "2026-10-25" });
    expect(telegramEmbed("https://t.me/hitechjobsjunior/1234?single")).toBe("https://t.me/hitechjobsjunior/1234?embed=1&mode=tme");
    expect(telegramEmbed("https://t.me/s/hitechjobsjunior/1234")).toBe("https://t.me/hitechjobsjunior/1234?embed=1&mode=tme");
    expect(telegramEmbed("https://evil.example/t.me/a/1")).toBe("");
  });

  test("reads Greenhouse's job through its public API", () => {
    expect(greenhouseApi("https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=x")).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345");
    expect(greenhouseApi("https://boards.greenhouse.io/acme/jobs/4012345")).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345");
    expect(greenhouseApi("https://acme.example/careers?gh_jid=4012345")).toBe("");
    const got = greenhousePosting(JSON.stringify({ content: "&lt;h2&gt;About&lt;/h2&gt;&lt;p&gt;We build.&lt;/p&gt;", first_published: "2025-11-04T07:16:58-05:00", application_deadline: null }))!;
    expect(got.html).toBe("<h2>About</h2><p>We build.</p>");
    expect(got.facts).toEqual({ posted: "2025-11-04" });
    expect(greenhousePosting("{}")).toBeNull();
  });

  test("picks the reader by the page's site, and the copy for Google elsewhere", () => {
    const comeet = `<script>POSITION_DATA = ${JSON.stringify({ custom_fields: { details: [{ name: "Description", value: "<p>x</p>" }] } })};</script>`;
    expect(pageData(comeet, "https://www.comeet.com/jobs/acme/B7.006/qa/C6.458")?.html).toContain("Description");
    expect(pageData(comeet, "https://careers.example.com/job/1")).toBeNull();
  });

  test("reads a portal's detail output: facts out of its lines, the title and link gone, a closed posting said so", () => {
    const out = ["Junior Developer", "Acme · Tel Aviv", "Seniority: Entry level", "Employment: Full-time", "Status: ACTIVE", "We build things.", "Requirements: Python", "", "URL: https://il.linkedin.com/jobs/view/1", ""].join("\n");
    const got = portalPlain(out);
    expect(got.closed).toBe(false);
    expect(got.facts).toEqual({ level: "entry", employment: "full_time" });
    expect(got.text).toBe("Seniority: Entry level\nEmployment: Full-time\nWe build things.\nRequirements: Python");
    expect(portalPlain(out.replace("ACTIVE", "CLOSED / EXPIRED")).closed).toBe(true);
  });

  test("a job's id is the same for its link with tracking words or without", () => {
    expect(plainUrl("https://il.linkedin.com/jobs/view/dev-123/?refId=a&trackingId=b&position=1")).toBe("https://linkedin.com/jobs/view/dev-123");
    expect(plainUrl("https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=88&utm_source=x")).toBe("https://alljobs.co.il/Search/UploadSingle.aspx?JobID=88");
    expect(jobId("https://il.linkedin.com/jobs/view/dev-123?refId=a")).toBe(jobId("https://www.linkedin.com/jobs/view/dev-123/"));
    expect(jobId("https://acme.example/jobs/1")).not.toBe(jobId("https://acme.example/jobs/2"));
    expect(jobId("javascript:alert(1)")).toBe("");
    expect(jobId("https://acme.example/jobs/1")).toMatch(/^[0-9a-z]{1,12}$/);
  });
});
