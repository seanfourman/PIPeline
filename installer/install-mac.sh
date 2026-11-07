#!/bin/bash
# Pip on a Mac, for this user alone: no password, and nothing outside the user's own folders. In Terminal:
#   curl -fsSL @SITE@/install.sh | bash
# It brings in, each at a fixed version checked against its SHA-256, as the Windows installer does (pip.iss): Bun, a
# Python of its own (python-build-standalone), a small TeX (TinyTeX, whose missing packages it installs as Pip's
# templates ask for them), and the program's files from the site (site/deploy.ts writes this script there with their
# hash). Then the packages, a launchd service that keeps Pip running from login, and Pip in the user's Applications,
# which opens it, on its site. Run again, it updates, and user/ stays as it is.
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
OPENER="$HOME/Applications/Pip.app"
LOG="$HOME/Library/Logs/Pip-install.log"
GUI="gui/$(id -u)"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\nThe whole log: %s\n' "$*" "$LOG" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$GUI/$AGENT" 2>/dev/null || true
  rm -rf "$PLIST" "$OPENER" "$RUNTIME"
  [ -d "$APP" ] && find "$APP" -mindepth 1 -maxdepth 1 ! -name user -exec rm -rf {} +
  say "Pip is gone. Your own files are still in $APP/user."
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || fail "This installs Pip on a Mac."
# Apple's own chips even under Rosetta, which reports the Intel one.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then ARCH=arm64; else ARCH=x64; fi

mkdir -p "$RUNTIME" "$APP" "$HOME/Library/LaunchAgents" "$HOME/Applications" "$HOME/Library/Logs"
exec > >(tee -a "$LOG") 2>&1
printf '\n===== %s, %s\n' "$(date)" "$ARCH"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A download into TMP, refused unless its SHA-256 is the one expected.
fetch() {
  curl -fL --retry 3 --progress-bar -o "$TMP/$2" "$1" || fail "Couldn't download $1"
  [ "$(shasum -a 256 "$TMP/$2" | awk '{print $1}')" = "$3" ] || fail "$2 isn't the file it should be: its SHA-256 differs."
}

say "Pip: stopping one that runs, if any"
launchctl bootout "$GUI/$AGENT" 2>/dev/null || true

BUN="$RUNTIME/bun/bun"
if [ "$("$BUN" --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
  say "1/7 Bun $BUN_VERSION"
  if [ "$ARCH" = arm64 ]; then name=bun-darwin-aarch64; sha=$BUN_SHA256_ARM64; else name=bun-darwin-x64; sha=$BUN_SHA256_X64; fi
  fetch "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/$name.zip" bun.zip "$sha"
  unzip -q "$TMP/bun.zip" -d "$TMP/bun"
  rm -rf "$RUNTIME/bun" && mkdir -p "$RUNTIME/bun"
  mv "$TMP/bun/$name/bun" "$BUN" && chmod +x "$BUN"
else say "1/7 Bun $BUN_VERSION, there already"; fi

PY="$RUNTIME/python/bin/python3"
if [ "$("$PY" -c 'import platform; print(platform.python_version())' 2>/dev/null || true)" != "$PYTHON_VERSION" ]; then
  say "2/7 Python $PYTHON_VERSION"
  if [ "$ARCH" = arm64 ]; then triple=aarch64-apple-darwin; sha=$PYTHON_SHA256_ARM64; else triple=x86_64-apple-darwin; sha=$PYTHON_SHA256_X64; fi
  fetch "https://github.com/astral-sh/python-build-standalone/releases/download/$PYTHON_RELEASE/cpython-$PYTHON_VERSION%2B$PYTHON_RELEASE-$triple-install_only.tar.gz" python.tar.gz "$sha"
  rm -rf "$RUNTIME/python"
  tar -xzf "$TMP/python.tar.gz" -C "$RUNTIME"
else say "2/7 Python $PYTHON_VERSION, there already"; fi

TEX="$RUNTIME/TinyTeX/bin/universal-darwin"
if [ ! -x "$TEX/lualatex" ]; then
  say "3/7 TeX (TinyTeX $TINYTEX_RELEASE)"
  fetch "https://github.com/rstudio/tinytex-releases/releases/download/$TINYTEX_RELEASE/TinyTeX-1-darwin-$TINYTEX_RELEASE.tar.xz" tinytex.tar.xz "$TINYTEX_SHA256"
  mkdir -p "$TMP/tex" && tar -xJf "$TMP/tinytex.tar.xz" -C "$TMP/tex"
  rm -rf "$RUNTIME/TinyTeX"
  mv "$(find "$TMP/tex" -mindepth 1 -maxdepth 1 -type d | head -1)" "$RUNTIME/TinyTeX"
  [ -x "$TEX/lualatex" ] || fail "TinyTeX came without lualatex where it should be ($TEX)."
else say "3/7 TeX, there already"; fi

say "4/7 Pip's files"
fetch "$SITE/pip-app.tar.gz" app.tar.gz "$APP_SHA256"
find "$APP" -mindepth 1 -maxdepth 1 ! -name user -exec rm -rf {} +
tar -xzf "$TMP/app.tar.gz" -C "$APP"
mkdir -p "$APP/user/app"

export PATH="$RUNTIME/bun:$RUNTIME/python/bin:$TEX:/usr/bin:/bin:/usr/sbin:/sbin"

say "5/7 Packages"
(cd "$APP/web" && bun install --ignore-scripts) || fail "Bun couldn't install Pip's packages."
python3 "$APP/tools/install_portal_clis.py" || say "(A job site's command line didn't install; Pip runs without it.)"
python3 -m pip install --disable-pip-version-check --quiet $PYTHON_PACKAGES || fail "Python's packages didn't install."

say "6/7 TeX packages for the CV templates (the first time takes a few minutes)"
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

say "7/7 Pip, running from login on, and in Applications"
cat >"$PLIST" <<EOF
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
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$APP/user/app/server.log</string>
  <key>StandardErrorPath</key><string>$APP/user/app/server.log</string>
</dict></plist>
EOF
launchctl bootstrap "$GUI" "$PLIST" || fail "launchd didn't take Pip's service."

# The app that opens it: no window of its own, a script that starts the service if it isn't running, asks the server
# where to open Pip (/open in web/server.ts), and opens the browser there, or, with a page of it open already, brings
# the browser to the front instead.
rm -rf "$OPENER"
mkdir -p "$OPENER/Contents/MacOS" "$OPENER/Contents/Resources"
cat >"$OPENER/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Pip</string>
  <key>CFBundleDisplayName</key><string>Pip</string>
  <key>CFBundleIdentifier</key><string>com.pip.open</string>
  <key>CFBundleExecutable</key><string>Pip</string>
  <key>CFBundleIconFile</key><string>pip</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF
cat >"$OPENER/Contents/MacOS/Pip" <<'EOF'
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
    BROWSER="$("$ROOT/runtime/python/bin/python3" -c '
import os, plistlib
try:
    with open(os.path.expanduser("~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"), "rb") as f:
        print(next(h["LSHandlerRoleAll"] for h in plistlib.load(f).get("LSHandlers", []) if h.get("LSHandlerURLScheme") == "https"))
except Exception:
    pass
' 2>/dev/null)"
    open -b "${BROWSER:-com.apple.Safari}"
    ;;
  *)
    URL="$(printf '%s' "$PLAN" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')"
    open "${URL:-http://127.0.0.1:4174/?t=$TOKEN}"
    ;;
esac
EOF
chmod +x "$OPENER/Contents/MacOS/Pip"
if curl -fsSL -o "$TMP/pip.png" "$SITE/pip-icon.png"; then
  sips -s format icns "$TMP/pip.png" --out "$OPENER/Contents/Resources/pip.icns" >/dev/null 2>&1 || true
  touch "$OPENER"
fi

say "Pip is installed. It opens now, and from Pip in Applications from now on."
open "$OPENER"
