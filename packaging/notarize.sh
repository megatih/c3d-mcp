#!/bin/bash
# Notarizes and staples the helper app (Developer ID builds only).
#
#   packaging/notarize.sh [--dry-run] ["helper/build/C3D Bridge Helper.app"]
#
# Prerequisites for a real run (none are needed for --dry-run):
#   * the app signed with a "Developer ID Application" identity (C3D_SIGN_IDENTITY=... helper/build-app.sh)
#   * a notarytool keychain profile, created once with:
#       xcrun notarytool store-credentials "<profile>" --apple-id <id> --team-id <TEAM> --password <app-specific-pw>
#   * export C3D_NOTARY_PROFILE="<profile>"
#
# --dry-run only prints the commands; it never contacts Apple and needs no credentials.
set -euo pipefail

DRY=0
APP=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) APP="$arg" ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="${APP:-$HERE/../helper/build/C3D Bridge Helper.app}"
PROFILE="${C3D_NOTARY_PROFILE:-<keychain-profile>}"
ZIP="${TMPDIR:-/tmp}/C3D-Bridge-Helper-notarize.zip"

run() {
  if [ "$DRY" = 1 ]; then printf '[dry-run] '; printf '%q ' "$@"; printf '\n'; else "$@"; fi
}

if [ "$DRY" = 0 ]; then
  [ -d "$APP" ] || { echo "app not found: $APP" >&2; exit 1; }
  [ -n "${C3D_NOTARY_PROFILE:-}" ] || { echo "set C3D_NOTARY_PROFILE to a notarytool keychain profile (or use --dry-run)" >&2; exit 1; }
  codesign -dvv "$APP" 2>&1 | grep -q "Developer ID Application" || { echo "app is not signed with a Developer ID Application identity" >&2; exit 1; }
fi

run ditto -c -k --keepParent "$APP" "$ZIP"
run xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait
run xcrun stapler staple "$APP"
run xcrun stapler validate "$APP"
run spctl --assess --type execute --verbose=2 "$APP"
[ "$DRY" = 1 ] && echo "[dry-run] nothing was submitted" || echo "==> notarized and stapled: $APP"
