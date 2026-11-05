#!/bin/bash
# One-line installer for C3D MCP.app. It only DELIVERS the app (download, verify, copy, open): everything else happens inside the app.
# Files downloaded with curl carry no quarantine flag, so macOS does not show its "unidentified developer" prompt for this route.
#
#   curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/get-c3d-mcp.sh | bash
#
# Env: C3D_RELEASE_BASE (download folder URL; file:// works), C3D_APP_DEST (default /Applications, else ~/Applications), C3D_NO_OPEN=1.
set -euo pipefail

BASE="${C3D_RELEASE_BASE:-https://github.com/megatih/c3d-mcp/releases/latest/download}"
DEST="${C3D_APP_DEST:-/Applications}"
if [ ! -d "$DEST" ] || [ ! -w "$DEST" ]; then DEST="$HOME/Applications"; mkdir -p "$DEST"; fi
APP="$DEST/C3D MCP.app"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || die "C3D MCP is for macOS."
[ "$(uname -m)" = arm64 ] || die "C3D MCP needs a Mac with Apple Silicon."
[ "$(sw_vers -productVersion | cut -d. -f1)" -ge 14 ] || die "C3D MCP needs macOS 14 or newer."

TMP=$(mktemp -d "${TMPDIR:-/tmp}/c3d-get.XXXXXX")
trap 'rm -rf "${TMP:?}"' EXIT

say "Downloading C3D MCP…"
curl -fsSL "$BASE/C3D-MCP-latest.zip" -o "$TMP/app.zip" || die "download failed ($BASE/C3D-MCP-latest.zip)"
curl -fsSL "$BASE/C3D-MCP-latest.zip.sha256" -o "$TMP/app.sha256" || die "checksum download failed"
WANT=$(cut -d' ' -f1 < "$TMP/app.sha256")
GOT=$(shasum -a 256 "$TMP/app.zip" | cut -d' ' -f1)
[ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || die "checksum mismatch; nothing was installed"

ditto -x -k "$TMP/app.zip" "$TMP/x"
NEW="$TMP/x/C3D MCP.app"
[ -d "$NEW" ] || die "the download does not contain C3D MCP.app"
codesign --verify --deep --strict "$NEW" 2>/dev/null || die "the downloaded app failed its signature check; nothing was installed"

if pgrep -x C3DMCP >/dev/null 2>&1; then
  say "Quitting the running C3D MCP…"
  osascript -e 'tell application "C3D MCP" to quit' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x C3DMCP >/dev/null 2>&1 || break; sleep 1; done
  pgrep -x C3DMCP >/dev/null 2>&1 && die "C3D MCP is still running; quit it and run this again"
fi

if [ -e "$APP" ]; then
  say "Replacing the existing $APP (it goes to the Trash)…"
  TRASHED="$HOME/.Trash/C3D MCP $(date +%Y%m%d-%H%M%S).app"
  mv "$APP" "$TRASHED" || die "could not move the old app to the Trash"
fi
ditto "$NEW" "$APP"
say "Installed $APP"
if [ "${C3D_NO_OPEN:-0}" != 1 ]; then open "$APP"; say "Opened it. Everything else is set up inside the app."; fi
