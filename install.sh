#!/bin/bash
# =============================================================================
# c3d-mcp installer for macOS
#
#   curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/install.sh | bash
#
# WHAT THIS SCRIPT CHANGES
#   * Only $PREFIX (default ~/.c3d-mcp): a private Node.js (only if you agree
#     and none >= 22 is found), the c3d-mcp npm package, and a launcher at
#     $PREFIX/bin/c3d-mcp.
#   * Optionally (opt-in, default NO) one line appended to ~/.zprofile.
#   * Via the `c3d-mcp setup` wizard it hands over to: the Cheetah3D
#     Scripts/MCP folders and your MCP client configs (the wizard asks first).
#   * It NEVER uses sudo and never pipes anything into a shell with sudo.
#   * Nothing is changed without a prompt (use --yes to accept defaults).
#   * Downloads are verified with SHA-256 before use; a mismatch aborts.
#
# INSPECT BEFORE RUNNING
#   curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/install.sh -o install.sh
#   less install.sh
#   bash install.sh --dry-run      # report only, changes nothing
#   bash install.sh
#
# FLAGS
#   --yes                 accept defaults at every prompt
#   --dry-run             report only; download/install/change nothing
#   --no-node-install     never install Node.js (fail with instructions)
#   --skip-cheetah-check  do not require Cheetah3D / its support folder
#   --version <v>         install this c3d-mcp version (default: pinned/latest)
#   --prefix <dir>        install location (default ~/.c3d-mcp)
#   --help                show this help
#   anything else         passed through to `c3d-mcp setup`
#
# ENV OVERRIDES (mainly for tests)
#   C3D_INSTALL_BASE_URL     release base URL (default GitHub releases/download)
#   C3D_NODE_BASE_URL        Node.js dist URL (default https://nodejs.org/dist)
#   C3D_APPS_DIRS            colon-separated dirs searched for Cheetah3D.app
#   C3D_CHEETAH_SUPPORT_DIR  Cheetah3D support dir (same var the server uses)
# =============================================================================
set -eu

# --- Pinned values; scripts/release.sh stamps these when cutting a release. ---
NODE_VERSION="22.23.4"            # release.sh bumps this to a current 22.x LTS
C3D_VERSION="@@C3D_VERSION@@"
C3D_TGZ_SHA256="@@C3D_TGZ_SHA256@@"
EXPECTED_CHEETAH_VERSION="8.1.3"
MIN_MACOS=14
MIN_NODE=22
DEFAULT_BASE="https://github.com/megatih/c3d-mcp/releases/download"
LATEST_URL="https://github.com/megatih/c3d-mcp/releases/latest"

# --- Output helpers (no colour unless stdout is a TTY) ---
if [ -t 1 ]; then
  C_OK=$(printf '\033[32m'); C_BAD=$(printf '\033[31m'); C_FIX=$(printf '\033[33m'); C_OFF=$(printf '\033[0m')
else
  C_OK=""; C_BAD=""; C_FIX=""; C_OFF=""
fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s[ok]%s %s\n' "$C_OK" "$C_OFF" "$*"; }
miss() { printf '%s[missing]%s %s\n' "$C_BAD" "$C_OFF" "$*"; }
fix()  { printf '%s[fix]%s %s\n' "$C_FIX" "$C_OFF" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$C_FIX" "$C_OFF" "$*"; }
step() { printf '\n== %s ==\n' "$*"; }
die()  { printf '%s[error]%s %s\n' "$C_BAD" "$C_OFF" "$*" >&2; exit 1; }

# --- State ---
YES=0; DRY=0; NO_NODE_INSTALL=0; SKIP_CHEETAH=0
VERSION_OVERRIDE=""; PREFIX=""; VERSION=""; OLD_NODE=""
PASS_ARGS=()
TTY_IN=""; TTY_CHECKED=0
NODE_BIN=""
ARCH=""; NODE_ARCH=""

show_help() {
  cat <<'HLP'
c3d-mcp installer (macOS). Never uses sudo; changes only --prefix (default ~/.c3d-mcp)
unless you opt in to a ~/.zprofile line; the setup wizard handles Cheetah3D/MCP clients.

Usage: install.sh [flags]
  --yes                 accept defaults at every prompt
  --dry-run             report only; download/install/change nothing
  --no-node-install     never install Node.js
  --skip-cheetah-check  do not require Cheetah3D / its support folder
  --version <v>         c3d-mcp version to install
  --prefix <dir>        install location (default ~/.c3d-mcp)
  --help                this text
Other flags are passed to `c3d-mcp setup` (--json, --clients <csv|all|none>, --no-skills).
HLP
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --yes|-y) YES=1; PASS_ARGS+=("--yes") ;;
      --dry-run) DRY=1; PASS_ARGS+=("--dry-run") ;;
      --no-node-install) NO_NODE_INSTALL=1 ;;
      --skip-cheetah-check) SKIP_CHEETAH=1 ;;
      --version) [ $# -ge 2 ] || die "--version needs a value"; VERSION_OVERRIDE="$2"; shift ;;
      --version=*) VERSION_OVERRIDE="${1#--version=}" ;;
      --prefix) [ $# -ge 2 ] || die "--prefix needs a value"; PREFIX="$2"; shift ;;
      --prefix=*) PREFIX="${1#--prefix=}" ;;
      --help|-h) show_help; exit 0 ;;
      *) PASS_ARGS+=("$1") ;;
    esac
    shift
  done
  [ -n "$PREFIX" ] || PREFIX="$HOME/.c3d-mcp"
}

# --- Prompts: read from the terminal even under `curl | bash` ---
init_tty() {
  [ "$TTY_CHECKED" = 1 ] && return 0
  TTY_CHECKED=1
  if [ -t 0 ]; then TTY_IN="/dev/stdin"
  elif ( : </dev/tty ) 2>/dev/null; then TTY_IN="/dev/tty"
  else TTY_IN=""; fi
}

# ask "question" default(y|n) -> returns 0 for yes
ask() {
  local q="$1" def="$2" ans="" hint="[y/N]"
  [ "$def" = y ] && hint="[Y/n]"
  if [ "$YES" = 1 ]; then
    say "? $q $hint -> (--yes) $def"
    [ "$def" = y ]; return
  fi
  if [ "$DRY" = 1 ]; then
    say "? $q $hint -> (dry-run, not asked) $def"
    [ "$def" = y ]; return
  fi
  init_tty
  if [ -z "$TTY_IN" ]; then
    die "Need to ask: \"$q\" but no terminal is available. Re-run with --yes to accept defaults, or download first:
  curl -fsSL $LATEST_URL/download/install.sh -o install.sh && bash install.sh"
  fi
  printf '? %s %s ' "$q" "$hint" >&2
  read -r ans <"$TTY_IN" || ans=""
  [ -n "$ans" ] || ans="$def"
  case "$ans" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

# --- 1. Platform ---
check_platform() {
  step "Platform"
  local os; os=$(uname -s 2>/dev/null || echo unknown)
  if [ "$os" != "Darwin" ]; then
    miss "macOS required (found: $os)"
    say "c3d-mcp drives Cheetah3D, which only runs on macOS. Aborting."
    exit 1
  fi
  local ver major
  ver=$(sw_vers -productVersion 2>/dev/null || echo 0)
  major=${ver%%.*}
  case "$major" in ''|*[!0-9]*) major=0 ;; esac
  if [ "$major" -lt "$MIN_MACOS" ]; then
    miss "macOS $MIN_MACOS or newer required (found: $ver)"
    fix "Update macOS, then re-run this installer."
    exit 1
  fi
  ok "macOS $ver"
  ARCH=$(uname -m 2>/dev/null || echo unknown)
  case "$ARCH" in
    arm64) NODE_ARCH="arm64"; ok "Apple Silicon (arm64)" ;;
    x86_64) NODE_ARCH="x64"; warn "Intel Mac (x86_64): not the primary target; things may be slower or untested" ;;
    *) die "Unsupported architecture: $ARCH" ;;
  esac
}

# --- 2. Cheetah3D ---
find_cheetah() {
  local d dirs oldifs="$IFS"
  dirs="${C3D_APPS_DIRS:-/Applications:$HOME/Applications}"
  IFS=:
  for d in $dirs; do
    if [ -d "$d/Cheetah3D.app" ]; then IFS="$oldifs"; printf '%s' "$d/Cheetah3D.app"; return 0; fi
  done
  IFS="$oldifs"
  if [ -z "${C3D_APPS_DIRS:-}" ] && command -v mdfind >/dev/null 2>&1; then
    local hit
    hit=$(mdfind "kMDItemFSName == 'Cheetah3D.app'" 2>/dev/null | head -n 1 || true)
    if [ -n "$hit" ] && [ -d "$hit" ]; then printf '%s' "$hit"; return 0; fi
  fi
  return 1
}

check_cheetah() {
  step "Cheetah3D"
  if [ "$SKIP_CHEETAH" = 1 ]; then
    warn "Skipping Cheetah3D check (--skip-cheetah-check)"; return 0
  fi
  local app
  if ! app=$(find_cheetah); then
    miss "Cheetah3D.app not found in /Applications or ~/Applications"
    say "Cheetah3D is commercial software and is not installed by this script."
    fix "Get it from https://www.cheetah3d.com, install it, launch it once, then re-run this installer."
    fix "(To install c3d-mcp anyway, re-run with --skip-cheetah-check.)"
    exit 1
  fi
  local v=""
  v=$(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist" 2>/dev/null || true)
  [ -n "$v" ] || v=$(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)
  [ -n "$v" ] || v="unknown"
  ok "Cheetah3D found: $app (version $v)"
  if [ "$v" != "$EXPECTED_CHEETAH_VERSION" ]; then
    warn "Tested with Cheetah3D $EXPECTED_CHEETAH_VERSION; you have $v. It may still work."
  fi
  local sdir="${C3D_CHEETAH_SUPPORT_DIR:-$HOME/Library/Application Support/Cheetah3D}"
  if [ -d "$sdir" ]; then
    ok "Support folder exists: $sdir (Cheetah3D has been launched before)"
  else
    miss "Support folder not found: $sdir (Cheetah3D has never been launched)"
    fix "Launch Cheetah3D once so it creates its folders, quit it, then re-run this installer."
    if [ "$DRY" = 0 ] && [ "$YES" = 0 ] && ask "Open Cheetah3D now?" n; then
      open -a Cheetah3D || warn "Could not open Cheetah3D; open it manually."
    fi
    exit 1
  fi
}

# --- 3. Node.js ---
node_major() { # prints major version of node binary $1, or 0
  local out
  out=$("$1" --version 2>/dev/null || true)
  out=${out#v}; out=${out%%.*}
  case "$out" in ''|*[!0-9]*) out=0 ;; esac
  printf '%s' "$out"
}

locate_node() {
  local cand
  if cand=$(command -v node 2>/dev/null) && [ -n "$cand" ]; then
    if [ "$(node_major "$cand")" -ge "$MIN_NODE" ]; then NODE_BIN="$cand"; return 0; fi
    OLD_NODE="$cand ($("$cand" --version 2>/dev/null || echo '?'))"
  fi
  if [ -x "$PREFIX/node/bin/node" ] && [ "$(node_major "$PREFIX/node/bin/node")" -ge "$MIN_NODE" ]; then
    NODE_BIN="$PREFIX/node/bin/node"; return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    local bp
    bp=$(brew --prefix node@22 2>/dev/null || true)
    if [ -n "$bp" ] && [ -x "$bp/bin/node" ] && [ "$(node_major "$bp/bin/node")" -ge "$MIN_NODE" ]; then
      NODE_BIN="$bp/bin/node"; return 0
    fi
  fi
  return 1
}

manual_node_steps() {
  say "Install Node.js $MIN_NODE or newer yourself, then re-run:"
  say "  - download the macOS installer from https://nodejs.org, or"
  say "  - brew install node@22   (if you use Homebrew)"
}

install_node_tarball() {
  local base="${C3D_NODE_BASE_URL:-https://nodejs.org/dist}"
  local name="node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
  local dir="$base/v${NODE_VERSION}"
  local tmp; tmp=$(mktemp -d "${TMPDIR:-/tmp}/c3d-node.XXXXXX")
  say "Downloading $dir/$name"
  curl -fsSL "$dir/$name" -o "$tmp/$name" || { rm -rf "$tmp"; die "Download failed: $dir/$name"; }
  curl -fsSL "$dir/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" || { rm -rf "$tmp"; die "Download failed: $dir/SHASUMS256.txt"; }
  local want got
  want=$(awk -v n="$name" '$2==n {print $1}' "$tmp/SHASUMS256.txt" | head -n 1)
  got=$(shasum -a 256 "$tmp/$name" | awk '{print $1}')
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    rm -rf "$tmp"
    die "SHA-256 mismatch for $name (expected '${want:-none listed}', got '$got'). Download deleted; nothing installed."
  fi
  ok "SHA-256 verified for $name"
  mkdir -p "$PREFIX/node"
  tar -xzf "$tmp/$name" -C "$PREFIX/node" --strip-components=1 || { rm -rf "$tmp"; die "Could not unpack Node.js"; }
  rm -rf "$tmp"
  [ -x "$PREFIX/node/bin/node" ] || die "Node.js unpacked but $PREFIX/node/bin/node is missing"
  NODE_BIN="$PREFIX/node/bin/node"
}

check_node() {
  step "Node.js (>= $MIN_NODE)"
  OLD_NODE=""
  if locate_node; then
    ok "Node.js $("$NODE_BIN" --version) at $NODE_BIN"
    return 0
  fi
  if [ -n "$OLD_NODE" ]; then miss "Node.js is too old: $OLD_NODE (need >= $MIN_NODE)"
  else miss "Node.js not found"; fi

  if [ "$NO_NODE_INSTALL" = 1 ]; then
    fix "--no-node-install given."; manual_node_steps; exit 1
  fi
  if command -v brew >/dev/null 2>&1; then
    fix "Homebrew found: can run  brew install node@22"
    if [ "$DRY" = 1 ]; then
      say "Would (after asking) run: brew install node@22"; NODE_BIN="<node@22 from Homebrew>"; return 0
    fi
    if ask "Install Node.js with Homebrew (brew install node@22)?" y; then
      brew install node@22 || die "brew install node@22 failed"
      local bp; bp=$(brew --prefix node@22 2>/dev/null || true)
      if [ -z "$bp" ] || [ ! -x "$bp/bin/node" ]; then die "Installed node@22 but could not locate its binary"; fi
      NODE_BIN="$bp/bin/node"; ok "Node.js $("$NODE_BIN" --version) at $NODE_BIN"; return 0
    fi
  else
    fix "Can download official Node.js v$NODE_VERSION (darwin-$NODE_ARCH) into $PREFIX/node (no sudo, SHA-256 verified)"
    if [ "$DRY" = 1 ]; then
      say "Would (after asking) download nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$NODE_ARCH.tar.gz and verify against SHASUMS256.txt"
      NODE_BIN="$PREFIX/node/bin/node"; return 0
    fi
    if ask "Download Node.js v$NODE_VERSION into $PREFIX/node?" y; then
      install_node_tarball; ok "Node.js $("$NODE_BIN" --version) at $NODE_BIN"; return 0
    fi
  fi
  manual_node_steps
  exit 1
}

# --- 4. c3d-mcp ---
is_placeholder() { case "$1" in "@@"*) return 0 ;; *) return 1 ;; esac; }

resolve_version() {
  local v="$C3D_VERSION"
  [ -n "$VERSION_OVERRIDE" ] && v="${VERSION_OVERRIDE#v}"
  if is_placeholder "$v"; then
    if [ "$DRY" = 1 ]; then VERSION="latest"; return 0; fi
    [ -z "${C3D_INSTALL_BASE_URL:-}" ] || die "No pinned version; pass --version <v> when using C3D_INSTALL_BASE_URL"
    local url tag
    url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$LATEST_URL") || die "Could not resolve the latest release. Pass --version <v>."
    tag=${url##*/}; v=${tag#v}
    [ -n "$v" ] || die "Could not parse latest release from $url"
  fi
  VERSION="$v"
}

write_launcher() {
  mkdir -p "$PREFIX/bin"
  {
    printf '#!/bin/sh\n'
    printf 'exec "%s" "%s/app/node_modules/c3d-mcp/bin/c3d-mcp.js" "$@"\n' "$NODE_BIN" "$PREFIX"
  } > "$PREFIX/bin/c3d-mcp"
  chmod +x "$PREFIX/bin/c3d-mcp"
}

install_c3d() {
  step "c3d-mcp"
  local base="${C3D_INSTALL_BASE_URL:-$DEFAULT_BASE}"
  resolve_version
  local tgz="c3d-mcp-$VERSION.tgz"
  local url="$base/v$VERSION/$tgz"
  local use_pinned=0
  if ! is_placeholder "$C3D_TGZ_SHA256" && [ -z "$VERSION_OVERRIDE" ]; then use_pinned=1; fi
  if [ "$DRY" = 1 ]; then
    fix "Would download $url"
    if [ "$use_pinned" = 1 ]; then say "Would verify against pinned SHA-256 $C3D_TGZ_SHA256"
    else say "Would verify against $base/v$VERSION/SHA256SUMS"; fi
    say "Would run: <npm next to chosen node> install --prefix $PREFIX/app --omit=dev --no-audit --no-fund <tgz>"
    say "Would create launcher: $PREFIX/bin/c3d-mcp"
    return 0
  fi
  if [ -f "$PREFIX/app/node_modules/c3d-mcp/package.json" ] \
     && grep -q "\"version\": *\"$VERSION\"" "$PREFIX/app/node_modules/c3d-mcp/package.json" 2>/dev/null; then
    ok "c3d-mcp $VERSION already installed in $PREFIX"
    write_launcher
    return 0
  fi
  if ! ask "Install c3d-mcp $VERSION into $PREFIX?" y; then die "Cancelled; nothing installed."; fi
  local tmp; tmp=$(mktemp -d "${TMPDIR:-/tmp}/c3d-dl.XXXXXX")
  say "Downloading $url"
  curl -fsSL "$url" -o "$tmp/$tgz" || { rm -rf "$tmp"; die "Download failed: $url"; }
  local want=""
  if [ "$use_pinned" = 1 ]; then
    want="$C3D_TGZ_SHA256"
  else
    curl -fsSL "$base/v$VERSION/SHA256SUMS" -o "$tmp/SHA256SUMS" || { rm -rf "$tmp"; die "Download failed: $base/v$VERSION/SHA256SUMS"; }
    want=$(awk -v n="$tgz" '{f=$2; sub(/^\*/,"",f); sub(/^.*\//,"",f); if (f==n) print $1}' "$tmp/SHA256SUMS" | head -n 1)
  fi
  local got; got=$(shasum -a 256 "$tmp/$tgz" | awk '{print $1}')
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    rm -rf "$tmp"
    die "SHA-256 mismatch for $tgz (expected '${want:-none listed}', got '$got'). Download deleted; nothing installed."
  fi
  ok "SHA-256 verified for $tgz"
  mkdir -p "$PREFIX/app" "$PREFIX/bin"
  local npm_bin; npm_bin="$(dirname "$NODE_BIN")/npm"
  [ -x "$npm_bin" ] || npm_bin=$(command -v npm 2>/dev/null || true)
  if [ -z "$npm_bin" ]; then rm -rf "$tmp"; die "npm not found next to $NODE_BIN"; fi
  [ -f "$PREFIX/app/package.json" ] || printf '{"name":"c3d-mcp-app","private":true}\n' > "$PREFIX/app/package.json"
  # Put the chosen node first so npm and its scripts use the same runtime.
  PATH="$(dirname "$NODE_BIN"):$PATH" "$npm_bin" install --prefix "$PREFIX/app" --omit=dev --no-audit --no-fund "$tmp/$tgz" \
    || { rm -rf "$tmp"; die "npm install failed"; }
  rm -rf "$tmp"
  [ -f "$PREFIX/app/node_modules/c3d-mcp/bin/c3d-mcp.js" ] || die "Install finished but bin/c3d-mcp.js is missing under $PREFIX/app"
  write_launcher
  ok "Installed c3d-mcp $VERSION; launcher: $PREFIX/bin/c3d-mcp"
}

offer_path() {
  local line="export PATH=\"$PREFIX/bin:\$PATH\""
  local zp="$HOME/.zprofile"
  step "PATH (optional)"
  if [ -f "$zp" ] && grep -qF "$PREFIX/bin" "$zp" 2>/dev/null; then
    ok "$zp already puts $PREFIX/bin on PATH"; return 0
  fi
  say "Line that would be appended to $zp:"
  say "  $line"
  [ "$DRY" = 1 ] && return 0
  if ask "Append it to $zp?" n; then
    printf '\n# c3d-mcp\n%s\n' "$line" >> "$zp"
    ok "Appended to $zp (open a new terminal to use it)"
  else
    say "Skipped. Run it directly as $PREFIX/bin/c3d-mcp"
  fi
}

# --- 5. Hand over ---
handover() {
  step "Setup wizard"
  local cmd=("$PREFIX/bin/c3d-mcp" setup)
  if [ ${#PASS_ARGS[@]} -gt 0 ]; then cmd+=("${PASS_ARGS[@]}"); fi
  cmd+=(--node-path "$NODE_BIN")
  if [ "$DRY" = 1 ]; then
    say "Dry run: would now run:"
    say "  ${cmd[*]}"
    say "Dry run complete; nothing was changed."
    return 0
  fi
  say "Running: ${cmd[*]}"
  init_tty
  if [ ! -t 0 ] && [ -n "$TTY_IN" ]; then exec "${cmd[@]}" <"$TTY_IN"; fi
  exec "${cmd[@]}"
}

main() {
  parse_args "$@"
  say "c3d-mcp installer"
  if [ "$DRY" = 1 ]; then say "(dry run: nothing will be downloaded or changed)"; fi
  check_platform
  check_cheetah
  check_node
  install_c3d
  offer_path
  handover
}

main "$@"
