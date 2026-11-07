// The login. The forest, the fox and the sparks are painted by intro.ts; this file holds the form. On the first visit
// (create) the same board makes the account: a name and a password, typed twice. On the site (site), a phone signs in
// here before it reaches its computer: the site passes the sign-in on (site/server.ts), and once it is in, the page
// loads again, now the computer's own. A computer that opens the site is sent to Pip on itself first ("pc"), which
// knows from its own folder whether to begin with the introduction or the login; signing in to another computer from
// there is a turn of the board away.
import React, { useEffect, useRef, useState } from "react";
import { LANGUAGES_ON, THEMES_ON, useApp } from "./app";
import type { Lang } from "./i18n";
import { startIntro } from "./intro";
import { OFF_BOARD } from "./jump";
import { api, Btn, copyText, desktopSystem, errorText, Field, Icon, isComputer, macCommand, type ApiError } from "./kit";
import { MARK, Pip } from "./pip";
import { Sprite } from "./views/home";
import { Monitor } from "./views/welcome";

// Each half of the board's flip when the language changes; matches flip-out and flip-in in styles.css.
const FLIP_MS = 180;
// The shortest password, as auth.ts takes it.
const PASSWORD_MIN = 6;

// What the site says of itself (site/server.ts): where the Windows installer is, once it is up to download, and
// whether a Mac's install is there too.
export type SiteInfo = { download: string; mac: boolean };

// A Mac's install, in place of the download: a button that copies the command for Terminal and then says so. Where
// the browser won't copy, the command shows for copying by hand.
function MacInstall() {
  const { t } = useApp();
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  const copy = () => copyText(macCommand()).then((ok) => {
    setCopied(ok ? "yes" : "no");
    if (ok) setTimeout(() => setCopied(""), 3000);
  });
  return (
    <>
      <Btn kind="primary" className="login-submit" onClick={copy}>{t(copied === "yes" ? "login.pc.macCopied" : "login.pc.macCopy")}</Btn>
      {copied === "no" && <code className="login-command" dir="ltr">{macCommand()}</code>}
    </>
  );
}

// The way to Pip on a computer, drawn on the board: the introduction's computer, its screen a desktop with Pip's
// shortcut on it, a pointer that comes to the shortcut and clicks it twice, and Pip rising onto the screen, waving,
// again and again (login-pc in styles.css). The shortcut is Pip's mark on a tile, as on the desktop.
const POINTER = ["O........", "OO.......", "OwO......", "OwwO.....", "OwwwO....", "OwwwwO...", "OwwwwwO..", "OwwwwwwO.", "OwwwwOOOO", "OwwOwO...", "OwO.OwO..", "OO..OwO..", ".....OO.."];
const SHORTCUT = (() => {
  const inner = MARK.map((row) => `Ot${row.replaceAll(".", "t")}tO`);
  const pad = `O${"t".repeat(inner[0].length - 2)}O`;
  return ["O".repeat(inner[0].length), pad, ...inner, pad, "O".repeat(inner[0].length)];
})();

function ShortcutPicture() {
  return (
    <span className="login-pc">
      <Monitor on={false}>
        <span className="login-pc-select" />
        <span className="login-pc-icon">
          <Sprite className="login-pc-mark" rows={SHORTCUT} colors={{ O: "#3a2414", t: "#fff2df", X: "#f2892e" }} />
          <b>Pip</b>
        </span>
        <Sprite className="login-pc-pointer" rows={POINTER} colors={{ O: "#2a2236", w: "#ffffff" }} />
        <span className="login-pc-pip"><Pip mood="wave" /></span>
      </Monitor>
    </span>
  );
}

export function Login({ onDone, intro, create = false, site = null }: { onDone: () => void; intro: boolean; create?: boolean; site?: SiteInfo | null }) {
  const { t, lang, setLang, dark, toggleTheme } = useApp();
  const [shown, setShown] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  // While the board flips, the language picked shows on the switch before the words change.
  const [flip, setFlip] = useState<"" | "flip-out" | "flip-in">("");
  const [picked, setPicked] = useState<Lang | null>(null);
  const showing = picked ?? lang;
  // The form's colours follow the forest, which changes under its leaves a moment after the theme button.
  const [nightShown, setNightShown] = useState(dark);
  const bg = useRef<HTMLCanvasElement>(null);
  const fx = useRef<HTMLCanvasElement>(null);
  const card = useRef<HTMLFormElement>(null);
  const userBox = useRef<HTMLInputElement>(null);
  const scene = useRef<ReturnType<typeof startIntro> | null>(null);
  // Reduced motion: no intro run, no dissolve between day and night, no flip.
  const calm = useRef(matchMedia("(prefers-reduced-motion: reduce)").matches).current;
  // Set from Pip's jump off the board until it is back on, so a second click waits for the first.
  const changing = useRef(false);
  // A computer rather than a phone or a tablet, and what it runs, for the installer to offer. Only on the site does it
  // matter.
  const [computer] = useState(isComputer);
  const [system] = useState(desktopSystem);
  const [view, setView] = useState<"pc" | "form">(site && computer ? "pc" : "form");

  useEffect(() => {
    scene.current = startIntro(bg.current!, fx.current!, {
      play: intro && !calm,
      calm,
      night: dark,
      card: () => card.current?.getBoundingClientRect() ?? null,
      shown: () => card.current?.classList.contains("show") ?? false,
      onCardShow: () => setShown(true),
      onSwap: setNightShown,
    });
    return () => scene.current?.destroy();
  }, []);

  // The theme button turns the forest between morning and night.
  useEffect(() => { scene.current?.setNight(dark); }, [dark]);

  useEffect(() => { if (shown && view === "form") userBox.current?.focus({ preventScroll: true }); }, [shown, view]);

  // Pip jumps off the board, the board flips like a sign (it narrows to nothing, what is on it changes, it opens
  // again), and Pip jumps back on. Before the form is up, or with reduced motion, it just changes.
  const turn = (change: () => void) => {
    if (!shown || calm || !scene.current) { change(); return; }
    changing.current = true;
    const at = (seconds: number, fn: () => void) => setTimeout(fn, seconds * 1000);
    const opened = OFF_BOARD + (2 * FLIP_MS) / 1000;
    scene.current.hopOff(opened, () => { changing.current = false; });
    at(OFF_BOARD, () => setFlip("flip-out"));
    at(OFF_BOARD + FLIP_MS / 1000, () => { change(); setFlip("flip-in"); });
    at(opened, () => setFlip(""));
  };
  // A new language, the one picked showing on the switch before the words change.
  const pickLang = (next: Lang) => {
    if (next === showing || changing.current) return;
    if (shown && !calm && scene.current) setPicked(next);
    turn(() => { setLang(next); setPicked(null); });
  };
  // On the site from a computer: between Pip on this computer and signing in to another.
  const toView = (next: "pc" | "form") => {
    if (next === view || changing.current) return;
    turn(() => { setView(next); setError(""); });
  };

  const refuse = (text: string) => {
    setError(text);
    scene.current?.react("wrong");
    setShake(true);
    setTimeout(() => setShake(false), 500);
    setBusy(false);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || view !== "form") return;
    if (create && password.length < PASSWORD_MIN) return refuse(t("login.short", { n: PASSWORD_MIN }));
    if (create && password !== repeat) return refuse(t("login.mismatch"));
    setBusy(true);
    setError("");
    try {
      await api(create ? "account" : "login", { user, password });
      scene.current?.skip();
      scene.current?.react("right");
      setTimeout(site ? () => location.reload() : onDone, 1100);
    } catch (x) {
      // The site can also say that the computer didn't answer, or that there were too many tries.
      const code = (x as ApiError).code;
      refuse(create || code === "login_no_pc" || code === "remote_busy" ? errorText(x as ApiError, lang) : t("login.wrong"));
    }
  };

  return (
    <div className={`login ${nightShown ? "" : "morning"}`}>
      <canvas ref={bg} className="intro-bg" aria-hidden="true" />
      {/* Always laid out left to right, so the buttons stay where they are when the language changes. Each shows
          only while it is on (app.tsx). */}
      <header className="login-top" dir="ltr">
        <div className="row">
          {THEMES_ON && <button type="button" className="theme" onClick={toggleTheme} aria-label={dark ? t("nav.light") : t("nav.dark")}><Icon name={dark ? "sun" : "moon"} /></button>}
          {LANGUAGES_ON && (
            <div className="lang" role="group" aria-label={t("nav.language")} data-on={showing}>
              <button type="button" lang="en" aria-pressed={showing === "en"} onClick={() => pickLang("en")}>English</button>
              <button type="button" lang="he" aria-pressed={showing === "he"} onClick={() => pickLang("he")}>עברית</button>
            </div>
          )}
        </div>
      </header>
      <main className="login-stage">
        <form ref={card} className={`login-card ${view === "pc" ? "pc" : ""} ${shown ? "show" : ""} ${shake ? "shake" : ""} ${flip}`} onSubmit={submit} aria-hidden={!shown}>
          {view === "pc" ? (
            <>
              <ShortcutPicture />
              <h1>{t("login.pc.title")}</h1>
              <p className="sub">{t("login.pc.text")}</p>
              {/* The install for what the computer runs, once it is up on the site; till then the button says it is
                  coming. */}
              {system === "mac"
                ? site?.mac ? <MacInstall /> : <Btn kind="primary" className="login-submit" disabled>{t("login.pc.mac")}<span className="login-soon">{t("common.soon")}</span></Btn>
                : site?.download
                  ? <a className="btn primary login-submit" href={site.download} download>{t("welcome.download.get")}</a>
                  : <Btn kind="primary" className="login-submit" disabled>{t("welcome.download.get")}<span className="login-soon">{t("common.soon")}</span></Btn>}
              <button type="button" className="login-switch" onClick={() => toView("form")}>{t("login.pc.remote")}</button>
            </>
          ) : (
            <>
              <h1>{t(create ? "login.createTitle" : "login.title")}</h1>
              <p className="sub">{t(create ? "login.createSub" : site ? "login.siteSub" : "login.sub")}</p>
              <Field label={t("login.user")}>
                <input ref={userBox} type="text" autoComplete="username" dir="ltr" value={user} onChange={(e) => setUser(e.target.value)} required />
              </Field>
              <Field label={t("login.password")}>
                {/* Pip covers its eyes while the password is typed. */}
                <input
                  type="password" autoComplete={create ? "new-password" : "current-password"} dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required
                  onFocus={() => scene.current?.cover(true)} onBlur={() => scene.current?.cover(false)}
                />
              </Field>
              {create && (
                <Field label={t("login.repeat")}>
                  <input
                    type="password" autoComplete="new-password" dir="ltr" value={repeat} onChange={(e) => setRepeat(e.target.value)} required
                    onFocus={() => scene.current?.cover(true)} onBlur={() => scene.current?.cover(false)}
                  />
                </Field>
              )}
              {error && <p className="error-line" role="alert">{error}</p>}
              <Btn kind="primary" type="submit" className="login-submit" disabled={busy}>{t(create ? "login.create" : "login.submit")}</Btn>
              {site && computer && <button type="button" className="login-switch" onClick={() => toView("pc")}>{t("login.pc.here")}</button>}
            </>
          )}
        </form>
      </main>
      <canvas ref={fx} className="intro-fx" aria-hidden="true" />
    </div>
  );
}
