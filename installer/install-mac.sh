#!/bin/bash
# Pip on a Mac, for this user alone: no password, and nothing outside the user's own folders. In Terminal:
#   curl -fsSL @SITE@/install.sh | bash
# It brings in, each at a fixed version checked against its SHA-256, as the Windows installer does (pip.iss): Bun, a
# Python of its own (python-build-standalone), a small TeX (TinyTeX, whose missing packages it installs as Pip's
# templates ask for them), and the program's files from the site (site/deploy.ts writes this script there with their
# hash). Then the packages, a launchd service that keeps Pip running from login, and Pip in the user's Applications:
# his face in the menu bar, from login on too, with a menu to open Pip or quit it, and opened itself, it opens Pip, on
# its site. Run again, it updates, and user/ stays as it is.
# Installed once, Pip keeps itself as new as its site: a second launchd service runs update.sh (below) every few
# minutes, which runs the site's newest copy of this script with --update when the site has another version. Then
# Pip goes on running while everything comes down, stops only while its new files go in, and opens no page.
#   curl -fsSL @SITE@/install.sh | bash -s -- --uninstall    takes it away, all but user/
set -euo pipefail

SITE="@SITE@"
APP_SHA256="@APP_SHA256@"
BUN_VERSION="1.4.4"
BUN_SHA256_ARM64="c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510"
BUN_SHA256_X64="50a3491f73abc2fe81673171a85762d3bc2cc1680ccecadd983de99adf77977e"
PYTHON_VERSION="3.14.9"
PYTHON_RELEASE="20261021"
PYTHON_SHA256_ARM64="226d696642a8a53d03b4d5b255b1c319b1575a6d44bd723a953c9f507755e36a"
PYTHON_SHA256_X64="600cf336dd007e7c72318214fd0708a56c555b516964175df4a748e4ff0487a2"
TINYTEX_RELEASE="v2026.10"
TINYTEX_SHA256="e40c294efae81026d8cc8d12c09d2dd456d268efe7fe092410478bc1973fd40f"
PYTHON_PACKAGES="pypdf==6.21.2 pymupdf==1.28.2 pyyaml==6.0.3 openpyxl==3.1.5"

ROOT="$HOME/Library/Pip"
RUNTIME="$ROOT/runtime"
APP="$ROOT/app"
AGENT="com.pip.server"
PLIST="$HOME/Library/LaunchAgents/$AGENT.plist"
MENU_AGENT="com.pip.menu"
MENU_PLIST="$HOME/Library/LaunchAgents/$MENU_AGENT.plist"
UPDATE_AGENT="com.pip.update"
UPDATE_PLIST="$HOME/Library/LaunchAgents/$UPDATE_AGENT.plist"
# How often, in seconds, the update service asks the site for its version.
UPDATE_EVERY=180
OPENER="$HOME/Applications/Pip.app"
LOG="$HOME/Library/Logs/Pip-install.log"
GUI="gui/$(id -u)"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\nThe whole log: %s\n' "$*" "$LOG" >&2; exit 1; }

UPDATE=0
case "${1:-}" in
  --uninstall)
    launchctl bootout "$GUI/$AGENT" 2>/dev/null || true
    launchctl bootout "$GUI/$UPDATE_AGENT" 2>/dev/null || true
    pkill -f "$OPENER/Contents/MacOS/" 2>/dev/null || true
    rm -rf "$PLIST" "$MENU_PLIST" "$UPDATE_PLIST" "$OPENER" "$RUNTIME" "$ROOT/open.sh" "$ROOT/front.js" "$ROOT/update.sh" "$ROOT/update-install.sh" "$ROOT/applet.sha256"
    [ -d "$APP" ] && find "$APP" -mindepth 1 -maxdepth 1 ! -name user -exec rm -rf {} +
    say "Pip is gone. Your own files are still in $APP/user."
    exit 0
    ;;
  --update) UPDATE=1 ;;
esac

[ "$(uname -s)" = "Darwin" ] || fail "This installs Pip on a Mac."
# Apple's own chips even under Rosetta, which reports the Intel one.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then ARCH=arm64; else ARCH=x64; fi

mkdir -p "$RUNTIME" "$APP" "$HOME/Library/LaunchAgents" "$HOME/Applications" "$HOME/Library/Logs"
exec > >(tee -a "$LOG") 2>&1
printf '\n===== %s, %s%s\n' "$(date)" "$ARCH" "$([ "$UPDATE" = 1 ] && echo ', update' || true)"
TMP="$(mktemp -d)"
# An update that stops partway leaves Pip running all the same, on whatever files it has.
finish() {
  local status=$?
  if [ "$UPDATE" = 1 ] && [ "$status" -ne 0 ]; then launchctl bootstrap "$GUI" "$PLIST" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap finish EXIT

# A download into TMP, refused unless its SHA-256 is the one expected.
fetch() {
  curl -fL --retry 3 --progress-bar -o "$TMP/$2" "$1" || fail "Couldn't download $1"
  [ "$(shasum -a 256 "$TMP/$2" | awk '{print $1}')" = "$3" ] || fail "$2 isn't the file it should be: its SHA-256 differs."
}
# A file of Pip's written whole and then put in place, so one that runs as it is written over goes on reading its old
# self.
put() { cat >"$1.new" && mv -f "$1.new" "$1"; }

# A first install stops a Pip that runs before anything else; an update leaves it running until its new files go in.
if [ "$UPDATE" = 0 ]; then
  say "Pip: stopping one that runs, if any"
  launchctl bootout "$GUI/$AGENT" 2>/dev/null || true
  pkill -f "$OPENER/Contents/MacOS/" 2>/dev/null || true
fi

BUN="$RUNTIME/bun/bun"
if [ "$("$BUN" --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
  say "1/8 Bun $BUN_VERSION"
  if [ "$ARCH" = arm64 ]; then name=bun-darwin-aarch64; sha=$BUN_SHA256_ARM64; else name=bun-darwin-x64; sha=$BUN_SHA256_X64; fi
  fetch "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/$name.zip" bun.zip "$sha"
  unzip -q "$TMP/bun.zip" -d "$TMP/bun"
  rm -rf "$RUNTIME/bun" && mkdir -p "$RUNTIME/bun"
  mv "$TMP/bun/$name/bun" "$BUN" && chmod +x "$BUN"
else say "1/8 Bun $BUN_VERSION, there already"; fi

PY="$RUNTIME/python/bin/python3"
if [ "$("$PY" -c 'import platform; print(platform.python_version())' 2>/dev/null || true)" != "$PYTHON_VERSION" ]; then
  say "2/8 Python $PYTHON_VERSION"
  if [ "$ARCH" = arm64 ]; then triple=aarch64-apple-darwin; sha=$PYTHON_SHA256_ARM64; else triple=x86_64-apple-darwin; sha=$PYTHON_SHA256_X64; fi
  fetch "https://github.com/astral-sh/python-build-standalone/releases/download/$PYTHON_RELEASE/cpython-$PYTHON_VERSION%2B$PYTHON_RELEASE-$triple-install_only.tar.gz" python.tar.gz "$sha"
  rm -rf "$RUNTIME/python"
  tar -xzf "$TMP/python.tar.gz" -C "$RUNTIME"
else say "2/8 Python $PYTHON_VERSION, there already"; fi

TEX="$RUNTIME/TinyTeX/bin/universal-darwin"
if [ ! -x "$TEX/lualatex" ]; then
  say "3/8 TeX (TinyTeX $TINYTEX_RELEASE)"
  fetch "https://github.com/rstudio/tinytex-releases/releases/download/$TINYTEX_RELEASE/TinyTeX-1-darwin-$TINYTEX_RELEASE.tar.xz" tinytex.tar.xz "$TINYTEX_SHA256"
  mkdir -p "$TMP/tex" && tar -xJf "$TMP/tinytex.tar.xz" -C "$TMP/tex"
  rm -rf "$RUNTIME/TinyTeX"
  mv "$(find "$TMP/tex" -mindepth 1 -maxdepth 1 -type d | head -1)" "$RUNTIME/TinyTeX"
  [ -x "$TEX/lualatex" ] || fail "TinyTeX came without lualatex where it should be ($TEX)."
else say "3/8 TeX, there already"; fi

# The new files in place of the old, all but the user's own (user/) and the packages (node_modules), which bun brings
# up to date next; a file the new version hasn't goes. An update stops Pip only from here until it runs again below.
say "4/8 Pip's files"
fetch "$SITE/pip-app.tar.gz" app.tar.gz "$APP_SHA256"
mkdir -p "$TMP/app" && tar -xzf "$TMP/app.tar.gz" -C "$TMP/app"
[ "$UPDATE" = 1 ] && { launchctl bootout "$GUI/$AGENT" 2>/dev/null || true; }
rsync -a --delete --exclude '/user/' --exclude 'node_modules/' "$TMP/app/" "$APP/" || fail "Pip's files didn't go in."
mkdir -p "$APP/user/app"

export PATH="$RUNTIME/bun:$RUNTIME/python/bin:$TEX:/usr/bin:/bin:/usr/sbin:/sbin"

say "5/8 Packages"
(cd "$APP/web" && bun install --ignore-scripts) || fail "Bun couldn't install Pip's packages."
python3 "$APP/tools/install_portal_clis.py" || say "(A job site's command line didn't install; Pip runs without it.)"
python3 -m pip install --disable-pip-version-check --quiet $PYTHON_PACKAGES || fail "Python's packages didn't install."

say "6/8 Pip, running from login on"
# The server's log beside Pip rather than in user/, which opening another account moves aside (web/accounts.ts); it
# stops with 75 to do that, and KeepAlive starts it again.
mkdir -p "$APP/logs"
put "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$AGENT</string>
  <key>ProgramArguments</key><array><string>$BUN</string><string>run</string><string>server.ts</string></array>
  <key>WorkingDirectory</key><string>$APP/web</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$PATH</string>
    <key>PIP_SITE</key><string>$SITE</string>
    <key>JOB_WEB_NO_BROWSER</key><string>1</string>
  </dict>
  <key>AssociatedBundleIdentifiers</key><array><string>com.pip.open</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$APP/logs/server.log</string>
  <key>StandardErrorPath</key><string>$APP/logs/server.log</string>
</dict></plist>
EOF
launchctl bootstrap "$GUI" "$PLIST" || fail "launchd didn't take Pip's service."

say "7/8 TeX packages for the CV templates (the first time takes a few minutes)"
tlmgr option repository ctan >/dev/null 2>&1 || true
tlmgr update --self >/dev/null 2>&1 || true
tlmgr postaction install script xetex >/dev/null 2>&1 || true
# Builds in a folder, installing the package of each file TeX says it can't find, until it builds or stops for
# another reason.
build() {
  local dir=$1 missing pkg
  shift
  for _ in $(seq 1 40); do
    if (cd "$dir" && "$@") >"$TMP/tex.log" 2>&1; then return 0; fi
    missing=$(sed -n "s/.*[Ff]ile \`\([^']*\)' not found.*/\1/p" "$TMP/tex.log" | head -1 || true)
    [ -n "$missing" ] || return 1
    pkg=$( (tlmgr search --global --file "/$missing" 2>/dev/null | grep -E '^[^[:space:]][^:]*:$' | head -1 | tr -d ':') || true)
    [ -n "$pkg" ] || return 1
    printf '  %s (for %s)\n' "$pkg" "$missing"
    tlmgr install "$pkg" >/dev/null 2>&1 || return 1
  done
  return 1
}
# One that doesn't build leaves Pip installed all the same, without what it takes to make that kind of document yet;
# the log says why.
unbuilt() { printf "\n\033[33m%s didn't build yet. Pip is installed, but makes no such documents till it does. Why:\033[0m\n" "$1"; tail -20 "$TMP/tex.log"; }
WARM="$APP/warmup/cv"
mkdir -p "$WARM"
cp "$APP/templates/user/cv/main_example.tex" "$WARM/"
build "$WARM" lualatex -interaction=nonstopmode -halt-on-error main_example.tex || unbuilt "The CV template"
build "$APP/cover_letters" xelatex -interaction=nonstopmode -halt-on-error -output-directory="$WARM" cover_example.tex || unbuilt "The cover letter template"
cp "$APP/templates/cv/one-page-clean/template.tex" "$WARM/"
# The one-page template stops at its placeholders, as it should, once its packages are in.
build "$WARM" lualatex -interaction=nonstopmode template.tex || true
rm -rf "$APP/warmup"

say "8/8 Pip in the menu bar and in Applications, and its updates"
# What opening Pip does: starts the service if it isn't running, asks the server where to open Pip (/open in
# web/server.ts), and opens the browser there; or, with a page of it open lately, brings its tab to the front
# (front.js), and opens it anyway when no tab has Pip after all (one closed a moment ago, or in a browser that can't
# be asked for its tabs), so that a click always shows it, as on Windows. Beside the app rather than in it, so that an
# update changes them without making the app again.
put "$ROOT/open.sh" <<'EOF'
#!/bin/bash
ROOT="$HOME/Library/Pip"
GUI="gui/$(id -u)"
launchctl kickstart "$GUI/com.pip.server" >/dev/null 2>&1 || launchctl bootstrap "$GUI" "$HOME/Library/LaunchAgents/com.pip.server.plist" >/dev/null 2>&1
# Its first start takes a while: it builds the interface before it takes connections.
for _ in $(seq 1 300); do nc -z 127.0.0.1 4174 >/dev/null 2>&1 && break; sleep 0.3; done
TOKEN="$(cat "$ROOT/app/user/app/token" 2>/dev/null)"
PLAN="$(curl -fsS --max-time 12 "http://127.0.0.1:4174/open?t=$TOKEN" 2>/dev/null)"
case "$PLAN" in
  *'"already":true'*)
    BROWSER="$(osascript -l JavaScript "$(dirname "$0")/front.js" 2>/dev/null)"
    if [ -n "$BROWSER" ]; then open -b "$BROWSER"; exit 0; fi
    ;;
esac
URL="$(printf '%s' "$PLAN" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')"
open "${URL:-http://127.0.0.1:4174/?t=$TOKEN}"
EOF
# The tab of a page of Pip, by its title as the page sets it (web/ui/app.tsx), in the default browser when it is
# Safari or of Chrome's kind (Chrome, Brave, Edge, Vivaldi), which can be asked for their tabs: picked, its window put
# above the browser's others, and the browser to the front. It prints the browser's id, or nothing with no tab of
# Pip. The Mac asks once whether Pip may ask the browser, with the words the app carries (below).
put "$ROOT/front.js" <<'EOF'
ObjC.import("AppKit");
const PIP = /^(\(\d+\) )?(\u05e4\u05d9\u05e4|Pip) \/ /;
const MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const CHROME = /^(com\.google\.Chrome|org\.chromium\.Chromium|com\.microsoft\.edgemac|com\.brave\.Browser|com\.vivaldi\.Vivaldi)/;
function run() {
  const at = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("https://example.com"));
  const id = at.isNil() ? "" : String($.NSBundle.bundleWithURL(at).bundleIdentifier.js || "");
  const safari = id.startsWith("com.apple.Safari");
  if (!safari && !CHROME.test(id)) return "";
  const browser = Application(id);
  if (!browser.running()) return "";
  for (const each of browser.windows.id()) {
    const w = browser.windows.byId(each);
    let titles;
    try { titles = safari ? w.tabs.name() : w.tabs.title(); } catch (e) { continue; }
    const tab = titles.findIndex((title) => PIP.test(String(title || "").replace(MARKS, "")));
    if (tab < 0) continue;
    if (safari) {
      w.currentTab = w.tabs[tab];
      try { if (w.miniaturized()) w.miniaturized = false; } catch (e) {}
    } else {
      w.activeTabIndex = tab + 1;
      try { if (w.minimized()) w.minimized = false; } catch (e) {}
    }
    try { w.index = 1; } catch (e) {}
    browser.activate();
    return id;
  }
  return "";
}
EOF
# Updates: when the site's version for a Mac (version.json, site/deploy.ts) isn't this one's (app/VERSION.json,
# installer/build.ts) and Pip isn't in the middle of something (/update in web/server.ts), the site's copy of this
# script, checked against the SHA-256 the site gives for it, runs with --update. Before it does, the server is told,
# so that the page says Pip is updating. A version tried already is tried again only after six hours; a server that
# doesn't answer isn't in the middle of anything, so an update can mend one that broke.
put "$ROOT/update.sh" <<'EOF'
#!/bin/bash
set -u
ROOT="$HOME/Library/Pip"
SITE="$1"
PIP="http://127.0.0.1:${JOB_WEB_PORT:-4174}"
field() { sed -n "s/.*\"$1\" *: *\"\([^\"]*\)\".*/\1/p"; }
MINE="$(field mac <"$ROOT/app/VERSION.json" 2>/dev/null || true)"
[ -n "$MINE" ] || exit 0
OFFER="$(curl -fsS --max-time 20 "$SITE/version.json" 2>/dev/null)" || exit 0
NEW="$(printf '%s' "$OFFER" | field mac)"
SHA="$(printf '%s' "$OFFER" | field script)"
{ [ -n "$NEW" ] && [ -n "$SHA" ] && [ "$NEW" != "$MINE" ]; } || exit 0
TRIED="$ROOT/app/user/app/update.json"
NOW="$(date +%s)"
LAST="$(cat "$TRIED" 2>/dev/null || true)"
AT="$(printf '%s' "$LAST" | field at)"
if [ "$(printf '%s' "$LAST" | field version)" = "$NEW" ] && [ $((NOW - ${AT:-0})) -lt 21600 ]; then exit 0; fi
TOKEN="$(cat "$ROOT/app/user/app/token" 2>/dev/null || true)"
case "$(curl -fsS --max-time 5 "$PIP/update?t=$TOKEN" 2>/dev/null)" in *'"busy":true'*) exit 0 ;; esac
curl -fsS --max-time 120 -o "$ROOT/update-install.sh" "$SITE/install.sh" || exit 0
[ "$(shasum -a 256 "$ROOT/update-install.sh" | awk '{print $1}')" = "$SHA" ] || exit 0
printf '{"version":"%s","at":"%s"}\n' "$NEW" "$NOW" >"$TRIED"
curl -fsS --max-time 5 -X POST "$PIP/update?t=$TOKEN" >/dev/null 2>&1 && sleep 8
printf '%s: updating to %s\n' "$(date)" "$NEW"
exec /bin/bash "$ROOT/update-install.sh" --update
EOF
put "$UPDATE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$UPDATE_AGENT</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$ROOT/update.sh</string><string>$SITE</string></array>
  <key>StartInterval</key><integer>$UPDATE_EVERY</integer>
  <key>RunAtLoad</key><true/>
  <key>AssociatedBundleIdentifiers</key><array><string>com.pip.open</string></array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/Pip-update.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/Pip-update.log</string>
</dict></plist>
EOF
# An update runs inside the update service, which goes on as it is; an install starts it afresh.
if [ "$UPDATE" = 0 ]; then
  launchctl bootout "$GUI/$UPDATE_AGENT" 2>/dev/null || true
  launchctl bootstrap "$GUI" "$UPDATE_PLIST" || say "(launchd didn't take Pip's updates; running this command again later updates it.)"
fi

# The app, from login on as well: a second service opens it then, telling it so (--args login). launchd takes it at
# the next login; this time the app is opened at the end. All three services show in the Mac's login items as Pip's
# (AssociatedBundleIdentifiers), not as the programs they run.
put "$MENU_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$MENU_AGENT</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>-a</string><string>$OPENER</string><string>--args</string><string>login</string></array>
  <key>AssociatedBundleIdentifiers</key><array><string>com.pip.open</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF

# The app: an AppleScript one, made here by osacompile (every Mac has it, and an app made on the Mac itself opens
# without Gatekeeper asking). It stays open with no window and no Dock icon, Pip's face in the menu bar (menu.png, a
# template, which the menu bar colours to suit itself), and a menu: open Pip, or quit, which stops the service and
# takes the face away, as quitting from the tray does on Windows. Opened by the user, now or later, it opens Pip
# (open.sh); opened at login, it only shows the face. Its words are in Hebrew on a Mac in Hebrew, written as the
# letters' numbers to keep the script plain ASCII for osacompile. It is made again only when what it is made of
# changed: made again, it is a new app to the Mac, which then asks once more whether Pip may ask the browser.
cat >"$TMP/pip.applescript" <<'EOF'
use AppleScript version "2.4"
use scripting additions
use framework "Foundation"
use framework "AppKit"

property statusItem : missing value

on run
	showFace()
	if ((current application's NSProcessInfo's processInfo()'s arguments()) as list) does not contain "login" then openPip()
end run

on reopen
	openPip()
end reopen

on quit
	set statusItem to missing value
	continue quit
end quit

on openFromMenu:sender
	openPip()
end openFromMenu:

on quitFromMenu:sender
	do shell script "launchctl bootout gui/$(id -u)/com.pip.server >/dev/null 2>&1 || true"
	tell me to quit
end quitFromMenu:

on openPip()
	do shell script "/bin/bash " & quoted form of ((POSIX path of (path to home folder)) & "Library/Pip/open.sh") & " >/dev/null 2>&1 &"
end openPip

on showFace()
	if statusItem is not missing value then return
	if (user locale of (system info)) starts with "he" then
		set openWords to string id {1508, 1514, 1497, 1495, 1514, 32, 1508, 1497, 1508}
		set quitWords to string id {1497, 1510, 1497, 1488, 1492}
		set tipWords to string id {1508, 1497, 1508, 32, 1508, 1493, 1506, 1500}
		set rightToLeft to true
	else
		set openWords to "Open Pip"
		set quitWords to "Quit"
		set tipWords to "Pip is running"
		set rightToLeft to false
	end if
	set statusItem to current application's NSStatusBar's systemStatusBar()'s statusItemWithLength:-1
	set faceImage to current application's NSImage's alloc()'s initWithContentsOfFile:((POSIX path of (path to me)) & "Contents/Resources/menu.png")
	if faceImage is missing value then
		statusItem's button()'s setTitle:"Pip"
	else
		faceImage's setSize:{width:18, height:15}
		faceImage's setTemplate:true
		statusItem's button()'s setImage:faceImage
	end if
	statusItem's button()'s setToolTip:tipWords
	set theMenu to current application's NSMenu's alloc()'s initWithTitle:"Pip"
	theMenu's setAutoenablesItems:false
	if rightToLeft then theMenu's setUserInterfaceLayoutDirection:1
	set openItem to current application's NSMenuItem's alloc()'s initWithTitle:openWords action:"openFromMenu:" keyEquivalent:""
	openItem's setTarget:me
	theMenu's addItem:openItem
	theMenu's addItem:(current application's NSMenuItem's separatorItem())
	set quitItem to current application's NSMenuItem's alloc()'s initWithTitle:quitWords action:"quitFromMenu:" keyEquivalent:""
	quitItem's setTarget:me
	theMenu's addItem:quitItem
	statusItem's setMenu:theMenu
end showFace
EOF
DOES="To bring Pip's tab to the front, rather than opening it again."
printf '"NSAppleEventsUsageDescription" = "%s";\n' "$DOES" >"$TMP/en.strings"
printf '"NSAppleEventsUsageDescription" = "%s";\n' '\U05db\U05d3\U05d9 \U05dc\U05d4\U05d1\U05d9\U05d0 \U05dc\U05e7\U05d3\U05de\U05ea \U05d4\U05de\U05e1\U05da \U05d0\U05ea \U05d4\U05dc\U05e9\U05d5\U05e0\U05d9\U05ea \U05e9\U05dc \U05e4\U05d9\U05e4, \U05d1\U05de\U05e7\U05d5\U05dd \U05dc\U05e4\U05ea\U05d5\U05d7 \U05d0\U05d5\U05ea\U05d4 \U05e9\U05d5\U05d1.' >"$TMP/he.strings"
bun "$APP/web/icon.ts" mac "$TMP" || say "(Pip's pictures didn't draw: the menu bar shows its name instead of its face.)"
MADE_OF="$(cat "$TMP/pip.applescript" "$TMP/en.strings" "$TMP/he.strings" "$TMP/menu.png" "$TMP/pip.png" 2>/dev/null | shasum -a 256 | awk '{print $1}')"
REMADE=0
if [ ! -d "$OPENER" ] || [ "$(cat "$ROOT/applet.sha256" 2>/dev/null || true)" != "$MADE_OF" ]; then
  REMADE=1
  pkill -f "$OPENER/Contents/MacOS/" 2>/dev/null || true
  rm -rf "$OPENER"
  osacompile -s -o "$OPENER" "$TMP/pip.applescript" || fail "osacompile couldn't make Pip's app."
  INFO="$OPENER/Contents/Info.plist"
  plutil -replace CFBundleIdentifier -string com.pip.open "$INFO"
  plutil -replace CFBundleName -string Pip "$INFO"
  plutil -replace LSUIElement -bool YES "$INFO"
  plutil -replace NSAppleEventsUsageDescription -string "$DOES" "$INFO"
  # Its icon is applet.icns, written over the one osacompile gives it, with no asset catalogue to take its place.
  plutil -remove CFBundleIconName "$INFO" >/dev/null 2>&1 || true
  rm -f "$OPENER/Contents/Resources/Assets.car"
  if [ -f "$TMP/pip.png" ]; then
    sips -s format icns "$TMP/pip.png" --out "$OPENER/Contents/Resources/applet.icns" >/dev/null 2>&1 || true
    cp "$TMP/menu.png" "$OPENER/Contents/Resources/menu.png"
  fi
  mkdir -p "$OPENER/Contents/Resources/en.lproj" "$OPENER/Contents/Resources/he.lproj"
  cp "$TMP/en.strings" "$OPENER/Contents/Resources/en.lproj/InfoPlist.strings"
  cp "$TMP/he.strings" "$OPENER/Contents/Resources/he.lproj/InfoPlist.strings"
  # Signed again, by the Mac itself, since the changes above undid osacompile's signature, which Apple's chips need.
  codesign --force --deep --sign - "$OPENER" >/dev/null 2>&1 || true
  touch "$OPENER"
  printf '%s\n' "$MADE_OF" >"$ROOT/applet.sha256"
fi

if [ "$UPDATE" = 1 ]; then
  # The face back in the menu bar if the app was made again, and no page opened.
  [ "$REMADE" = 1 ] && open -g -a "$OPENER" --args login
  say "Pip is updated."
else
  say "Pip is installed. It opens now, with its face in the menu bar (open Pip, or quit), and from Pip in Applications. From now on it keeps itself up to date."
  open "$OPENER"
fi
