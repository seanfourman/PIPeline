# The site

Where Pip is used, from the computer it runs on and from a phone. Pip still runs on the computer; each computer keeps a connection open to the site, so nothing at home is opened to the internet, and the site passes along it the requests of a browser tied to that computer: everything the account holds comes from the computer, the conversations' live updates too. Only the interface's own files (the page, its code, styles and fonts) come from the site, its newest copy, so a change to the screens shows as soon as the site is deployed, without Pip on the computer installed again; a change to what Pip does on the computer still needs it updated, which it does by itself: `deploy.ts` puts the build's version beside the downloads as `version.json`, and an installed Pip that finds another version there installs it (installer/README.md, Updates).

An installed Pip pairs with the site as soon as it starts, before it has an account, and its shortcut opens it on the site: the server asks the site for a one-time code and sends the browser to `/pair/<code>`, which ties that browser to the computer as its own. The site notes when such a page last asked anything, and says so with the next code, so Pip opening again brings that page up rather than a second. The account is made there, in the app's own forest, and the computer then takes the account's name on the site. While the name is typed, the computer asks the site whether another computer has it (`/api/site/free`, with its key, a few hundred names a quarter of an hour at most); its own name counts as free, so an account made again after a forgotten password can keep it, and a new name given then replaces the old one. Any other browser, a phone's, signs in with that name and password, on the app's own sign-in; the site passes it to the computer, which checks it, and the page loads again as the computer's own. While the computer is off, the browser gets the app's screen that says so, and it carries on by itself once the computer is back. If the site is out of reach when Pip opens, Pip opens on the computer itself (`127.0.0.1`), as it always could.

## What it keeps

Only each computer's id, its account's name once it has one, and a hash of the key it connects with (`store.ts`, SQLite); the one-time codes live in memory for two minutes. No password, and none of the owner's files: those stay on the computer. Everything the browser and the computer send passes through it, so it must run behind HTTPS.

## Running it

```bash
bun site/server.ts
```

| Variable | Default | What it sets |
|---|---|---|
| `PORT` | `4180` | Where it listens |
| `DATA_DIR` | `site/data` | Where `site.db` is kept (must survive restarts and redeploys) |
| `PIP_DOWNLOAD` | `/PipSetup.exe` if there | The installer's address, for the download button on a computer. `deploy.ts` puts `installer/out/PipSetup.exe` beside the interface when it is built; with neither, the button says it is coming soon |

Until a phone reaches its computer, the site shows it the app's own interface: the sign-in, and the screen for a computer that is off. Run from the repository, that is `web/public` as the app's server last built it; deployed, a fresh copy beside `server.ts`. Its `/api/me` says `site`, so the sign-in shows the site's line and loads the page again once in. A computer that opens the site is sent to Pip on itself first: no site can look into its folders, and Pip, opened from its shortcut, knows from its own whether to begin with the introduction or the login. Signing in to another computer from there is a link away.

On the computer, `PIP_SITE` is the site's address: the installed launcher sets it, and Pip pairs with it and opens there. Run from the repository without it, Pip stays on the computer, and links from the settings (Phone access) by the account's name. Turning phone access off there keeps an installed Pip off the site too.

## On Railway

`deploy.ts` gathers the site's own files and a fresh build of the app's interface in a folder outside the repository, and uploads only that, so nothing else leaves the computer. It runs from `Dockerfile`, with Railway's settings kept on the service itself and written in `.railway/railway.ts`: built from the Dockerfile, one copy only, since the computers' connections live in its memory, and a new version taking over only once `/health` answers; restarting if it stops is Railway's own default. `DATA_DIR` points at a volume, so the records survive a redeploy.

```bash
cd site
railway init --name pip-site            # once: the project
railway add --service pip-site          # once: its service
railway service link pip-site           # once: before the volume, which needs a linked service
railway volume add --mount-path /data   # once: where site.db is kept
railway domain                          # once: its https address
bun deploy.ts --yes                     # each deploy
railway config plan                     # after changing .railway/railway.ts: what would change
railway config apply                    # and then to set it
```

Run these from PowerShell or cmd: Git Bash turns `/data` into a Windows path. `RAILWAY` names the CLI when it isn't on the PATH, and `bun deploy.ts --stage-only` gathers the folder and prints where it is, without uploading. Railway sets `PORT` and puts HTTPS in front, and the site marks its cookies Secure behind it. The settings were moved there from `railway.json` (Config as Code, which Railway reads only until 2026-12-01) on 2026-11-08. `railway config` reads `.railway/railway.ts` with Railway's SDK (`npm install` here, the `railway` package pinned in `package.json`), which runs `railway --version` by name, so the CLI must be on the PATH for it, not only in `RAILWAY`. The file leaves the service's variables alone (`managed: false`).

## Files

- `server.ts`: the routes: the app's interface and its sign-in for a phone not yet in, linking and unlinking a computer, the computers' connections, and passing a phone's requests on.
- `relay.ts`: the requests and answers along each computer's connection, streamed, a phone that leaves cancelling its request.
- `store.ts`: the linked computers.
- `deploy.ts`: the upload to Railway.
- `.railway/railway.ts`: Railway's settings for the site's service and its volume (`railway config plan` and `apply`).

The tests are in `web/remote.test.ts`, which runs the site with the app's side of the connection (`web/remote.ts`).
