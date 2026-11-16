import { afterEach, describe, expect, test } from "bun:test";
import { runSearch } from "../src/commands/search";
import { runSearchFixture } from "./helpers";

const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;

function searchCard(id: string, title: string): string {
  return `<li>
    <div data-entity-urn="urn:li:jobPosting:${id}">
      <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/${id}"></a>
      <h3 class="base-search-card__title">${title}</h3>
    </div>
  </li>`;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalStdoutWrite;
});

describe("runSearch", () => {
  test("--limit 0 emits zero results", async () => {
    globalThis.fetch = (async () => new Response(searchCard("123456", "Engineer"))) as typeof fetch;

    let stdout = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    const code = await runSearch({
      location: "Copenhagen, Denmark",
      jobage: 9999,
      page: 1,
      limit: 0,
      format: "json",
    });

    expect(code).toBe(0);
    expect(JSON.parse(stdout).results).toHaveLength(0);
  });

  test("--jobage-minutes 30 constructs f_TPR=r1800 in the request URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response("");
    }) as typeof fetch;

    const code = await runSearch({
      location: "Remote",
      jobage: 9999,
      jobageMinutes: 30,
      page: 1,
      format: "json",
    });

    expect(code).toBe(0);
    expect(capturedUrl).toContain("f_TPR=r1800");
  });

  // Through the real command line: the flag was once accepted there and never handed on, so the search kept
  // LinkedIn's relevance order while a direct call to runSearch passed.
  test("--sort recent asks for the newest first (sortBy=DD); LinkedIn's own order otherwise", async () => {
    const recent = await runSearchFixture(["search", "-l", "Israel", "--jobage", "1", "--sort", "recent"]);
    expect(recent.result.exitCode).toBe(0);
    expect(recent.requests[0].searchParams.get("sortBy")).toBe("DD");
    for (const args of [[], ["--sort", "relevant"]]) {
      const { result, requests } = await runSearchFixture(["search", "-l", "Israel", "--jobage", "1", ...args]);
      expect(result.exitCode).toBe(0);
      expect(requests[0].searchParams.has("sortBy")).toBe(false);
    }
  });

  test("--sort with another order exits 1 with BAD_ARG before any request", async () => {
    const { result, requests } = await runSearchFixture(["search", "-l", "Israel", "--sort", "newest"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).code).toBe("BAD_ARG");
    expect(requests).toHaveLength(0);
  });
});
