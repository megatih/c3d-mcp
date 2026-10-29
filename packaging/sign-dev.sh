#!/bin/bash
# Signs an app bundle for local development and verifies it.
#
#   packaging/sign-dev.sh "helper/build/C3D Bridge Helper.app"
#
# Identity: $C3D_SIGN_IDENTITY (a code-signing identity name or SHA-1 from `security find-identity -v -p codesigning`).
# Unset or "-" => ad-hoc signature.
#
# WHY A STABLE IDENTITY MATTERS
#   An ad-hoc signature's designated requirement is the exact code hash (cdhash), so macOS TCC forgets the
#   Accessibility / Screen Recording grant on EVERY rebuild. A certificate-backed signature has a designated
#   requirement based on the certificate leaf + bundle id, so grants survive rebuilds signed with the same cert.
#
# ONE-TIME: CREATE A SELF-SIGNED CODE-SIGNING CERTIFICATE (user step, do not automate blindly)
#   Easiest (GUI):  Keychain Access > Certificate Assistant > Create a Certificate...
#                   Name "C3D Dev Signing", Identity Type "Self Signed Root", Certificate Type "Code Signing".
#   Command line:
#     W=$(mktemp -d); cd "$W"
#     printf '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=C3D Dev Signing\n[ext]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n' > cert.cnf
#     openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config cert.cnf -keyout dev.key -out dev.crt
#     openssl pkcs12 -export -inkey dev.key -in dev.crt -name "C3D Dev Signing" -out dev.p12 -passout pass:c3d
#     security import dev.p12 -k ~/Library/Keychains/login.keychain-db -P c3d -T /usr/bin/codesign
#     # Self-signed certs are untrusted until you trust them for code signing (asks for your password):
#     security add-trusted-cert -r trustRoot -p codeSign -k ~/Library/Keychains/login.keychain-db dev.crt
#     cd - && rm -rf "$W"
#     security find-identity -v -p codesigning     # should now list "C3D Dev Signing"
#   Then:  export C3D_SIGN_IDENTITY="C3D Dev Signing"
#   After the FIRST signed build the user must grant Accessibility / Screen Recording to the helper once more.
set -euo pipefail

APP="${1:?usage: sign-dev.sh <path-to-app-bundle>}"
IDENTITY="${C3D_SIGN_IDENTITY:--}"

if [ "$IDENTITY" = "-" ]; then
  echo "==> ad-hoc signing (TCC grants reset on every rebuild; see header for a stable self-signed identity)"
else
  echo "==> signing with identity: $IDENTITY"
fi

# Hardened runtime needs no entitlements here (no JIT, no library injection, no Apple Events).
sign() { codesign --force --sign "$IDENTITY" --options runtime --timestamp=none "$@"; }

# Sign nested executables first, then the bundle (avoids the deprecated --deep for signing).
for exe in "$APP"/Contents/MacOS/*; do
  sign --identifier "dev.c3dmcp.helper.$(basename "$exe")" "$exe"
done
sign --identifier dev.c3dmcp.helper "$APP"

codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dr - "$APP" 2>&1 | sed -n 's/^designated => /designated requirement: /p'
echo "==> signature OK"
