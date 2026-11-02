// The login. The forest, the fox and the sparks are painted by intro.ts; this file holds the form.
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "./app";
import type { Lang } from "./i18n";
import { startIntro } from "./intro";
import { api, Btn, Field, Icon } from "./kit";

// Each half of the board's flip when the language changes; matches flip-out and flip-in in styles.css.
const FLIP_MS = 180;

export function Login({ onDone, intro }: { onDone: () => void; intro: boolean }) {
  const { t, lang, setLang, dark, toggleTheme } = useApp();
  const [shown, setShown] = useState(false);
  const [landed, setLanded] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  // While the board flips, the language picked shows on the switch before the words change.
  const [flip, setFlip] = useState<"" | "flip-out" | "flip-in">("");
  const [picked, setPicked] = useState<Lang | null>(null);
  const showing = picked ?? lang;
  const bg = useRef<HTMLCanvasElement>(null);
  const fx = useRef<HTMLCanvasElement>(null);
  const card = useRef<HTMLFormElement>(null);
  const userBox = useRef<HTMLInputElement>(null);
  const scene = useRef<ReturnType<typeof startIntro> | null>(null);

  useEffect(() => {
    const play = intro && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    scene.current = startIntro(bg.current!, fx.current!, {
      play,
      night: dark,
      card: () => card.current?.getBoundingClientRect() ?? null,
      shown: () => card.current?.classList.contains("show") ?? false,
      onCardShow: () => setShown(true),
      onLanded: () => setLanded(true),
    });
    return () => scene.current?.destroy();
  }, []);

  // The theme button turns the forest between morning and night.
  useEffect(() => { scene.current?.setNight(dark); }, [dark]);

  useEffect(() => { if (shown) userBox.current?.focus({ preventScroll: true }); }, [shown]);

  // A new language flips the board like a sign: it narrows to nothing, the words change, and it opens again
  // while Pip hops. Before the form is up, or with reduced motion, the words just change.
  const pickLang = (next: Lang) => {
    if (next === showing || flip) return;
    if (!shown || matchMedia("(prefers-reduced-motion: reduce)").matches) { setLang(next); return; }
    setPicked(next);
    setFlip("flip-out");
    scene.current?.react("hop");
    setTimeout(() => {
      setLang(next);
      setPicked(null);
      setFlip("flip-in");
      setTimeout(() => setFlip(""), FLIP_MS);
    }, FLIP_MS);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("login", { user, password });
      scene.current?.skip();
      scene.current?.react("right");
      setTimeout(onDone, 1100);
    } catch {
      setError(t("login.wrong"));
      scene.current?.react("wrong");
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setBusy(false);
    }
  };

  return (
    <div className={`login ${dark ? "" : "morning"}`}>
      <canvas ref={bg} className="intro-bg" aria-hidden="true" />
      {/* Always laid out left to right, so the buttons stay where they are when the language changes. */}
      <header className="login-top" dir="ltr">
        <div className="row">
          <button type="button" className="theme" onClick={toggleTheme} aria-label={dark ? t("nav.light") : t("nav.dark")}><Icon name={dark ? "sun" : "moon"} /></button>
          <div className="lang" role="group" aria-label={t("nav.language")} data-on={showing}>
            <button type="button" lang="en" aria-pressed={showing === "en"} onClick={() => pickLang("en")}>English</button>
            <button type="button" lang="he" aria-pressed={showing === "he"} onClick={() => pickLang("he")}>עברית</button>
          </div>
          {!landed && <button type="button" className="skip" onClick={() => scene.current?.skip()}>{t("login.skip")}</button>}
        </div>
      </header>
      <main className="login-stage">
        <form ref={card} className={`login-card ${shown ? "show" : ""} ${shake ? "shake" : ""} ${flip}`} onSubmit={submit} aria-hidden={!shown}>
          <h1>{t("login.title")}</h1>
          <p className="sub">{t("login.sub")}</p>
          <Field label={t("login.user")}>
            <input ref={userBox} type="text" autoComplete="username" dir="ltr" value={user} onChange={(e) => setUser(e.target.value)} required />
          </Field>
          <Field label={t("login.password")}>
            <input type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <p className="error-line" role="alert">{error}</p>}
          <Btn kind="primary" type="submit" className="login-submit" disabled={busy}>{t("login.submit")}</Btn>
        </form>
      </main>
      <canvas ref={fx} className="intro-fx" aria-hidden="true" />
    </div>
  );
}
