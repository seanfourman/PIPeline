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

## On a Mac

A Mac installs from Terminal, with the command the site shows a Mac (`install-mac.sh`, which `site/deploy.ts` puts on the site as `install.sh`):

```bash
curl -fsSL https://pip-site-production-8fff.up.railway.app/install.sh | bash
```

It installs for the user alone, with no password, into `~/Library/Pip`: Bun, a Python of its own (python-build-standalone) and TinyTeX into `runtime/`, and the program's files into `app/`, from the site's `pip-app.tar.gz`, the same staged files as the Windows installer's. Each download is a fixed version, at least two weeks old when picked, checked against its SHA-256, the program's own written into the script by `deploy.ts`. Then the packages, and LaTeX's: TinyTeX doesn't fetch what a document lacks the way MiKTeX does, so building the templates' examples installs each package they lack, by the file TeX can't find. Then a launchd service (`~/Library/LaunchAgents/com.pip.server.plist`) that keeps Pip running from login, and **Pip** in the user's Applications, a small app that opens it: on its site, or the browser to the front with a page of it open already. Keys are sealed with a key Pip keeps in the user's keychain (`web/vault.ts`). Running the command again updates it and keeps `user/`; `| bash -s -- --uninstall` takes it away, all but `user/`. It logs to `~/Library/Logs/Pip-install.log`.

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
- `launcher.cs`: `Pip.exe`, what the shortcuts open. It starts the server unless it is already running, with the site's address (`Site`, as `PIP_SITE`), then asks it where to open Pip (`/open`, with the server's key): straight on the site, or on the computer while the site is out of reach. With a page of Pip open already (the server sees its own, the site the ones it tied to this computer), it brings that window to the front instead of opening a second; clicked, it opens one anyway when no window shows Pip. It shows Pip's icon by the clock while the server runs. `--background` starts the server alone, and `--stop` stops it.
- `art.ts`: the icon and the wizard's pictures, drawn from Pip's pixels, and the big mark a Mac's app icon is made of.
- `build.ts`: stages the files, builds the launcher and runs Inno Setup's compiler.
- `install-mac.sh`: the Mac's install, above.
