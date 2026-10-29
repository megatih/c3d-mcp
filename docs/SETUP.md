# Setup per client

> Until the package is published on npm, replace `npx -y c3d-mcp` below with `npx -y https://github.com/megatih/c3d-mcp/releases/download/v0.2.0/c3d-mcp-0.2.0.tgz` (or `npm i -g` that URL and use `c3d-mcp`).

All clients launch the same stdio server: `npx -y c3d-mcp serve` (or `node /path/to/packages/server/bin/c3d-mcp.js serve`).
`c3d-mcp config <client>` prints a ready-to-paste snippet for each client below (with two leading `#` comment lines naming the config file). Add `--raw` to print only the snippet so it can be redirected into a file, e.g. `c3d-mcp config codex --raw > codex-snippet.toml`.

## 0. Guided installer (recommended for new users)
```
curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/install.sh | bash
```
Checks macOS, Cheetah3D 8.1.3 and Node.js 22+, offers to install Node.js (Homebrew, or a checksum-verified private copy in `~/.c3d-mcp/node`, never `sudo`), installs c3d-mcp into `~/.c3d-mcp`, then runs `c3d-mcp setup`, which installs the bridge and helper, opens the right System Settings pane for Accessibility, configures the AI clients it detects (asking first, with backups), installs the agent skills and runs a test render. Flags: `--dry-run`, `--yes`, `--clients <list|all|none>`, `--no-skills`, `--no-node-install`, `--prefix <dir>`. Full walkthrough: [INSTALL.md](INSTALL.md). Run just the wizard later with `c3d-mcp setup`. The steps below are the manual equivalent.

## 0b. One-time bridge install (all clients)
```
npx -y c3d-mcp install      # backs up Scripts/, installs the bridge macro + runtime and the helper app (to ~/Library/Application Support/Cheetah3D/MCP/helper/)
```
Then **restart Cheetah3D once** (new macros only appear after a restart). Grant **Accessibility** to *C3D Bridge Helper*: System Settings → Privacy & Security → Accessibility → **+** → ⇧⌘G → `~/Library/Application Support/Cheetah3D/MCP/helper/C3D Bridge Helper.app` (the helper never triggers the prompt itself, so it is not listed until you add it). Screen Recording is optional (only `c3d_capture_viewport`).
Verify: `npx -y c3d-mcp doctor`. After the restart you will find the macro under *Tools › Script › Macro Script › C3D-MCP › C3D-MCP Bridge.js* — you never run it by hand; the helper presses it for you.

**Requirements:** macOS 14+ on Apple Silicon (developed and tested on macOS 27.2), Cheetah3D 8.1.3, Node.js ≥ 22. Without the helper the server falls back to `osascript` (slower; your terminal/MCP client then needs Accessibility), and `c3d_new_document`, `c3d_make_editable`, `c3d_merge_file` and `c3d_capture_viewport` are unavailable.

## Claude Desktop
* Easiest: double-click `c3d-mcp-0.2.0.mcpb`.
* Manual: `~/Library/Application Support/Claude/claude_desktop_config.json`
```json
{ "mcpServers": { "c3d": { "command": "npx", "args": ["-y", "c3d-mcp", "serve"] } } }
```

## Claude Code
```
claude mcp add c3d -- npx -y c3d-mcp serve
# or via the plugin (adds a Cheetah3D skill + a SessionStart doctor hook):
claude plugin marketplace add megatih/c3d-mcp && claude plugin install c3d-mcp
```

## Codex CLI (`~/.codex/config.toml`)
```toml
[mcp_servers.c3d]
command = "npx"
args = ["-y", "c3d-mcp", "serve"]
startup_timeout_sec = 30
tool_timeout_sec = 600   # renders can take minutes (`c3d-mcp config codex` prints the same value)
```

## Gemini CLI (`~/.gemini/settings.json`)
```json
{ "mcpServers": { "c3d": { "command": "npx", "args": ["-y", "c3d-mcp", "serve"], "timeout": 600000 } } }
```

## Antigravity
`mcpServers` entry in `~/.gemini/config/mcp_config.json` (some builds use `.agents/mcp_config.json` in the workspace — check Antigravity's *Manage MCP servers* screen for the path it actually reads). Same JSON object as Gemini CLI.

## Cursor (`~/.cursor/mcp.json`) / LM Studio (`mcp.json`)
```json
{ "mcpServers": { "c3d": { "command": "npx", "args": ["-y", "c3d-mcp", "serve"], "env": { "C3D_MCP_PROFILE": "local" } } } }
```
Use `C3D_MCP_PROFILE=local` for small local models (≤25 tools, short descriptions, no script execution).

## Environment variables
| Variable | Meaning |
|---|---|
| `C3D_MCP_PROFILE` | `full` (default), `local`, `readonly` |
| `C3D_MCP_DISABLE_EXEC=1` | hide `c3d_run_script` |
| `C3D_MCP_DISABLE_ASSETS=1` | hide Poly Haven tools |
| `C3D_MCP_DISABLE_SHELL=1` | never allow `OS.system` in scripts |
| `C3D_MCP_AUTO_CONFIRM=1` | **unattended agent runs only** (e.g. `claude -p`): honour `confirm:true` even when the client could ask a human. Default off — with it off, a client that supports elicitation is always asked and the model's `confirm` flag is ignored |
| `C3D_MCP_WORKDIR` | where renders/checkpoints/downloads go (default `~/Library/Application Support/Cheetah3D/MCP/tmp`) |
| `C3D_MCP_DIR`, `C3D_CHEETAH_SUPPORT_DIR` | override the mailbox dir / Cheetah3D support dir (tests) |
| `C3D_MCP_LOG_DIR`, `C3D_MCP_LOG_LEVEL` | log location (default `~/Library/Logs/c3d-mcp`) and verbosity |
| `C3D_MCP_TRIGGER` | `auto` (default), `helper` or `osascript` |
| `C3D_HELPER_APP` | use a helper app bundle from a custom path |

If Claude Desktop reports `spawn npx ENOENT`, print a config with absolute paths: `npx -y c3d-mcp config claude-desktop --form absolute`.
LM Studio: Program → Install → *Edit mcp.json* (same JSON object).
