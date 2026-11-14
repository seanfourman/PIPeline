import { describe, expect, test } from "bun:test";
import { channelJobs, channelName, postJobs, postLines } from "./telegram";

const FIELD = ["developer", "engineer", "qa", "backend", "מפתח", "תוכנה", "בודק"];
const NOW = Date.parse("2026-11-14T12:00:00Z");
const post = (id: number, when: string, body: string) =>
  `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="jobsil/${id}"><div class="tgme_widget_message_text js-message_text" dir="auto">${body}</div><a class="tgme_widget_message_date"><time datetime="${when}" class="time">10:00</time></a></div></div>`;

describe("telegram", () => {
  test("reads a post's lines without its markup or direction marks", () => {
    expect(postLines("&lrm;🔹 Junior <b>QA</b> Engineer<br/>&lrm;🏢 Acme &amp; Co · 📍 Haifa")).toEqual(["🔹 Junior QA Engineer", "🏢 Acme & Co · 📍 Haifa"]);
  });

  test("takes each job of a fixed-form post, numbered by its place in the post, those in the roles' field only", () => {
    const lines = ["📬 Junior roles", "🔹 Junior Accountant", "🏢 Beta · 📍 Haifa", "🔹 בודק/ת תוכנה ג'וניור", "🏢 Ness · 📍 Jerusalem", "🔹 Junior Backend Developer", "🏢 Gamma", "📍 Netanya"];
    expect(postJobs(lines, FIELD)).toEqual([
      { title: "בודק/ת תוכנה ג'וניור", company: "Ness", location: "Jerusalem", n: 2 },
      { title: "Junior Backend Developer", company: "Gamma", location: "Netanya", n: 3 },
    ]);
  });

  test("takes a free-text post as one job, with its company and place where it names them", () => {
    expect(postJobs(["דרושים!", "מפתח/ת Full Stack לחברת סייבר", "חברה: Cyberix", "מיקום: הרצליה", "קו\"ח למייל"], FIELD))
      .toEqual([{ title: "מפתח/ת Full Stack לחברת סייבר", company: "Cyberix", location: "הרצליה" }]);
    // No place named: one the settings' areas know, from anywhere in the post.
    expect(postJobs(["QA Engineer wanted", "office in Ra'anana, send your CV"], FIELD, ["ra'anana", "netanya"])[0].location).toBe("ra'anana");
    expect(postJobs(["A lecture on interviews"], FIELD)).toEqual([]);
    // A post about an event is no job, even one in the field.
    expect(postJobs(["אני מעביר הרצאה על ראיונות למפתחים", "הרשמה בקישור"], FIELD)).toEqual([]);
    // The company a title names at its end, when the post names none.
    expect(postJobs(["Telephony Network Engineer, TSM at NICE"], FIELD)[0].company).toBe("NICE");
  });

  test("reads a channel's posts of the last two weeks that offer a job and a way to apply, each by its own link", () => {
    const html = [
      post(5, "2026-10-20T08:00:00+00:00", "Junior Backend Developer<br/>send your CV to jobs@acme.com"),
      post(6, "2026-11-12T08:00:00+00:00", "🔹 Junior QA Engineer<br/>🏢 Acme · 📍 Tel Aviv<br/>🔹 Backend Engineer<br/>🏢 Beta · 📍 Haifa"),
      post(7, "2026-11-13T08:00:00+00:00", "Backend Developer at Delta<br/>Apply: <a href=\"https://delta.example/jobs/1\">here</a>"),
      post(8, "2026-11-13T09:00:00+00:00", "Talk tonight for every developer and engineer, come along"),
    ].join("");
    expect(channelJobs(html, FIELD, [], NOW)).toEqual([
      { title: "Junior QA Engineer", company: "Acme", location: "Tel Aviv", date: "2026-11-12", url: "https://t.me/jobsil/6?job=1" },
      { title: "Backend Engineer", company: "Beta", location: "Haifa", date: "2026-11-12", url: "https://t.me/jobsil/6?job=2" },
      { title: "Backend Developer at Delta", company: "Delta", location: "", date: "2026-11-13", url: "https://t.me/jobsil/7" },
    ]);
  });

  test("knows a channel by its page's address", () => {
    expect(channelName("https://t.me/s/hitechjobsjunior")).toBe("hitechjobsjunior");
    expect(channelName("https://t.me/Hireme_israelbot")).toBe("");
  });
});
