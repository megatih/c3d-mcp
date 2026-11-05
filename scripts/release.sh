#!/bin/zsh
# Builds everything that goes on a GitHub release into release/ (nothing is published or pushed). Usage: scripts/release.sh
#   release/app/    C3D-MCP-<v>.dmg, C3D-MCP-<v>.zip, C3D-MCP-latest.zip(.sha256), appcast.xml, get-c3d-mcp.sh   (the one install method)
#   release/        c3d-skills-<v>.zip and skills/<name>-<v>.zip (optional: upload by hand to Claude Desktop / ChatGPT), SHA256SUMS
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
VERSION=$(node -p "require('./packages/server/package.json').version")
OUT=$ROOT/release; rm -rf "$OUT"; mkdir -p "$OUT"

echo "==> agent skills (validate)"; node scripts/build-skills.mjs --check
echo "==> bridge runtime"; node scripts/build-runtime.mjs >/dev/null
echo "==> agent skills (zip)"; node scripts/build-skills.mjs --zip "$OUT"
echo "==> C3D MCP app (dmg, zip, appcast, curl installer)"; C3D_APP_OUT="$OUT/app" scripts/build-app.sh >/dev/null

echo "==> the app must not carry any old install method"
if find "$OUT/app/C3D MCP.app" \( -name 'install.sh' -o -name '*.mcpb' -o -name 'C3D-Bridge-Helper*' -o -name 'plugin.json' \) | grep -q .; then
  echo "an old install artifact is inside the app bundle" >&2; exit 1
fi
[ ! -e "$OUT/app/C3D MCP.app/Contents/Resources/server/assets/helper" ] || { echo "assets/helper must not ship" >&2; exit 1; }

echo "==> leak scan of every artifact"
node scripts/check-public.mjs --archive "$OUT"/c3d-skills-*.zip "$OUT"/app/C3D-MCP-[0-9]*.zip "$OUT"/app/C3D-MCP-[0-9]*.dmg "$OUT"/app/get-c3d-mcp.sh "$OUT"/app/appcast.xml

echo "==> checksums"
(cd "$OUT" && shasum -a 256 c3d-skills-*.zip skills/*.zip app/C3D-MCP-[0-9]*.dmg app/C3D-MCP-[0-9]*.zip app/C3D-MCP-latest.zip app/C3D-MCP-latest.zip.sha256 app/get-c3d-mcp.sh app/appcast.xml > SHA256SUMS && cat SHA256SUMS)
echo "==> release $VERSION is in $OUT"
