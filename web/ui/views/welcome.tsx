// The introduction: what a new user goes through once, in the login's forest, with Pip on a board that changes for
// each step. It asks for what everything else needs: the name employers see, an AI to work with, the CV the profile
// is built from (/setup reads it, in a conversation shown on the board), where to search, and whether to get the
// daily email. A step can be left and come back to, and the track under the board shows which are done. Finishing it
// marks it done (server.ts), with or without every step; the home page opens it again while there is no profile.
// Going to another step is the login's change of language: Pip jumps down off the board, the board flips like a sign
// to the new step, and Pip jumps back on.
import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useApp } from "../app";
import { paintStill } from "../intro";
import { jump, OFF_BOARD, type Point } from "../jump";
import { api, Btn, Field, Spinner } from "../kit";
import { SaveNote, useAutoSave } from "../autosave";
import { Pip, PipSetsOff, pixelPath, type Mood } from "../pip";
import { ENGLISH_NAME, englishOnly } from "../../names";
import { INDUSTRIES, PORTALS } from "../../portals";
import { fromList, type Level, type ListedRole, listedRole, matchListed, type Role, ROLE_FIELDS, roleQuery } from "../../roles";
import { Conversation, readBase64 } from "./chat";
import { Digits, PixelArt, Sprite, Tick } from "./home";
import { AiKeys, MarketsEditor, RUN_TIMES, RUN_TIMES_ADVISED } from "./settings";

const STEPS = ["hello", "name", "ai", "cv", "search", "mail", "done"] as const;
type Step = (typeof STEPS)[number];
// The steps with a wider board (the class on welcome-center): wide for the ones with the most on them, and the end's
// as wide as its ticket.
const WIDTH: Partial<Record<Step, "wide" | "ticket">> = { cv: "wide", search: "wide", mail: "wide", done: "ticket" };
// What the server takes into the documents folder (user.ts).
const DOC_ACCEPT = ".pdf,.docx,.doc,.txt,.md,.rtf";
// Each half of the board's flip, as the login's (FLIP_MS in ui/login.tsx).
const FLIP_MS = 180;
// While the board flips Pip waits up to GAP pixels beside it, far enough that his jumps clear its corner, and stays
// on the ground LINGER seconds after it opens before jumping back on, so steps changed one after another only turn
// the board while he waits beside it.
const GAP = 130;
const LINGER = 0.45;
// At the end, Pip setting off from beside the board (useStepChange): how long after the page is stamped he puts the
// backpack on (or jumps down, if on the board still), how long after landing he pulls it out, how long that takes
// (pack-out in styles.css), how long he holds it up when pulled out after the page is stamped, how long putting it on
// takes (pack-on), and how fast he runs off the screen, in pixels a millisecond. While he holds it open each line of
// the ticket that comes in tosses its picture in, TOSS_MS through the air, rising TOSS_RISE over the straight way.
// If he isn't ready in READY_BY_MS, the ticket comes in anyway.
const JUMP_AFTER_MS = 700;
const PULL_AFTER_MS = 150;
const PACK_OUT_MS = 600;
const PULL_MS = 900;
const PUT_ON_MS = 650;
const RUN_SPEED = 1.1;
const TOSS_MS = 520;
const TOSS_RISE = 90;
const READY_BY_MS = 3000;

// The board's own little drawings, in its pixels: a page for a document, and the arrow back (drawn pointing to the
// start of a right-to-left line, turned round in English by its class, like the site's back icon).
// Where a document drops: a folder, an arrow falling into it, and the arrow between the steps of LinkedIn's way to
// save a PDF (drawn going on along a right-to-left line, turned round in English).
const FOLDER = ["XXXXX.........", "X...X.........", "X...XXXXXXXXXX", "X............X", "X............X", "X............X", "X............X", "X............X", "XXXXXXXXXXXXXX"];
const DROP_ARROW = ["..XXX..", "..XXX..", "..XXX..", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
const ONWARD = ["...X", "..XX", ".XX.", "XX..", ".XX.", "..XX", "...X"];
// Making the CV step's conversation big, four corners pointing out, and small again, pointing in.
const EXPAND = ["XXX...XXX", "XX.....XX", "X.X...X.X", ".........", "X.X...X.X", "XX.....XX", "XXX...XXX"];
const SHRINK = ["X.X...X.X", ".XX...XX.", "XXX...XXX", ".........", "XXX...XXX", ".XX...XX.", "X.X...X.X"];
// The files a drop names; the rest it counts, on a tag of their own with a plus where the others have their tick.
const SHOWN_FILES = 3;
const PLUS = ["..XX..", "..XX..", "XXXXXX", "XXXXXX", "..XX..", "..XX.."];
const BACK = ["X...", "XX..", ".XX.", "..XX", ".XX.", "XX..", "X..."];
// The opening's list of what Pip does, a line of the paper each, with its picture seven blocks tall: a magnifier, a
// star, a page, an envelope and a paper plane (drawn going on along a right-to-left line, turned round in English
// like the site's onward icon). The colours are in the CSS, by key. Sean keeps it short: only what a new user must
// hear (he took out lines on the portals and on checking CVs as too much), so ask him before adding one; a line goes
// here, in i18n.ts (welcome.hello.points, both languages) and its colour in the CSS. The magnifier is the level's
// search box's too (LevelEffect).
const FIND = ["..XXX...", ".X...X..", ".X...X..", ".X...X..", "..XXXX..", ".....XX.", "......XX"];
const POINTS: { key: string; rows: string[]; turn?: boolean }[] = [
  { key: "search", rows: FIND },
  { key: "rank", rows: ["....X....", "...XXX...", "XXXXXXXXX", ".XXXXXXX.", "..XXXXX..", ".XXX.XXX.", ".X.....X."] },
  { key: "cv", rows: ["XXXXX..", "X...XX.", "X.XX..X", "X.....X", "X.XXX.X", "X.....X", "XXXXXXX"] },
  { key: "mail", rows: ["XXXXXXXXX", "XX.....XX", "X.X...X.X", "X..X.X..X", "X...X...X", "X.......X", "XXXXXXXXX"] },
  { key: "send", rows: [".......XX", ".....XXXX", "...XXXXX.", ".XXXXXX..", "...XXXXX.", ".....XXXX", ".......XX"], turn: true },
];
const point = (key: string) => POINTS.find((p) => p.key === key)!.rows;
// The end's ticket has the points' pictures, and a spark for the AI; a barcode on its stub; and a notch cut out of its
// edge at each end of the line the stub tears off along, drawn for the top edge and turned over for the bottom one,
// the cut in the colour of the wood behind it (the CSS's).
const SPARK = ["...X...", "...X...", "..XXX..", "XXXXXXX", "..XXX..", "...X...", "...X..."];
const BARCODE = Array<string>(10).fill("X.XX.X..XXX.X.XX..X.X.XXX..X.XX.X");
const NOTCH = { rows: ["OfffffO", "OfffffO", ".OfffO.", "..OOO.."], colors: { O: "#3a2414", f: "currentColor" } };
// What glints over Pip's bag as a picture lands in it, drawn outside React (toss), as SVG.
const GLINT = [".X.", "XXX", ".X."];
const SVG_NS = "http://www.w3.org/2000/svg";
// The puff of dust Pip leaves as he runs off at the end.
const DUST = ["...XX.....", ".XXXXX.XX.", "XXXXXXXXXX", ".XXXXXXXX."];
// The forest's birds, flying up out of the trees round the board as the stamp lands with its thud: wings up and wings
// down, taking turns as Pip's steps do (pip-a, pip-b). Each sits out from the board's side (side, x) and down from
// its top (y), as big as size (1 is 44 pixels wide), flies out and up so far, and goes after so long.
const BIRD_UP = ["XX.......XX", ".XX.....XX.", "..XX.X.XX..", "...XXXXX...", "....XXX...."];
const BIRD_DOWN = ["...........", "....XXX....", "..XXXXXXX..", ".XX.XXX.XX.", "XX.......XX"];
const FLOCK = [
  { side: -1, x: 90, y: 30, size: 1, out: 220, up: 380, after: 0 },
  { side: -1, x: 190, y: -20, size: 0.85, out: 300, up: 330, after: 90 },
  { side: -1, x: 60, y: -90, size: 0.7, out: 160, up: 420, after: 40 },
  { side: -1, x: 250, y: 110, size: 0.75, out: 340, up: 300, after: 150 },
  { side: 1, x: 80, y: 10, size: 1, out: 260, up: 360, after: 60 },
  { side: 1, x: 200, y: -60, size: 0.8, out: 320, up: 320, after: 0 },
  { side: 1, x: 130, y: 120, size: 0.7, out: 200, up: 440, after: 120 },
];
// How long the flock is on screen, its last bird's wait and flight (bird-off in styles.css).
const BIRDS_MS = 2200;
type Bird = { left: number; top: number; width: number; dx: number; dy: number; after: number };
// The next of the day's run times from now, today's or else tomorrow's first: what automation.ts nextRun says when
// no run is due, for a server that doesn't say.
const nextFrom = (times: string[], now = new Date()) => {
  const sorted = [...times].sort();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const later = sorted.find((x) => x > time);
  return later ? { day: "today" as const, time: later } : { day: "tomorrow" as const, time: sorted[0] ?? "09:00" };
};

// The forest at rest, the whole window behind the board, morning or night with the theme.
function Forest() {
  const { dark } = useApp();
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const paint = () => paintStill(c, dark, 0.82);
    paint();
    const watch = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(paint, 150); });
    watch.observe(c);
    return () => { clearTimeout(timer); watch.disconnect(); };
  }, [dark]);
  return <canvas ref={ref} className="welcome-forest" aria-hidden="true" />;
}

// The page's scrollbar, drawn like the two red pins at its top corners: a red bar in the strip of wood between the
// board's frame and the page, on the side where a browser puts its own. As long as a browser's, it is to the strip
// what the part in sight is to the whole page. The page scrolls as it always does, by wheel, keys or touch, and the bar
// follows; it can be dragged, and a click on the strip turns a page. It shows only when the page has more than fits.
const BAR_END = 12; // the strip left above and below the bar, so it sets out level with the corner pins
const BAR_SHORTEST = 24;
const barFor = (el: HTMLElement) => {
  const track = el.clientHeight - 2 * BAR_END;
  // In whole blocks of the board's pixels (4px), as everything on it.
  const length = Math.min(track, Math.max(BAR_SHORTEST, Math.round((track * el.clientHeight) / el.scrollHeight / 4) * 4));
  return { length, travel: Math.max(1, track - length), range: el.scrollHeight - el.clientHeight };
};
function PageBar({ page }: { page: React.RefObject<HTMLDivElement | null> }) {
  const rail = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const r = rail.current, p = bar.current;
      if (!r || !p) return;
      const { length, travel, range } = barFor(el);
      r.hidden = range < 1;
      if (range < 1) return;
      r.style.top = `${el.offsetTop}px`;
      r.style.height = `${el.clientHeight}px`;
      p.style.height = `${length}px`;
      p.style.transform = `translateY(${Math.round((el.scrollTop / range) * travel)}px)`;
    };
    const soon = () => { if (!frame) frame = requestAnimationFrame(place); };
    // What is written on the page changes with the step, and grows as a conversation goes on.
    const sizes = new ResizeObserver(soon);
    const watch = () => { sizes.disconnect(); sizes.observe(el); for (const c of el.children) sizes.observe(c); soon(); };
    const kids = new MutationObserver(watch);
    kids.observe(el, { childList: true });
    el.addEventListener("scroll", place, { passive: true });
    // What comes in with a step can stand out past the page while it does; once it is in, the bar measures again.
    el.addEventListener("animationend", soon);
    watch();
    return () => {
      cancelAnimationFrame(frame); sizes.disconnect(); kids.disconnect();
      el.removeEventListener("scroll", place); el.removeEventListener("animationend", soon);
    };
  }, [page]);
  const drag = (e: React.PointerEvent<HTMLSpanElement>) => {
    const el = page.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const p = e.currentTarget;
    p.setPointerCapture(e.pointerId);
    const y0 = e.clientY, top0 = el.scrollTop;
    const { travel, range } = barFor(el);
    const per = range / travel;
    const move = (m: PointerEvent) => { el.scrollTop = top0 + (m.clientY - y0) * per; };
    const end = () => { p.classList.remove("held"); p.removeEventListener("pointermove", move); p.removeEventListener("lostpointercapture", end); };
    p.classList.add("held");
    p.addEventListener("pointermove", move);
    p.addEventListener("lostpointercapture", end);
  };
  const turn = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = page.current, p = bar.current;
    if (!el || !p || e.button !== 0 || e.target !== e.currentTarget) return;
    const down = e.clientY > p.getBoundingClientRect().bottom ? 1 : -1;
    el.scrollBy({ top: down * el.clientHeight * 0.9, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  // The strip is beside the page, not on it, so a wheel over it is passed on.
  const wheel = (e: React.WheelEvent) => page.current?.scrollBy({ top: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY });
  return (
    <div ref={rail} className="welcome-rail" aria-hidden="true" hidden onPointerDown={turn} onWheel={wheel}>
      <span ref={bar} className="welcome-rail-bar" onPointerDown={drag} />
    </div>
  );
}

// The board's foot, on the wood under the page that scrolls (welcome-body), where each step puts its Actions.
const Foot = createContext<HTMLElement | null>(null);

// A step's buttons: back on the start side, then whatever moves on. They go in the board's foot, so they stay in
// sight and nothing scrolls under them; a form's submit button there names its form (the form attribute).
function Actions({ back, note, children }: { back?: () => void; note?: React.ReactNode; children?: React.ReactNode }) {
  const { t } = useApp();
  const foot = useContext(Foot);
  if (!foot) return null;
  return createPortal(
    <div className="welcome-actions">
      {back && <button type="button" className="welcome-back" onClick={back}><PixelArt className="icon-back welcome-arrow" rows={BACK} />{t("welcome.back")}</button>}
      {note}
      <div className="welcome-go">{children}</div>
    </div>,
    foot,
  );
}

function NameStep({ next, back }: { next: () => void; back: () => void }) {
  const { s, t, err, refresh } = useApp();
  const [name, setName] = useState(String(s.intro?.name ?? ""));
  // The name is in English letters only, as on the CV: anything else typed or pasted is dropped, with a word on why.
  const [foreign, setForeign] = useState(() => Boolean(name.trim()) && !ENGLISH_NAME.test(name.trim()));
  const [error, setError] = useState("");
  const type = (typed: string) => {
    const kept = englishOnly(typed);
    setForeign(kept !== typed);
    setName(kept);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api("intro/name", { name });
      await refresh();
      next();
    } catch (x) {
      setError(err(x));
    }
  };
  return (
    <form id="welcome-name" className="welcome-form" onSubmit={save}>
      <Field label={t("welcome.name.label")}>
        <input type="text" dir="ltr" lang="en" autoFocus autoComplete="name" autoCapitalize="words" spellCheck={false} placeholder="Dana Cohen"
          value={name} onChange={(e) => type(e.target.value)} />
      </Field>
      {foreign && <p className="note" role="status" dir="auto">{t("welcome.name.english")}</p>}
      {error && <p className="error-line" role="alert" dir="auto">{error}</p>}
      <Actions back={back}><Btn kind="cta" type="submit" form="welcome-name" disabled={!ENGLISH_NAME.test(name.trim())}>{t("welcome.next")}</Btn></Actions>
    </form>
  );
}

function AiStep({ next, back }: { next: () => void; back: () => void }) {
  const { s, t, refresh } = useApp();
  const logins = s.aiLogins ?? {};
  const any = Boolean(logins.claude || logins.openai || s.aiKeys.openai);
  const primary = async (id: string) => {
    await api("settings", { ...s.settings, aiPrimary: id }).catch(() => {});
    await refresh();
  };
  return (
    <>
      <AiKeys bare primary={String(s.settings.aiPrimary ?? "claude")} onPrimary={primary} />
      {!any && <p className="note" role="status">{t("welcome.ai.need")}</p>}
      <Actions back={back}><Btn kind="cta" disabled={!any} onClick={next}>{t("welcome.next")}</Btn></Actions>
    </>
  );
}

// A place to drop documents, or click to pick them: a folder with an arrow falling into it, "drop here", what goes
// in, and what it takes (the kinds of file, or LinkedIn's way to save one); once something is there, the files as
// tags from the left, as their names read (the first few, then how many more), and the arrow rests.
function Drop({ label, takes, files, busy, onFiles }: { label: string; takes: React.ReactNode; files: string[]; busy: boolean; onFiles: (f: FileList | null) => void }) {
  const { t } = useApp();
  const [over, setOver] = useState(false);
  return (
    <label
      className={`welcome-drop ${over ? "over" : ""} ${files.length ? "has" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
    >
      <input type="file" accept={DOC_ACCEPT} multiple className="welcome-file" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      <span className="welcome-drop-art"><PixelArt className="welcome-drop-arrow" rows={DROP_ARROW} /><PixelArt className="welcome-drop-folder" rows={FOLDER} /></span>
      {!files.length && <><span className="welcome-drop-call">{t("welcome.cv.dropHere")}</span><span className="note">{t("welcome.cv.orPick")}</span></>}
      <strong className="welcome-drop-what">{label}{busy && <Spinner />}</strong>
      {files.length ? (
        <>
          <span className="welcome-drop-files" dir="ltr">
            {files.slice(0, SHOWN_FILES).map((f) => <span key={f} className="tag"><Tick /><bdi>{f}</bdi></span>)}
            {files.length > SHOWN_FILES && (
              <span className="tag welcome-drop-rest">
                <PixelArt className="tick" rows={PLUS} />
                <bdi dir="auto">{files.length - SHOWN_FILES === 1 ? t("welcome.cv.oneMore") : t("welcome.cv.nMore", { n: files.length - SHOWN_FILES })}</bdi>
              </span>
            )}
          </span>
        </>
      ) : takes}
    </label>
  );
}

// The CV step's conversation box, which can be made big: the box itself leaves the board for nearly the whole window,
// over a dimmed introduction, and comes back, keeping its frame and bar and the one conversation in it, which fills
// each size as the box grows and shrinks, so nothing in it is drawn again. While it is out, an empty room of the same
// size keeps its place on the board, and Escape, or a click anywhere outside it, brings it back.
function ConversationBox({ id }: { id: string }) {
  const { t } = useApp();
  const [big, setBig] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const moving = useRef(false);
  const calm = useRef(matchMedia("(prefers-reduced-motion: reduce)").matches).current;
  const place = (r: DOMRect) => ({ top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
  const timing = { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
  const resize = async (toBig: boolean) => {
    const el = box.current;
    if (!el || moving.current) return;
    if (calm) return setBig(toBig);
    moving.current = true;
    const start = el.getBoundingClientRect();
    if (toBig) {
      flushSync(() => setBig(true));
      shade.current?.animate([{ opacity: 0 }, { opacity: 1 }], timing);
      await el.animate([place(start), place(el.getBoundingClientRect())], timing).finished.catch(() => {});
    } else {
      const end = room.current!.getBoundingClientRect();
      shade.current?.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, fill: "forwards" });
      const back = el.animate([place(start), place(end)], { ...timing, fill: "forwards" });
      await back.finished.catch(() => {});
      flushSync(() => setBig(false));
      back.cancel();
    }
    moving.current = false;
  };
  useEffect(() => {
    if (!big) return;
    const shut = (e: KeyboardEvent) => { if (e.key === "Escape") resize(false); };
    addEventListener("keydown", shut);
    return () => removeEventListener("keydown", shut);
  });
  return (
    <>
      {big && <div className="big-chat-shade" ref={shade} onClick={() => resize(false)} />}
      {big && <div className="welcome-convo-room" ref={room} />}
      {/* Its lists (the access to pick) stay in it, in the site's look, not the board's (select.tsx). */}
      <div className={`welcome-convo ${big ? "big" : ""}`} ref={box} data-popovers="" role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={big ? t("welcome.cv.convo") : undefined}>
        {/* A bar over it, as a window's: what it is, and at its end the way to make it big or small again. */}
        <div className="welcome-convo-bar">
          <span>{t("welcome.cv.convo")}</span>
          <button type="button" className="welcome-convo-big" onClick={() => resize(!big)}>
            {t(big ? "welcome.cv.smaller" : "welcome.cv.bigger")}<PixelArt className="welcome-convo-big-icon" rows={big ? SHRINK : EXPAND} />
          </button>
        </div>
        <Conversation key={id} id={id} bare />
      </div>
    </>
  );
}

// The CV and a LinkedIn PDF go into the documents folder, and the way on starts /setup reading them in the
// background: the introduction goes on, Pip working on every step and the track marking this one until the profile
// is saved, and the step shows the conversation when it is back to (it asks there what it needs). Without a CV the
// red button interviews instead, here. The step opens on the files: the conversation shows while it goes, before
// the profile is saved, or once the interview was started here (talk), until the files are asked for again. Shown,
// it tells the board what it is (onConversation), for the words over it, and it can be made big (BigConversation).
function CvStep({ next, back, onConversation }: { next: () => void; back: () => void; onConversation: (kind: string) => void }) {
  const { s, t, err, refresh } = useApp();
  const docs = s.intro?.documents ?? { cv: [], linkedin: [] };
  const setup = s.sessions.filter((x) => /^\/setup\b/.test(x.title)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const working = setup?.status === "running" || setup?.status === "waiting";
  const [talk, setTalk] = useState(false);
  const [again, setAgain] = useState(false);
  const shown = Boolean(setup && !again && (talk || working || !s.profileReady));
  const kind = !shown ? "" : /--interview\b/.test(setup!.title) ? "interview" : /--from-documents\b/.test(setup!.title) ? "reading" : "other";
  useEffect(() => { onConversation(kind); }, [kind, onConversation]);
  useEffect(() => () => onConversation(""), [onConversation]);
  // Files added on this visit, which the way on reads even with a profile saved already.
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const any = docs.cv.length + docs.linkedin.length > 0;
  const upload = async (kind: "cv" | "linkedin", files: FileList | null) => {
    if (!files?.length) return;
    setBusy(kind);
    setError("");
    try {
      for (const f of Array.from(files)) await api("intro/document", { kind, name: f.name, data: await readBase64(f) });
      await refresh();
      setAdded(true);
    } catch (x) {
      setError(err(x));
    }
    setBusy("");
  };
  // On, with the files read meanwhile if there is something new to read; the files stay on the board as it turns.
  const onward = async () => {
    if (any && (!s.profileReady || added)) {
      setError("");
      setAgain(true);
      try {
        await api("sessions", { prompt: "/setup --from-documents" });
        await refresh();
      } catch (x) {
        setAgain(false);
        setError(err(x));
        return;
      }
    }
    next();
  };
  const begin = async (prompt: string) => {
    setError("");
    try {
      await api("sessions", { prompt });
      await refresh();
      setAgain(false);
      setTalk(true);
    } catch (x) {
      setError(err(x));
    }
  };
  if (setup && shown) {
    // Back to the files: to start again when the conversation stopped before the profile was saved, or, with a
    // profile saved already, to read a new CV, stopping this conversation first if it still goes.
    const leave = async () => {
      if (working) await api(`sessions/${setup.id}/interrupt`, {}).catch(() => {});
      setAgain(true);
      setTalk(false);
    };
    return (
      <>
        <ConversationBox id={setup.id} />
        <Actions back={back} note={(s.profileReady || !working) && <Btn className="welcome-other welcome-again" onClick={leave}>{t(s.profileReady ? "welcome.cv.newCv" : "welcome.cv.again")}</Btn>}>
          {s.profileReady
            ? <Btn kind="cta" onClick={next}>{t("welcome.next")}</Btn>
            : working
              ? <><span className="welcome-wait" role="status"><Spinner />{t("welcome.cv.working")}</span><Btn kind="cta" onClick={next}>{t("welcome.next")}</Btn></>
              : <span className="welcome-wait" role="status">{t("welcome.cv.stuck")}</span>}
        </Actions>
      </>
    );
  }
  return (
    <>
      <div className="welcome-drops">
        <Drop label={t("welcome.cv.cv")} files={docs.cv} busy={busy === "cv"} onFiles={(f) => upload("cv", f)}
          takes={<span className="welcome-kinds">{t("welcome.cv.kinds").split("|").map((k) => <span key={k}>{k}</span>)}</span>} />
        <Drop label={t("welcome.cv.linkedin")} files={docs.linkedin} busy={busy === "linkedin"} onFiles={(f) => upload("linkedin", f)}
          takes={<span className="welcome-path">{t("welcome.cv.linkedinSteps").split("|").map((step, i) => (
            <React.Fragment key={step}>{i > 0 && <PixelArt className="icon-onward" rows={ONWARD} />}<span>{step}</span></React.Fragment>
          ))}</span>} />
      </div>
      {error && <p className="error-line" role="alert" dir="auto">{error}</p>}
      {/* Without a CV file, the step's other way, a red button, starts the interview instead, straight away. */}
      <Actions back={back} note={<Btn className="welcome-other" onClick={() => begin("/setup --interview")}>{t("welcome.cv.none")}</Btn>}>
        <Btn kind="cta" disabled={!any && !s.profileReady} onClick={onward}>{t("welcome.next")}</Btn>
      </Actions>
    </>
  );
}

// Where to search, as on the settings screen, in tabs like a notebook's dividers: the markets, the level, the roles
// from the ready-made list, and the industries, one at a time on a panel the open tab is joined to, each tab with its
// picture and what is chosen on it so far. The way on and back go from tab to tab before they leave the step, which
// needs a market and a role. /setup may have chosen roles already; they show here picked.
const SEARCH_TABS = ["places", "level", "roles", "industries"] as const;
type SearchTab = (typeof SEARCH_TABS)[number];
const TAB_PICTURES: Record<SearchTab, string[]> = {
  places: ["..XXXXX..", ".XX...XX.", "XX..X..XX", "XX.XXX.XX", "XX..X..XX", ".XX...XX.", "..XX.XX..", "...XXX...", "....X...."],
  level: ["......XXX", "......X.X", "...XXXX.X", "...X....X", "XXXX....X", "X.......X", "XXXXXXXXX"],
  roles: ["...XXX...", "...X.X...", "XXXXXXXXX", "X.......X", "X.......X", "XXXXXXXXX", "X.......X", "XXXXXXXXX"],
  industries: ["X........", "X.X.X....", "XXXXXXXXX", "X.X.X.X.X", "X.......X", "X.XX.XX.X", "XXXXXXXXX"],
};
const LEVELS: Level[] = ["any", "junior", "middle", "senior"];
// A level's picture, the tab's steps as three bars climbing: its own lit and the others in outline, all of them lit
// for any level. They climb the way the cards run, turned round in Hebrew by the CSS.
const STEP_HEIGHTS = [4, 7, 10];
const steps = (on: (step: number, x: number, y: number, top: number) => boolean) =>
  Array.from({ length: 10 }, (_, y) => STEP_HEIGHTS.map((h, i) => [0, 1, 2, 3].map((x) => (y >= 10 - h && on(i, x, y, 10 - h) ? "X" : ".")).join("")).join("."));
function LevelSteps({ level }: { level: Level }) {
  const lit = (step: number) => level === "any" || LEVELS.indexOf(level) === step + 1;
  return (
    <span className="level-steps">
      <PixelArt className="level-step-off" rows={steps((i, x, y, top) => !lit(i) && (x === 0 || x === 3 || y === top || y === 9))} />
      <PixelArt className="level-step-on" rows={steps(lit)} />
    </span>
  );
}

// How long the level's word takes to type into the search box, a letter at a time, and to delete, and the pause
// before its first letter.
const TYPE_MS = 85;
const DELETE_MS = 45;
const TYPE_START_MS = 260;

// The word as the box shows it at the moment: the one before deleted a letter at a time, and the new one typed in
// the same way, from the tab's opening too; all at once for those who ask for less motion.
function useTyped(word: string) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (shown === word) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(word); return; }
    const typing = word.startsWith(shown);
    const timer = setTimeout(() => setShown(typing ? word.slice(0, shown.length + 1) : shown.slice(0, -1)),
      typing ? (shown ? TYPE_MS : TYPE_START_MS) : DELETE_MS);
    return () => clearTimeout(timer);
  }, [shown, word]);
  return shown;
}

// What the level does to the search: one of the roles chosen from the list, or Backend before any is, searched as
// it will be, in a box like a search's. The word the level adds is typed in as it changes, each letter dropping into
// place, the caret where the letters go meanwhile and at the end after; once typed, the highlighter is drawn over
// it. The tab has no heading, for all of it to fit on the board without scrolling: the cards say what the level is.
function LevelEffect({ roles, level }: { roles: any[]; level: Level }) {
  const { t } = useApp();
  const role = roles.map((r) => listedRole(r.id)).find((r) => r && !r.fixed) ?? listedRole("backend")!;
  const added = roleQuery(role, level).slice(0, -role.title.length).trim();
  const shown = useTyped(added);
  const typing = shown !== added;
  const caret = <span className={`level-caret ${typing ? "typing" : ""}`} />;
  return (
    <div className="level-query" dir="ltr" role="img" aria-label={t("welcome.search.levelSearch", { query: roleQuery(role, level) })}>
      <PixelArt className="level-query-find" rows={FIND} />
      <span>
        {shown && <span className={`level-added ${typing ? "" : "inked"}`}>{[...shown].map((c, i) => <span key={i} className="level-letter">{c}</span>)}</span>}
        {typing && caret}
        {shown && <span className="level-gap" />}
        {role.title}
        {!typing && caret}
      </span>
    </div>
  );
}

// The roles, as a notebook's index: the fields down the start side, the open one in the highlighter, each with how
// many of its roles are chosen, and the open field's roles beside them, a block each in rows of three, green with a
// tick once chosen. A box above them finds roles in the whole list by any of their names, in either language, and
// offers what is typed as a role of one's own when the list has none of that name, which the search then looks for
// as typed (roles.ts). Enter does what the box offers. One's own roles have a field at the end while there are any,
// where a click removes one. All of it fits the panel of the tallest board, as the level's does.
const OWN = "own";
// The most roles the box's finds show: rows of three, one of them taken by the offer of one's own when there is one.
const FOUND_MOST = 9;
// Names compared word by word from the start of a word, whatever stands between the words, so "dev" finds Backend
// Developer and ".net" .NET, but "bi" not Mobile.
const plain = (s: string) => ` ${s.toLowerCase().split(/[\s/.,()\-]+/).filter(Boolean).join(" ")}`;
const LISTED_ROLES = ROLE_FIELDS.flatMap((f) => f.roles);
const namesOf = (r: ListedRole) => [r.title, r.he, r.en, r.hebrew ?? ""].map(plain);
const fieldOf = (r: ListedRole) => ROLE_FIELDS.find((f) => f.roles.includes(r))!.id;

function RolesPicker({ draft, update }: { draft: any; update: (fn: (d: any) => void) => void }) {
  const { t, lang } = useApp();
  const roles: Role[] = draft.roles;
  const own = roles.filter((r) => !listedRole(r.id));
  const picked = (id: string) => roles.some((x) => x.id === id);
  const [field, setField] = useState(() => ROLE_FIELDS.find((f) => f.roles.some((r) => picked(r.id)))?.id ?? ROLE_FIELDS[0].id);
  const [query, setQuery] = useState("");
  const typed = plain(query);
  const words = typed.trim() ? typed : "";
  const exact = words ? (matchListed(query, draft.seniority) ?? LISTED_ROLES.find((r) => namesOf(r).includes(words))) : undefined;
  const offer = Boolean(words) && !exact && !own.some((r) => plain(r.query) === words || plain(r.label) === words);
  const found = words ? LISTED_ROLES.filter((r) => namesOf(r).some((n) => n.includes(words))) : [];
  const ownFound = words ? own.filter((r) => plain(r.label).includes(words) || plain(r.query).includes(words)) : [];
  const open = field === OWN && !own.length ? ROLE_FIELDS[0].id : field;
  const index = [
    ...ROLE_FIELDS.map((f) => ({ id: f.id, name: f[lang], n: f.roles.filter((r) => picked(r.id)).length })),
    ...(own.length ? [{ id: OWN, name: t("settings.ownRoles"), n: own.length }] : []),
  ];
  const toggle = (r: ListedRole) => update((d) => {
    d.roles = picked(r.id) ? d.roles.filter((x: Role) => x.id !== r.id) : [...d.roles, fromList(r, d.seniority)];
  });
  const remove = (r: Role) => update((d) => { d.roles = d.roles.filter((x: Role) => x.id || x.query !== r.query); });
  const take = () => {
    const typed = query.trim();
    if (exact) {
      if (!picked(exact.id)) toggle(exact);
      setField(fieldOf(exact));
    } else if (offer) {
      update((d) => { d.roles.push({ label: typed, query: typed }); });
      setField(OWN);
    } else return;
    setQuery("");
  };
  const pick = (r: ListedRole) => (
    <button key={r.id} type="button" className="role-pick" dir="auto" aria-pressed={picked(r.id)} onClick={() => toggle(r)}>
      {picked(r.id) && <Tick />}<span>{r[lang]}</span>
    </button>
  );
  const mine = (r: Role) => (
    <button key={r.query} type="button" className="role-pick" dir="auto" aria-pressed="true" aria-label={`${t("common.remove")} ${r.label}`} onClick={() => remove(r)}>
      <Tick /><span>{r.label}</span>
    </button>
  );
  const shown = words
    ? [...found.map(pick), ...ownFound.map(mine)].slice(0, offer ? FOUND_MOST - 3 : FOUND_MOST)
    : open === OWN ? own.map(mine) : ROLE_FIELDS.find((f) => f.id === open)!.roles.map(pick);
  return (
    <div className="roles-picker">
      <div className="role-index" role="group" aria-label={t("welcome.search.tabs.roles")}>
        {index.map((f) => (
          <button key={f.id} type="button" aria-pressed={!words && open === f.id} onClick={() => { setField(f.id); setQuery(""); }}>
            <span>{f.name}</span>{f.n > 0 && <span className="welcome-count on">{f.n}</span>}
          </button>
        ))}
      </div>
      <div className="role-side">
        <label className="role-find">
          <input type="text" dir={query ? "auto" : undefined} maxLength={60} value={query} placeholder={t("welcome.search.rolesFind")} aria-label={t("welcome.search.rolesFind")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); take(); }
              else if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); }
            }} />
          <PixelArt className="role-find-icon" rows={FIND} />
        </label>
        <div className="role-grid" role="group" aria-label={words ? t("welcome.search.rolesFind") : index.find((f) => f.id === open)!.name}>
          {shown}
          {offer && (
            <button type="button" className="role-pick role-add" onClick={take}>
              <PixelArt className="tick" rows={PLUS} /><span>{t("welcome.search.addOwn")} <bdi>{query.trim()}</bdi></span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// The industries outside high-tech, as tiles (portals.ts): green while their employers are read, which is every one
// until some are turned off. Lit as the settings have it: in the industries chosen, none meaning all, and outside
// high-tech only while that is on, except defence, which is read either way. A change writes both back: the tiles
// lit as the industries, with high-tech kept among them for the daily run to go on searching it (settings.ts), or
// none for all of them; and outside high-tech on while any tile but defence is lit. With none lit, no employer is.
const TILES = INDUSTRIES.filter((i) => i.id !== "hightech");
const TILE_PICTURES: Record<string, string[]> = {
  health: ["...XXX...", "...X.X...", "XXXX.XXXX", "X.......X", "XXXX.XXXX", "...X.X...", "...XXX..."],
  insurance: ["....X....", "..XXXXX..", ".XXXXXXX.", "XXXXXXXXX", "....X....", "....X....", "..X.X....", "...X....."],
  finance: ["XXXXXXXXX", "X.......X", "X..XXX..X", "X.X...X.X", "X..XXX..X", "X.......X", "XXXXXXXXX"],
  government: ["....X....", "..XX.XX..", "XX.....XX", "XXXXXXXXX", ".X.X.X.X.", ".X.X.X.X.", ".X.X.X.X.", "XXXXXXXXX"],
  local: ["....X....", "...XXX...", "..XX.XX..", ".XX...XX.", "XXXXXXXXX", ".X.....X.", ".X.XXX.X.", ".X.X.X.X."],
  academia: ["XX.....XX", "X.XX.XX.X", "X...X...X", "X...X...X", "X...X...X", "XXX.X.XXX", "...XXX..."],
  telecom: [".X.....X.", "..X...X..", "...X.X...", "XXXXXXXXX", "X.......X", "X.......X", "XXXXXXXXX", ".X.....X."],
  retail: ["XX.......", ".X.......", ".XXXXXXXX", "..X....X.", "..XXXXXX.", "..X......", "..XXXXXX.", "...X..X.."],
  industry: [".......XX", "......XX.", "X..X..XX.", "XX.XX.XX.", "XXXXXXXXX", "X.......X", "X.XX.XX.X", "XXXXXXXXX"],
  energy: ["....XXXX.", "...XXXX..", "..XXXX...", ".XXXXXXX.", "....XXX..", "...XXX...", "..XX.....", ".X......."],
  transport: ["XXXXXXXXX", "X.X.X.X.X", "XXXXXXXXX", "X.......X", "XXXXXXXXX", ".XX...XX."],
  defense: ["XXXXXXXXX", "X...X...X", "X...X...X", "X...X...X", ".X..X..X.", ".X..X..X.", "..X.X.X..", "...XXX..."],
};
// How many of each industry's employers are read, and of them all, in round hundreds once there are a hundred
// ("100+").
const EMPLOYERS: Record<string, number> = Object.fromEntries(TILES.map((i) => [i.id, PORTALS.filter((p) => p.kind === "employer" && p.how === "read" && p.industry === i.id).length]));
const ALL_EMPLOYERS = Object.values(EMPLOYERS).reduce((a, b) => a + b, 0);
const ALL_SAID = ALL_EMPLOYERS >= 100 ? `${Math.floor(ALL_EMPLOYERS / 100) * 100}+` : String(ALL_EMPLOYERS);
const tilesLit = (d: any) => {
  const chosen: string[] = d.industries ?? [];
  return TILES.map((i) => i.id).filter((id) => (!chosen.length || chosen.includes(id)) && (d.lowTech !== false || id === "defense"));
};
// How long the tiles' wave lasts, coming in or turned over all at once: a step of 35ms between them (styles.css)
// and the last one's hop.
const WAVE_MS = TILES.length * 35 + 340;

// The tiles, under what they are about and a switch of two, all of them or high-tech only. They come in with a wave,
// and the switch turns them over in another (switched), the grid drawn again for it to start over.
function IndustryTiles({ draft, update }: { draft: any; update: (fn: (d: any) => void) => void }) {
  const { t, lang } = useApp();
  const lit = tilesLit(draft);
  const [waves, setWaves] = useState(0);
  const [wave, setWave] = useState(true);
  useEffect(() => {
    if (!wave) return;
    const timer = setTimeout(() => setWave(false), WAVE_MS);
    return () => clearTimeout(timer);
  }, [wave, waves]);
  const light = (on: (id: string) => boolean) => update((d) => {
    const ids = TILES.map((i) => i.id).filter(on);
    d.industries = ids.length === TILES.length ? [] : ["hightech", ...ids];
    d.lowTech = ids.some((id) => id !== "defense");
  });
  const all = (on: boolean) => { light(() => on); setWaves((n) => n + 1); setWave(true); };
  return (
    <>
      <div className="ind-head">
        <div className="ind-words">
          <span className="ind-title">{t("settings.lowTech")}</span>
          <span className="ind-note">{t("welcome.search.industriesNote", { n: ALL_SAID })}</span>
        </div>
        <div className={`segmented ${waves ? "moved" : ""}`} role="group" aria-label={t("settings.lowTech")}>
          <button type="button" aria-pressed={lit.length === TILES.length} onClick={() => all(true)}>{t("welcome.search.all")}</button>
          <button type="button" aria-pressed={!lit.length} onClick={() => all(false)}>{t("welcome.search.onlyHightech")}</button>
        </div>
      </div>
      <div key={waves} className={`ind-grid ${wave ? "wave" : ""} ${wave && waves ? "switched" : ""}`} role="group" aria-label={t("welcome.search.tabs.industries")}>
        {TILES.map((i, n) => {
          const on = lit.includes(i.id);
          return (
            <button key={i.id} type="button" className="ind-tile" style={{ "--i": n } as React.CSSProperties} aria-pressed={on}
              aria-label={`${i[lang]}, ${t("welcome.search.employers", { n: EMPLOYERS[i.id] })}`}
              onClick={() => light((id) => (id === i.id ? !on : lit.includes(id)))}>
              <span className="ind-count"><Digits n={EMPLOYERS[i.id]} /></span>
              <PixelArt className="ind-icon" rows={TILE_PICTURES[i.id]} />
              <span className="ind-name">{t(`welcome.search.industry.${i.id}`)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function SearchStep({ next, back }: { next: () => void; back: () => void }) {
  const { s, t, lang, refresh } = useApp();
  const [draft, setDraft] = useState<any>(() => structuredClone(s.settings));
  const saving = useAutoSave(draft, async (d) => { await api("settings", { ...d, language: lang }); await refresh(); });
  const update = (fn: (d: any) => void) => { const n = structuredClone(draft); fn(n); setDraft(n); };
  const [tab, setTab] = useState<SearchTab>("places");
  const at = SEARCH_TABS.indexOf(tab);
  const last = at === SEARCH_TABS.length - 1;
  const count = (n: number | string, on: boolean) => <span className={`welcome-count ${on ? "on" : ""}`}>{n}</span>;
  const lit = tilesLit(draft).length;
  const status: Record<SearchTab, React.ReactNode> = {
    places: draft.markets.length ? <Tick /> : null,
    level: <Tick />,
    roles: count(draft.roles.length, draft.roles.length > 0),
    industries: lit === TILES.length ? count(t("welcome.search.all"), false) : count(lit, lit > 0),
  };
  return (
    <>
      <div className="search-tabs" role="tablist" aria-label={t("welcome.search.title")}>
        {SEARCH_TABS.map((x) => (
          <button key={x} type="button" role="tab" id={`search-tab-${x}`} aria-selected={tab === x} aria-controls="search-panel"
            className={`search-tab ${tab === x ? "here" : ""}`} onClick={() => setTab(x)}>
            <PixelArt className="search-tab-picture" rows={TAB_PICTURES[x]} />{t(`welcome.search.tabs.${x}`)}{status[x]}
          </button>
        ))}
      </div>
      <div key={tab} className="search-panel" id="search-panel" role="tabpanel" aria-labelledby={`search-tab-${tab}`}>
        {tab === "places" && <MarketsEditor bare draft={draft} update={update} title={<h2 className="welcome-sub">{t("settings.markets")}</h2>} />}
        {tab === "level" && (
          <>
            <div className="level-picks" role="group" aria-label={t("settings.seniority")}>
              {LEVELS.map((v) => (
                <button key={v} type="button" className="level-pick" aria-pressed={draft.seniority === v} onClick={() => update((d) => {
                  d.seniority = v;
                  d.roles = d.roles.map((r: any) => (listedRole(r.id) ? fromList(listedRole(r.id)!, v) : r));
                })}>
                  <LevelSteps level={v} />
                  <span className="level-words">
                    <span className="level-name">{t(`settings.levels.${v}`)}</span>
                    <span className="level-who">{t(`welcome.search.levelWho.${v}`)}</span>
                  </span>
                </button>
              ))}
            </div>
            <LevelEffect roles={draft.roles} level={draft.seniority} />
          </>
        )}
        {tab === "roles" && <RolesPicker draft={draft} update={update} />}
        {tab === "industries" && <IndustryTiles draft={draft} update={update} />}
      </div>
      <Actions back={() => (at > 0 ? setTab(SEARCH_TABS[at - 1]) : back())} note={<SaveNote state={saving} />}>
        <Btn kind="cta" disabled={last && (!draft.markets.length || !draft.roles.length)} onClick={() => (last ? next() : setTab(SEARCH_TABS[at + 1]))}>{t("welcome.next")}</Btn>
      </Actions>
    </>
  );
}

// Google's page for making an app password, and the code that opens it on a phone (public/app-passwords-qr.svg,
// made from this address).
const APP_PASSWORDS = "https://myaccount.google.com/apppasswords";
// Going on to the phone in that window: when the phone's page goes on, the other still falling, and how long it takes
// to go on (page-fall and page-stick in styles.css).
const STICK_AT_MS = 360;
const STICK_MS = 300;
// How long the window takes to go away; matches pop-out in styles.css.
const CLOSE_MS = 240;
// The × on its pages, as the places' in the settings.
const CROSS = ["XX...XX", "XXX.XXX", ".XXXXX.", "..XXX..", ".XXXXX.", "XXX.XXX", "XX...XX"];
// A picture for each of the phone's steps rather than a number, on the board's paper in its colours: the phone with
// the code being scanned, a fingerprint, the keyboard with a key down.
const PHONE_STEPS: { key: "scan" | "confirm" | "type"; rows: string[]; colors: Record<string, string> }[] = [
  {
    key: "scan",
    rows: [
      "...OOOOOOO...", "..OOOwwwOOO..", "..OsssssssO..", "..OsggsggsO..", "..OsgsssgsO..", "..OsssssssO..", "..OrrrrrrrO..",
      "..OsssssssO..", "..OsgsssgsO..", "..OsggsggsO..", "..OsssssssO..", "..OOOOwOOOO..", "...OOOOOOO...",
    ],
    colors: { O: "#3a2414", w: "#a58a6a", s: "#ffffff", g: "#367a32", r: "#d0302f" },
  },
  {
    key: "confirm",
    rows: [
      "....XXXXX....", "..XX.....XX..", ".X..XXXXX..X.", "X..X.....X..X", "X.X..XXX..X.X", "X.X.X...X.X.X", "..X.X.X.X.X.X",
      ".X..X.X.X.X..", ".X.X..X.X..X.", "...X.X..X..X.", "..X..X.X..X..", ".X..X..X.....", "...X..X......",
    ],
    colors: { X: "#367a32" },
  },
  {
    key: "type",
    rows: [
      ".............", ".............", ".OOOOOOOOOOO.", "OkkOkkOkkOkkO", "OddOddOddOddO", "OOOOOOOOOOOOO", "OkkOkkOyyOkkO",
      "OddOddOYYOddO", "OOOOOOOOOOOOO", "OkOkkkkkkkOkO", "OdOdddddddOdO", ".OOOOOOOOOOO.", ".............",
    ],
    colors: { O: "#3a2414", k: "#fffaf0", d: "#ead8b2", y: "#ffc94a", Y: "#c98a1a" },
  },
];

// How to make an app password (MailStep): Google asks to confirm the sign-in with a fingerprint, a face or a passkey,
// which a desktop computer often can't give. So first which computer this is: on one that can, Google's page opens
// at once; otherwise the password is made on the phone, through the code or the address, and typed in here. A small
// board over the step with a ruled page on it, as the board's is; the page's ×, a click outside it or Escape closes
// it. Both pages are on it one over the other, the one not shown hidden, so the board is the same size for each.
// Going on to the phone, the page falls off the board and the phone's is stuck on in its place. However it closes, it
// pops away first, its backdrop with it, and only then goes. With reduced motion all of it just happens.
function AppPasswordHelp({ onClose, onTyping }: { onClose: () => void; onTyping: () => void }) {
  const { t } = useApp();
  const box = useRef<HTMLDialogElement>(null);
  const phoneView = useRef<HTMLDivElement>(null);
  const [phone, setPhone] = useState(false);
  // The page falling, and then the phone's going on while it still is.
  const [turn, setTurn] = useState<"" | "fall" | "stick">("");
  const [closing, setClosing] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    box.current?.showModal();
    return () => timers.current.forEach(clearTimeout);
  }, []);
  // Gone, and then what is to happen next, once nothing waits behind the window any more.
  const close = (then?: () => void) => {
    if (closing) return;
    const go = () => { box.current?.close(); then?.(); };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return go();
    setClosing(true);
    timers.current.push(setTimeout(go, CLOSE_MS));
  };
  const cross = (
    <button type="button" className="welcome-ask-x" aria-label={t("common.close")} onClick={() => close()}>
      <PixelArt className="welcome-ask-x-art" rows={CROSS} />
    </button>
  );
  const toPhone = () => {
    if (turn) return;
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The phone's page, its button taking the focus from the one pressed, now going.
    const show = () => {
      flushSync(() => { setPhone(true); if (!calm) setTurn("stick"); });
      phoneView.current?.querySelector<HTMLButtonElement>(".welcome-ask-foot button")?.focus();
    };
    if (calm) return show();
    setTurn("fall");
    timers.current.push(setTimeout(show, STICK_AT_MS), setTimeout(() => setTurn(""), STICK_AT_MS + STICK_MS));
  };
  return (
    <dialog ref={box} className={`welcome-ask ${closing ? "closing" : ""}`} aria-labelledby={phone ? "welcome-ask-phone-title" : "welcome-ask-title"}
      onClose={onClose} onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === box.current) close(); }}>
      {/* The interface's own words, in its direction: dir="auto" would turn a line starting with Google round. */}
      <div className={`welcome-ask-page ${turn ? "fall" : ""}`} hidden={phone && !turn}>
        <h2 id="welcome-ask-title">{t("welcome.mail.help.title")}</h2>
        {cross}
        <p>{t("welcome.mail.help.text")}</p>
        <p className="welcome-ask-q">{t("welcome.mail.help.question")}</p>
        <div className="welcome-ask-choices">
          <a className="btn" href={APP_PASSWORDS} target="_blank" rel="noopener noreferrer" onClick={() => close()}>{t("welcome.mail.help.laptop")}</a>
          <Btn onClick={toPhone}>{t("welcome.mail.help.desktop")}</Btn>
        </div>
      </div>
      <div className={`welcome-ask-page ${turn === "stick" ? "stick" : ""}`} hidden={!phone} ref={phoneView}>
        <h2 id="welcome-ask-phone-title">{t("welcome.mail.help.phoneTitle")}</h2>
        {cross}
        <div className="welcome-ask-phone">
          <img src="/app-passwords-qr.svg" width={148} height={148} alt={t("welcome.mail.help.code")} />
          {/* Each step a line, its picture at its start, the address to open by hand on a line of its own under them,
              and the button under that, beside the code. */}
          <div className="welcome-ask-steps">
            <ol>
              {PHONE_STEPS.map((step) => (
                <li key={step.key}><Sprite className="welcome-ask-icon" rows={step.rows} colors={step.colors} />{t(`welcome.mail.help.${step.key}`)}</li>
              ))}
            </ol>
            <p className="welcome-ask-or">{t("welcome.mail.help.address")} <span className="welcome-ask-url" dir="ltr">myaccount.google.com/apppasswords</span></p>
            <div className="welcome-ask-foot"><Btn kind="cta" onClick={() => close(onTyping)}>{t("welcome.mail.help.done")}</Btn></div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

// The hours of the day in the strip for the daily email's times (HourStrip), midnight first: the sky at each, and the
// night's, with stars in their sky.
const SKY = [
  "#1a1f52", "#1a1f52", "#1d2360", "#222a6e", "#2f3a8a", "#5b4a96", "#ee9b90", "#f6c28b", "#a9dcef", "#94d2ec", "#86c7e6", "#7fc2e4",
  "#7abfe3", "#7fc2e4", "#86c7e6", "#94cde8", "#a7cfe0", "#f3c26b", "#ef8f5a", "#a8578f", "#5b3f8f", "#33337a", "#262c6e", "#1f2463",
];
const NIGHT = new Set([0, 1, 2, 3, 4, 20, 21, 22, 23]);
// What flies in an hour's sky once it is picked, the moon at midnight and the sun at noon.
const HOUR_MAIL = { rows: ["OOOOOOOOO", "OOpppppOO", "OpOpppOpO", "OppOpOppO", "OpppOpppO", "OpppppppO", "OOOOOOOOO"], colors: { O: "#3a2414", p: "#fffaf0" } };
const MOON = { rows: ["..MMM.", ".MMm..", "MMm...", "MMm...", "MMm...", ".MMm..", "..MMM."], colors: { M: "#fff3c4", m: "#e8d48a" } };
const SUN = { rows: ["..Y.Y..", ".......", "Y.YYY.Y", "..YYY..", "Y.YYY.Y", ".......", "..Y.Y.."], colors: { Y: "#ffc94a" } };
const hourTime = (h: number) => `${String(h).padStart(2, "0")}:00`;

// The daily email's times on the board: a strip of the day's sky in pixels, an hour to each column with its number
// under it, from midnight at the start round to the last hour. An hour pressed lights up, an envelope flying in its
// sky, as many as wanted but one at least: taking the last away, the strip shakes its head. Times saved with minutes
// light their hour. One stop for Tab, the arrows going along it the way it runs on the screen.
function HourStrip({ times, onChange, labelledBy }: { times: string[]; onChange: (times: string[]) => void; labelledBy: string }) {
  const lit = new Set(times.map((x) => parseInt(x, 10)));
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(() => (lit.size ? Math.min(...lit) : 9));
  // Its class taken off and put back on, so that it shakes again each time.
  const no = () => {
    const el = strip.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  };
  const toggle = (h: number) => {
    setAt(h);
    if (lit.has(h)) return lit.size > 1 ? onChange(times.filter((x) => parseInt(x, 10) !== h)) : no();
    onChange([...times, hourTime(h)].sort());
  };
  const move = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const by: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
    const to = e.key === "Home" ? 0 : e.key === "End" ? 23 : e.key in by ? (at + by[e.key] + 24) % 24 : null;
    if (to === null) return;
    e.preventDefault();
    setAt(to);
    strip.current?.querySelectorAll<HTMLButtonElement>(".hour")[to]?.focus();
  };
  return (
    <div ref={strip} className="hour-strip" role="group" aria-labelledby={labelledBy}
      onAnimationEnd={(e) => { if (e.animationName === "shake") e.currentTarget.classList.remove("shake"); }}>
      {SKY.map((sky, h) => (
        <button key={h} type="button" className={`hour ${NIGHT.has(h) ? "night" : ""}`} style={{ "--sky": sky } as React.CSSProperties}
          aria-label={hourTime(h)} aria-pressed={lit.has(h)} tabIndex={h === at ? 0 : -1}
          onClick={() => toggle(h)} onKeyDown={move}>
          <span className="hour-sky">
            {lit.has(h) ? <Sprite className="hour-mail" rows={HOUR_MAIL.rows} colors={HOUR_MAIL.colors} />
              : h === 0 ? <Sprite className="hour-moon" rows={MOON.rows} colors={MOON.colors} />
              : h === 12 ? <Sprite className="hour-sun" rows={SUN.rows} colors={SUN.colors} /> : null}
          </span>
          <span className="hour-n"><Digits n={h} /></span>
        </button>
      ))}
    </div>
  );
}

// Claude's quota, in the note under the hours once more are picked than are advised: a battery whose four bars
// drain as more are picked, three of them at four to six hours a day and one fewer every three hours more, in hotter
// colours, empty from thirteen.
const BATTERY = [
  "OOOOOOOOOOOOOOO..", "O.............O..", "O.11.22.33.44.O..", "O.11.22.33.44.OOO", "O.11.22.33.44.OOO",
  "O.11.22.33.44.OOO", "O.11.22.33.44.O..", "O.............O..", "OOOOOOOOOOOOOOO..",
];
const BATTERY_BARS = ["", "#d0302f", "#f39c3c", "#ffc94a"];
const batteryBars = (hours: number) => Math.max(0, 3 - Math.floor((hours - 4) / 3));
const batteryFor = (hours: number) => BATTERY.map((row) => row.replace(/[1-4]/g, (bar) => (Number(bar) <= batteryBars(hours) ? "l" : ".")));

// The daily email on: an envelope with a green tick, beside that it is on, and when and where it goes.
const MAIL_ON = {
  rows: [
    "OOOOOOOOOOOOOOOOOOOOO...", "OOfffffffffffffffffOO...", "OpOfffffffffffffffOpO...", "OpppOfffffffffffOpppO...", "OppppOfffffffffOppppO...",
    "OpppppOfffffffOpppppO...", "OppppppOfffffOppppppO...", "OpppppppOfffOpppppppO...", "OppppppppOfOppppppppO...", "OpppppppppppppppOOOOO...",
    "OppppppppppppppOGGGGGO..", "OpppppppppppppOGGGGGGwO.", "OppppppppppppOGGGGGGwwGO", "OOOOOOOOOOOOOOGwGGGwwGGO", ".............OGwwGwwGGGO",
    ".............OGGwwwGGGGO", "..............OGGwGGGGO.", "...............OGGGGGO..", "................OOOOO...",
  ],
  colors: { O: "#3a2414", p: "#fffaf0", f: "#ead8b2", G: "#367a32", w: "#ffffff" },
};

// The daily email: the Gmail account it goes out from, and the same address to get it, and at the bottom the hours
// it runs at. Saved, the run is on; it can wait, and the settings screen turns it on later.
function MailStep({ next, back }: { next: () => void; back: () => void }) {
  const { s, t, lang, err, refresh } = useApp();
  const on = Boolean(s.settings.automation?.enabled);
  const [email, setEmail] = useState(String(s.settings.automation?.email ?? ""));
  const [password, setPassword] = useState("");
  const [help, setHelp] = useState(false);
  const passwordBox = useRef<HTMLInputElement>(null);
  const [times, setTimes] = useState<string[]>(() => (s.settings.automation?.runTimes?.length ? s.settings.automation.runTimes : ["09:00"]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("automation/mail", { user: email, password });
      await api("settings", { ...s.settings, automation: { ...s.settings.automation, enabled: true, email, runTimes: times } });
      await refresh();
      next();
    } catch (x) {
      setError(err(x));
    }
    setBusy(false);
  };
  if (on) {
    const when = s.settings.automation.runTimes?.length ? s.settings.automation.runTimes : ["09:00"];
    const hours = new Intl.ListFormat(lang, { type: "conjunction" }).format(when.map((time: string) => t("welcome.mail.atTime", { time })));
    return (
      <>
        <div className="welcome-mail-on" role="status">
          <Sprite className="welcome-mail-on-art" rows={MAIL_ON.rows} colors={MAIL_ON.colors} />
          <p><strong>{t("welcome.mail.onTitle")}</strong><span>{t("welcome.mail.onWhen", { times: hours, email: s.settings.automation.email })}</span></p>
        </div>
        <Actions back={back}><Btn kind="cta" onClick={next}>{t("welcome.next")}</Btn></Actions>
      </>
    );
  }
  return (
    <form id="welcome-mail" className="welcome-form" onSubmit={enable}>
      <div className="fields">
        <Field label={t("settings.gmail")}><input type="email" dir="ltr" autoComplete="email" placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {/* What an app password is shows where it is asked for: how to make one at the other end of its name's line
            (AppPasswordHelp), and, in the box until something is typed, that it is not the usual password. Its
            name labels the box alone, the button beside it outside the label. */}
        <div className="field">
          <span className="field-label">
            <label htmlFor="welcome-app-password">{t("settings.appPassword")}</label>
            <button type="button" className="welcome-help" onClick={() => setHelp(true)}>{t("welcome.mail.how")}</button>
          </span>
          <input id="welcome-app-password" ref={passwordBox} type="password" dir={password ? "ltr" : undefined} autoComplete="off" placeholder={t("welcome.mail.notUsual")}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <span className="field-label" id="welcome-hours">{t("settings.runTimes")}</span>
        <HourStrip times={times} onChange={setTimes} labelledBy="welcome-hours" />
      </div>
      {times.length > RUN_TIMES_ADVISED && (
        <div className="welcome-hours-note" role="status">
          <Sprite className="welcome-hours-battery" rows={batteryFor(times.length)} colors={{ O: "#3a2414", l: BATTERY_BARS[batteryBars(times.length)] }} />
          <p><strong>{t("settings.runTimesManyTitle")}</strong><span>{t("settings.runTimesManyWhy")} <b>{t("settings.runTimesManyQuota")}</b></span></p>
        </div>
      )}
      {help && <AppPasswordHelp onClose={() => setHelp(false)} onTyping={() => passwordBox.current?.focus()} />}
      {error && <p className="error-line" role="alert" dir="auto">{error}</p>}
      <Actions back={back} note={<button type="button" className="welcome-link" onClick={next}>{t("welcome.mail.later")}</button>}>
        <Btn kind="cta" type="submit" form="welcome-mail" disabled={busy || !email.trim() || !password}>{t("welcome.mail.enable")}</Btn>
      </Actions>
    </form>
  );
}

// Pip's paw stamped in ink at the end, as a real one is and not drawn in the board's pixels: the big pad and four
// toes, their edges ragged, the ink solid but thinner in patches and with the paper showing through in a few specks,
// some spatters, and a faint smear where it slid; the word across the pad in the paper's colour, a little ragged too.
function PawStamp({ word }: { word: string }) {
  return (
    <svg className="welcome-paw-art" viewBox="0 0 140 130">
      <defs>
        <filter id="paw-ink" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves={2} seed={4} result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale={7} xChannelSelector="R" yChannelSelector="G" result="ragged" />
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={1} seed={10} result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  6 0 0 0 -1.2" result="specks" />
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={1} seed={22} result="patch" />
          <feColorMatrix in="patch" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.4 0 0 0 0.45" result="density" />
          <feComposite in="ragged" in2="specks" operator="in" result="specked" />
          <feComposite in="specked" in2="density" operator="in" />
        </filter>
        <filter id="paw-word" x="-10%" y="-30%" width="120%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.12" numOctaves={1} seed={6} result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale={1.6} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <g filter="url(#paw-ink)" fill="#9e1f16">
        <path opacity={0.25} d="M48 96 C47 74 62 69 75 75 C88 69 104 74 104 96 C104 113 90 119 75 113 C60 119 48 113 48 96 Z" />
        <ellipse cx={32} cy={46} rx={12} ry={15.5} transform="rotate(-24 32 46)" />
        <ellipse cx={56} cy={27} rx={12.5} ry={16} transform="rotate(-8 56 27)" />
        <ellipse cx={84} cy={27} rx={12.5} ry={16} transform="rotate(9 84 27)" />
        <ellipse cx={108} cy={47} rx={12} ry={15.5} transform="rotate(25 108 47)" />
        <path d="M38 90 C37 64 55 59 70 66 C85 59 103 64 102 90 C102 109 86 115 70 109 C54 115 38 109 38 90 Z" />
        {[[16, 70, 3], [22, 80, 1.6], [121, 76, 2.4], [127, 66, 1.4], [70, 4, 1.8], [96, 8, 1.2], [112, 104, 2.8], [118, 112, 1.5]].map(([cx, cy, r]) => (
          <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} />
        ))}
        <ellipse cx={29} cy={104} rx={4} ry={1.6} transform="rotate(30 29 104)" />
      </g>
      <text className="welcome-paw-word" filter="url(#paw-word)" x={70} y={97} textAnchor="middle" transform="rotate(-6 70 90)">{word}</text>
    </svg>
  );
}

// The board taking the blow as the end's stamp lands: pressed down a little and back up, past where it was, quickly.
const thud = (el: Element) => el.closest(".welcome-board")?.animate(
  [{ translate: "0 0" }, { translate: "0 6px", offset: 0.3 }, { translate: "0 -2px", offset: 0.7 }, { translate: "0 0" }],
  { duration: 260, easing: "ease-out" },
);

type TicketLine = { key: string; rows: string[]; label: string; text: string; quiet?: boolean };

// Words on the ticket in the board's pixel font, which runs the way the page does whatever language they start in;
// their numbers and times in its pixel digits (Digits), as the font's own 0 looks like an 8, read out as they are.
function PixelWords({ text }: { text: string }) {
  return <>{text.split(/(\d+(?::\d+)?)/).map((part, i) => (i % 2 ? <span key={i} className="welcome-ticket-num" role="img" aria-label={part}><Digits n={part} /></span> : part))}</>;
}

// The end's ticket for the road (Welcome, every step done), pinned to the board in the notebook page's place: the
// title, then where Pip is headed, what is packed, who navigates and the postcard home, a line each with the points'
// pictures, coming in one after another (--i) once he holds his bag open (ready), each tossing its picture into it
// as it starts to (toss); on its stub, past the line it tears off along, when it leaves (or whenever wanted, with the
// daily run off), with a barcode; then his paw stamped on it (stamped, once it has come down).
function Ticket({ title, lines, leaves, ready, toss, stamped }: {
  title: string; lines: TicketLine[]; leaves: { day: "now" | "today" | "tomorrow"; time: string } | null; ready: boolean;
  toss: (picture: Element | null) => void; stamped: (paw: Element) => void;
}) {
  const { t } = useApp();
  return (
    <div className={`welcome-ticket ${ready ? "go" : ""}`} role="group" aria-label={t("welcome.done.ticket.label")} style={{ "--n": lines.length } as React.CSSProperties}>
      <div className="welcome-ticket-main">
        <h1 id="welcome-title" dir="auto"><span className="welcome-mark">{title}</span></h1>
        <ul className="welcome-points welcome-ticket-lines">
          {lines.map((line, i) => (
            <li key={line.key} data-point={line.key} className={line.quiet ? "quiet" : ""} style={{ "--i": i } as React.CSSProperties}
              onAnimationStart={(e) => { if (e.target === e.currentTarget) toss(e.currentTarget.querySelector(".welcome-point")); }}>
              <PixelArt className="welcome-point" rows={line.rows} />
              <b>{line.label}</b>
              <span><PixelWords text={line.text} /></span>
            </li>
          ))}
        </ul>
      </div>
      <div className="welcome-ticket-stub">
        <Sprite className="welcome-ticket-notch" rows={NOTCH.rows} colors={NOTCH.colors} />
        <Sprite className="welcome-ticket-notch bottom" rows={NOTCH.rows} colors={NOTCH.colors} />
        <span className="welcome-ticket-leaves">{t("welcome.done.ticket.leaves")}</span>
        <strong dir="auto">{t(`welcome.done.ticket.${leaves?.day ?? "whenever"}`)}</strong>
        {leaves && leaves.day !== "now" && <span className="welcome-ticket-time" role="img" aria-label={leaves.time}><Digits n={leaves.time} /></span>}
        <PixelArt className="welcome-ticket-code" rows={BARCODE} />
      </div>
      <span className="welcome-paw" aria-hidden="true" onAnimationEnd={(e) => { if (e.animationName === "paw-down") stamped(e.currentTarget); }}>
        <PawStamp word={t("welcome.done.stamp")} />
      </span>
    </div>
  );
}

export function Welcome() {
  const { s, t, lang, refresh } = useApp();
  const logins = s.aiLogins ?? {};
  const done: Record<Step, boolean> = {
    hello: Boolean(s.intro?.name),
    name: Boolean(s.intro?.name),
    ai: Boolean(logins.claude || logins.openai || s.aiKeys.openai),
    cv: s.profileReady,
    search: s.settings.markets?.length > 0 && s.settings.roles?.length > 0,
    mail: Boolean(s.settings.automation?.enabled),
    done: false,
  };
  // It opens where it was left: the first step still to do.
  const [step, setStep] = useState<Step>(() => (!done.name ? "hello" : (["ai", "cv", "search"] as Step[]).find((x) => !done[x]) ?? "mail"));
  const at = STEPS.indexOf(step);
  // The end names what is still to do, if anything, with a way back to each; it can still be finished. With every
  // step done it has a ticket for the road instead (Ticket), filled in while Pip packs, and stamped with his paw;
  // then he sets off (useStepChange).
  const missing = (["name", "ai", "cv", "search"] as Step[]).filter((x) => !done[x]);
  const goTo = useStepChange(step, setStep, missing.length ? null : "done");
  const [foot, setFoot] = useState<HTMLDivElement | null>(null);
  // What the CV step's conversation is, while it shows one: the words over it are about it, not the files.
  const [cvTalk, setCvTalk] = useState("");
  const go = (i: number) => goTo.to(STEPS[Math.max(0, Math.min(STEPS.length - 1, i))]);
  // When the next search is, for the end's ticket to say (automation.ts nextRun); none while the daily run is off.
  const [nextSearch, setNextSearch] = useState<{ day: "now" | "today" | "tomorrow"; time: string } | null>(null);
  useEffect(() => {
    if (step === "done") api("automation").then((a) => setNextSearch(a.next ?? null)).catch(() => setNextSearch(null));
  }, [step]);
  // The forest's birds while they fly up from round the board, after the end's stamp lands.
  const [birds, setBirds] = useState<Bird[] | null>(null);
  useEffect(() => {
    if (!birds) return;
    const gone = setTimeout(() => setBirds(null), BIRDS_MS);
    return () => clearTimeout(gone);
  }, [birds]);
  const next = () => go(at + 1);
  const back = () => go(at - 1);
  const finish = async () => {
    await api("intro/done", {}).catch(() => {});
    await refresh();
    location.hash = "#/dash";
  };
  const almost = step === "done" && missing.length > 0;
  const ending = step === "done" && !almost;
  const title = t(almost ? "welcome.done.almostTitle" : `welcome.${step}.title`);
  // The opening has its list of points instead, and the end its ticket.
  const text = step === "hello" || ending ? "" : String(t(almost ? "welcome.done.missing" : step === "cv" && cvTalk ? `welcome.cv.talk.${cvTalk}` : `welcome.${step}.text`));
  // What the end's ticket says, a line each: what is looked for, the CV packed, the AI navigating, and the daily email
  // as a postcard home, or quieter that it is off; and on its stub when the next search is, worked out here from the
  // run times when the server doesn't say.
  const roles: string[] = (s.settings.roles ?? []).map((r: Role) => r.label);
  const hours: string[] = s.settings.automation?.runTimes ?? [];
  const mailOn = Boolean(s.settings.automation?.enabled);
  const ai = s.settings.aiPrimary === "openai" || (!logins.claude && (logins.openai || s.aiKeys.openai)) ? "ChatGPT" : "Claude";
  const tk = (key: string, vars?: Record<string, string | number>) => String(t(`welcome.done.ticket.${key}`, vars));
  const ticket: TicketLine[] = !ending ? [] : [
    { key: "search", rows: FIND, label: tk("search"), text: roles.length > 2 ? tk("more", { list: roles.slice(0, 2).join(", "), n: roles.length - 2 }) : roles.join(", ") },
    { key: "cv", rows: point("cv"), label: tk("cv"), text: tk("cvText") },
    { key: "ai", rows: SPARK, label: tk("ai"), text: ai },
    mailOn
      ? {
        key: "mail", rows: point("mail"), label: tk("mail"),
        text: hours.length >= RUN_TIMES ? tk("mailHourly") : hours.length > RUN_TIMES_ADVISED ? tk("mailMany", { n: hours.length })
          : tk("mailText", { hours: new Intl.ListFormat(lang, { type: "conjunction" }).format(hours.map((time) => t("welcome.mail.atTime", { time }))) }),
      }
      : { key: "mail", rows: point("mail"), label: tk("mail"), text: tk("mailOff"), quiet: true },
  ];
  const leaves = mailOn ? nextSearch ?? nextFrom(hours) : null;
  // The ticket stamped: the board takes the blow, the forest's birds fly up out of the trees round it (those with
  // room on the screen), and a moment after Pip sets off.
  const stamped = (paw: Element) => {
    thud(paw);
    const b = paw.closest(".welcome-board")?.getBoundingClientRect();
    if (b) {
      setBirds(FLOCK.map((f) => {
        const width = 44 * f.size;
        return { left: f.side < 0 ? b.left - f.x - width : b.right + f.x, top: b.top + f.y, width, dx: f.side * f.out, dy: -f.up, after: f.after };
      }).filter((x) => x.left >= 0 && x.left + x.width <= innerWidth));
    }
    goTo.off(JUMP_AFTER_MS);
  };
  const setup = s.sessions.filter((x) => /^\/setup\b/.test(x.title)).sort((a, b) => b.createdAt - a.createdAt)[0];
  // Pip reading the CV, in the background of the steps after it, until the profile is saved: working while /setup
  // runs, and otherwise waiting for the user (an approval, his questions, or a run that stopped).
  const reading: "" | "work" | "ask" = !setup || s.profileReady ? "" : setup.status === "running" ? "work" : "ask";
  const mood: Mood = step === "hello" ? "wave" : step === "done" ? (missing.length ? "idle" : "happy")
    : reading === "work" ? "work" : reading === "ask" ? "ask" : "idle";
  const body: Record<Step, React.ReactNode> = {
    hello: <Actions><Btn kind="cta" autoFocus onClick={next}>{t("welcome.hello.go")}</Btn></Actions>,
    name: <NameStep next={next} back={back} />,
    ai: <AiStep next={next} back={back} />,
    cv: <CvStep next={next} back={back} onConversation={setCvTalk} />,
    search: <SearchStep next={next} back={back} />,
    mail: <MailStep next={next} back={back} />,
    done: (
      <>
        {almost ? (
          <div className="chips welcome-missing">
            {missing.map((x) => <button key={x} type="button" className="role-pick" onClick={() => goTo.to(x)}>{t(`welcome.${x}.short`)}</button>)}
          </div>
        ) : (
          <Ticket title={title} lines={ticket} leaves={leaves} ready={goTo.ready} toss={goTo.toss} stamped={stamped} />
        )}
        <Actions back={back}><Btn kind="cta" autoFocus onClick={finish}>{t("welcome.done.go")}</Btn></Actions>
      </>
    ),
  };
  return (
    // The lists its boxes open are put here, so they take the board's look (select.tsx, styles.css).
    <div className="welcome" data-popovers="">
      <Forest />
      <main className="welcome-stage">
        {/* The board is centred in the window, as tall as its step, with Pip on its top edge; the steps under it are
            fixed on the screen (welcome-track), so they stay where they are from step to step. */}
        <div className={`welcome-center ${WIDTH[step] ?? ""} ${step === "hello" ? "fit" : ""}`}>
          {/* Off the board, so the board's flip leaves Pip as he is; hidden while he jumps (the one in goTo.flying). */}
          <span ref={goTo.perch} className={`welcome-pip ${goTo.flying ? "away" : ""}`}><Pip mood={mood} /></span>
          {/* It pops in when the page opens, like the login's; after that a new step flips it. */}
          <section ref={goTo.board} className={`welcome-board ${goTo.flip}`} aria-labelledby="welcome-title">
            {/* A board of planks with a page of a notebook pinned to it, and at the end a ticket for the road in its
                place (Ticket). The board grows with its step up to a limit;
                what does not fit, the title too, scrolls on the page, above the step's buttons on the wood under it,
                which stay put. Which step this is shows only in the track under the board. */}
            <Foot.Provider value={foot}>
              <div className="welcome-body" ref={goTo.scroller}>
                {/* The title marked over in yellow, as with a highlighter; the end's is on its ticket. */}
                {!ending && <h1 id="welcome-title" dir="auto"><span className="welcome-mark">{title}</span></h1>}
                {step === "hello" ? (
                  <>
                    <ul className="welcome-points">
                      {POINTS.map((p) => (
                        <li key={p.key} data-point={p.key}>
                          <PixelArt className={`welcome-point ${p.turn ? "icon-onward" : ""}`} rows={p.rows} />
                          <span dir="auto">{t(`welcome.hello.points.${p.key}`)}</span>
                        </li>
                      ))}
                    </ul>
                    {/* After a line left empty, the way in, with no picture. */}
                    <p className="welcome-text welcome-start" dir="auto">{t("welcome.hello.start")}</p>
                  </>
                ) : ending ? null : (
                  /* Each sentence on a line of its own. */
                  <p className="welcome-text" dir="auto">{text.split(/(?<=[.!?])\s+/).map((line, i) => <span key={i} className="hero-line">{line}</span>)}</p>
                )}
                {body[step]}
              </div>
            </Foot.Provider>
            <PageBar page={goTo.scroller} />
            <div className="welcome-foot" ref={setFoot} />
          </section>
          <ol className="welcome-track" aria-label={t("welcome.label")}>
            {STEPS.map((x, i) => (
              <li key={x} className={`${done[x] ? "done" : ""} ${x === step ? "here" : ""} ${x === "cv" && reading ? `reading ${reading}` : ""}`}>
                <button type="button" aria-current={x === step ? "step" : undefined} onClick={() => goTo.to(x)}
                  aria-label={`${i + 1}. ${t(`welcome.${x}.title`)}${x === "cv" && reading ? `, ${t(reading === "work" ? "welcome.cv.reading" : "welcome.cv.waiting")}` : ""}`}>
                  <span className="flag">
                    {done[x] && x !== step ? <Tick /> : <Digits n={i + 1} />}
                    {/* The CV's step while Pip reads it: a light blinking while he works, a red mark while he waits. */}
                    {x === "cv" && reading && <span className="welcome-track-mark" aria-hidden="true">{reading === "ask" ? "!" : ""}</span>}
                  </span>
                  <span className="welcome-track-name">{t(`welcome.${x}.short`)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </main>
      {goTo.flying && (
        <span ref={goTo.flyer} className={`welcome-pip-fly ${goTo.flying.behind ? "behind" : ""} ${goTo.scene} ${goTo.returning ? "back" : ""}`} style={{ left: goTo.flying.left, top: goTo.flying.top, width: goTo.flying.width }}>
          {goTo.scene ? <PipSetsOff scene={goTo.scene} /> : <Pip mood="happy" leaps />}
        </span>
      )}
      {/* The puff of dust he leaves as he runs off. */}
      {goTo.dust && <span className="welcome-dust" style={{ left: goTo.dust.left, top: goTo.dust.top }}><PixelArt className="welcome-dust-art" rows={DUST} /></span>}
      {/* The birds flying up out of the trees round the board as the end's stamp lands, flapping as they go. */}
      {birds?.map((b, i) => (
        <span key={i} className="welcome-bird" aria-hidden="true"
          style={{ left: b.left, top: b.top, width: b.width, animationDelay: `${b.after}ms`, "--dx": `${b.dx}px`, "--dy": `${b.dy}px` } as React.CSSProperties}>
          <svg viewBox="0 0 11 5" shapeRendering="crispEdges">
            <path className="pip-a" d={pixelPath(BIRD_UP)} fill="currentColor" />
            <path className="pip-b" d={pixelPath(BIRD_DOWN)} fill="currentColor" />
          </svg>
        </span>
      ))}
    </div>
  );
}

// One of Pip's jumps (jump.ts), moving el from one offset to another every frame, px the size of one of his
// pixels: in the air he takes his leaping pose (the class air), and his feet stay put as he squashes
// (transform-origin in the CSS). It returns how to stop it.
function leap(el: HTMLElement, from: Point, to: Point, px: number, done: () => void) {
  const path = jump(from, to, px);
  const start = performance.now();
  let frame = 0;
  const draw = (now: number) => {
    const s = (now - start) / 1000;
    const pose = path.at(s);
    el.style.translate = `${Math.round(pose.x)}px ${Math.round(pose.y)}px`;
    el.style.scale = `${pose.sx} ${pose.sy}`;
    el.classList.toggle("air", pose.air);
    if (s < path.length) frame = requestAnimationFrame(draw);
    else done();
  };
  frame = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frame);
}

// Going to another step, as the login's change of language: Pip jumps from his spot on the board down to the ground
// beside it; once he is off it the board narrows to nothing, the new step goes in and it opens again; and once he has
// landed, it is open and LINGER has passed with no other step asked for, he jumps back on, to where his spot is on the
// new step's board (wider for some). A step asked for while he waits on the ground only turns the board again, and
// if its board is wider than where he stands he hops aside first; one asked for while he is in the air or the board
// is turning goes as soon as it can (queued). His ground is the foot of the tallest board, just over the steps'
// track, so a board that grows or shrinks while he waits never leaves him standing in the air. When the board fills
// the width there is no ground beside it, so he jumps down behind it instead, to under the steps, and back up from
// behind it. While he is off the board a copy of him at a fixed place on the screen does the jumping, so the board
// changing size under him moves nothing. With reduced motion the step just changes.
// At the end (end, the last step with every other done) he doesn't jump back on after the change: he stays on the
// ground beside the board and packs to set off and look for jobs (scene). He pulls a backpack out over his head and
// holds it open, and only then does the end's ticket come in (ready), each line tossing its picture down into the bag
// as it does (toss). Once the ticket is stamped (off) he turns round, puts the bag on, and runs off the screen on his
// side of it on his two legs, leaving a puff of dust. Stamped before he is down, he pulls the bag out, holds it up and
// goes; on the board still (the end opened without a change), he jumps down first. Another step asked for brings him
// back to where he landed, to jump on from there. With no room beside the board he stays on it, and the ticket comes
// in at once.
function useStepChange(step: Step, setStep: (s: Step) => void, end: Step | null) {
  const perch = useRef<HTMLSpanElement>(null);
  const board = useRef<HTMLElement>(null);
  const flyer = useRef<HTMLSpanElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // The board pops in when the page opens, and only then: after the first flip it never pops again.
  const [flip, setFlip] = useState<"" | "pop" | "flip-out" | "flip-in">("pop");
  // Where the copy starts (left, top, width), and whether it goes behind the board.
  const [flying, setFlying] = useState<{ left: number; top: number; width: number; behind: boolean } | null>(null);
  // The step on screen, and the last one asked for while it can't go yet (queued), so a click during a change is not
  // lost.
  const current = useRef(step);
  current.current = step;
  const ends = useRef(end);
  ends.current = end;
  const queued = useRef<Step | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stop = useRef(() => {});
  // Pip off the board: the spot on it he left (where his copy starts), where he waits, as an offset from that spot,
  // the size of one of his pixels, whether he is behind the board, and what he is doing.
  const away = useRef<{ from: DOMRect; wait: Point; px: number; behind: boolean; state: "down" | "ground" | "holding" | "up" | "off" } | null>(null);
  const turning = useRef(false);
  const jumpOff = useRef(false);
  const back = useRef<ReturnType<typeof setTimeout>>();
  const calm = useRef(matchMedia("(prefers-reduced-motion: reduce)").matches).current;
  const [scene, setScene] = useState<"" | "pull" | "on" | "run">("");
  // Whether he runs back in, the other way (runBack).
  const [returning, setReturning] = useState(false);
  const [dust, setDust] = useState<{ left: number; top: number } | null>(null);
  // Setting off: whether the page is stamped while he can't go yet, and what is under way once he does.
  const wantsOff = useRef(false);
  const offing = useRef<{ timers: ReturnType<typeof setTimeout>[]; run?: Animation } | null>(null);
  // At the end: whether its ticket can come in, held back until he holds the bag open for it (or READY_BY_MS);
  // whether he holds it open now, catching what is tossed; and what is on its way through the air.
  const [ready, setReady] = useState(true);
  const readyBy = useRef<ReturnType<typeof setTimeout>>();
  const catching = useRef(false);
  const tossed = useRef(new Set<Element>());
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    clearTimeout(back.current);
    clearTimeout(readyBy.current);
    stop.current();
    offing.current?.timers.forEach(clearTimeout);
    catching.current = false;
    tossed.current.forEach((el) => el.remove());
  }, []);
  const at = (seconds: number, fn: () => void) => { timers.current.push(setTimeout(fn, seconds * 1000)); };
  // Going to the end with room beside the board: the ticket waits for him.
  const awaitBag = () => {
    setReady(false);
    clearTimeout(readyBy.current);
    readyBy.current = setTimeout(() => setReady(true), READY_BY_MS);
  };
  const letIn = () => {
    clearTimeout(readyBy.current);
    setReady(true);
  };

  // Where he waits while the board turns to next, as an offset from the spot on the board he left: beside the wider
  // of the board now and next's (its width is measured by putting its class on for a moment, in between two paints,
  // so it never shows), off its start end, where he stands, on his ground; or, with no room beside it, behind it.
  const spotFor = (next: Step, from: DOMRect) => {
    const b = board.current!.getBoundingClientRect();
    const center = board.current!.parentElement!;
    const was = center.className;
    center.classList.remove("wide", "ticket");
    if (WIDTH[next]) center.classList.add(WIDTH[next]!);
    const n = center.getBoundingClientRect();
    center.className = was;
    const left = Math.min(b.left, n.left);
    const right = Math.max(b.right, n.right);
    const rtl = getComputedStyle(board.current!).direction === "rtl";
    const room = rtl ? innerWidth - right : left;
    const gap = Math.min(GAP, room - from.width - 16);
    const behind = gap < 14;
    const tallest = parseFloat(getComputedStyle(board.current!).maxHeight);
    const ground = Number.isFinite(tallest) ? Math.max(b.bottom, innerHeight / 2 + tallest / 2) : b.bottom;
    const spot = behind
      ? { left: from.left, top: Math.min(innerHeight - from.height, b.bottom + 76) }
      : { left: rtl ? right + gap : left - gap - from.width, top: ground - from.height };
    return { wait: [spot.left - from.left, spot.top - from.top] as Point, behind };
  };

  // The board turning to next, with Pip off it: it narrows to nothing, the new step goes in and it opens again.
  const turn = (next: Step, delay: number) => {
    turning.current = true;
    at(delay, () => setFlip("flip-out"));
    at(delay + FLIP_MS / 1000, () => { setStep(next); setFlip("flip-in"); scroller.current?.scrollTo({ top: 0 }); });
    at(delay + (2 * FLIP_MS) / 1000, () => { setFlip(""); turning.current = false; settle(); });
  };

  // Once the board is open and he is on the ground: a step asked for meanwhile goes now; at the end he stays down and
  // packs (hold), or goes at once if it is stamped already; otherwise he jumps back on after LINGER, unless another
  // is asked for first.
  const settle = () => {
    const a = away.current;
    if (!a || turning.current || a.state !== "ground") return;
    const then = queued.current;
    queued.current = null;
    if (then && then !== current.current) return change(then);
    clearTimeout(back.current);
    if (current.current === ends.current && !a.behind) return wantsOff.current ? setOff() : hold();
    back.current = setTimeout(up, LINGER * 1000);
  };
  // An end that stops being one while he packs for it or waits for it on the ground (a step undone meanwhile): he
  // puts the bag away and jumps back on.
  useEffect(() => {
    if (away.current?.state === "holding" && current.current !== end) comeBack();
    settle();
  }, [end]);

  // What setting off has under way, for comeBack to stop.
  const later = (ms: number, fn: () => void) => {
    offing.current ??= { timers: [] };
    offing.current.timers.push(setTimeout(fn, ms));
  };
  // Down at the end before its ticket is in: he pulls the backpack out and holds it open, and then the ticket comes in.
  const hold = () => {
    away.current!.state = "holding";
    later(PULL_AFTER_MS, () => setScene("pull"));
    later(PULL_AFTER_MS + PACK_OUT_MS, () => {
      catching.current = true;
      letIn();
    });
  };
  // A line of the ticket come in while he holds the bag open: a copy of its picture, in its own colours alone, flies
  // from it in an arc down into the bag, smaller as it goes in, and the bag dips as it lands, with a glint over it.
  // Otherwise nothing: the line is on the ticket all the same.
  const toss = (picture: Element | null) => {
    const pack = flyer.current?.querySelector(".pip-pack");
    if (!picture || !pack || !catching.current) return;
    const from = picture.getBoundingClientRect();
    const to = pack.getBoundingClientRect();
    const copy = picture.cloneNode(true) as SVGElement;
    copy.setAttribute("class", "welcome-toss");
    Object.assign(copy.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, color: getComputedStyle(picture).color });
    document.body.append(copy);
    tossed.current.add(copy);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top - (from.top + from.height / 2);
    const path = Array.from({ length: 9 }, (_, i) => {
      const s = i / 8;
      return { translate: `${Math.round(dx * s)}px ${Math.round(dy * s - Math.sin(Math.PI * s) * TOSS_RISE)}px`, scale: `${1 - 0.4 * s}` };
    });
    copy.animate(path, { duration: TOSS_MS, easing: "ease-in" }).onfinish = () => {
      copy.remove();
      tossed.current.delete(copy);
      if (!catching.current) return;
      pack.animate([{ translate: "0 0" }, { translate: "0 1px" }, { translate: "0 0" }], { duration: 200, easing: "ease-out" });
      const glint = document.createElement("span");
      glint.className = "welcome-glint";
      const art = document.createElementNS(SVG_NS, "svg");
      art.setAttribute("viewBox", "0 0 3 3");
      art.setAttribute("shape-rendering", "crispEdges");
      const dot = document.createElementNS(SVG_NS, "path");
      dot.setAttribute("d", pixelPath(GLINT));
      dot.setAttribute("fill", "currentColor");
      art.append(dot);
      glint.append(art);
      Object.assign(glint.style, { left: `${to.right - 4}px`, top: `${to.top - 14}px` });
      glint.addEventListener("animationend", () => { glint.remove(); tossed.current.delete(glint); });
      document.body.append(glint);
      tossed.current.add(glint);
    };
  };

  // The ticket is stamped: after a moment he puts the bag he holds on and goes; still on the ground from the step's
  // change and not yet packing, he packs and goes; on the board, he jumps down off it to beside it first. Unless
  // another step has come meanwhile.
  const off = (delay: number) => {
    const at0 = current.current;
    at(delay / 1000, () => {
      if (calm || current.current !== at0 || !perch.current || !board.current) return;
      wantsOff.current = true;
      const a = away.current;
      if (a) {
        if (a.state === "holding") putOn();
        else if (a.state === "ground" && !turning.current) settle();
        return;
      }
      const from = perch.current.getBoundingClientRect();
      const spot = spotFor(current.current, from);
      if (spot.behind) { wantsOff.current = false; return; }
      away.current = { from, wait: spot.wait, px: from.width / 22, behind: false, state: "down" };
      jumpOff.current = true;
      setFlying({ left: from.left, top: from.top, width: from.width, behind: false });
    });
  };
  // From where he stands to past the screen's edge on his side, faster as he goes.
  const run = () => {
    const el = flyer.current;
    const a = away.current;
    if (!el || !a) return;
    setScene("run");
    const r = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === "rtl";
    const by = rtl ? innerWidth - r.left + 20 : -(r.right + 20);
    setDust({ left: rtl ? r.left - 24 : r.right - 16, top: r.bottom - 18 });
    later(500, () => setDust(null));
    offing.current!.run = el.animate([{ translate: `${a.wait[0]}px ${a.wait[1]}px` }, { translate: `${a.wait[0] + by}px ${a.wait[1]}px` }],
      { duration: Math.abs(by) / RUN_SPEED, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
  };
  const putOn = () => {
    away.current!.state = "off";
    wantsOff.current = false;
    catching.current = false;
    setScene("on");
    later(PUT_ON_MS, run);
  };
  const setOff = () => {
    away.current!.state = "off";
    wantsOff.current = false;
    later(PULL_AFTER_MS, () => setScene("pull"));
    later(PULL_AFTER_MS + PULL_MS, () => setScene("on"));
    later(PULL_AFTER_MS + PULL_MS + PUT_ON_MS, run);
  };
  // Back from packing or setting off, to where he waited on the ground, as he was there; the ticket no longer waits.
  const comeBack = () => {
    const o = offing.current;
    wantsOff.current = false;
    catching.current = false;
    tossed.current.forEach((el) => el.remove());
    tossed.current.clear();
    letIn();
    if (!o) return;
    o.timers.forEach(clearTimeout);
    o.run?.cancel();
    offing.current = null;
    setScene("");
    setDust(null);
    if (away.current) away.current.state = "ground";
  };
  // Run off the screen at the end, or on his way: another step asked for brings him running back in from where he
  // is, the other way, to beside the board as it turns to it, slowing as he comes; he stops in a puff of dust, the
  // bag put away, and jumps on as from any wait on the ground. With no room beside the board for it, not.
  const runBack = (next: Step) => {
    const a = away.current!;
    const el = flyer.current;
    const o = offing.current!;
    const spot = spotFor(next, a.from);
    if (!el || spot.behind) return false;
    const now = getComputedStyle(el).translate;
    const [x, y = 0] = now === "none" ? [0, 0] : now.split(" ").map(parseFloat);
    o.timers.forEach(clearTimeout);
    o.run?.cancel();
    offing.current = null;
    letIn();
    setDust(null);
    a.state = "down";
    a.wait = spot.wait;
    setReturning(true);
    el.animate([{ translate: `${x}px ${y}px` }, { translate: `${spot.wait[0]}px ${spot.wait[1]}px` }],
      { duration: Math.abs(x - spot.wait[0]) / RUN_SPEED, easing: "cubic-bezier(0, 0, 0.6, 1)" }).onfinish = () => {
      setScene("");
      setReturning(false);
      const r = el.getBoundingClientRect();
      setDust({ left: r.left + r.width / 2 - 20, top: r.bottom - 18 });
      at(0.5, () => setDust(null));
      landed();
    };
    el.style.translate = `${spot.wait[0]}px ${spot.wait[1]}px`;
    turn(next, 0);
    return true;
  };
  const landed = () => {
    if (!away.current) return;
    away.current.state = "ground";
    settle();
  };

  // He is on the ground already: the board turns at once, and if the next step's board is wider than where he
  // stands, he hops aside first, the board waiting until he is off the ground.
  const change = (next: Step) => {
    const a = away.current!;
    clearTimeout(back.current);
    const spot = spotFor(next, a.from);
    const moves = spot.behind !== a.behind || Math.abs(spot.wait[0] - a.wait[0]) > 2 || Math.abs(spot.wait[1] - a.wait[1]) > 2;
    if (moves && flyer.current) {
      const from = a.wait;
      a.wait = spot.wait;
      a.behind = spot.behind;
      a.state = "down";
      if (spot.behind) setFlying((f) => f && { ...f, behind: true });
      stop.current = leap(flyer.current, from, spot.wait, a.px, landed);
    }
    if (next === ends.current && !spot.behind) awaitBag();
    turn(next, moves ? OFF_BOARD : 0);
  };

  // He jumps back on, to his spot on the board as it is now; a step asked for meanwhile goes a moment after, once
  // his copy is gone.
  const up = () => {
    const a = away.current;
    if (!a) return;
    const done = () => {
      setFlying(null);
      away.current = null;
      const then = queued.current;
      queued.current = null;
      if (then) at(0.06, () => to(then));
    };
    const now = perch.current?.getBoundingClientRect();
    if (!flyer.current || !now) return done();
    a.state = "up";
    stop.current = leap(flyer.current, a.wait, [now.left - a.from.left, now.top - a.from.top], a.px, done);
  };

  // The jump down, once the copy is on screen.
  useLayoutEffect(() => {
    const a = away.current;
    if (!flying || !flyer.current || !a || !jumpOff.current) return;
    jumpOff.current = false;
    stop.current = leap(flyer.current, [0, 0], a.wait, a.px, landed);
  }, [flying]);

  const to = (next: Step) => {
    const a = away.current;
    wantsOff.current = false;
    if (a) {
      // Run off at the end: he runs back in for another step, and the end's own leaves him gone.
      if (offing.current?.run && (next === current.current || runBack(next))) return;
      comeBack();
      // Off the board already: from the ground the board turns now; in the air or while it turns, the step waits.
      if (a.state !== "ground" || turning.current) queued.current = next;
      else if (next !== current.current) change(next);
      return;
    }
    if (next === current.current) return;
    if (calm || !perch.current || !board.current) { setStep(next); return; }
    const from = perch.current.getBoundingClientRect();
    const spot = spotFor(next, from);
    // The sprite is 22 of his pixels wide (pip.tsx).
    away.current = { from, wait: spot.wait, px: from.width / 22, behind: spot.behind, state: "down" };
    jumpOff.current = true;
    setFlying({ left: from.left, top: from.top, width: from.width, behind: spot.behind });
    if (next === ends.current && !spot.behind) awaitBag();
    turn(next, OFF_BOARD);
  };
  return { to, off, toss, ready, perch, board, flyer, scroller, flip, flying, scene, returning, dust };
}
