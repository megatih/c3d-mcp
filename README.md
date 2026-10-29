# c3d-mcp — an MCP server for Cheetah3D 8.1.3

> **New to c3d-mcp?** Read the friendly introduction, with install steps and two benchmark scenes (Cornell Box and Cyberpunk Diorama): **[Cheetah3D Meets AI](https://megatih.github.io/2026-10-29-cheetah3d-meets-ai-introducing-c3d-mcp/)**.

Let an AI agent (Claude Code / Claude Desktop, Codex, Gemini CLI, Antigravity, Cursor, LM Studio …) **inspect, build, edit, animate, light, texture, render and export scenes in the running Cheetah3D** on macOS 27+ / Apple Silicon.

Cheetah3D has no network API, no AppleScript dictionary and no URL scheme. `c3d-mcp` therefore works through three parts:

```
 MCP client ──stdio──▶ c3d-mcp server (TypeScript) ──mailbox files──▶ bridge macro inside Cheetah3D (JavaScript)
                              │                                              ▲
                              └──Unix socket──▶ C3D Bridge Helper.app (Swift) ─┘ presses the macro's menu item (Accessibility)
```

* **Server** (`packages/server`): 63 `c3d_*` tools, resources and prompts; queue, safety checks, backups.
* **Bridge** (`bridge/`): a tiny loader macro plus a runtime that Cheetah3D executes, draining a request inbox and writing results.
* **Helper** (`helper/`): a small Accessibility app that activates Cheetah3D, presses the bridge menu item and reports dialogs. Optional (an `osascript` fallback exists) but recommended: ~3× faster, modal detection, screenshots.

## Requirements
macOS 14+ on Apple Silicon (developed on macOS 27.2), Cheetah3D 8.1.3, Node.js ≥ 22. The helper app is optional but recommended (without it `c3d_new_document`, `c3d_make_editable`, `c3d_merge_file`, `c3d_capture_viewport` are unavailable and everything is slower).

## Quickstart

One command on a new Mac (checks macOS, Cheetah3D 8.1.3 and Node.js 22+, offers to install what is missing, installs the bridge and helper, opens the right System Settings pane, configures your AI clients and installs the agent skills; never uses `sudo`):

```bash
curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/install.sh | bash
```

Read it first if you like (`curl -fsSL <url> -o install.sh; less install.sh; bash install.sh`), or double-click `Install-c3d-mcp.command` from the [latest release](https://github.com/megatih/c3d-mcp/releases/latest). Full walkthrough: [docs/INSTALL.md](docs/INSTALL.md).

<details><summary>Manual install</summary>

> **Status:** `c3d-mcp` is not on the npm registry yet. Until it is, use the release tarball wherever this README says `npx -y c3d-mcp`:
> `npx -y https://github.com/megatih/c3d-mcp/releases/download/v0.2.0/c3d-mcp-0.2.0.tgz <command>` (or install it once: `npm i -g https://github.com/megatih/c3d-mcp/releases/download/v0.2.0/c3d-mcp-0.2.0.tgz`, then run `c3d-mcp <command>`).

```bash
# 1. one command: backs up your Scripts folder, installs the bridge macro + runtime and the helper app
npx -y c3d-mcp install

# 2. restart Cheetah3D once (macros are only scanned at launch)
# 3. System Settings → Privacy & Security → Accessibility → + → add ~/Library/Application Support/Cheetah3D/MCP/helper/C3D Bridge Helper.app (see docs/SETUP.md)
#    (Screen Recording is optional, only for c3d_capture_viewport)

# 4. verify
npx -y c3d-mcp doctor

# 5. add the server to your client
claude mcp add c3d -- npx -y c3d-mcp serve      # Claude Code
npx -y c3d-mcp config codex                      # prints snippets for claude-desktop, claude-code, codex, gemini-cli, antigravity, cursor, lm-studio
```

The guided version of steps 1-5 is `c3d-mcp setup`.
</details>

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

**Agent skills** for Claude Code, Codex CLI, Antigravity, Claude Desktop and ChatGPT ship with every release: `c3d-mcp skills install` (see [docs/SKILLS.md](docs/SKILLS.md)).

Full reference with parameters: [docs/TOOLS.md](docs/TOOLS.md) (generated from the schemas). Honest list of what is unsupported or experimental: [docs/limitations.md](docs/limitations.md).

## Profiles and switches

`C3D_MCP_PROFILE=full` (default) · `local` (≤ 25 tools, short descriptions, no script execution — for small local models) · `readonly` (read tools only).
`C3D_MCP_DISABLE_EXEC=1`, `C3D_MCP_DISABLE_ASSETS=1`, `C3D_MCP_DISABLE_SHELL=1`.

## Safety in one paragraph

Same-user threat model. The server never overwrites a file that existed before the session, takes automatic checkpoints before destructive operations, asks for confirmation (MCP elicitation, or `confirm:true`) before deleting many objects, overwriting or running scripts that touch files/shell, and `c3d_run_script` runs with best-effort containment that is **not** a security boundary. Details: [docs/SECURITY.md](docs/SECURITY.md).

## Things worth knowing about Cheetah3D itself

Verified against 8.1.3 while building this (details in `research/08-open-questions-and-probes.md`):
render formats are png/jpg/tiff only; glTF/GLB cannot be opened (FBX/OBJ/DAE/STL/3DS/USDZ/DXF can); object names are not unique (tools address objects by stable `id`); Edit › Undo does not revert script changes (use checkpoints); exporting **OBJ** crashed Cheetah3D once on a nested scene (an automatic checkpoint is taken first; prefer other formats); a dialog open in Cheetah3D blocks everything (`BLOCKED_BY_MODAL` carries its text).

## Repository layout

`packages/server` TypeScript MCP server · `bridge/` in-app runtime + Swift JavaScriptCore test harness · `helper/` Swift helper app · `contracts/` JSON Schemas shared by all three · `docs/PROTOCOL.md` the bridge protocol · `evals/` task suite + runner · `plugin/` + `.claude-plugin/` Claude Code plugin & marketplace · `mcpb/` Claude Desktop extension · `packaging/` Homebrew cask, registry `server.json`, signing scripts · `research/` the research notes and live probe results · `vendor/c3d-scripting-kb` pinned MIT snapshot used for doc search.

## Development

```bash
cd packages/server && npm ci && npm run lint && npm run typecheck && npm test      # unit/contract tests (offline)
scripts/test-bridge.sh                                                              # in-app runtime tests on a Swift JavaScriptCore harness with strict mocks
cd helper && swift test                                                             # helper tests (fake Accessibility provider)
C3D_LIVE=1 npm run test:live                                                        # needs Cheetah3D running + installed bridge (uses a scratch document)
node evals/runner/run.mjs --n=3                                                     # agent evals through `claude -p` (spends API credit; budget cap built in)
scripts/release.sh                                                                  # builds npm tarball, .mcpb, helper zip into release/ (publishes nothing)
```

## License

MIT. The vendored knowledge base (`vendor/c3d-scripting-kb`) is MIT © its authors; see its `LICENSE`/`NOTICE.md`.

---
#cheetah3d #mcp #modelcontextprotocol #macos #3d #ai #claude #codex #antigravity #automation #rendering
