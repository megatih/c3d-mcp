# Changelog

## 0.3.1 (2026-10-30)
Research-to-code audit (details and evidence: `docs/qa/research-traceability-audit.md`). Runtime 1.0.1 (content changed since 1.0.0; capabilities are cached per runtime version). All components are versioned 0.3.1 (server, helper app, `.mcpb`, plugin, marketplace, registry, cask); the in-app runtime keeps its own protocol version (1.0.1: the server refuses a runtime with a different major).
- **New:** auto-launch. When a call finds Cheetah3D not running, the helper app launches it, waits for its menu bar, uses the untitled document it opens (File > New if none) and runs the call again once; a crash in the middle of a request is still `APP_CRASHED`. Needs the helper; `C3D_MCP_NO_AUTOLAUNCH=1` turns it off. Verified live (opt-out: immediate `APP_NOT_RUNNING`; default: launched and answered in 1.5 s).
- **Evals:** the five tasks added or flaky since the last full run pass 15/15 (N=3); the eval runner keeps the display awake (a sleeping display hides Cheetah3D's windows from Accessibility).
- **Fix:** `c3d_set_keyframes` with a 3-component colour (`[r,g,b]`, `{r,g,b}`, `{x,y,z}`) no longer fails; the alpha keeps the parameter's current value.
- **Fix:** `Shadowmat` is listed in `c3d_capabilities`; `File.readInt` (present in 8.1.3, missing from the sandbox wrapper) works in `c3d_run_script` and is no longer flagged by the linter.
- **Fix:** the live-test window cleanup now closes edited scratch documents on macOS 27 ("Do you want to keep this new document?" -> Delete) and reports only windows that really closed.
- **New:** long calls forward the "Waiting for Cheetah3D (Ns)" heartbeat as MCP progress (stops when the request ends); `c3d_remove_tag`, `c3d_takes remove` and lossy `c3d_edit_mesh` take an automatic checkpoint first; `c3d_doctor` warns about a helper older than the one this release ships; `.mcpb` option `disable_shell`.
- **Lint:** `isAnimateable` is flagged (the method is `isAnimatable`); Falcon `samples` of 0 or below (incl. negatives) is an error; the `removeMaterial` warning now says `obj.document()` cannot be guarded.
- **Knowledge:** the book's 8.1.1 errata are searchable (labelled not verified in 8.1.3); measured notes for shadow softness, Shadowmat, `isAnimateable` and the legacy tags; `c3d://templates/macro` parents its object.
- **Docs:** corrected statements about default interpolation (`soft`), `flat` = `spline`, sequence time, duplicate offsets, parenting, light axes and the Vision claim; research/10 section F.
- **Tests:** the live vitest suite, the `packages/server/scripts/*.mjs` dev scripts and the eval runner close the Cheetah3D windows they open (answering "Don't Save"; windows that existed before are left alone), through the shared `packages/server/scripts/window-cleanup.mjs`. `C3D_KEEP_WINDOWS=1` keeps them for inspection.

## 0.3.0 (2026-10-30)
Integration of two external knowledge sources, each claim checked against Cheetah3D 8.1.3 first (`research/10-kb-verification-8.1.3.md`).
- **Fix:** `c3d_create_mesh` and `c3d_create_pipe` now produce OUTWARD normals. Cheetah3D's front face is clockwise; counter-clockwise polygons (the documented input) used to get inward normals, invisible in renders (two-sided) but possibly wrong for exports, booleans and subdivision. New option `winding:"cw"` sends indices unchanged.
- **Fix:** material tags are capped at 24 per object, also through `c3d_add_tag` (30 crashed Cheetah3D 8.1.3, 24 were fine).
- **New:** `c3d_set_light` `shadow_softness` / `visible_in_camera`; `c3d_set_camera` `projection` (perspective, orthographic) / `camera_light` (off, on, auto); `c3d_set_background` kind `transparent` (PNG alpha 0); `c3d_create_material` type `Shadowmat` (shadow catcher); Falcon `samples` <= 0 is refused.
- **Search:** `c3d_search_api_docs` now covers per-method descriptions of the official API, the example scripts bundled with Cheetah3D, the book "Learn 3D with Cheetah 3D" and (last) the forum archive; hits carry a trust level and notes saying what was confirmed or refuted in 8.1.3; new `sources` filter. New resources `c3d://patterns`, `c3d://api/reference`, `c3d://verified`.
- **Lint:** rules now use a table of 178 constants measured in 8.1.3; new rules `vec4-isequal`, `many-shader-tags`, `falcon-samples-zero`; corrected `selected-object-null`, `light-constants`, `ctor-without-new`; `parent()` / `rib()` are reported as missing. All 17 official example scripts lint without errors.
- **Skills and docs:** corrected the scripting cheat sheet (no `parent()`, POINTLIGHT, constant values), look-dev (soft shadows, emission in Falcon, camera light, transparent background), scene-building (winding); README credits; limitations and troubleshooting. README tool count corrected to 60.
- **Vendored:** `vendor/c3d-scripting-kb` extended (API pages, examples, forum archive with emails and foreign home paths removed); new `vendor/learn3d-cheetah` (book text, BSD-2-Clause).

## 0.2.1
- **Sanitized release.** Sources, documentation and the published git history were scrubbed of personal paths and names; internal planning material, raw app dumps and third-party images were removed from the repository (the benchmark pages now link to the original video instead). Release archives (npm tarball, `.mcpb`, helper zip, installer) are built from the clean sources and scanned before publishing.
- New `scripts/check-public.mjs` leak scanner (tree, archives, git history) wired into the mirror sync, `scripts/release.sh` and CI.
- Added `SECURITY.md` (private vulnerability reporting), Dependabot configuration and a CI workflow.
- Older releases (0.1.0 to 0.2.0) were withdrawn because their packages contained a private folder name in the bundled research notes.

## 0.2.0
- **Installer for new users:** `install.sh` / `Install-c3d-mcp.command` (one command; checks macOS, Cheetah3D and Node.js 22+, offers to install Node via Homebrew or a checksum-verified private copy, never `sudo`) and the guided `c3d-mcp setup` wizard (bridge + helper, version-aware and verified opening of the Accessibility / Screen Recording panes, opt-in client configuration with backups, skills, doctor and a test render). See docs/INSTALL.md.

## 0.1.4
- Fix: `c3d-mcp skills install --target antigravity` now installs into `~/.gemini/config/skills` (user level) and `.agents/skills` (project level), the folders the current Antigravity CLI (`agy`) reads; verified with `agy` finding all six skills from both locations.

## 0.1.3
- **Agent skills** for Claude Code, Codex CLI, Antigravity, Claude Desktop and ChatGPT: `c3d-setup`, `c3d-scene-building`, `c3d-look-dev`, `c3d-scripting` (with a standalone-macro fallback for clients without MCP), `c3d-reference-recreation`, `c3d-animation-export`. They encode the lessons of the benchmark runs.
- `c3d-mcp skills install|uninstall|list` (targets claude, codex, antigravity; `--project`, `--dry-run`; never overwrites folders it did not create).
- Skills ship with every release: `c3d-skills-<version>.zip` plus one zip per skill (upload format for Claude Desktop and ChatGPT), inside the npm package, and inside the Claude Code plugin. `scripts/build-skills.mjs` validates them (format, links, tool names, syntax) and runs in `npm test`.
- See docs/SKILLS.md.

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
