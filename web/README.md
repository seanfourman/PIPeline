# Web interface

A local interface for everything in this workspace. Double-click `start-web.cmd` in the repository root. It opens at `http://127.0.0.1:4174`, and the window must stay open while you use it.

## How it is built

The interface is React, written in `ui/`. The server bundles it into `public/build/` on every start, so there is no separate build step. Text is in `ui/i18n.ts`, in Hebrew and English, and `ui.test.ts` checks that both have the same keys. Pip, the companion, is an abstract fox in big pixel blocks in `ui/pip.tsx`, and the home screen's banner is the login's forest at rest, drawn by `paintStill` in `ui/intro.ts`. The banner is the one part of the app in pixel art, with a board and the Handjet pixel font like the login's, and at its foot the forest dissolves into the page in a dither of pixel blocks. Along the journey at its foot Pip stands on the sign of the stage you are at; the browser remembers the stage it was last seen on, so a stage reached while you were elsewhere shows as Pip hopping on to it, a stage at a time. The jobs page is a single search box over a moving forest-rainbow glow, with the first few of your roles in a straight row of liquid-glass buttons and a + that unfolds the rest downward in a curved fan like a Dock stack. The labels open one after another and fold back in reverse order, curving inward in either language. The fan never scrolls: each column holds only what fits above the window's bottom, and the rest start another column further in. It closes on selection, an outside click, Escape or tabbing away. Arrow keys, Home and End move through the roles; reduced motion skips the animation. At the box's end, the search settings and a colour-turning sparkles button for the two searches that use Claude, and once you type, a search button flies in. When the first search of a visit starts, the box and the roles rise to the top; Pip rides up on the box for a moment, frightened and shivering, then leaps down to the bottom of the window and runs off its edge, and the results rise in one after another, as a plain list like a search engine's: each with the company's initial on a round tile in a forest colour, the title, company and place, chips for how long ago it was posted and its area, and round buttons to open the posting and to check it and apply. Saved jobs have a tab of their own. Below it the numbers sit on plain cards in the banner's colours, with a pixel outline, pixel pictures and digits, and the best jobs stand as squares on pixel shelves with no sides, a plank under each row, as many as they need; empty places on the last shelf hold dust, a mushroom or a snail with a cobweb under its end, and with no jobs Pip sleeps on the one low shelf; everything else is plain and easy to read, in Rubik, black and white like a social site, with the main buttons, links and marks of where you are in one forest colour: forest green by day, the night forest's turquoise at night. The page you are on has its sidebar icon filled. The sidebar is laid out like a social site's: Pip's head as a one-colour logo (`PipMark`, also the tab icon in orange, `public/icon.svg`), one list of icons and words, and a round button for a new conversation, with the account and a logout button at its foot, narrowing to icons only in smaller windows. Language and theme are on the settings page. The icons are Lucide (ISC licence), and the interface uses no tooltips. What Pip says after an action shows as a small notice at the bottom of the screen. Until the page is ready, with its fonts in, the state loaded and the banner painted, a loading screen in `public/index.html` shows Pip hopping beside a trail of paw prints, for at least a second; `public/boot.js` sets the theme and language before it first shows, and `ui.test.ts` checks that its fox still matches `<Pip mood="happy" />`. The login page, `ui/login.tsx`, opens with a pixel art scene from `ui/intro.ts`: leaves cover the screen and part to the sides, the camera pushes into the forest, Pip hops in from the edge of the screen and away into the clearing, turns round, sparks gather into the form, and Pip jumps onto it. The forest is a morning one in the light theme and a night one in the dark, and the theme button switches between them under leaves that close over the whole screen and part again, like at the start. The form stands on a board drawn in the same pixels, wood and parchment in the morning, dark stone at night, and its fields and button take matching colours from \public/styles.css\. It is drawn small in flat colours on two canvases, one behind the form and one in front, and enlarged without smoothing. Pip here is the same sprite as in the app, from `foxPixels` in `ui/pip.tsx`, with a back view for hopping away. A reduced-motion setting goes straight to the form. The theme and language buttons stay in the top left corner in both languages, and a new language flips the board like a sign while Pip jumps off it and back on. The fonts are Fredoka for headings and Rubik for text, and Handjet, a pixel font with Hebrew, on the login, all served from `public/fonts/`.

The language button sets the conversation language too, through the saved settings, so sessions and the daily email follow it.

## What runs where

- **Live search** runs the portal CLIs directly and uses no Claude usage.
- **Direct edits** use no Claude usage either: the settings, the rules and profile text, the limits and banned wording, the files screen, a CV's or letter's text and rebuild, and an application's status.
- **Everything else** runs a Claude session in this folder, through the Agent SDK with your existing Claude Code login. This is for your own use. Anything shared with other people would need an API key.

## Settings

The settings screen chooses up to 3 markets (any country, an optional city, or remote), the area tiers, work mode, seniority, relocation, roles (picked from a ready-made list by field in `roles.ts`, each searched with the experience level added, or typed in by hand; `/setup` picks them with `bun run web/pick-roles.ts`), salary, fields of interest, how to treat student positions, and the daily run. They are stored in `web/data/settings.json`.

Saving also rewrites the `WEB-SETTINGS` block in `CLAUDE.md` and `search-queries.md`, so `/job-scraper`, `/rank` and `/apply` follow the same choices in new conversations.

Areas match words in a job's location text, from the start of a word. A job listed as "Fürstenfeldbruck, DE" does not match "Bavaria", so list the cities that matter too. Ready-made areas exist for Israel only, in `REGION_PRESETS`.

## Direct edits

`edit.ts` holds them. Saving a document or a CV refuses a file that changed since the page loaded it, so a direct edit never overwrites a session's work. Changing a status follows `/outcome` Step 4: it adds a dated note and, on a row leaving `drafted`, sets the date to today. It does not write `outcome.md`, so use `/outcome` to record what happened in an interview or a rejection.

The limits and banned wording are in `templates/cv/one-page-clean/cv_checks.json`, which `onepage.sty` and `build.py` read at every build.

The files screen edits the commands, agents, knowledge files and CV template. The list in `FILE_GROUPS` is the only way in, so a request cannot reach any other file. `.claude/settings.json` and `policy.ts` can be read there but not saved, and the safety tools and this interface's code are not listed: those keep the approval in a conversation, because they decide what a session may do.

## The daily run

`automation.ts`, switched on in the settings screen and off by default. Once a day from the set hour it searches, ranks, drafts a CV for the best jobs through `/apply`, and emails the CVs to the candidate through `send_mail.py`. It never contacts an employer.

- It runs only while this server is running. If the server starts after the set hour, it runs then, once that day.
- Its sessions use the same `policy.ts` as any other, and anything that would ask for approval is refused instead, so a posting cannot gain more rights through it.
- A job is tried once, even when no CV comes out.
- The Gmail app password is stored in `~/.ai-job-search/mail.json`, outside the project, and the API never returns it. `.claude/settings.json` denies a session reading that folder.

## Security

- **Login:** for now the only account is `admin` with the password `admin`, set in `auth.ts`. The server checks it, and every API call and document needs the session cookie it sets. Sessions live in memory, so starting the server again asks for the login again.
- The server listens on this computer only. It checks the Host and Origin headers and requires a cookie, so other websites cannot reach it.
- `policy.ts` decides what a session may do without asking. Reading the project, research, the commands in `.claude/settings.json`, known LaTeX compiles and writing workflow output run on their own. Everything else waits for your approval in the browser. Permission mode is never bypassed.
- Conversations and the access token are stored in `web/data/`, which git ignores.

## Tests

```
cd web
bun test
```
