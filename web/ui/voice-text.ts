// The words of the chat's voice typing (voice.tsx), worked out apart from the page so they can be tested: the
// language the browser listens in, and what is said joined onto what the box already holds.

export type SpokenLang = "he" | "en";

// The language the browser listens in, for each.
export const LISTEN_LANG: Record<SpokenLang, string> = { he: "he-IL", en: "en-US" };

// What was said, after what is already there: its spaces made single, a space between them unless the text before
// already ends in one or in a line's end. Nothing said leaves the text as it was.
export function withSaid(before: string, said: string): string {
  const words = said.replace(/\s+/g, " ").trim();
  if (!words) return before;
  if (!before) return words;
  return /\s$/.test(before) ? before + words : `${before} ${words}`;
}
