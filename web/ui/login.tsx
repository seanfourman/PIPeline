// The login. The forest, the fox and the sparks are painted by intro.ts; this file holds the form. On the first visit
// (create) the same board makes the account: a name and a password, typed twice.
import React, { useEffect, useRef, useState } from "react";
import { LANGUAGES_ON, THEMES_ON, useApp } from "./app";
import type { Lang } from "./i18n";
import { startIntro } from "./intro";
import { OFF_BOARD } from "./jump";
import { api, Btn, errorText, Field, Icon, type ApiError } from "./kit";

// Each half of the board's flip when the language changes; matches flip-out and flip-in in styles.css.
const FLIP_MS = 180;
// The shortest password, as auth.ts takes it.
const PASSWORD_MIN = 6;

export function Login({ onDone, intro, create = false }: { onDone: () => void; intro: boolean; create?: boolean }) {
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

  useEffect(() => { if (shown) userBox.current?.focus({ preventScroll: true }); }, [shown]);

  // A new language: Pip jumps off the board, the board flips like a sign (it narrows to nothing, the words
  // change, it opens again), and Pip jumps back on. Before the form is up, or with reduced motion, the
  // words just change.
  const pickLang = (next: Lang) => {
    if (next === showing || changing.current) return;
    if (!shown || calm || !scene.current) { setLang(next); return; }
    changing.current = true;
    setPicked(next);
    const at = (seconds: number, fn: () => void) => setTimeout(fn, seconds * 1000);
    const opened = OFF_BOARD + (2 * FLIP_MS) / 1000;
    scene.current.hopOff(opened, () => { changing.current = false; });
    at(OFF_BOARD, () => setFlip("flip-out"));
    at(OFF_BOARD + FLIP_MS / 1000, () => { setLang(next); setPicked(null); setFlip("flip-in"); });
    at(opened, () => setFlip(""));
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
    if (busy) return;
    if (create && password.length < PASSWORD_MIN) return refuse(t("login.short", { n: PASSWORD_MIN }));
    if (create && password !== repeat) return refuse(t("login.mismatch"));
    setBusy(true);
    setError("");
    try {
      await api(create ? "account" : "login", { user, password });
      scene.current?.skip();
      scene.current?.react("right");
      setTimeout(onDone, 1100);
    } catch (x) {
      refuse(create ? errorText(x as ApiError, lang) : t("login.wrong"));
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
        <form ref={card} className={`login-card ${shown ? "show" : ""} ${shake ? "shake" : ""} ${flip}`} onSubmit={submit} aria-hidden={!shown}>
          <h1>{t(create ? "login.createTitle" : "login.title")}</h1>
          <p className="sub">{t(create ? "login.createSub" : "login.sub")}</p>
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
        </form>
      </main>
      <canvas ref={fx} className="intro-fx" aria-hidden="true" />
    </div>
  );
}
