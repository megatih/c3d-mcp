#!/bin/bash
# Installs / removes the helper LaunchAgent (does not start anything unless you run `kickstart`).
#
#   helper/install-launchagent.sh install   [--app <path-to-.app>] [--socket <path>]
#   helper/install-launchagent.sh uninstall
#   helper/install-launchagent.sh start      # launchctl kickstart (RunAtLoad is false)
#
# Defaults: app = helper/build/C3D Bridge Helper.app, socket = ~/Library/Application Support/Cheetah3D/MCP/helper.sock
# (the MCP directory itself is created by the c3d-mcp Node installer, never by this script).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="dev.c3dmcp.helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
TEMPLATE="$HERE/../packaging/launchagent/$LABEL.plist.template"

ACTION="${1:-}"; shift || true
APP="$HERE/build/C3D Bridge Helper.app"
SOCKET="$HOME/Library/Application Support/Cheetah3D/MCP/helper.sock"
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="$2"; shift 2 ;;
    --socket) SOCKET="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

escape() {
  case "$1" in *'&'*|*'<'*|*'>'*) echo "path contains XML-special characters: $1" >&2; exit 2 ;; esac
  printf '%s' "$1" | sed -e 's|/|\\/|g'
}

case "$ACTION" in
  install)
    [ -x "$APP/Contents/MacOS/C3DBridgeHelper" ] || { echo "helper app not built: $APP (run helper/build-app.sh)" >&2; exit 1; }
    escape "$APP" >/dev/null; escape "$SOCKET" >/dev/null   # reject XML-special characters early
    mkdir -p "$(dirname "$PLIST")"
    sed -e "s/{{HELPER_APP}}/$(escape "$APP")/g" -e "s/{{SOCKET}}/$(escape "$SOCKET")/g" "$TEMPLATE" > "$PLIST.new"
    plutil -lint "$PLIST.new" >/dev/null
    mv "$PLIST.new" "$PLIST"
    # Idempotent: drop a previous registration first (ignore "not loaded").
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "installed $PLIST (not started; use '$0 start' or let c3d-mcp launch it)"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"
    ;;
  start)
    launchctl kickstart "$DOMAIN/$LABEL"
    ;;
  *)
    echo "usage: $0 install [--app path] [--socket path] | uninstall | start" >&2
    exit 2
    ;;
esac
