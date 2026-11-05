#!/bin/bash
# Creates the long-lived self-signed code-signing identity used to sign "C3D MCP.app" (idempotent).
#
#   packaging/make-signing-identity.sh
#
# WHY: an ad-hoc signature changes with every build, so macOS forgets the Accessibility / Screen Recording grant after every update.
# A certificate-backed signature keeps the same designated requirement as long as the SAME certificate signs every release.
# This is NOT an Apple certificate: Gatekeeper still shows its "unidentified developer" prompt on the first launch of a downloaded copy.
#
# Everything lives in ~/.c3d-mcp-signing (mode 0700), in its own keychain; your login keychain and its trust settings are not touched:
#   c3d-signing.keychain-db   the keychain holding the key (password in signing.env)
#   c3d-signing.p12           the same identity as a file: BACK THIS UP. Lose it and the next release needs one more permission re-grant.
#   signing.env               sourced by scripts/build-app.sh
set -euo pipefail

DIR="${C3D_SIGNING_DIR:-$HOME/.c3d-mcp-signing}"
NAME="C3D MCP Signing"
KC="$DIR/c3d-signing.keychain-db"
ENVFILE="$DIR/signing.env"

if [ -f "$ENVFILE" ] && [ -f "$KC" ]; then
  # shellcheck disable=SC1090
  . "$ENVFILE"
  if security find-certificate -c "$NAME" "$KC" >/dev/null 2>&1; then
    echo "Signing identity already exists: $KC"
    echo "SHA-1: ${C3D_SIGN_IDENTITY:-unknown}"
    exit 0
  fi
fi

umask 077
mkdir -p "$DIR"; chmod 700 "$DIR"
W=$(mktemp -d "${TMPDIR:-/tmp}/c3d-sign.XXXXXX")
trap 'rm -rf "$W"' EXIT
PASS=$(openssl rand -hex 16)

cat > "$W/cert.cnf" <<CNF
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=$NAME
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$W/cert.cnf" -keyout "$W/k.pem" -out "$W/c.pem" 2>/dev/null
# -legacy: the macOS keychain cannot read OpenSSL 3's default PKCS#12 encryption.
if openssl pkcs12 -help 2>&1 | grep -q -- '-legacy'; then LEGACY=(-legacy); else LEGACY=(); fi
openssl pkcs12 -export "${LEGACY[@]}" -inkey "$W/k.pem" -in "$W/c.pem" -name "$NAME" -out "$DIR/c3d-signing.p12" -passout "pass:$PASS"

rm -f "$KC"
security create-keychain -p "$PASS" "$KC"
security set-keychain-settings "$KC"                       # never auto-lock
security unlock-keychain -p "$PASS" "$KC"
security import "$DIR/c3d-signing.p12" -k "$KC" -P "$PASS" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "$PASS" "$KC" >/dev/null

SHA=$(security find-certificate -c "$NAME" -Z "$KC" | sed -n 's/^SHA-1 hash: //p' | head -n1)
[ -n "$SHA" ] || { echo "could not read the new certificate" >&2; exit 1; }
cat > "$ENVFILE" <<ENV
C3D_SIGN_KEYCHAIN="$KC"
C3D_SIGN_KEYCHAIN_PASSWORD="$PASS"
C3D_SIGN_IDENTITY="$SHA"
ENV
chmod 600 "$ENVFILE" "$DIR/c3d-signing.p12"
echo "Created signing identity '$NAME' (SHA-1 $SHA) in $DIR"
echo "Back up $DIR/c3d-signing.p12 (password is in signing.env): the same certificate must sign every future release."
