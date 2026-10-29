#!/bin/zsh
# Builds every distributable locally into release/ (nothing is published or pushed). Usage: scripts/release.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
VERSION=$(node -p "require('./packages/server/package.json').version")
OUT=$ROOT/release; rm -rf "$OUT"; mkdir -p "$OUT"

echo "==> agent skills (validate)"; node scripts/build-skills.mjs --check
echo "==> bridge runtime"; node scripts/build-runtime.mjs >/dev/null
echo "==> helper app"; (cd helper && ./build-app.sh >/dev/null)
ditto -c -k --keepParent "helper/build/C3D Bridge Helper.app" helper/build/C3D-Bridge-Helper.zip
cp helper/build/C3D-Bridge-Helper.zip "$OUT/C3D-Bridge-Helper-$VERSION.zip"

echo "==> npm tarball"; (cd packages/server && npm pack --pack-destination "$OUT" 2>&1 | tail -1)

echo "==> mcpb"
STAGE=$(mktemp -d); mkdir -p "$STAGE/server"
cp mcpb/manifest.json "$STAGE/manifest.json"
tar -xzf "$OUT/c3d-mcp-$VERSION.tgz" -C "$STAGE/server" --strip-components=1
(cd "$STAGE/server" && npm install --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null 2>&1)
npx --yes @anthropic-ai/mcpb@2.1.2 validate "$STAGE/manifest.json"
npx --yes @anthropic-ai/mcpb@2.1.2 pack "$STAGE" "$OUT/c3d-mcp-$VERSION.mcpb"
rm -rf "$STAGE"

echo "==> agent skills"; node scripts/build-skills.mjs --zip "$OUT"

echo "==> checksums"; (cd "$OUT" && shasum -a 256 *.zip *.mcpb *.tgz skills/*.zip > SHA256SUMS && cat SHA256SUMS)
