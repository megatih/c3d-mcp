# Cheetah3D MCP — research index & decision log

Researched 2026-10-29 on macOS 27.2 / Apple Silicon with Cheetah3D 8.1.3. Methods: local binary/bundle/manual inspection, live Accessibility probing, 4 parallel research agents (prior art, JS API, MCP/packaging/models, independent design QA), web research.

| File | Content |
|---|---|
| 01-prior-art.md | Existing Cheetah3D projects (none for MCP) + DCC MCP survey |
| 02-cheetah3d-js-api.md | Complete JS API reference with confidence tags |
| 03-host-integration.md | What the app exposes; channels; bridge protocol |
| 04-mcp-spec-and-best-practices.md | Spec 2026-07-28, SDKs, tool design, security |
| 05-macos-automation-tcc-capture.md | AX, TCC responsibility, ScreenCaptureKit, signing |
| 06-models-frontier-vs-mlx.md | Frontier vs local MLX; Vision/BM25 |
| 07-packaging-distribution.md | mcpb, plugin, npm, Homebrew, registry, CLI |
| 08-open-questions-and-probes.md | 30 live probes to run first |
| 09-qa-review.md | Independent review findings → resolutions |
| 10-kb-verification-8.1.3.md | Claims of c3d-scripting-kb and the book "Learn 3D with Cheetah 3D" tested against 8.1.3: confirmed / refined / refuted / not tested |
| raw/ | symbols, JS method-name table, menus, prior probe dumps |

## Decision log
1. **Build from scratch** (no prior MCP/bridge exists); **reuse** c3d-scripting-kb (docs, API index, linter) and Cheetah3DParser notes. Later (2026-10-30) both c3d-scripting-kb and the book "Learn 3D with Cheetah 3D" (same author) were integrated more deeply, but only after testing their claims in 8.1.3 (file 10).
2. **Bridge = file mailbox + AX menu press of a tiny loader macro**; runtime hot-loaded from disk. Sockets/timers/AppleScript are impossible.
3. **Stack = TypeScript MCP server (SDK v2, spec 2026-07-28) + Swift helper app** (user-approved).
4. **Helper owns TCC** (Accessibility, Screen Recording); LaunchAgent/`open -g` + Unix socket; never a Node child.
5. **`c3d_run_script` on by default with safeguards** (user-approved): shadowed OS/File, lint, backup, elicitation/`confirm`, env opt-out, hidden in local profile.
6. **No Developer ID** (user): dev self-signed cert; ad-hoc distribution; scripted notarization verified by `--dry-run`.
7. **Frontier clients first, local MLX second** via `C3D_MCP_PROFILE=local`; no LLM in-server.
8. **Visual feedback primarily via `doc.render`**, ScreenCaptureKit optional.
9. **Safety-first**: never touch user's `.jas`, never `File.mkDir`, backups before destructive/exec ops.
10. Distribution: npm, `.mcpb`, Claude Code plugin+marketplace, Homebrew tap/cask, MCP Registry, config snippets for Codex/Gemini/Antigravity/Cursor/LM Studio.
