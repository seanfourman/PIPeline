// Saving on its own, so nothing on the site needs a Save button: a moment after the last change, and at once when
// the thing is left (a window closed, a page changed) with a change still waiting.
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "./app";

export type SaveState = "" | "saving" | "saved" | { error: unknown };

// value is what to save, compared as JSON; save sends it, and throws when it fails. Nothing is saved until ready,
// and the first value once ready is taken as what is there already. Saves go one after another, never two at
// once, so each one starts from where the last left off. The state is for SaveNote.
export function useAutoSave<T>(value: T, save: (value: T) => Promise<unknown>, { ready = true, wait = 700 }: { ready?: boolean; wait?: number } = {}) {
  const [state, setState] = useState<SaveState>("");
  const key = JSON.stringify(value);
  const saved = useRef<string>();
  const waiting = useRef<{ value: T; key: string } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const send = useRef(save);
  send.current = save;
  const run = (v: T, k: string) => {
    queue.current = queue.current.then(async () => {
      setState("saving");
      try {
        await send.current(v);
        saved.current = k;
        setState("saved");
      } catch (error) {
        setState({ error });
      }
    });
  };
  // A change still waiting, sent now.
  const flush = () => {
    const w = waiting.current;
    waiting.current = null;
    if (w && w.key !== saved.current) run(w.value, w.key);
  };
  useEffect(() => {
    // No longer ready (an editor closed): what was waiting goes now.
    if (!ready) { flush(); return; }
    if (saved.current === undefined) { saved.current = key; return; }
    // Changed back to what was saved: nothing waits any more.
    if (key === saved.current) { waiting.current = null; return; }
    waiting.current = { value, key };
    const timer = setTimeout(flush, wait);
    return () => clearTimeout(timer);
  }, [key, ready]);
  // Left with a change still waiting: sent now, with nobody left to show how it went.
  useEffect(() => flush, []);
  return state;
}

// Saving shows nothing while it goes well; only a save that failed says so, in red, until the next try.
export function SaveNote({ state }: { state: SaveState }) {
  const { t, err } = useApp();
  if (!state || state === "saving" || state === "saved") return null;
  return <span className="save-note" role="alert">{t("common.saveFailed", { error: err(state.error) })}</span>;
}
