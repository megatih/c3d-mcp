# Runbook: items that need hardware, credentials or clients this repo's CI machine did not have

## Real-client smoke runs (Gemini CLI, Cursor, LM Studio, Antigravity)
For each client: `c3d-mcp config <client> --raw` (client = gemini-cli, cursor, lm-studio, antigravity), paste the snippet into the client's MCP config, restart it, then ask:
1. "Run c3d_doctor." - expect all checks ok.
2. "Create a new document, add a red box and a point light, render 320x180 and tell me the mean luma." - expect a render and no errors.
3. "Create a pipe through (0,0,0) (2,0,0) (2,2,0) radius 0.1 and render it." - expect a pipe in the image.
For LM Studio / small local models use `C3D_MCP_PROFILE=local`. Record the client version, model and result in docs/qa/clients.md.

## Timed fresh-Mac install (requirements target: under 10 minutes)
On a clean macOS 14+ Apple Silicon account with Cheetah3D 8.1.3 installed and launched once: start a timer, run `npx -y https://github.com/megatih/c3d-mcp/releases/download/v0.1.2/c3d-mcp-0.1.2.tgz install`, restart Cheetah3D, grant Accessibility to the helper, run `doctor`. Stop the timer when doctor is green and note every manual step and any Gatekeeper prompt.

## Notarization (needs a Developer ID Application certificate)
`C3D_SIGN_IDENTITY="Developer ID Application: <name> (<team>)" scripts/release.sh`, then `xcrun notarytool submit release/C3D-Bridge-Helper-<v>.zip --keychain-profile <profile> --wait` and `xcrun stapler staple` on the app inside the zip before re-zipping; update the cask sha256.

## Conformance suite
The 6 unpassed scenarios require the suite's own fixture tools/resources/prompts (`test_simple_text`, `test://static-text`, ...). They are expected to fail for a real server and are intentionally not faked; see docs/qa/conformance.md.
