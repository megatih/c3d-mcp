#!/bin/bash
# Self-test of scripts/check-public.mjs: it must pass a clean tree and fail on planted canaries (tree, archive, history).
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "ok - $1"; }; bad() { echo "not ok - $1"; fail=1; }
CAN1="japanese""house"; CAN2="/Users/""someone""else/Documents"; CAN3="ghp_""$(printf 'a%.0s' {1..30})"
mkdir -p "$T/clean" "$T/dirty"; echo "hello world" > "$T/clean/a.md"
node scripts/check-public.mjs --tree "$T/clean" >/dev/null 2>&1 && ok "clean tree passes" || bad "clean tree passes"
for c in "$CAN1" "$CAN2" "$CAN3"; do echo "x $c y" > "$T/dirty/f.md"; node scripts/check-public.mjs --tree "$T/dirty" >/dev/null 2>&1 && bad "canary caught: $c" || ok "canary caught"; done
rm "$T/dirty/f.md"; echo secret > "$T/dirty/PRD.md"; node scripts/check-public.mjs --tree "$T/dirty" >/dev/null 2>&1 && bad "forbidden path caught" || ok "forbidden path caught"
mkdir -p "$T/pkg/package"; echo "$CAN1" > "$T/pkg/package/n.md"; tar -czf "$T/pkg.tgz" -C "$T/pkg" package
node scripts/check-public.mjs --archive "$T/pkg.tgz" >/dev/null 2>&1 && bad "archive canary caught" || ok "archive canary caught"
( cd "$T" && git init -q h && cd h && git config user.email a@users.noreply.github.com && git config user.name a && echo "$CAN1" > f.md && git add . && git commit -qm c && echo clean > f.md && git commit -qam d )
node scripts/check-public.mjs --history "$T/h" >/dev/null 2>&1 && bad "history canary caught" || ok "history canary caught"
exit $fail
