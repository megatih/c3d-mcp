# Client configuration

All clients launch the same stdio server: `npx -y c3d-mcp serve`. Without npm publication use `npx -y <tarball-url> serve` or `node /path/to/packages/server/bin/c3d-mcp.js serve`. `c3d-mcp config <client>` prints the snippet with two leading `#` comment lines naming the config file; add `--raw` to redirect it into a file.

## Claude Code
```
claude mcp add c3d -- npx -y c3d-mcp serve
```
Or via the plugin (adds a Cheetah3D skill and a SessionStart doctor hook): `claude plugin marketplace add megatih/c3d-mcp && claude plugin install c3d-mcp`.

## Claude Desktop
Easiest: double-click the `c3d-mcp-<version>.mcpb` bundle. Manual: `~/Library/Application Support/Claude/claude_desktop_config.json`
```json
{ "mcpServers": { "c3d": { "command": "npx", "args": ["-y", "c3d-mcp", "serve"] } } }
```
If it reports `spawn npx ENOENT`: `npx -y c3d-mcp config claude-desktop --form absolute`.

## Codex CLI (`~/.codex/config.toml`)
```toml
[mcp_servers.c3d]
command = "npx"
args = ["-y", "c3d-mcp", "serve"]
startup_timeout_sec = 30
tool_timeout_sec = 600
```

## Gemini CLI (`~/.gemini/settings.json`)
```json
{ "mcpServers": { "c3d": { "command": "npx", "args": ["-y", "c3d-mcp", "serve"], "timeout": 600000 } } }
```

## Antigravity
Same JSON object as Gemini CLI, in `~/.gemini/config/mcp_config.json`. Some builds read `.agents/mcp_config.json` in the workspace instead; check Antigravity's Manage MCP servers screen for the path it uses.

## Cursor (`~/.cursor/mcp.json`) and LM Studio (`mcp.json`)
```json
{ "mcpServers": { "c3d": { "command": "npx", "args": ["-y", "c3d-mcp", "serve"], "env": { "C3D_MCP_PROFILE": "local" } } } }
```
`local` suits small local models. Drop the `env` block (or use `full`) for capable models. LM Studio: Program > Install > Edit mcp.json.

`config` copies `C3D_MCP_PROFILE` from the current shell environment into the snippet, so `C3D_MCP_PROFILE=readonly c3d-mcp config cursor` yields a read-only entry.

## Verify
Restart the client, then ask it to run `c3d_doctor`. All checks ok means the setup is complete.
