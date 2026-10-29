# Security policy

## Reporting a vulnerability
Please report security problems **privately** through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (private vulnerability reporting). Do not open a public issue for something exploitable. I will acknowledge a report within a few days and keep you updated until it is fixed.

## Scope
c3d-mcp runs on your own Mac, as your user: an MCP server that drives Cheetah3D through a file mailbox, a small Accessibility helper app, and an in-app JavaScript runtime. Its threat model, what it protects and what it deliberately does not (for example `c3d_run_script` is best-effort containment, not a security boundary) are described in [docs/SECURITY.md](docs/SECURITY.md).

In scope: the server, the bridge runtime, the helper app and the installer (`install.sh`, `c3d-mcp setup`). Out of scope: vulnerabilities in Cheetah3D itself, in your AI client, or in macOS.

## Supported versions
Only the latest release receives fixes.

## Installer integrity
The installer verifies every download against a SHA-256 checksum, never uses `sudo`, and can be read before it is run: `curl -fsSL <url> -o install.sh; less install.sh`. Release checksums are published in `SHA256SUMS` on each release.
