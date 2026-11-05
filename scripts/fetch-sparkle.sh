#!/bin/bash
# Downloads Sparkle's prebuilt framework (updater engine) into helper/.sparkle/ and verifies its SHA-256 against the checksum pinned in
# Sparkle's own Package.swift for this tag. Needed once before building the app; `swift build` of the app target without it simply leaves
# the updater out. Usage: scripts/fetch-sparkle.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=2.9.6
SHA=8d5fb41d960b43f4a68aa14126bf62b098544ec8d191cdcc73eb14e63a8e7606
CACHE=${C3D_BUILD_CACHE:-$HOME/Library/Caches/c3d-mcp-build}
ZIP="$CACHE/Sparkle-$VERSION-spm.zip"
DEST=helper/.sparkle
mkdir -p "$CACHE"
if [ -d "$DEST/Sparkle.xcframework" ] && [ "$(cat "$DEST/VERSION" 2>/dev/null)" = "$VERSION" ]; then exit 0; fi
if [ ! -f "$ZIP" ]; then
  curl -fsSL "https://github.com/sparkle-project/Sparkle/releases/download/$VERSION/Sparkle-for-Swift-Package-Manager.zip" -o "$ZIP.part"
  mv "$ZIP.part" "$ZIP"
fi
[ "$(shasum -a 256 "$ZIP" | cut -d' ' -f1)" = "$SHA" ] || { echo "Sparkle checksum mismatch" >&2; rm -f "$ZIP"; exit 1; }
rm -rf "$DEST"; mkdir -p "$DEST"
ditto -x -k "$ZIP" "$DEST"
[ -d "$DEST/Sparkle.xcframework" ] || { echo "Sparkle.xcframework missing in the download" >&2; exit 1; }
echo "$VERSION" > "$DEST/VERSION"
echo "Sparkle $VERSION ready in $DEST"
