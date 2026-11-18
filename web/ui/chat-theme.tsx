// The chat's theme on the page: the scene behind the conversation (chat-themes.ts) and the gallery it is picked from,
// a round button at the top of the chat. The pick is a convenience of this computer's, kept in its browser, and the
// chat works the same without it.
import React, { useEffect, useRef, useState } from "react";
import { useApp } from "./app";
import { CHAT_THEMES, isTheme, runScene, type ThemeId } from "./chat-themes";
import { ActLabel, Icon } from "./kit";

const KEY = "pip-chat-theme";
const read = (): ThemeId => { try { const v = localStorage.getItem(KEY); return isTheme(v) ? v : "plain"; } catch { return "plain"; } };
// One pick for the whole page: the chat's root and the gallery hear each change.
let current: ThemeId | null = null;
const listeners = new Set<(id: ThemeId) => void>();
export function useChatTheme(): [ThemeId, (id: ThemeId) => void] {
  const [id, setId] = useState<ThemeId>(() => (current ??= read()));
  useEffect(() => { listeners.add(setId); return () => { listeners.delete(setId); }; }, []);
  const pick = (next: ThemeId) => {
    current = next;
    try { localStorage.setItem(KEY, next); } catch { /* kept for this visit */ }
    for (const hear of listeners) hear(next);
  };
  return [id, pick];
}

// The scene behind the chat, filling it (styles.css .chat-backdrop), quiet in the conversation's column: as wide as
// styles.css .log-column, and a little more.
const QUIET_COLUMN = 800;
export function ChatBackdrop({ theme }: { theme: ThemeId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ref.current ? runScene(ref.current, theme, 3, QUIET_COLUMN) : undefined), [theme]);
  if (theme === "plain") return null;
  return <div className="chat-backdrop" aria-hidden="true"><canvas ref={ref} /></div>;
}

// A scene small, as it moves, on its card, in finer pixels than behind the chat, so Pip on his hill keeps his size in it.
function Preview({ id }: { id: ThemeId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ref.current ? runScene(ref.current, id, 1.5) : undefined), [id]);
  return id === "plain" ? <span className="theme-preview plain" aria-hidden="true"><i /><i /><i /></span> : <canvas ref={ref} className="theme-preview" aria-hidden="true" />;
}

// The gallery: a card for each theme, its scene moving on it, its name and whether it is light or dark; the one in use
// marked. A pick shows behind the chat at once, and the gallery stays open to try the next. It closes on Escape, on
// the button again, or on a press outside it.
export function ThemePicker() {
  const { t } = useApp();
  const [theme, pick] = useChatTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const shut = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("pointerdown", away);
    addEventListener("keydown", shut);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", shut); };
  }, [open]);
  return (
    <div className="theme-pick" ref={box}>
      <button type="button" className={`chat-theme-btn${open ? " open" : ""}`} aria-expanded={open} aria-haspopup="dialog" aria-label={t("chat.theme.button")} onClick={() => setOpen(!open)}>
        <Icon name="palette" /><ActLabel>{t("chat.theme.button")}</ActLabel>
      </button>
      {open && (
        <div className="theme-gallery" role="dialog" aria-label={t("chat.theme.title")}>
          <p className="theme-gallery-title">{t("chat.theme.title")}</p>
          <div className="theme-cards">
            {CHAT_THEMES.map(({ id, dark }) => (
              <button key={id} type="button" className={`theme-card${id === theme ? " on" : ""}`} aria-pressed={id === theme} onClick={() => pick(id)}>
                <span className="theme-frame">
                  <Preview id={id} />
                  {id === theme && <span className="theme-check"><Icon name="check" /></span>}
                </span>
                <span className="theme-name">{t(`chat.theme.names.${id}`)}</span>
                <span className="theme-tag">{t(dark ? "chat.theme.dark" : "chat.theme.light")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
