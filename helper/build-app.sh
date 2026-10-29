#!/bin/bash
# Builds helper/build/C3D Bridge Helper.app (universal if possible, else arm64) and signs it.
# Signing identity: $C3D_SIGN_IDENTITY (default "-" = ad-hoc). See packaging/sign-dev.sh.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
VERSION="$(tr -d '[:space:]' < VERSION)"
APP="$HERE/build/C3D Bridge Helper.app"
IDENTITY="${C3D_SIGN_IDENTITY:--}"

echo "==> building C3D Bridge Helper $VERSION"
if swift build -c release --arch arm64 --arch x86_64 >/dev/null 2>&1; then
  ARCHS=(--arch arm64 --arch x86_64); LABEL="universal (arm64+x86_64)"
else
  echo "    universal build unavailable, falling back to arm64"
  swift build -c release --arch arm64
  ARCHS=(--arch arm64); LABEL="arm64"
fi
BIN="$(swift build -c release "${ARCHS[@]}" --show-bin-path)"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN/C3DBridgeHelper" "$BIN/c3d-helper-ctl" "$APP/Contents/MacOS/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.c3dmcp.helper</string>
  <key>CFBundleName</key><string>C3D Bridge Helper</string>
  <key>CFBundleDisplayName</key><string>C3D Bridge Helper</string>
  <key>CFBundleExecutable</key><string>C3DBridgeHelper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAccessibilityUsageDescription</key>
  <string>C3D Bridge Helper presses Cheetah3D menu items on behalf of the c3d-mcp server so AI assistants can drive Cheetah3D.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>C3D Bridge Helper can capture Cheetah3D windows so AI assistants can see the viewport.</string>
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null

"$HERE/../packaging/sign-dev.sh" "$APP"

echo "==> built $APP ($LABEL, version $VERSION)"
