# Changelog

## 0.1.2
Open issues from the 0.1.1 review resolved:
- New tools: `c3d_get_scene_stats`, `c3d_set_background` (solid/gradient/image), `c3d_create_pipe` (swept tube with fillets, covers the torus-sweep gap), `c3d_postprocess_image` (bloom, outlines, vignette, grade, posterize via the helper; CoreImage).
- Per-polygon materials: `c3d_assign_material polygons`/`slot` (render-verified; earlier "unsupported" was a wrong probe).
- Light aiming: `look_at_*` on lights switches the light `axis` option to -Z so the aim is correct (distant/point/area/spot).
- Crash #2 root cause found (removing a material created in the same script run); the script `doc` now refuses it. Crash #1 (OBJ) could not be reproduced in 12 controlled scenes; mitigations kept.
- Runtime: `sceneStats` op, cleanup removes from the actual parent after failed creates, Link `{ref}` values, Vec4D 3-component keyframes, partial-result surfacing for render settings.
- Installer used a stale packaged runtime over a fresh build: fixed (newest asset wins).
- Security hardening: peer-uid check on the helper socket, helper signature verified before auto-launch (`C3D_HELPER_SKIP_VERIFY=1` to bypass), mailbox directory ownership checks, streaming download caps, export sibling/confinement checks, uninstall removes only what install created. Helper image commands refuse existing output files and `..` paths.
- `c3d-mcp config <client> --raw`.

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
