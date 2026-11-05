# Security policy

## Reporting a vulnerability
Please report security problems **privately** through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (private vulnerability reporting). Do not open a public issue for something exploitable. I will acknowledge a report within a few days and keep you updated until it is fixed.

## Scope
c3d-mcp runs on your own Mac, as your user: an MCP server that drives Cheetah3D through a file mailbox, the C3D MCP app (a control panel plus a small Accessibility helper), and an in-app JavaScript runtime. Its threat model, what it protects and what it deliberately does not (for example `c3d_run_script` is best-effort containment, not a security boundary) are described in [docs/SECURITY.md](docs/SECURITY.md).

In scope: the server, the bridge runtime, the C3D MCP app (including its update and cleanup functions) and the curl installer `get-c3d-mcp.sh`. Out of scope: vulnerabilities in Cheetah3D itself, in your AI client, or in macOS.

## Supported versions
Only the latest release receives fixes.

## Distribution integrity
The app is signed with a self-signed certificate, **not** an Apple Developer ID, and is not notarized; macOS therefore shows its "unidentified developer" prompt once for a browser download. What you can check instead: `SHA256SUMS` on every release; `get-c3d-mcp.sh` downloads the app zip and its `.sha256` from the release, aborts on a mismatch and verifies the app's code signature before copying it (it is short and meant to be read first: `curl -fsSL <url> -o get-c3d-mcp.sh; less get-c3d-mcp.sh`). In-app updates (Sparkle) are accepted only when the zip carries a valid EdDSA signature made with the project's update key, whose public half is inside the app. Nothing is installed with `sudo`. The signing certificate and the update key are held by the maintainer; if you suspect either is compromised, report it as described above.
