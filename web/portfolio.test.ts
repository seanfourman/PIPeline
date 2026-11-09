import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { byteRange, mediaFile, readPortfolio, webLink } from "./portfolio";

// A portfolio folder with a picture and a video in its media folder, and a file beside it that must never be served.
// By its real path, as mediaFile answers with one: a Mac's temp folder is under /var, a link to /private/var.
function folder(portfolio?: unknown) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "job-portfolio-")));
  mkdirSync(path.join(dir, "media", "rival-minds"), { recursive: true });
  writeFileSync(path.join(dir, "media", "rival-minds", "cover.jpg"), "jpg");
  writeFileSync(path.join(dir, "media", "rival-minds", "brag.mp4"), "mp4");
  writeFileSync(path.join(dir, "media", "rival-minds", "notes.txt"), "txt");
  writeFileSync(path.join(dir, "secret.png"), "png");
  if (portfolio !== undefined) writeFileSync(path.join(dir, "portfolio.json"), typeof portfolio === "string" ? portfolio : JSON.stringify(portfolio));
  return dir;
}

const project = (over: Record<string, unknown> = {}) => ({
  slug: "rival-minds", name: "Rival Minds", tier: "featured", score: 92, tagline: "A live RL tournament",
  summary: "Two agents learn.", highlights: ["PPO went from 57% to 90%."], stack: ["Python", "PyTorch"],
  links: { repo: "https://github.com/someone/rival-minds" },
  media: { cover: "media/rival-minds/cover.jpg", video: "media/rival-minds/brag.mp4" },
  readme: { status: "strong" },
  ...over,
});

describe("the portfolio the skill writes", () => {
  test("nothing written yet reads as none, and a scan alone as the scan", () => {
    const dir = folder();
    expect(readPortfolio(dir)).toEqual({ portfolio: null, scanned: null });
    writeFileSync(path.join(dir, "inventory.json"), JSON.stringify({ generated: "2026-11-08T10:00:00Z", projects: [{}, {}, {}] }));
    expect(readPortfolio(dir)).toEqual({ portfolio: null, scanned: { at: "2026-11-08T10:00:00Z", count: 3 } });
    expect(readPortfolio(folder("{not json")).portfolio).toBeNull();
  });

  test("a project comes through with its fields, and its media only when they are there", () => {
    const { portfolio } = readPortfolio(folder({ projects: [project({ media: { cover: "media/rival-minds/cover.jpg", reel: "media/rival-minds/missing.gif", video: "media/rival-minds/brag.mp4" } })] }));
    const [p] = portfolio!.projects;
    expect(p.name).toBe("Rival Minds");
    expect(p.tier).toBe("featured");
    expect(p.score).toBe(92);
    expect(p.links.repo).toBe("https://github.com/someone/rival-minds");
    expect(p.media).toEqual({ cover: "media/rival-minds/cover.jpg", reel: "", video: "media/rival-minds/brag.mp4", poster: "" });
    expect(p.readme.status).toBe("strong");
    expect(portfolio!.site).toBe(false);
  });

  test("what the file holds is cut to its kind: links to the web's, media to the media folder, tiers to the two", () => {
    const { portfolio } = readPortfolio(folder({
      owner: { name: { x: 1 }, github: "javascript:alert(1)", links: { email: "not an email", site: "https://me.dev" } },
      projects: [
        project({ tier: "legendary", score: 400, links: { repo: "javascript:alert(1)", live: "ftp://x" }, media: { cover: "../secret.png", reel: "media/../secret.png", video: "C:/Windows/x.mp4", poster: "media/rival-minds/notes.txt" } }),
        { name: "" },
        "a string",
      ],
    }));
    const [p] = portfolio!.projects;
    expect(portfolio!.projects.length).toBe(1);
    expect(p.tier).toBe("showcase");
    expect(p.score).toBeNull();
    expect(p.links).toEqual({ repo: "", live: "", video: "" });
    expect(p.media).toEqual({ cover: "", reel: "", video: "", poster: "" });
    expect(portfolio!.owner).toEqual({ name: "", headline: "", github: "", links: { linkedin: "", site: "https://me.dev/", email: "" } });
  });

  test("slugs are made safe and each one once, and Featured comes first", () => {
    const { portfolio } = readPortfolio(folder({
      projects: [
        project({ slug: "../evil", name: "Side Thing", tier: "showcase" }),
        project({ slug: "rival-minds" }),
        project({ slug: "rival-minds", name: "Rival Minds Copy" }),
      ],
    }));
    expect(portfolio!.projects.map((p) => [p.slug, p.tier])).toEqual([["rival-minds", "featured"], ["rival-minds-2", "featured"], ["side-thing", "showcase"]]);
  });

  test("the website counts once its index.html is there", () => {
    const dir = folder({ projects: [] });
    mkdirSync(path.join(dir, "site"));
    writeFileSync(path.join(dir, "site", "index.html"), "<!doctype html>");
    expect(readPortfolio(dir).portfolio!.site).toBe(true);
  });
});

describe("its media", () => {
  test("only a picture or a video inside the media folder is served", () => {
    const dir = folder();
    expect(mediaFile("media/rival-minds/cover.jpg", dir)).toBe(path.join(dir, "media", "rival-minds", "cover.jpg"));
    expect(mediaFile("media\\rival-minds\\brag.mp4", dir)).toBe(path.join(dir, "media", "rival-minds", "brag.mp4"));
    for (const bad of ["secret.png", "media/../secret.png", "media/rival-minds/../../secret.png", "media/rival-minds/notes.txt", "media/rival-minds/none.png",
      "/media/rival-minds/cover.jpg", "C:/media/x.png", "media/", "", "media/rival-minds", "media//cover.jpg"]) {
      expect(mediaFile(bad, dir)).toBeNull();
    }
    expect(mediaFile({ path: "media/rival-minds/cover.jpg" }, dir)).toBeNull();
  });

  test("a link is the web's or none", () => {
    expect(webLink("https://github.com/a/b")).toBe("https://github.com/a/b");
    expect(webLink("javascript:alert(1)")).toBe("");
    expect(webLink("https://x.dev/\"onmouseover=")).toBe("");
    expect(webLink(42)).toBe("");
  });

  test("a video asked for in pieces gets the piece", () => {
    expect(byteRange(null, 1000)).toBeNull();
    expect(byteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(byteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(byteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange("bytes=1000-", 1000)).toBe("bad");
    expect(byteRange("bytes=-0", 1000)).toBe("bad");
    expect(byteRange("bytes=0-1,5-9", 1000)).toBeNull();
  });
});
