# Web interface

A local interface for everything in this workspace. Double-click `start-web.cmd` in the repository root. It opens at `http://127.0.0.1:4174`, and the window must stay open while you use it.

## How it is built

The interface is React, written in `ui/`. The server bundles it into `public/build/` on every start, so there is no separate build step. Text is in `ui/i18n.ts`, in Hebrew and English, and `ui.test.ts` checks that both have the same keys. Pip, the companion, is a pixel fox in `ui/pip.tsx`, and the landscape behind the home screen is `ui/scene.tsx`. The login page, `ui/login.tsx`, opens with a pixel art scene from `ui/intro.ts`: leaves cover the screen and part to the sides, the camera pushes into the forest, Pip hops in from the edge of the screen and away into the clearing, turns round, sparks gather into the form, and Pip jumps onto it. The forest is a morning one in the light theme and a night one in the dark, and the theme button switches it on the spot. The form stands on a board drawn in the same pixels, wood and parchment in the morning, dark stone at night, and its fields and button take matching colours from \public/styles.css\. It is drawn small in flat colours on two canvases, one behind the form and one in front, and enlarged without smoothing. Pip here is the same sprite as in the app, from `foxPixels` in `ui/pip.tsx`, with a back view for hopping away. The Skip button and a reduced-motion setting both go straight to the form. The fonts are Fredoka for headings and Rubik for text, and Handjet, a pixel font with Hebrew, on the login, all served from `public/fonts/`.

The language button sets the conversation language too, through the saved settings, so sessions and the daily email follow it.

## What runs where

- **Live search** runs the portal CLIs directly and uses no Claude usage.
- **Direct edits** use no Claude usage either: the settings, the rules and profile text, the limits and banned wording, the files screen, a CV's or letter's text and rebuild, and an application's status.
- **Everything else** runs a Claude session in this folder, through the Agent SDK with your existing Claude Code login. This is for your own use. Anything shared with other people would need an API key.

## Settings

The settings screen chooses up to 3 markets (any country, an optional city, or remote), the area tiers, work mode, seniority, relocation, role shortcuts, salary, fields of interest, how to treat student positions, and the daily run. They are stored in `web/data/settings.json`.

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
