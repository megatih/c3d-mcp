#!/bin/bash
# Offline tests for install.sh. Uses a temp HOME/PATH with stub tools; downloads
# only from local file:// fixtures. Usage: scripts/test-install.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
INSTALL="$HERE/../install.sh"
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/c3d-install-test.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

PASS=0; FAIL=0; N=0
OUT=""; RC=0

# new_env <name> [node-version|none] [os] [macos] [arch]  -> sets T (HOME), STUBS, FIX
new_env() {
  local name="$1" nodev="${2:-v22.12.0}" os="${3:-Darwin}" mac="${4:-15.1}" arch="${5:-arm64}"
  T="$ROOT/$name"; STUBS="$T/stubs"; FIX="$T/fix"
  mkdir -p "$T/home" "$STUBS" "$FIX" "$T/Apps/Cheetah3D.app/Contents" "$T/support"
  cat >"$T/Apps/Cheetah3D.app/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>8.1.3</string></dict></plist>
PL
  printf '#!/bin/sh\necho %s\n' "$mac" >"$STUBS/sw_vers"
  printf '#!/bin/sh\ncase "$1" in -s) echo %s;; -m) echo %s;; *) echo %s;; esac\n' "$os" "$arch" "$os" >"$STUBS/uname"
  if [ "$nodev" != none ]; then
    printf '#!/bin/sh\nif [ "$1" = --version ]; then echo %s; else echo "NODE-STUB $*"; fi\n' "$nodev" >"$STUBS/node"
    cat >"$STUBS/npm" <<'NPM'
#!/bin/sh
echo "$@" >>"$NPM_LOG"
for last; do :; done
prefix=""; while [ $# -gt 0 ]; do [ "$1" = --prefix ] && prefix="$2"; shift; done
ver=$(basename "$last" .tgz | sed 's/^c3d-mcp-//'); case "$ver" in [0-9]*) ;; *) ver=0.0.0 ;; esac
mkdir -p "$prefix/node_modules/c3d-mcp/bin"
echo '{"name":"c3d-mcp","version":"'"$ver"'"}' >"$prefix/node_modules/c3d-mcp/package.json"
echo '// stub' >"$prefix/node_modules/c3d-mcp/bin/c3d-mcp.js"
NPM
    chmod +x "$STUBS/node" "$STUBS/npm"
  fi
  chmod +x "$STUBS/sw_vers" "$STUBS/uname"
  NPM_LOG="$T/npm.log"; : >"$NPM_LOG"
}

# run_install <args...>  (sets OUT, RC)
run_install() {
  OUT=$(HOME="$T/home" PATH="$STUBS:/usr/bin:/bin" TMPDIR="$T" NPM_LOG="$NPM_LOG" \
    C3D_APPS_DIRS="$T/Apps" C3D_CHEETAH_SUPPORT_DIR="$T/support" \
    bash "$INSTALL" "$@" </dev/null 2>&1)
  RC=$?
}

check() { # check <desc> <cond-exit-code>
  N=$((N + 1))
  if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "ok $N - $1"
  else FAIL=$((FAIL + 1)); echo "not ok $N - $1"; echo "    --- output (rc=$RC) ---"; printf '%s\n' "$OUT" | sed 's/^/    /'; fi
}
has() { printf '%s\n' "$OUT" | grep -qF -- "$1"; }
assert_rc()  { check "$1 (exit $2)" "$([ "$RC" -eq "$2" ]; echo $?)"; }
assert_has() { check "$1" "$(has "$2"; echo $?)"; }
assert_not() { check "$1" "$(has "$2"; r=$?; [ $r -ne 0 ]; echo $?)"; }

echo "TAP version 13"
bash -n "$INSTALL"; check "bash -n install.sh" $?
if command -v zsh >/dev/null 2>&1; then zsh -n "$INSTALL"; check "zsh -n install.sh" $?; fi

# 1. all good
new_env good; run_install --dry-run --yes
assert_rc "all good" 0
assert_has "all good: macOS ok" "[ok] macOS 15.1"
assert_has "all good: cheetah ok" "[ok] Cheetah3D found"
assert_has "all good: support dir ok" "[ok] Support folder exists"
assert_has "all good: node ok" "[ok] Node.js v22.12.0"
assert_has "all good: dry-run hand-over printed" "setup --dry-run --yes --node-path"
assert_not "all good: no [missing]" "[missing]"
check "all good: nothing written under HOME" "$([ -z "$(ls -A "$T/home")" ]; echo $?)"

# 2. node missing
new_env nonode none; run_install --dry-run --yes
assert_rc "node missing" 0
assert_has "node missing: reported" "[missing] Node.js not found"
assert_has "node missing: tarball plan" "darwin-arm64.tar.gz"

# 3. node too old
new_env oldnode v18.19.0; run_install --dry-run --yes
assert_rc "node old" 0
assert_has "node old: reported" "Node.js is too old"
new_env oldnode2 v18.19.0; run_install --dry-run --yes --no-node-install
assert_rc "node old + --no-node-install" 1

# 4. cheetah missing
new_env nocheetah; rm -rf "$T/Apps/Cheetah3D.app"; run_install --dry-run --yes
assert_rc "cheetah missing" 1
assert_has "cheetah missing: reported" "[missing] Cheetah3D.app not found"
assert_has "cheetah missing: download page" "https://www.cheetah3d.com"

# 5. skip
new_env skip; rm -rf "$T/Apps/Cheetah3D.app"; run_install --dry-run --yes --skip-cheetah-check
assert_rc "cheetah missing + skip" 0
assert_has "skip: warned" "Skipping Cheetah3D check"

# 5b. never launched
new_env nolaunch; rm -rf "$T/support"; run_install --dry-run --yes
assert_rc "support dir missing" 1
assert_has "support dir missing: reported" "never been launched"

# 6. macOS 13, 7. non-macOS, Intel
new_env mac13 v22.12.0 Darwin 13.6; run_install --dry-run --yes
assert_rc "macOS 13" 1
assert_has "macOS 13: message" "macOS 14 or newer required"
new_env linux v22.12.0 Linux 6.1; run_install --dry-run --yes
assert_rc "non-macOS" 1
assert_has "non-macOS: message" "macOS required"
new_env intel v22.12.0 Darwin 15.1 x86_64; run_install --dry-run --yes
assert_rc "intel" 0
assert_has "intel: warning" "Intel Mac"

# 8. real install flow with file:// fixtures
mkfix() { # mkfix <dir> ; builds v0.0.0 tgz
  mkdir -p "$1/v0.0.0" "$T/pkg/package/bin"
  echo '{"name":"c3d-mcp","version":"0.0.0"}' >"$T/pkg/package/package.json"
  echo '// js' >"$T/pkg/package/bin/c3d-mcp.js"
  tar -czf "$1/v0.0.0/c3d-mcp-0.0.0.tgz" -C "$T/pkg" package
}
new_env inst; mkfix "$FIX"
(cd "$FIX/v0.0.0" && shasum -a 256 c3d-mcp-0.0.0.tgz >SHA256SUMS)
export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --yes --version 0.0.0 --prefix "$T/prefix" --clients none
assert_rc "install ok" 0
assert_has "install: checksum verified" "SHA-256 verified for c3d-mcp-0.0.0.tgz"
check "install: launcher exists" "$([ -x "$T/prefix/bin/c3d-mcp" ]; echo $?)"
check "install: npm called with --omit=dev" "$(grep -q -- '--omit=dev' "$NPM_LOG"; echo $?)"
assert_has "install: wizard handed over" "setup --yes --clients none --node-path"
assert_has "install: launcher ran node with entry" "NODE-STUB $T/prefix/app/node_modules/c3d-mcp/bin/c3d-mcp.js setup"
check "install: ~/.zprofile untouched" "$([ ! -e "$T/home/.zprofile" ]; echo $?)"

# 9. mismatch
new_env bad; mkfix "$FIX"
echo "0000000000000000000000000000000000000000000000000000000000000000  c3d-mcp-0.0.0.tgz" >"$FIX/v0.0.0/SHA256SUMS"
export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --yes --version 0.0.0 --prefix "$T/prefix"
assert_rc "checksum mismatch" 1
assert_has "mismatch: message" "SHA-256 mismatch"
check "mismatch: npm not run" "$([ ! -s "$NPM_LOG" ]; echo $?)"
check "mismatch: nothing installed" "$([ ! -e "$T/prefix/bin/c3d-mcp" ]; echo $?)"

# 10. node tarball download (no node on PATH), plus mismatch
new_env tarnode none Darwin 15.1 arm64; mkfix "$FIX"
(cd "$FIX/v0.0.0" && shasum -a 256 c3d-mcp-0.0.0.tgz >SHA256SUMS)
NF="$T/nodefix/v22.23.4"; mkdir -p "$NF" "$T/nodepkg/node-v22.23.4-darwin-arm64/bin"
printf '#!/bin/sh\nif [ "$1" = --version ]; then echo v22.23.4; else echo "NODE-STUB $*"; fi\n' >"$T/nodepkg/node-v22.23.4-darwin-arm64/bin/node"
cp "$STUBS/../../inst/stubs/npm" "$T/nodepkg/node-v22.23.4-darwin-arm64/bin/npm"
chmod +x "$T"/nodepkg/node-v22.23.4-darwin-arm64/bin/*
tar -czf "$NF/node-v22.23.4-darwin-arm64.tar.gz" -C "$T/nodepkg" node-v22.23.4-darwin-arm64
(cd "$NF" && shasum -a 256 node-v22.23.4-darwin-arm64.tar.gz >SHASUMS256.txt)
export C3D_INSTALL_BASE_URL="file://$FIX"; export C3D_NODE_BASE_URL="file://$T/nodefix"
run_install --yes --version 0.0.0 --prefix "$T/prefix"
assert_rc "node tarball install" 0
assert_has "node tarball: verified" "SHA-256 verified for node-v22.23.4-darwin-arm64.tar.gz"
check "node tarball: unpacked in prefix" "$([ -x "$T/prefix/node/bin/node" ]; echo $?)"
assert_has "node tarball: used for setup" "--node-path $T/prefix/node/bin/node"
echo "deadbeef  node-v22.23.4-darwin-arm64.tar.gz" >"$NF/SHASUMS256.txt"
rm -rf "$T/prefix"
run_install --yes --version 0.0.0 --prefix "$T/prefix"
assert_rc "node tarball mismatch" 1
assert_has "node tarball mismatch: message" "SHA-256 mismatch for node-v22.23.4"
check "node tarball mismatch: nothing unpacked" "$([ ! -e "$T/prefix/node" ]; echo $?)"
unset C3D_INSTALL_BASE_URL C3D_NODE_BASE_URL


# ---------------------------------------------------------------------------------------------
# Lifecycle: detect fresh / current / outdated / newer / partial installs, then status, update,
# repair, reinstall and uninstall (with and without --all).
# ---------------------------------------------------------------------------------------------
mkfixv() { # mkfixv <version>: release fixture tarball + checksums for that version
  mkdir -p "$FIX/v$1" "$T/pkgv/package/bin"
  echo '{"name":"c3d-mcp","version":"'"$1"'"}' >"$T/pkgv/package/package.json"
  echo '// js' >"$T/pkgv/package/bin/c3d-mcp.js"
  tar -czf "$FIX/v$1/c3d-mcp-$1.tgz" -C "$T/pkgv" package
  (cd "$FIX/v$1" && shasum -a 256 "c3d-mcp-$1.tgz" >SHA256SUMS)
}
mkprefix() { # mkprefix <version> [launcher-node]: an existing installation under $T/prefix
  local ver="$1" node="${2:-$STUBS/node}"
  mkdir -p "$T/prefix/app/node_modules/c3d-mcp/bin" "$T/prefix/bin"
  echo '{"name":"c3d-mcp","version":"'"$ver"'"}' >"$T/prefix/app/node_modules/c3d-mcp/package.json"
  echo '// js' >"$T/prefix/app/node_modules/c3d-mcp/bin/c3d-mcp.js"
  printf '#!/bin/sh\nexec "%s" "%s/app/node_modules/c3d-mcp/bin/c3d-mcp.js" "$@"\n' "$node" "$T/prefix" >"$T/prefix/bin/c3d-mcp"
  chmod +x "$T/prefix/bin/c3d-mcp"
}
npm_ran() { [ -s "$NPM_LOG" ]; }
inst_ver() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$T/prefix/app/node_modules/c3d-mcp/package.json" 2>/dev/null | head -n 1; }
LIFE="--yes --prefix"

# L1. fresh machine: detected as such
new_env l1; mkfixv 0.0.0; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --yes --version 0.0.0 --prefix "$T/prefix" --clients none
assert_rc "fresh: ok" 0
assert_has "fresh: detected" "Detected: no existing install"
assert_has "fresh: handover without a mode flag" "setup --yes --clients none --node-path"

# L2. current: detected, nothing downloaded, setup still runs (it repairs the Cheetah3D side)
new_env l2; mkfixv 0.0.0; mkprefix 0.0.0; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --yes --version 0.0.0 --prefix "$T/prefix" --clients none
assert_rc "current: ok" 0
assert_has "current: detected" "c3d-mcp 0.0.0 is installed"
assert_has "current: up to date" "up to date"
check "current: npm not run" "$(npm_ran; [ $? -ne 0 ]; echo $?)"
assert_has "current: setup handed over" "setup --yes --clients none --node-path"

# L3. outdated: update available, installed on --yes
new_env l3; mkfixv 0.1.0; mkprefix 0.0.0; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --yes --version 0.1.0 --prefix "$T/prefix" --clients none
assert_rc "outdated: ok" 0
assert_has "outdated: detected" "update available: 0.0.0 -> 0.1.0"
check "outdated: updated to 0.1.0" "$([ "$(inst_ver)" = 0.1.0 ]; echo $?)"
assert_has "outdated: checksum verified" "SHA-256 verified for c3d-mcp-0.1.0.tgz"

# L4. newer than the release: never downgraded
new_env l4; mkfixv 0.1.0; mkprefix 0.2.0; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --yes --version 0.1.0 --prefix "$T/prefix" --clients none
assert_rc "newer: ok" 0
assert_has "newer: detected" "newer than the release"
check "newer: not downgraded" "$([ "$(inst_ver)" = 0.2.0 ]; echo $?)"
check "newer: npm not run" "$(npm_ran; [ $? -ne 0 ]; echo $?)"

# L5. partial installs: each shape is named and repaired
new_env l5a; mkfixv 0.0.0; mkprefix 0.0.0; rm -f "$T/prefix/bin/c3d-mcp"; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --yes --version 0.0.0 --prefix "$T/prefix" --clients none
assert_rc "partial (launcher missing): ok" 0
assert_has "partial (launcher missing): detected" "partial install"
assert_has "partial (launcher missing): named" "launcher missing"
check "partial (launcher missing): launcher recreated" "$([ -x "$T/prefix/bin/c3d-mcp" ]; echo $?)"
assert_has "partial: setup repairs" "setup --repair --yes --clients none --node-path"
new_env l5b; mkfixv 0.0.0; mkprefix 0.0.0; rm -rf "$T/prefix/app"; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --yes --version 0.0.0 --prefix "$T/prefix" --clients none
assert_has "partial (app missing): named" "app missing"
check "partial (app missing): package reinstalled" "$([ "$(inst_ver)" = 0.0.0 ]; echo $?)"
new_env l5c; mkfixv 0.0.0; mkprefix 0.0.0 "$T/gone/node"; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --yes --version 0.0.0 --prefix "$T/prefix" --clients none
assert_has "partial (launcher points at a missing node): named" "launcher points at a Node.js that is gone"
check "partial (stale node): launcher rewritten to the current node" "$(grep -q "$STUBS/node" "$T/prefix/bin/c3d-mcp"; echo $?)"

# L6. --status: read-only, no network, shows the bridge side through the CLI
new_env l6; mkprefix 0.0.0; unset C3D_INSTALL_BASE_URL
run_install --status --prefix "$T/prefix"
assert_rc "status: ok" 0
assert_has "status: detected" "c3d-mcp 0.0.0 is installed"
assert_has "status: asks the CLI for the bridge state" "NODE-STUB $T/prefix/app/node_modules/c3d-mcp/bin/c3d-mcp.js status"
check "status: nothing changed" "$(npm_ran; [ $? -ne 0 ]; echo $?)"
new_env l6b; unset C3D_INSTALL_BASE_URL
run_install --status --prefix "$T/prefix"
assert_rc "status (fresh): ok" 0
assert_has "status (fresh): detected" "Detected: no existing install"

# L7. --reinstall forces a fresh download even when current; --repair does not
new_env l7; mkfixv 0.0.0; mkprefix 0.0.0; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --reinstall --yes --version 0.0.0 --prefix "$T/prefix" --clients none
assert_rc "reinstall: ok" 0
assert_has "reinstall: downloads again" "SHA-256 verified for c3d-mcp-0.0.0.tgz"
assert_has "reinstall: setup reinstalls" "setup --reinstall --yes --clients none --node-path"
new_env l7b; mkfixv 0.0.0; mkprefix 0.0.0; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --repair --yes --version 0.0.0 --prefix "$T/prefix" --clients none
assert_rc "repair (healthy): ok" 0
check "repair (healthy): no download" "$(npm_ran; [ $? -ne 0 ]; echo $?)"
assert_has "repair: setup repairs" "setup --repair --yes --clients none --node-path"

# L8. --uninstall: bridge + helper only (prefix stays); --all also removes the prefix and the PATH line
new_env l8; mkprefix 0.0.0; mkdir -p "$T/prefix/node/bin"; unset C3D_INSTALL_BASE_URL
printf 'export EDITOR=vim\n\n# c3d-mcp\nexport PATH="%s/bin:$PATH"\nexport KEEP=1\n' "$T/prefix" >"$T/home/.zprofile"
run_install --uninstall --yes --prefix "$T/prefix"
assert_rc "uninstall: ok" 0
assert_has "uninstall: asks the CLI to remove the bridge" "NODE-STUB $T/prefix/app/node_modules/c3d-mcp/bin/c3d-mcp.js uninstall --yes"
check "uninstall: prefix kept" "$([ -x "$T/prefix/bin/c3d-mcp" ] && [ -d "$T/prefix/app" ]; echo $?)"
check "uninstall: PATH line kept" "$(grep -q "$T/prefix/bin" "$T/home/.zprofile"; echo $?)"
run_install --uninstall --all --yes --prefix "$T/prefix"
assert_rc "uninstall --all: ok" 0
assert_has "uninstall --all: CLI removes skills and client entries too" "uninstall --all --yes"
check "uninstall --all: app removed" "$([ ! -e "$T/prefix/app" ]; echo $?)"
check "uninstall --all: launcher removed" "$([ ! -e "$T/prefix/bin/c3d-mcp" ]; echo $?)"
check "uninstall --all: private node removed" "$([ ! -e "$T/prefix/node" ]; echo $?)"
check "uninstall --all: empty prefix removed" "$([ ! -e "$T/prefix" ]; echo $?)"
check "uninstall --all: our PATH lines removed, the rest kept" "$(! grep -q 'c3d-mcp' "$T/home/.zprofile" && grep -q 'EDITOR=vim' "$T/home/.zprofile" && grep -q 'KEEP=1' "$T/home/.zprofile"; echo $?)"
check "uninstall --all: .zprofile backed up" "$(ls -A "$T/home" | grep -q 'zprofile.c3d-backup'; echo $?)"

# L9. --all --keep-prefix keeps the prefix and the PATH line; foreign files keep the prefix directory
new_env l9; mkprefix 0.0.0; printf '# c3d-mcp\nexport PATH="%s/bin:$PATH"\n' "$T/prefix" >"$T/home/.zprofile"
run_install --uninstall --all --keep-prefix --yes --prefix "$T/prefix"
assert_rc "uninstall --all --keep-prefix: ok" 0
check "keep-prefix: prefix untouched" "$([ -x "$T/prefix/bin/c3d-mcp" ]; echo $?)"
check "keep-prefix: PATH line kept" "$(grep -q c3d-mcp "$T/home/.zprofile"; echo $?)"
new_env l9b; mkprefix 0.0.0; echo mine >"$T/prefix/my-notes.txt"
run_install --uninstall --all --yes --prefix "$T/prefix"
assert_rc "uninstall --all (foreign file): ok" 0
check "foreign file: kept with its directory" "$([ -f "$T/prefix/my-notes.txt" ]; echo $?)"
assert_has "foreign file: explained" "not created by c3d-mcp"
new_env l9c; mkprefix 0.0.0; printf '# c3d-mcp\nexport PATH="%s/bin:$PATH:/extra"\n' "$T/prefix" >"$T/home/.zprofile"
run_install --uninstall --all --yes --prefix "$T/prefix"
check "edited PATH line: left alone" "$(grep -q ':/extra' "$T/home/.zprofile"; echo $?)"
assert_has "edited PATH line: explained" "edited"

# L10. uninstall dry run changes nothing and reaches the CLI with --dry-run; nothing installed is reported
new_env l10; mkprefix 0.0.0
run_install --uninstall --all --dry-run --prefix "$T/prefix"
assert_rc "uninstall dry run: ok" 0
assert_has "uninstall dry run: CLI dry run" "uninstall --all --dry-run"
assert_has "uninstall dry run: says nothing was removed" "Dry run: nothing was removed"
assert_not "uninstall dry run: never asks or cancels" "Cancelled"
check "uninstall dry run: nothing removed" "$([ -x "$T/prefix/bin/c3d-mcp" ] && [ -d "$T/prefix/app" ]; echo $?)"
new_env l10b
run_install --uninstall --yes --prefix "$T/prefix"
assert_rc "uninstall (nothing installed): ok" 0
assert_has "uninstall (nothing installed): said so" "Nothing to uninstall"

# L11. confirmations: no terminal needs --yes; answers drive the questions; "n" removes nothing
new_env l11; mkprefix 0.0.0
run_install --uninstall --prefix "$T/prefix"
assert_rc "uninstall without --yes and without a terminal" 1
assert_has "uninstall: says to pass --yes" "--yes"
export C3D_INSTALL_ANSWERS="n"; run_install --uninstall --all --prefix "$T/prefix"
assert_rc "uninstall answered no: ok" 0
assert_has "uninstall answered no: aborted" "Cancelled"
check "uninstall answered no: nothing removed" "$([ -x "$T/prefix/bin/c3d-mcp" ]; echo $?)"
export C3D_INSTALL_ANSWERS="y"; run_install --uninstall --all --prefix "$T/prefix"
check "uninstall answered yes: removed" "$([ ! -e "$T/prefix/app" ]; echo $?)"
unset C3D_INSTALL_ANSWERS

# L12. interactive menu when an install exists: update / repair / reinstall / uninstall / status / quit
new_env l12; mkfixv 0.1.0; mkprefix 0.0.0; export C3D_INSTALL_BASE_URL="file://$FIX"
export C3D_INSTALL_ANSWERS="q"; run_install --version 0.1.0 --prefix "$T/prefix" --clients none
assert_rc "menu: quit" 0
assert_has "menu: offers update first" "1) Update"
assert_has "menu: shows reinstall" "Reinstall"
assert_has "menu: shows uninstall everything" "Uninstall everything"
check "menu: quit changes nothing" "$([ "$(inst_ver)" = 0.0.0 ]; echo $?)"
export C3D_INSTALL_ANSWERS="1,y,n"; run_install --version 0.1.0 --prefix "$T/prefix" --clients none
assert_rc "menu: 1 (update) completes" 0
check "menu: 1 updates" "$([ "$(inst_ver)" = 0.1.0 ]; echo $?)"
export C3D_INSTALL_ANSWERS="3,y,n"; run_install --version 0.1.0 --prefix "$T/prefix" --clients none
assert_rc "menu: 3 (reinstall) completes" 0
assert_has "menu: 3 reinstalls" "setup --reinstall"
export C3D_INSTALL_ANSWERS="2,n"; run_install --version 0.1.0 --prefix "$T/prefix" --clients none
assert_rc "menu: 2 (repair) completes" 0
assert_has "menu: 2 repairs" "setup --repair"
export C3D_INSTALL_ANSWERS="6"; run_install --version 0.1.0 --prefix "$T/prefix" --clients none
assert_rc "menu: 6 (status) completes" 0
assert_has "menu: 6 shows the status" "c3d-mcp.js status"
export C3D_INSTALL_ANSWERS="5,y"; run_install --version 0.1.0 --prefix "$T/prefix" --clients none
assert_rc "menu: 5 (uninstall everything) completes" 0
check "menu: 5 uninstalls everything" "$([ ! -e "$T/prefix" ]; echo $?)"
unset C3D_INSTALL_ANSWERS
new_env l12b; mkfixv 0.1.0; mkprefix 0.0.0; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --yes --version 0.1.0 --prefix "$T/prefix" --clients none
assert_not "no menu with --yes" "1) Update"
export C3D_INSTALL_ANSWERS="q"; run_install --dry-run --yes --version 0.1.0 --prefix "$T/prefix"
assert_not "no menu in a dry run" "1) Update"
unset C3D_INSTALL_ANSWERS

# L12c. --no-setup installs the package and stops before the wizard (scripts, sandboxes)
new_env l12c; mkfixv 0.0.0; export C3D_INSTALL_BASE_URL="file://$FIX"
run_install --no-setup --yes --version 0.0.0 --prefix "$T/prefix"
assert_rc "no-setup: ok" 0
check "no-setup: package installed" "$([ -x "$T/prefix/bin/c3d-mcp" ]; echo $?)"
assert_has "no-setup: says it skipped the wizard" "Skipped the setup wizard"
assert_not "no-setup: wizard not run" "NODE-STUB"
unset C3D_INSTALL_BASE_URL

# L13. a c3d-mcp elsewhere on PATH (for example npm -g) is reported, not touched
new_env l13; mkprefix 0.0.0; mkfixv 0.0.0; export C3D_INSTALL_BASE_URL="file://$FIX"
mkdir -p "$T/elsewhere"; printf '#!/bin/sh\necho 9.9.9\n' >"$T/elsewhere/c3d-mcp"; chmod +x "$T/elsewhere/c3d-mcp"
OUT=$(HOME="$T/home" PATH="$T/elsewhere:$STUBS:/usr/bin:/bin" TMPDIR="$T" NPM_LOG="$NPM_LOG" C3D_APPS_DIRS="$T/Apps" C3D_CHEETAH_SUPPORT_DIR="$T/support" bash "$INSTALL" --status --prefix "$T/prefix" </dev/null 2>&1); RC=$?
assert_has "other install: reported" "also found outside the prefix"
unset C3D_INSTALL_BASE_URL

echo "1..$N"
echo "# pass $PASS"
echo "# fail $FAIL"
[ "$FAIL" -eq 0 ]
