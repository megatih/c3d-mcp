# Agent skills for c3d-mcp

Six skills in the open Agent Skills format (a folder with `SKILL.md`, plus `references/` and `templates/`). They teach an agent how to use the `c3d_*` tools well: the workflow, the Cheetah3D facts that surprise people, materials and lighting recipes, scripting rules, reference-image recreation and export. They are built from what the benchmark runs taught us and ship with every release (`c3d-skills-<version>.zip`, plus one zip per skill in `skills/`).

| Skill | Use it for |
|---|---|
| `c3d-setup` | Installing the bridge, `doctor`, per-client MCP config, permissions, troubleshooting |
| `c3d-scene-building` | The build-and-verify loop, ids, HPB rotation, primitives, meshes, pipes, bulk building |
| `c3d-look-dev` | Materials and node graphs, per-polygon materials, lights, camera, render settings, backgrounds, post-processing |
| `c3d-scripting` | Writing Cheetah3D JavaScript safely; standalone-macro fallback when the MCP tools are not available |
| `c3d-reference-recreation` | Recreating a scene from a reference image in phases, with checkpoints and an honest report |
| `c3d-animation-export` | Time, takes, keyframes, sequences, exports, assets |

## Install

**One command (Claude Code, Codex CLI, Antigravity):**
```bash
c3d-mcp skills install                      # all clients
c3d-mcp skills install --target codex       # claude | codex | antigravity
c3d-mcp skills install --project .          # into ./.claude/skills and ./.agents/skills (Codex and Antigravity)
c3d-mcp skills install --dry-run            # show what would change
c3d-mcp skills uninstall                    # removes only what install created
```
User-level folders: `~/.claude/skills`, `~/.agents/skills` (Codex), `~/.gemini/config/skills` (Antigravity CLI `agy`; older Antigravity builds read `~/.gemini/antigravity/skills`, so copy the folders there if your build does not see them). Folders that were not installed by c3d-mcp are never overwritten (installed folders carry a `.c3d-mcp-skill` marker). Start a new session afterwards.

**Claude Code plugin:** the skills are inside the plugin (`plugin/skills`), so `/plugin install` brings them along.

**Claude Desktop / claude.ai:** Settings › Capabilities › Skills › upload the `c3d-skills-<version>.zip` from the release (or the individual zips in `skills/`). The MCP server itself comes from the `.mcpb` extension.

**ChatGPT:** ChatGPT cannot run a local stdio MCP server, so the `c3d_*` tools are not available there. Upload the same zips where your plan supports skills. The skills then work in fallback mode: `c3d-scripting` makes the agent write a ready-to-run Cheetah3D macro (`function main(doc)`) that you save into Cheetah3D's Macro scripts folder and run from `Tools › Script › Macro Script`.

**Other agents** that read `SKILL.md` folders (Gemini CLI, Cursor, …): copy the folders from `skills/` (or the unzipped bundle) into that client's skills directory.

## Maintaining
`skills/` is the single source. `node scripts/build-skills.mjs` validates every skill (frontmatter, description length, line count, links, that every `c3d_*` name exists in `docs/TOOLS.md`, JavaScript syntax, no private paths), mirrors them into `plugin/skills`, and with `--zip <dir>` writes the upload bundles. `scripts/release.sh` runs it, and `npm pack` includes the skills.
