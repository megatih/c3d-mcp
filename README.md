# c3d-mcp — an MCP server for Cheetah3D 8.1.3

> **New to c3d-mcp?** Read the friendly introduction, with install steps and two benchmark scenes (Cornell Box and Cyberpunk Diorama): **[Cheetah3D Meets AI](https://megatih.github.io/2026-10-29-cheetah3d-meets-ai-introducing-c3d-mcp/)**.

Let an AI agent (Claude Code / Claude Desktop, Codex, Gemini CLI, Antigravity, Cursor, LM Studio …) **inspect, build, edit, animate, light, texture, render and export scenes in the running Cheetah3D** on macOS 14+ / Apple Silicon (developed and tested on macOS 27.2).

Cheetah3D has no network API, no AppleScript dictionary and no URL scheme. `c3d-mcp` therefore works through three parts, all delivered by one app:

```
 MCP client ──stdio──▶ c3d-mcp server (TypeScript) ──mailbox files──▶ bridge macro inside Cheetah3D (JavaScript)
                              │                                              ▲
                              └──Unix socket──▶ C3D MCP.app (Swift: control panel + helper) ─┘ presses the macro's menu item (Accessibility)
```

* **Server** (`packages/server`): 63 `c3d_*` tools (60 scene, render and asset tools plus 3 health tools), resources and prompts; queue, safety checks, backups.
* **Bridge** (`bridge/`): a tiny loader macro plus a runtime that Cheetah3D executes, draining a request inbox and writing results.
* **App** (`helper/`): `C3D MCP.app`, a control panel plus the Accessibility helper that activates Cheetah3D, presses the bridge menu item, reports dialogs and takes screenshots. It also carries its own Node.js and the server, so nothing else has to be installed.

## Requirements
macOS 14+ on Apple Silicon (developed on macOS 27.2) and Cheetah3D 8.1.3. That is all: no Node.js, Homebrew or Terminal.

## Quickstart

**Download the app.** `C3D-MCP-<version>.dmg` from the [latest release](https://github.com/megatih/c3d-mcp/releases/latest): drag **C3D MCP** to Applications and open it. In the control panel: **Bridge** › install (then restart Cheetah3D once), **AI clients** › connect Claude Desktop/Code, Codex, Antigravity, Gemini CLI or Cursor, **Permissions** › grant Accessibility (Screen Recording is optional) and choose how often c3d-mcp asks for confirmation. **Overview** shows a Setup checklist and a health check that re-checks by itself when Cheetah3D starts, plus updates, **Activity** the helper log, **Cleanup** removes older installs.

The app is signed with its own certificate (there is no paid Apple Developer ID behind it), so macOS asks you **once** to confirm: *System Settings › Privacy & Security › Open Anyway*. To skip that prompt, one line downloads the same app without it (it only downloads, verifies the SHA-256, copies the app to Applications and opens it):

```bash
curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/get-c3d-mcp.sh | bash
```

Already installed an older version some other way (script, npm, npx, Homebrew, the Claude Desktop extension, the Claude Code plugin, by hand)? **Cleanup** finds and removes those (files go to the Trash). Full walkthrough: [docs/INSTALL.md](docs/INSTALL.md).

**Keep it healthy.** Everything is in the control panel; the same functions exist as commands of the bundled server (`"/Applications/C3D MCP.app/Contents/Resources/node/bin/node" "/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js" <command>`, add `--json` for machine-readable output):

| I want to… | In the app | Command |
|---|---|---|
| see what is installed and whether it works | Overview, Bridge | `status`, `doctor` |
| install, update or repair the bridge | Bridge › Install or update / Repair | `install [--repair\|--reinstall] [--dry-run]` |
| connect or disconnect an AI client | AI clients | `clients list\|add\|remove <client>` |
| stop Claude Code asking before every tool call | Permissions › Allow all c3d tools | `permissions allow\|revoke` |
| choose how often c3d-mcp asks to confirm | Permissions › Confirmation prompts | `C3D_MCP_APPROVAL` (below) |
| remove leftovers of older installs | Cleanup | `legacy scan\|remove` |
| remove the bridge, skills and client entries | Bridge › Uninstall everything | `uninstall --all` |
| install the agent skills | Bridge › Install agent skills | `skills install\|uninstall` |

Updates arrive in the app itself (Sparkle, signed with the project's update key). Uninstall never touches your Cheetah3D scripts or the `MCP-backups` folder; to remove the app, drag it to the Trash.

Then ask your agent: *"Build a dining table with four legs and a wood material, light it, and render it."*

Per-client setup: [docs/SETUP.md](docs/SETUP.md). Something not working: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## What agents can do

| Area | Tools (all prefixed `c3d_`) |
|---|---|
| Health | `doctor`, `install_bridge`, `capabilities` |
| Documents | `get_document_info`, `new_document`, `open_document`, `use_document`, `save_document`, `export` (jas/obj/fbx/dae/stl/3ds/usdz/gltf/glb/dxf), `checkpoint`, `restore_checkpoint` |
| Scene | `list_scene`, `get_object`, `create_object`, `delete_objects`, `reparent`, `rename`, `duplicate`, `set_transform`, `get_parameters`, `set_parameters`, `select`, `look_at` |
| Geometry | `create_mesh` (n-gons, validated), `get_mesh`, `edit_mesh`, `create_spline`, `make_editable` |
| Materials | `list_materials`, `create_material`, `set_material_params`, `add_material_node`, `connect_nodes`, `get_material_graph`, `assign_material`, `set_texture` |
| Tags, camera, light | `add_tag`, `set_tag_params`, `remove_tag`, `set_camera`, `set_light` |
| Animation | `set_time`, `set_fps`, `takes`, `set_keyframes`, `get_keyframes` |
| Rendering | `set_render_settings`, `render_image` (returns a downscaled image + blank/luma stats), `render_sequence` + `job_status`/`job_cancel`, `capture_viewport` |
| Assets | `search_assets`, `import_asset` (Poly Haven, CC0, no key) , `merge_file` |
| Scripting | `run_script` (sandboxed JS), `lint_script`, `get_console`, `search_api_docs` |

**Agent skills** for Claude Code, Codex CLI, Antigravity, Claude Desktop and ChatGPT ship with every release: the app installs them for the first three, and the zips on the release page upload to Claude Desktop and ChatGPT (see [docs/SKILLS.md](docs/SKILLS.md)).

Full reference with parameters: [docs/TOOLS.md](docs/TOOLS.md) (generated from the schemas). Honest list of what is unsupported or experimental: [docs/limitations.md](docs/limitations.md).

## Profiles and switches

`C3D_MCP_PROFILE=full` (default) · `local` (≤ 25 tools, short descriptions, no script execution — for small local models) · `readonly` (read tools only).
`C3D_MCP_DISABLE_EXEC=1`, `C3D_MCP_DISABLE_ASSETS=1`, `C3D_MCP_DISABLE_SHELL=1`, `C3D_MCP_NO_AUTOLAUNCH=1` (by default the first call launches Cheetah3D when it is not running and C3D MCP is installed).
`C3D_MCP_APPROVAL=session` (default: a confirmation you accepted is not asked again for the same action until the server restarts) · `strict` (ask every time) · `trusted` (never ask; files that existed before the session are still never overwritten). The control panel stores the choice in `MCP/settings.json`; the environment variable wins.

## Safety in one paragraph

Same-user threat model. The server never overwrites a file that existed before the session, takes automatic checkpoints before destructive operations, asks for confirmation (MCP elicitation, or `confirm:true`; see `C3D_MCP_APPROVAL` above) before deleting many objects, overwriting or running scripts that touch files/shell, and `c3d_run_script` runs with best-effort containment that is **not** a security boundary. Details: [docs/SECURITY.md](docs/SECURITY.md).

## Things worth knowing about Cheetah3D itself

Verified against 8.1.3 while building this (details in `research/08-open-questions-and-probes.md`):
render formats are png/jpg/tiff only; glTF/GLB cannot be opened (FBX/OBJ/DAE/STL/3DS/USDZ/DXF can); object names are not unique (tools address objects by stable `id`); Edit › Undo does not revert script changes (use checkpoints); exporting **OBJ** crashed Cheetah3D once on a nested scene (an automatic checkpoint is taken first; prefer other formats); a dialog open in Cheetah3D blocks everything (`BLOCKED_BY_MODAL` carries its text); Cheetah3D's front face is clockwise, so `c3d_create_mesh` converts your counter-clockwise polygons to get outward normals; 30 material tags on one object crashed it, 24 were fine (the tools stop at 24).

## Repository layout

`packages/server` TypeScript MCP server · `bridge/` in-app runtime + Swift JavaScriptCore test harness · `helper/` Swift package: `HelperCore` (the Accessibility helper), `AppCore` + `C3DMCPApp` (the control panel app), `c3d-helper-ctl` (diagnostics) · `contracts/` JSON Schemas shared by all three · `docs/PROTOCOL.md` the bridge protocol · `evals/` task suite + runner · `packaging/` signing, update-key, appcast, DMG and the curl installer · `scripts/` build, release and leak-check scripts · `skills/` agent skills · `research/` the research notes and live probe results (`research/10` = what was verified in 8.1.3) · `vendor/c3d-scripting-kb` pinned MIT snapshot and `vendor/learn3d-cheetah` pinned BSD-2 book text, both used for doc search, lint rules and skills.

## Development

```bash
cd packages/server && npm ci && npm run lint && npm run typecheck && npm test      # unit/contract tests (offline)
scripts/test-bridge.sh                                                              # in-app runtime tests on a Swift JavaScriptCore harness with strict mocks
cd helper && swift test                                                             # helper and app-model tests (fake Accessibility provider)
C3D_LIVE=1 npm run test:live                                                        # needs Cheetah3D running + installed bridge (uses scratch documents)
node evals/runner/run.mjs --n=3                                                     # agent evals through `claude -p` (spends API credit; budget cap built in)
packaging/make-signing-identity.sh && packaging/make-update-key.sh                  # once: the self-signed signing identity and the update key (see the scripts' headers)
scripts/build-app.sh                                                                # builds, signs and packs release/app/ (dmg, zip, appcast.xml, get-c3d-mcp.sh)
scripts/release.sh                                                                  # skills zips + the app + leak scan + checksums into release/ (publishes nothing)
```

The live suite, the `packages/server/scripts/*.mjs` dev scripts and the evals close the Cheetah3D windows they open (answering "Don't Save"), through `packages/server/scripts/window-cleanup.mjs`. Windows that were already open stay, but do not create documents by hand while a run is in progress: they would be closed too. Set `C3D_KEEP_WINDOWS=1` to keep a run's windows for inspection.


## Credits and knowledge sources

c3d-mcp stands on the work of **Tonio Loewald**, who documented Cheetah3D scripting for the community:

* **[c3d-scripting-kb](https://github.com/tonioloewald/c3d-scripting-kb)** (MIT): the Cheetah3D API reference as Markdown, the gotchas and patterns collected from the user forum, the official example scripts, the linter whose rules `c3d_lint_script` ports, and the forum archive. We use it for `c3d_search_api_docs`, lint rules, MCP resources and skill content.
* **[Learn 3D with Cheetah 3D](https://learn3d.loewald.com)** (BSD-2-Clause, [source](https://github.com/tonioloewald/Learn-3D-with-Cheetah-3D)): the book's scripting chapter and its guidance on lights, materials, rendering and animation. We use it for the search corpus and for skill recipes.
* The official reference and example scripts are © Martin Wengenmayer / MW3D-Solutions (shipped with Cheetah3D); the forum scripts and threads belong to their authors (credited in the KB's `NOTICE.md`; email addresses and other people's home folders were removed from our copy).

Everything taken from these sources was checked against Cheetah3D 8.1.3 first; what held, what changed and what could not be tested is recorded in [research/10-kb-verification-8.1.3.md](research/10-kb-verification-8.1.3.md) and surfaced to agents as trust levels and notes in search results. Corrections to those sources are ours, not theirs.

## License

MIT. The vendored knowledge base (`vendor/c3d-scripting-kb`) is MIT © its authors (forum material per its `NOTICE.md`); the vendored book text (`vendor/learn3d-cheetah`) is BSD-2-Clause © 2019 Tonio Loewald; see their `LICENSE` files.

---
#cheetah3d #mcp #modelcontextprotocol #macos #3d #ai #claude #codex #antigravity #automation #rendering
