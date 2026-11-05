# Setup per client

Install **C3D MCP.app** first ([INSTALL.md](INSTALL.md)). In its **AI clients** tab you tick the clients you use and the app writes the right config for each, with a backup of every file it edits. This page is for reading what it writes, for doing it by hand, and for the settings.

All clients launch the same stdio server: the Node.js and server that live inside the app.

```
"/Applications/C3D MCP.app/Contents/Resources/node/bin/node"  "/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js"  serve
```

(If you put the app in `~/Applications` or elsewhere, use that path. Absolute paths mean no `npx`, no npm registry and no login `PATH` are involved, which is why Claude Desktop and other GUI clients work without tinkering.) If you move or rename the app, open **AI clients**: entries that point at the old location are shown as "Connected to an older install" and *Switch to this app* rewrites them.

## What the app does for you
```bash
APP="/Applications/C3D MCP.app/Contents/Resources"
alias c3d-mcp='"$APP/node/bin/node" "$APP/server/bin/c3d-mcp.js"'
c3d-mcp clients list                      # per client: none | current | legacy | foreign
c3d-mcp clients add cursor codex --yes    # the same as ticking them in the app
c3d-mcp clients remove all
c3d-mcp config <client>                   # print a ready-to-paste snippet (claude-desktop, claude-code, codex, gemini-cli, antigravity, cursor, lm-studio); --raw prints only the snippet
```
`clients add` never overwrites a different existing `c3d` entry unless you pass `--yes`, and it refuses config files it cannot parse.

## Claude Desktop
`~/Library/Application Support/Claude/claude_desktop_config.json`
```json
{ "mcpServers": { "c3d": {
  "command": "/Applications/C3D MCP.app/Contents/Resources/node/bin/node",
  "args": ["/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js", "serve"]
} } }
```
Restart Claude Desktop after changing it. In Claude Desktop choose "Always allow" on the first prompt of each tool to stop per-tool prompts.

## Claude Code
```
claude mcp add --scope user c3d -- "/Applications/C3D MCP.app/Contents/Resources/node/bin/node" "/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js" serve
```
Claude Code asks before every MCP tool call that is not allowed. **Permissions › Allow all c3d tools** in the app (or `c3d-mcp permissions allow`) adds `mcp__c3d` to `permissions.allow` in `~/.claude/settings.json` after asking, with a backup; `permissions revoke` undoes it.

## Codex CLI (`~/.codex/config.toml`)
```toml
[mcp_servers.c3d]
command = "/Applications/C3D MCP.app/Contents/Resources/node/bin/node"
args = ["/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js", "serve"]
startup_timeout_sec = 30
tool_timeout_sec = 600   # renders can take minutes (`c3d-mcp config codex` prints the same value)
```

## Gemini CLI (`~/.gemini/settings.json`)
```json
{ "mcpServers": { "c3d": { "command": "/Applications/C3D MCP.app/Contents/Resources/node/bin/node", "args": ["/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js", "serve"], "timeout": 600000 } } }
```

## Antigravity
`mcpServers` entry in `~/.gemini/config/mcp_config.json` (some builds use `.agents/mcp_config.json` in the workspace; check Antigravity's *Manage MCP servers* screen for the path it actually reads). Same JSON object as Gemini CLI.

## Cursor (`~/.cursor/mcp.json`) / LM Studio (`~/.lmstudio/mcp.json`)
```json
{ "mcpServers": { "c3d": { "command": "/Applications/C3D MCP.app/Contents/Resources/node/bin/node", "args": ["/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js", "serve"], "env": { "C3D_MCP_PROFILE": "local" } } } }
```
Use `C3D_MCP_PROFILE=local` for small local models (≤25 tools, short descriptions, no script execution). The app connects Cursor for you; LM Studio is configured by hand (Program → Install → *Edit mcp.json*).

## How often c3d-mcp asks you to confirm
Overwriting a file this session already wrote, deleting many objects, restoring a checkpoint and running scripts that write files or use the shell need a confirmation. **Permissions › Confirmation prompts** in the app (stored in `~/Library/Application Support/Cheetah3D/MCP/settings.json`, read each time a client starts the server) or `C3D_MCP_APPROVAL`:
* `session` (default): a confirmation you accepted is remembered for that action (same file, same checkpoint) until the server restarts. Declines are never remembered; shell scripts and bulk deletions are asked every time.
* `strict`: ask every time.
* `trusted`: never ask. Files that existed before the session are still never overwritten.

## Environment variables
| Variable | Meaning |
|---|---|
| `C3D_MCP_PROFILE` | `full` (default), `local`, `readonly` |
| `C3D_MCP_DISABLE_EXEC=1` | hide `c3d_run_script` |
| `C3D_MCP_DISABLE_ASSETS=1` | hide Poly Haven tools |
| `C3D_MCP_DISABLE_SHELL=1` | never allow `OS.system` in scripts |
| `C3D_MCP_NO_AUTOLAUNCH=1` | do not start Cheetah3D when it is not running (default: the first call launches it, waits for its menu bar and uses the untitled document it opens) |
| `C3D_MCP_APPROVAL` | `session` (default), `strict`, `trusted`: see above. Overrides `settings.json` |
| `C3D_MCP_AUTO_CONFIRM=1` | same as `C3D_MCP_APPROVAL=trusted` (kept for unattended runs such as `claude -p`) |
| `C3D_MCP_WORKDIR` | where renders/checkpoints/downloads go (default `~/Library/Application Support/Cheetah3D/MCP/tmp`) |
| `C3D_MCP_DIR`, `C3D_CHEETAH_SUPPORT_DIR` | override the mailbox dir / Cheetah3D support dir (tests) |
| `C3D_MCP_LOG_DIR`, `C3D_MCP_LOG_LEVEL` | log location (default `~/Library/Logs/c3d-mcp`) and verbosity |
| `C3D_MCP_TRIGGER` | `auto` (default), `helper` or `osascript` |
| `C3D_HELPER_APP` | use a different app bundle as the helper (development) |

**Without the app running** the server falls back to `osascript` (slower; your terminal or MCP client then needs Accessibility), and `c3d_new_document`, `c3d_make_editable`, `c3d_merge_file` and `c3d_capture_viewport` are unavailable. When a client starts the server, it launches the app headless (no window) if it is not running.
