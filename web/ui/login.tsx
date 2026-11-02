// The login. The forest, the fox and the sparks are painted by intro.ts; this file holds the form.
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "./app";
import { startIntro } from "./intro";
import { api, Btn, Field, Icon } from "./kit";

export function Login({ onDone, intro }: { onDone: () => void; intro: boolean }) {
  const { t, lang, setLang, dark, toggleTheme } = useApp();
  const [shown, setShown] = useState(false);
  const [landed, setLanded] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
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
      <header className="login-top">
        <div className="login-brand"><strong>{t("brand.name")}</strong></div>
        <div className="row">
          {!landed && <button type="button" className="skip" onClick={() => scene.current?.skip()}>{t("login.skip")}</button>}
          <div className="lang" role="group" aria-label={t("nav.language")}>
            <button type="button" aria-pressed={lang === "he"} onClick={() => setLang("he")}>עברית</button>
            <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
          </div>
          <button type="button" className="theme" onClick={toggleTheme} aria-label={dark ? t("nav.light") : t("nav.dark")}><Icon name={dark ? "sun" : "moon"} /></button>
        </div>
      </header>
      <main className="login-stage">
        <form ref={card} className={`login-card ${shown ? "show" : ""} ${shake ? "shake" : ""}`} onSubmit={submit} aria-hidden={!shown}>
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
