#!/usr/bin/env bash
# Builds the runtime and the Swift JSContext harness, runs every bridge case plus schema/lint checks.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE="$ROOT/bridge"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/c3d-bridge.XXXXXX")"
DUMP="$WORK/dump"
TAP="$WORK/tap.txt"
trap 'rm -rf "$WORK"' EXIT
status=0
step() { printf '\n== %s\n' "$1"; }

step "build runtime"
node "$ROOT/scripts/build-runtime.mjs" || exit 1

step "lint (ES5 / ASCII / bare constants)"
node "$BRIDGE/tests/lint-es5.mjs" || status=1

step "build harness"
(cd "$BRIDGE/tests/harness" && swift build -c release 2>&1 | tail -3) || exit 1
HARNESS="$BRIDGE/tests/harness/.build/release/c3d-harness"
[ -x "$HARNESS" ] || { echo "harness build failed"; exit 1; }

step "cases"
"$HARNESS" cases --bridge "$BRIDGE" --dump "$DUMP" | tee "$TAP" | grep -v '^ok' || true
grep -q '^# fail 0$' "$TAP" || status=1

step "schemas"
node "$BRIDGE/tests/validate-schemas.mjs" "$DUMP" || status=1

printf '\n== summary\n'
grep -E '^# (pass|fail)' "$TAP"
[ "$status" -eq 0 ] && echo "bridge tests: PASS" || echo "bridge tests: FAIL"
exit "$status"
