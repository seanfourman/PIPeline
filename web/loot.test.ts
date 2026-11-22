import { describe, expect, test } from "bun:test";
import { homeArea } from "./data";
import { GOLD_MAX, treasure, whereFound, type LootJob } from "./ui/loot";
import { GROUND, PEAK, pourFrame, ROOMS, vaultPixels, vaultScene, WALL } from "./ui/vault";

const now = new Date(2026, 10, 20, 15, 0);
type J = LootJob & { s: number | null };
let n = 0;
const job = (title: string, company: string, s: number | null, more: Partial<J> = {}): J =>
  ({ key: `k${++n}`, url: `https://jobs.example.com/${n}`, title, company, s, tier: "near", date: "2026-11-18", portal: "careers-page", ...more });
const score = (j: J) => j.s;
const titles = (list: J[]) => list.map((j) => j.title);

describe("Pip's treasure", () => {
  test("where a job was found: LinkedIn, another big board, the employer's own site, a channel, or a site few read", () => {
    expect(whereFound("linkedin-search")).toBe("linkedin");
    expect(whereFound("alljobs-search")).toBe("board");
    expect(whereFound("")).toBe("board");
    expect(whereFound("careers-page")).toBe("own");
    expect(whereFound("telegram:hitechjobsjunior")).toBe("channel");
    expect(whereFound("websearch:jobify360.co.il")).toBe("web");
  });

  test("gold: the best of the last three weeks with a firm score, one a company, students left out when less welcome", () => {
    const jobs = [
      job("Backend Developer", "Acme", 90),
      job("Frontend Developer", "Acme", 88),
      job("Old Developer", "Globex", 99, { date: "2026-10-01" }),
      job("Software Engineer Student", "Initech", 97),
      job("Fair Developer", "Umbrella", 79),
      job("No score", "Hooli", null),
      job("Ruled out", "Stark", 95, { veto: true }),
      job("Skipped", "Wayne", 95, { status: "skipped" }),
      job("Far away", "Tyrell", 95, { tier: "far" }),
      job("QA Engineer", "Soylent", 85, { date: "2026-11-20" }),
    ];
    expect(titles(treasure(jobs, score, { studentJobs: "low", now }).piles.gold)).toEqual(["Backend Developer", "QA Engineer"]);
    expect(titles(treasure(jobs, score, { studentJobs: "normal", now }).piles.gold)).toEqual(["Software Engineer Student", "Backend Developer", "QA Engineer"]);
    const many = Array.from({ length: 15 }, (_, i) => job(`Developer ${i}`, `Company ${i}`, 85));
    expect(treasure(many, score, { now }).piles.gold.length).toBe(GOLD_MAX);
  });

  test("gold goes by worth: new, near home and hidden count a little, a temporary job less", () => {
    const jobs = [
      job("Steady", "A", 90, { date: "2026-11-10" }),
      job("Maternity Leave Replacement", "B", 92, { date: "2026-11-10" }),
      job("New near home", "C", 87, { date: "2026-11-19", home: true }),
    ];
    expect(titles(treasure(jobs, score, { now }).piles.gold)).toEqual(["New near home", "Steady", "Maternity Leave Replacement"]);
  });

  test("hidden finds: from a channel, a site few read or a low-tech employer's own site, and not also on LinkedIn", () => {
    const jobs = [
      job("Channel Dev", "Moveo", 80, { portal: "telegram" }),
      job("Web Dev", "Thing", 75, { portal: "jobify360.co.il" }),
      job("Bank Dev", "Bank", 72, { industry: "finance" }),
      job("Startup Dev", "Startup", 90, { industry: "hightech" }),
      job("Board Dev", "Insurer", 90, { portal: "alljobs-search", industry: "insurance" }),
      job("Twin Dev", "Twin", 90, { portal: "telegram" }),
      job("Twin Dev", "Twin", 85, { portal: "linkedin-search" }),
      job("Weak Channel Dev", "Weak", 65, { portal: "telegram" }),
    ];
    const t = treasure(jobs, score, { now });
    expect(titles(t.piles.gems)).toEqual(["Channel Dev", "Web Dev", "Bank Dev"]);
    expect(titles(t.piles.lowtech)).toEqual(["Board Dev", "Bank Dev"]);
    expect(t.marks.get(jobs[0].key)).toEqual(["gold", "gems"]);
  });

  test("a job twice counts once, the copy off LinkedIn kept at the same score", () => {
    const jobs = [job("Data Engineer", "Nvidia", 93, { portal: "linkedin-search" }), job("Data Engineer", "NVIDIA", 93)];
    const t = treasure(jobs, score, { now });
    expect(t.piles.gold.map((j) => j.portal)).toEqual(["careers-page"]);
  });

  test("the other piles, each in score order", () => {
    const jobs = [
      job("Junior Developer", "Somewhere", 70, { date: "2026-11-20" }),
      job("Closing QA", "Somewhere Else", 50, { deadline: "2026-11-23" }),
      job("Home Developer", "Near", 64, { home: true }),
      job("Computer Vision Engineer", "Vision", 81),
      job("AI Developer", "Lab", 66),
      job("Outstanding Graduate Developer", "Grad Co", 77),
      job("Graduate Intern", "Grad Co", 77),
      job("Software Engineer", "Google", 62),
      job("Data Engineer", "אלביט מערכות", 61),
      job("Weak AI Developer", "Lab", 50),
    ];
    const { piles } = treasure(jobs, score, { now });
    expect(titles(piles.fresh)).toEqual(["Junior Developer"]);
    expect(titles(piles.closing)).toEqual(["Closing QA"]);
    expect(titles(piles.home)).toEqual(["Home Developer"]);
    expect(titles(piles.ai)).toEqual(["Computer Vision Engineer", "AI Developer"]);
    expect(titles(piles.grads)).toEqual(["Outstanding Graduate Developer"]);
    expect(titles(piles.big)).toEqual(["Software Engineer", "Data Engineer"]);
    expect(titles(piles.defense)).toEqual(["Data Engineer"]);
  });

  test("the vault's rooms: the gold, high-tech and outside it, a company's next jobs put further down", () => {
    const jobs = [
      ...Array.from({ length: 8 }, (_, i) => job(`Acme Developer ${i}`, "Acme", 95 - i)),
      job("Other Developer", "Globex", 70),
      job("Bank Developer", "Bank", 75, { industry: "finance" }),
      job("Defense Developer", "Elbit", 72, { industry: "defense" }),
    ];
    const { rooms } = treasure(jobs, score, { now });
    expect(titles(rooms.gold)).toEqual(["Acme Developer 0"]);
    expect(titles(rooms.low)).toEqual(["Bank Developer"]);
    const named = treasure([job("Data Developer", "הראל ביטוח ופיננסים", 80), job("QA", "Bank Leumi", 70), job("Web", "Banking Cloud", 70)], score, { now });
    expect(titles(named.rooms.low)).toEqual(["Data Developer", "QA"]);
    expect(titles(rooms.tech)).toEqual([
      "Acme Developer 0", "Acme Developer 1", "Defense Developer", "Other Developer", "Acme Developer 2", "Acme Developer 3",
      "Acme Developer 4", "Acme Developer 5", "Acme Developer 6", "Acme Developer 7",
    ]);
  });

  test("the vault's rooms are painted whole, the same each time, the doors kept clear of coins and a hill under Pip", () => {
    const plan = { width: 200, height: 120, floor: 40, clear: [[20, 40]] as [number, number][], quiet: [[150, 195, 4, 20]] as [number, number, number, number][], pip: 100 };
    const coinish = (px: Uint8ClampedArray, x: number, y: number) => { const i = (y * plan.width + x) * 4; return px[i] > 150 && px[i + 2] < 50; };
    for (const room of ROOMS) {
      const px = vaultPixels(room, plan);
      expect(px.length).toBe(200 * 120 * 4);
      expect(px.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
      expect(vaultPixels(room, plan)).toEqual(px);
      expect(coinish(px, 30, 34)).toBe(false);
      expect(coinish(px, 100, 40 - PEAK + 2) || coinish(px, 101, 40 - PEAK + 2)).toBe(true);
      expect(coinish(px, 170, 8)).toBe(false);
    }
    // Under the jobs the coins thin out: whole at first, fewer and fewer, and none past the last row.
    const thinned = vaultPixels("gold", { ...plan, thin: [70, 110] });
    const opaque = (y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < 200; x++) if (thinned[(y * 200 + x) * 4 + 3] === 255) n++;
      return n / ((y1 - y0) * 200);
    };
    expect(opaque(50, 68)).toBe(1);
    expect(opaque(72, 80)).toBeGreaterThan(opaque(95, 105));
    expect(opaque(95, 105)).toBeGreaterThan(0);
    expect(opaque(112, 120)).toBe(0);
  });

  test("the coins pour in, each falling into its place, and fall away again", () => {
    const plan = { width: 160, height: 110, floor: 40, clear: [], quiet: [[60, 100, 10, 30]] as [number, number, number, number][], pip: null, thin: [48, 108] as [number, number] };
    for (const room of ROOMS) {
      const s = vaultScene(room, plan);
      expect(s.pixels).toEqual(vaultPixels(room, plan));
      // Every pixel belongs to the wall, the ground or one coin, each coin's pixels listed once.
      expect(s.order.length).toBe(s.owner.filter((k) => k >= 0).length);
      expect([...s.owner].every((k) => k === WALL || k === GROUND || (k >= 0 && k < s.ys.length))).toBe(true);
      const frame = new Uint8ClampedArray(s.pixels.length);
      const alpha = (f: Uint8ClampedArray) => { let n = 0; for (let i = 3; i < f.length; i += 4) n += f[i]; return n; };
      pourFrame(s, 0, frame);
      expect(alpha(frame)).toBe(0);
      pourFrame(s, 0.5, frame);
      const half = alpha(frame);
      expect(half).toBeGreaterThan(0);
      expect(half).toBeLessThan(alpha(s.pixels));
      // Before its coins are in, the wall shows whole behind the heap.
      pourFrame(s, 0.31, frame);
      for (let x = 0; x < 160; x++) expect(frame[((39 * 160) + x) * 4 + 3]).toBe(255);
      pourFrame(s, 1, frame);
      // Poured in, it is the room, pixel for pixel (where nothing shows, whatever colour).
      const seen = (f: Uint8ClampedArray) => f.map((v, i) => (f[i - (i % 4) + 3] ? v : 0));
      expect(seen(frame)).toEqual(seen(s.pixels));
      pourFrame(s, 0.5, frame, true);
      expect(alpha(frame)).toBeLessThan(alpha(s.pixels));
      pourFrame(s, 1, frame, true);
      expect(alpha(frame)).toBe(0);
    }
  });

  test("why a job is there: its score, how new, when it closes, home, its industry, where found, a graduate track", () => {
    const j = job("Graduate Developer", "Bank", 88, { date: "2026-11-19", deadline: "2026-11-22", home: true, industry: "finance" });
    const t = treasure([j], score, { now });
    expect(t.why(j)).toEqual([
      { kind: "score", n: 88 }, { kind: "posted", days: 1 }, { kind: "closes", days: 2 }, { kind: "home" },
      { kind: "industry", id: "finance" }, { kind: "where", where: "own" }, { kind: "grads" },
    ]);
  });

  test("the home base's area is the one among the settings' areas that names it", () => {
    const areas = [
      { name: "Sharon", places: ["netanya", "kfar saba"], tier: "near" as const },
      { name: "South", places: ["beer sheva"], tier: "far" as const },
    ];
    expect(homeArea({ home: "Netanya, Israel", areas })?.name).toBe("Sharon");
    expect(homeArea({ home: "Beer Sheva", areas })).toBeNull();
    expect(homeArea({ home: "", areas })).toBeNull();
  });
});
