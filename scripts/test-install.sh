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
prefix=""; while [ $# -gt 0 ]; do [ "$1" = --prefix ] && prefix="$2"; shift; done
mkdir -p "$prefix/node_modules/c3d-mcp/bin"
echo '{"name":"c3d-mcp","version":"0.0.0"}' >"$prefix/node_modules/c3d-mcp/package.json"
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

echo "1..$N"
echo "# pass $PASS"
echo "# fail $FAIL"
[ "$FAIL" -eq 0 ]
