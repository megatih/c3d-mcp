#!/bin/bash
# Creates the Ed25519 key pair that signs C3D MCP updates (idempotent). Private key: ~/.c3d-mcp-signing/sparkle-ed25519.key (BACK IT UP; every
# future update must be signed by the same key, or installed apps will refuse it). Public key: printed, and stored next to it.
set -euo pipefail
DIR="${C3D_SIGNING_DIR:-$HOME/.c3d-mcp-signing}"
mkdir -p "$DIR"; chmod 700 "$DIR"
if [ -f "$DIR/sparkle-ed25519.key" ] && [ -f "$DIR/sparkle-ed25519.pub" ]; then echo "Update key already exists: $DIR/sparkle-ed25519.key"; cat "$DIR/sparkle-ed25519.pub"; echo; exit 0; fi
umask 077
swift "$(cd "$(dirname "$0")" && pwd)/make-update-key.swift" "$DIR/sparkle-ed25519.key" "$DIR/sparkle-ed25519.pub"
echo "Created the update-signing key in $DIR (back up sparkle-ed25519.key)."
