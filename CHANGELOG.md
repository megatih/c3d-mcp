# Changelog

## 0.1.1
Fixes and lessons from the Cornell Box and Cyberpunk Diorama benchmark runs (docs/benchmark/):
- Checkpoints are listed from disk after a server restart (ids continue instead of colliding).
- New opt-in `C3D_MCP_AUTO_CONFIRM=1` for unattended agent runs; by default a client that supports elicitation is always asked and the model's `confirm` flag is ignored.
- Script-type objects/tags (`SCRIPT*`) are refused; sandbox getter/`toString` escape closed; `File` write guard hardened (security review).
- Lint warns on `removeMaterial` (suspected Cheetah3D crash trigger, see research/08 crash #2).
- Tool descriptions: rotation components are x=heading, y=pitch, z=bank; `keep_world` limit; `c3d_run_script` quirks (parenting follows the selected object, no rollback on error); light types and attenuation; render/obj guidance.
- `doctor --brief`, helper install from the package, dialog-safe live tests, stale-`busy`/modal handling in the bridge client.
- Docs: benchmark prompts and results, troubleshooting, limitations, security.

## 0.1.0 (first release)
- First complete implementation: file-mailbox bridge into Cheetah3D 8.1.3, Swift helper app, TypeScript MCP server (`c3d-mcp`), 59 tools, packaging for npm / .mcpb / Claude Code plugin / Homebrew cask / MCP Registry.
