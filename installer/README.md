# The installer

`PipSetup.exe`, one file that installs Pip on a Windows computer, for the user who runs it, with no admin rights. It installs into `%LOCALAPPDATA%\Programs\Pip`:

1. The program's files, and its launcher, `Pip.exe`.
2. Bun, which the program runs on (into the program's own `runtime\bun`).
3. Python and MiKTeX, if the computer doesn't have them (for the user only).
4. The program's packages, at the versions locked in this repository.
5. Python's packages for its tools: pypdf, PyMuPDF, PyYAML and openpyxl.
6. LaTeX's packages for the CVs and letters, by building the templates' examples once. MiKTeX fetches each package they lack, so the first real CV needs nothing more.
7. A **Pip** shortcut in the Start menu, and optionally one on the desktop and one that starts Pip with Windows (for the daily searches).

The fonts are the program's own files. At the end it starts Pip: the server with no window and Pip's icon by the clock (open, or quit), then the browser on Pip's site, which the server pairs with as it starts, where the account is made and the introduction begins. While the site is out of reach, the browser opens on the computer itself instead. If the server stops with the page open, the page says so and carries on by itself when Pip is back (`Offline` in `web/ui/app.tsx`).

The installer downloads everything itself, with Inno Setup's own downloader, and refuses any file that isn't the exact one expected:

| Download | Checksum from |
|---|---|
| Bun | Its release |
| Python | The installer the Python Software Foundation signed |
| MiKTeX | miktex.org (the installer isn't signed) |

Every version was out at least two weeks when it was picked (`pip.iss`, `[Code]`). No script runs anything: the installer runs the programs themselves, so it doesn't look like the downloaders malware is made of (an earlier build that ran hidden PowerShell was taken for one by Windows Defender). Running it again over an install mends whatever step failed. Removing it (Windows' installed apps) leaves only the `user` folder, the person's own data.

It isn't signed yet. Until it is, Windows warns before running a downloaded copy, and an antivirus may still take it for something it isn't.

## Updates

Installed once, Pip keeps itself as new as its site. Each build carries its version (`version.ts`: a fingerprint of the program's files, and of each system's installer with them), written into the program as `VERSION.json`; `site/deploy.ts` puts the same on the site as `version.json`, with the SHA-256 of each download.

- **Windows:** while the server runs, the launcher (`Pip.exe`) asks the site for `version.json` a minute after it starts and then every three minutes. When the site's version isn't the installed one, it asks the server whether this is a bad time (`/update` in `web/server.ts`): a conversation running or waiting for an answer, the daily run, a search, or someone who used a page of Pip in the last five minutes (each page says so as it asks the server, every few seconds). If not, it downloads `PipSetup.exe` and checks it against the site's SHA-256. Then it tells the server, and runs the installer unseen with `/UPDATE=1`. The installer stops Pip, puts the new one in (its launcher too), leaves out LaTeX's warm-up, and starts Pip again in the background, after the packages are in. Pip is away for a few seconds. A page open meanwhile, told by the server, isn't covered: Pip peeks out from behind the sidebar to say he is updating, and once he is back that he is updated (`PeekingPip` in `web/ui/app.tsx`), and the page carries on as it was, not loaded again, and logged in still, since logins outlast the server (`web/auth.ts`). Only an update that takes over a minute and a half covers it, with "Pip is updating".
- **Mac:** a launchd service (`com.pip.update`) runs `~/Library/Pip/update.sh` every three minutes, which does the same with the site's `install.sh` and `--update`. Pip keeps running while everything comes down and stops only while its new files go in (`rsync`, keeping `user/` and the packages). An update that stops partway starts Pip again on whatever is there. The menu-bar app is made again only when what it is made of changed, since the Mac then asks once more whether Pip may ask the browser for its tab.
- A version tried and not taken is tried again only after six hours (`user/app/update.json`). The checking runs apart from the server, and a server that doesn't answer counts as not busy, so an update that broke the server is still followed by the one that mends it. On Windows a server that stops by itself within a minute of starting has the site asked at once.
- Logs: the Windows installer's in `user\app\update.log`, a Mac's in `~/Library/Logs/Pip-update.log` and `Pip-install.log`.

To try an update without touching Pip, `pip.iss` takes `AppName` and `AppId` (`ISCC /DAppName=PipTest /DAppId={{...}`), which build a copy that installs beside it. The launcher takes the site from `PIP_SITE` and how often it asks from `PIP_UPDATE_EVERY_MS`, so such a copy can be pointed at a site run locally with its own installer on it.

## On a Mac

A Mac installs from Terminal, with the command the site shows a Mac (`install-mac.sh`, which `site/deploy.ts` puts on the site as `install.sh`):

```bash
curl -fsSL https://pip-site-production-8fff.up.railway.app/install.sh | bash
```

It installs for the user alone, with no password, into `~/Library/Pip`: Bun, a Python of its own (python-build-standalone) and TinyTeX into `runtime/`, and the program's files into `app/`, from the site's `pip-app.tar.gz`, the same staged files as the Windows installer's. Each download is a fixed version, at least two weeks old when picked, checked against its SHA-256, the program's own written into the script by `deploy.ts`. Then the packages, and LaTeX's: TinyTeX doesn't fetch what a document lacks the way MiKTeX does, so building the templates' examples installs each package they lack, by the file TeX can't find. Then a launchd service (`~/Library/LaunchAgents/com.pip.server.plist`) that keeps Pip running from login, and **Pip** in the user's Applications: an AppleScript app that `osacompile` makes on the Mac itself, which shows Pip's face (the logo, drawn by `web/icon.ts`) in the menu bar from login on (a second service, `com.pip.menu`, opens it then), with a menu to open Pip or quit it, as the tray icon does on Windows. Opened by the user, it opens Pip on its site, or, with a page of it open already, brings that page's tab to the front: it asks the default browser for its tabs, if it is Safari or of Chrome's kind (the Mac asks the user once whether Pip may). When no tab of Pip is found, or the browser can't be asked, it opens one, so a click always shows Pip. Keys are sealed with a key Pip keeps in the user's keychain (`web/vault.ts`). Running the command again updates it and keeps `user/`; `| bash -s -- --uninstall` takes it away, all but `user/`. It logs to `~/Library/Logs/Pip-install.log`.

Nothing on a Mac is signed either: the files come down by curl, which macOS doesn't hold back the way it does a browser's downloads, and the app is made on the Mac itself.

## Building it

```bash
bun installer/build.ts
```

It needs [Inno Setup 6](https://jrsoftware.org/isdl.php) (or `ISCC` set to its `ISCC.exe`). The launcher is built with the C# compiler of the .NET Framework that every Windows has.

It stages the program's files as git sees them: tracked, or new and not ignored, so nothing in `user/` and no keys, PDFs or packages. It leaves out what is personal or only for working on the program: `links/`, `tests/`, `site/`, `.github/`, `assets/` and this folder. The lockfiles git ignores go with them.

It writes `installer/out/PipSetup.exe`.

## Files

- `pip.iss`: the installer. It has its pages (Hebrew or English with Windows), files and shortcuts. In `[Code]` are the steps after the files are in: Bun, Python, MiKTeX, the packages, and LaTeX's warm-up. Each does nothing if what it brings in is already there. They log to `install.log` in the installed program.
- `launcher.cs`: `Pip.exe`, what the shortcuts open. It starts the server unless it is already running, with the site's address (`Site`, as `PIP_SITE`), then asks it where to open Pip (`/open`, with the server's key): straight on the site, or on the computer while the site is out of reach. With a page of Pip open already (the server sees its own, the site the ones it tied to this computer), it brings that window to the front instead of opening a second, and picks Pip's tab first when another tab is in front of it (UI Automation, in Chrome's kind and Firefox; a minimized window's tabs can't be seen so). Clicked, it opens one anyway when no window has Pip. It shows Pip's icon by the clock while the server runs, and keeps Pip up to date meanwhile (Updates, above). `--background` starts the server alone, and `--stop` stops it.
- `art.ts`: the icon (the fox as the page shows him, from `web/icon.ts`) and the wizard's pictures, drawn from Pip's pixels, and the big icon a Mac's app icon is made of.
- `build.ts`: stages the files with their version (`version.ts`), builds the launcher and runs Inno Setup's compiler.
- `version.ts`: a build's version, for updates (above).
- `install-mac.sh`: the Mac's install, and its updates, above.
