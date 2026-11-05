#!/bin/zsh
# Builds "C3D MCP.app" (control panel + helper + bundled Node 22 + the c3d-mcp server), signs it, and packs release/app/C3D-MCP-<version>.dmg
# plus the same app as a .zip (what the optional curl one-liner downloads). Nothing is published. Usage: scripts/build-app.sh
#
# Env: C3D_NODE_VERSION (default 22.23.4), C3D_NODE_BASE_URL, C3D_BUILD_CACHE (default ~/Library/Caches/c3d-mcp-build),
#      C3D_SIGN_IDENTITY / ~/.c3d-mcp-signing/signing.env (see packaging/make-signing-identity.sh), C3D_APP_OUT (default release/app).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
VERSION=$(node -p "require('./packages/server/package.json').version")
OUT=${C3D_APP_OUT:-$ROOT/release/app}
CACHE=${C3D_BUILD_CACHE:-$HOME/Library/Caches/c3d-mcp-build}
NODE_VERSION=${C3D_NODE_VERSION:-22.23.4}
NODE_BASE=${C3D_NODE_BASE_URL:-https://nodejs.org/dist}
APP="$OUT/C3D MCP.app"
RES="$APP/Contents/Resources"

rm -rf "$OUT"; mkdir -p "$OUT" "$CACHE"

echo "==> bridge runtime + server package"
node scripts/build-runtime.mjs >/dev/null
PACK=$(mktemp -d); trap 'rm -rf "$PACK"' EXIT
(cd packages/server && npm pack --pack-destination "$PACK" 2>&1 | tail -1)

echo "==> Sparkle (update engine)"
scripts/fetch-sparkle.sh
packaging/make-update-key.sh >/dev/null
UPDATE_PUB=${C3D_UPDATE_PUBLIC_KEY:-$(cat "${C3D_SIGNING_DIR:-$HOME/.c3d-mcp-signing}/sparkle-ed25519.pub")}
FEED_URL=${C3D_FEED_BASE:-https://github.com/megatih/c3d-mcp/releases/latest/download}/appcast.xml

echo "==> Swift app (arm64)"
(cd helper && swift build -c release --arch arm64 --product C3DMCP 2>&1 | grep -E "error|warning: var|Build complete" || true)
BIN=$(cd helper && swift build -c release --arch arm64 --show-bin-path)
[ -x "$BIN/C3DMCP" ] || { echo "Swift build failed" >&2; exit 1; }

echo "==> assemble bundle"
mkdir -p "$APP/Contents/MacOS" "$RES/node/bin" "$RES/server"
cp "$BIN/C3DMCP" "$APP/Contents/MacOS/C3DMCP"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.c3dmcp.app</string>
  <key>CFBundleName</key><string>C3D MCP</string>
  <key>CFBundleDisplayName</key><string>C3D MCP</string>
  <key>CFBundleExecutable</key><string>C3DMCP</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.graphics-design</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>SUFeedURL</key><string>$FEED_URL</string>
  <key>SUPublicEDKey</key><string>$UPDATE_PUB</string>
  <key>SUEnableAutomaticChecks</key><true/>
  <key>SUScheduledCheckInterval</key><integer>86400</integer>
  <key>NSAccessibilityUsageDescription</key>
  <string>C3D MCP presses Cheetah3D menu items on behalf of your AI assistant so it can drive Cheetah3D.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>C3D MCP can capture Cheetah3D windows so your AI assistant can see the viewport.</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>C3D MCP asks Cheetah3D and Claude to quit politely before it removes older installs, and can start Cheetah3D.</string>
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null

# Sparkle.framework (not sandboxed, so its XPC services are not needed)
mkdir -p "$APP/Contents/Frameworks"
ditto helper/.sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework "$APP/Contents/Frameworks/Sparkle.framework"
rm -rf "$APP/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices" "$APP/Contents/Frameworks/Sparkle.framework/XPCServices"
install_name_tool -add_rpath @executable_path/../Frameworks "$APP/Contents/MacOS/C3DMCP"

echo "==> icon"
ICONSET=$(mktemp -d)/AppIcon.iconset
swift scripts/make-icon.swift "$ICONSET" && iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns"

echo "==> Node.js $NODE_VERSION (official build, SHA-256 verified)"
NODE_TGZ="node-v$NODE_VERSION-darwin-arm64.tar.gz"
if [ ! -f "$CACHE/$NODE_TGZ" ]; then
  curl -fsSL "$NODE_BASE/v$NODE_VERSION/$NODE_TGZ" -o "$CACHE/$NODE_TGZ.part"
  curl -fsSL "$NODE_BASE/v$NODE_VERSION/SHASUMS256.txt" -o "$CACHE/SHASUMS256-$NODE_VERSION.txt"
  WANT=$(grep " $NODE_TGZ\$" "$CACHE/SHASUMS256-$NODE_VERSION.txt" | cut -d' ' -f1)
  GOT=$(shasum -a 256 "$CACHE/$NODE_TGZ.part" | cut -d' ' -f1)
  [ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || { echo "Node.js checksum mismatch ($GOT vs $WANT)" >&2; rm -f "$CACHE/$NODE_TGZ.part"; exit 1; }
  mv "$CACHE/$NODE_TGZ.part" "$CACHE/$NODE_TGZ"
fi
tar -xzf "$CACHE/$NODE_TGZ" -C "$RES/node" --strip-components=1 "node-v$NODE_VERSION-darwin-arm64/bin/node" "node-v$NODE_VERSION-darwin-arm64/LICENSE"
"$RES/node/bin/node" --version | grep -qx "v$NODE_VERSION"

echo "==> server + production dependencies"
tar -xzf "$PACK/c3d-mcp-$VERSION.tgz" -C "$RES/server" --strip-components=1
(cd "$RES/server" && PATH="$RES/node/bin:$PATH" npm install --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null 2>&1)
rm -rf "$RES/server/node_modules/.cache"
"$RES/node/bin/node" "$RES/server/bin/c3d-mcp.js" version | grep -q "$VERSION"

packaging/sign-app.sh "$APP"

echo "==> zip + dmg"
ditto -c -k --keepParent "$APP" "$OUT/C3D-MCP-$VERSION.zip"
swift packaging/make-appcast.swift "$OUT/C3D-MCP-$VERSION.zip" "${C3D_SIGNING_DIR:-$HOME/.c3d-mcp-signing}/sparkle-ed25519.key" "$VERSION" "${C3D_DOWNLOAD_BASE:-https://github.com/megatih/c3d-mcp/releases/download/v$VERSION}/C3D-MCP-$VERSION.zip" "$OUT/appcast.xml"
STAGE=$(mktemp -d)/"C3D MCP"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
cp packaging/dmg/"Read me first - Open Anyway.txt" "$STAGE/"
hdiutil create -volname "C3D MCP" -srcfolder "$STAGE" -ov -format UDZO "$OUT/C3D-MCP-$VERSION.dmg" >/dev/null
rm -rf "$(dirname "$STAGE")"

# Stable names for the curl one-liner (packaging/get-c3d-mcp.sh): the same zip under a version-less name plus its checksum.
cp "$OUT/C3D-MCP-$VERSION.zip" "$OUT/C3D-MCP-latest.zip"
(cd "$OUT" && shasum -a 256 C3D-MCP-latest.zip > C3D-MCP-latest.zip.sha256)
cp packaging/get-c3d-mcp.sh "$OUT/get-c3d-mcp.sh"; chmod +x "$OUT/get-c3d-mcp.sh"; bash -n "$OUT/get-c3d-mcp.sh"

echo "==> checksums"
(cd "$OUT" && shasum -a 256 *.dmg C3D-MCP-$VERSION.zip get-c3d-mcp.sh appcast.xml | tee SHA256SUMS)
echo "==> built $APP"
