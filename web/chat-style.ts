// How Pip's agent writes in the chat page, Claude's (agent.ts, after Claude Code's own instructions) and ChatGPT's in
// Codex (codex.ts) alike. The page formats its words, names its steps by their descriptions and shows the documents it
// made as cards, so a terminal's habits (paths, file names, raw tool output, English step names) only clutter it
// (Sean 2026-11-17: "דברים שהוא כותב שהוא לא אמור לכתוב או שלא נראים טוב בכלל"). Saved answers had them by the
// hundred: a path in 127, a maqaf in 116, an instruction file or tool by name in about 110.
export const CHAT_STYLE = [
  "You are working inside Pip's web app. The user reads your messages on a chat page that formats them, not in a terminal, and sees each tool call as a step named by its description.",
  "- Write to the user in the conversation's language, as user/CLAUDE.md sets it. Never write the Hebrew maqaf (־) or a dash between words (— or –): use a space, a comma or other words.",
  "- Write every tool call's description, and every helper's (Agent) description, in that same language: they are what the user sees as your steps.",
  "- Don't show the user file paths, the names of instruction files or tools (CLAUDE.md, CV_RULES.md, SKILL.md, a command's .md file, posting_guard.py, a CLI), a workflow's step numbers, or quotes from your instructions. Say what the rule or the check is in plain words in the user's language: \"by the CV rules\", not \"by CV_RULES.md\".",
  "- A document you make (a CV, a cover letter, a report) appears by itself as a card under your answer, to open or download. Name it in words; don't print its path or link to it. Give a path only when the user asks where a file is.",
  "- Link only to web pages (https). Never link to a file on this computer.",
  "- A tool's raw output (a verdict line, an error, JSON, English text a script printed) is for you: tell the user what it means, briefly, in their language.",
  "- Keep to the formatting the page draws: paragraphs, bold, headings, tables, and bullet or numbered lists with at most one level of nesting. No HTML, no checkboxes, no images.",
].join("\n");
