#!/bin/bash
# Signs "C3D MCP.app": our own executable and the bundle. The bundled Node binary keeps the Node.js project's own signature.
#
#   packaging/sign-app.sh "release/app/C3D MCP.app"
#
# Identity: from ~/.c3d-mcp-signing/signing.env (packaging/make-signing-identity.sh) or $C3D_SIGN_IDENTITY (+ optional
# $C3D_SIGN_KEYCHAIN / $C3D_SIGN_KEYCHAIN_PASSWORD). "-" or nothing at all => ad-hoc (TCC grants then reset on every build).
set -euo pipefail

APP="${1:?usage: sign-app.sh <path-to-app-bundle>}"
ENVFILE="${C3D_SIGNING_DIR:-$HOME/.c3d-mcp-signing}/signing.env"
# shellcheck disable=SC1090
if [ -z "${C3D_SIGN_IDENTITY:-}" ] && [ -f "$ENVFILE" ]; then . "$ENVFILE"; fi
IDENTITY="${C3D_SIGN_IDENTITY:--}"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"

KCARGS=()
if [ "$IDENTITY" != "-" ] && [ -n "${C3D_SIGN_KEYCHAIN:-}" ]; then
  security unlock-keychain -p "${C3D_SIGN_KEYCHAIN_PASSWORD:-}" "$C3D_SIGN_KEYCHAIN"
  KCARGS=(--keychain "$C3D_SIGN_KEYCHAIN")
fi
if [ "$IDENTITY" = "-" ]; then echo "==> ad-hoc signing (no stable identity: permissions reset on every update)"; else echo "==> signing with identity $IDENTITY"; fi

# No hardened runtime: it only matters for notarization, and it would add library validation against the embedded Sparkle framework.
sign() { codesign --force --sign "$IDENTITY" ${KCARGS[@]+"${KCARGS[@]}"} --timestamp=none "$@"; }
# Sparkle, inside-out (the updater helper and its launcher first, then the framework).
SPARKLE="$APP/Contents/Frameworks/Sparkle.framework"
if [ -d "$SPARKLE" ]; then
  V="$SPARKLE/Versions/B"
  [ -e "$V/Autoupdate" ] && sign "$V/Autoupdate"
  [ -d "$V/Updater.app" ] && sign "$V/Updater.app"
  sign "$SPARKLE"
fi
for exe in "$APP"/Contents/MacOS/*; do sign --identifier "$BUNDLE_ID.$(basename "$exe")" "$exe"; done
sign --identifier "$BUNDLE_ID" "$APP"

codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dr - "$APP" 2>&1 | sed -n 's/^designated => /designated requirement: /p'
echo "==> signature OK"
