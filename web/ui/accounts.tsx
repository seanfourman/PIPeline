// Opening another account (server.ts /api/accounts/open, and /api/login with another account's name): one on this
// computer, from the account menu (AccountDialog), or on the login's board one on other computers, which joins this one
// first, all its files coming from them, sealed, through the site. Either way the server starts again with it, and the
// page waits for it to answer as that account, then opens its home page.
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "./app";
import { api, Btn, errorText, Field, Spinner, type ApiError } from "./kit";

// How long the page waits for Pip to be back with the other account before it reloads anyway.
const BACK_WITHIN_MS = 100_000;

export async function waitForAccount() {
  for (const until = Date.now() + BACK_WITHIN_MS; Date.now() < until;) {
    await new Promise((r) => setTimeout(r, 700));
    const me = await fetch("/api/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (me?.loggedIn) break;
  }
  location.href = "/";
}

// The account menu's window for one of this computer's other accounts, picked in the menu: its password asked for; or,
// for one this browser keeps a login to (remembered), none: it opens straight away, and asks for the password only if
// that login is no longer good.
export function AccountDialog({ name, remembered, onClose }: { name: string; remembered: boolean; onClose: () => void }) {
  const { t, lang } = useApp();
  const box = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [asking, setAsking] = useState(!remembered);
  const [state, setState] = useState<"" | "busy" | "switching">(remembered ? "busy" : "");
  const [error, setError] = useState("");
  const started = useRef(false);

  const open = async (withPassword: boolean) => {
    setState("busy");
    setError("");
    try {
      await api("accounts/open", withPassword ? { user: name, password } : { user: name });
      setState("switching");
      await waitForAccount();
    } catch (x) {
      const code = (x as ApiError).code;
      if (code === "password_needed") setAsking(true);
      else setError(code === "bad_login" ? t("login.wrong") : errorText(x as ApiError, lang));
      setState("");
    }
  };

  useEffect(() => {
    box.current?.showModal();
    if (remembered && !started.current) {
      started.current = true;
      open(false);
    }
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!state) open(asking);
  };

  return (
    <dialog ref={box} className="account-dialog" onClose={onClose} onCancel={(e) => { if (state) e.preventDefault(); }}>
      <form className="stack" onSubmit={submit}>
        <h2>{t("account.openTitle", { name })}</h2>
        {asking && <p className="note">{t("account.openSub")}</p>}
        {asking && (
          <Field label={t("login.password")}>
            <input type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus disabled={Boolean(state)} />
          </Field>
        )}
        {error && <p className="error-line" role="alert">{error}</p>}
        {state && (
          <p className="account-wait" role="status">
            <Spinner />{state === "switching" ? t("account.switching", { name }) : t("account.opening")}
          </p>
        )}
        {/* Opening with a login the browser keeps has nothing to press, unless it fails: then trying again or not. */}
        {(asking || error) && (
          <div className="account-actions">
            <Btn kind="primary" type="submit" disabled={Boolean(state)}>{t("login.submit")}</Btn>
            <Btn kind="ghost" onClick={() => box.current?.close()} disabled={Boolean(state)}>{t("account.cancel")}</Btn>
          </div>
        )}
      </form>
    </dialog>
  );
}
