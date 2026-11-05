# Client configuration

The C3D MCP app's **AI clients** tab writes these entries for you (and `c3d-mcp clients add <client>` does the same from a terminal). All clients launch the same stdio server, the Node.js and server inside the app:

```
/Applications/C3D MCP.app/Contents/Resources/node/bin/node  /Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js  serve
```

Use the real location if the app is not in /Applications. `c3d-mcp config <client>` prints the snippet for the install that runs it (with two leading `#` comment lines naming the config file; `--raw` prints only the snippet). Back up and restart the client after any change; the app keeps a `.c3d-backup-<time>` copy of each file it edits.

## Claude Code
```
claude mcp add --scope user c3d -- "/Applications/C3D MCP.app/Contents/Resources/node/bin/node" "/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js" serve
```
To stop Claude Code asking before every c3d tool: the app's Permissions > *Allow all c3d tools*, or `c3d-mcp permissions allow` (adds `mcp__c3d` to `permissions.allow` in `~/.claude/settings.json`, after asking, with a backup).

## Claude Desktop
`~/Library/Application Support/Claude/claude_desktop_config.json`
```json
{ "mcpServers": { "c3d": { "command": "/Applications/C3D MCP.app/Contents/Resources/node/bin/node", "args": ["/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js", "serve"] } } }
```
Choose "Always allow" on the first prompt of each tool to stop per-tool prompts.

## Codex CLI (`~/.codex/config.toml`)
```toml
[mcp_servers.c3d]
command = "/Applications/C3D MCP.app/Contents/Resources/node/bin/node"
args = ["/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js", "serve"]
startup_timeout_sec = 30
tool_timeout_sec = 600
```

## Gemini CLI (`~/.gemini/settings.json`)
```json
{ "mcpServers": { "c3d": { "command": "/Applications/C3D MCP.app/Contents/Resources/node/bin/node", "args": ["/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js", "serve"], "timeout": 600000 } } }
```

## Antigravity
Same JSON object as Gemini CLI, in `~/.gemini/config/mcp_config.json`. Some builds read `.agents/mcp_config.json` in the workspace instead; check Antigravity's Manage MCP servers screen for the path it uses.

## Cursor (`~/.cursor/mcp.json`) and LM Studio (`~/.lmstudio/mcp.json`)
```json
{ "mcpServers": { "c3d": { "command": "/Applications/C3D MCP.app/Contents/Resources/node/bin/node", "args": ["/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js", "serve"], "env": { "C3D_MCP_PROFILE": "local" } } } }
```
`local` suits small local models. Drop the `env` block (or use `full`) for capable models. The app connects Cursor; LM Studio is configured by hand (Program > Install > Edit mcp.json).

`config` copies `C3D_MCP_PROFILE` from the current shell environment into the snippet, so `C3D_MCP_PROFILE=readonly c3d-mcp config cursor` yields a read-only entry.

## Verify
Restart the client, then ask it to run `c3d_doctor`. All checks ok means the setup is complete. If a client shows "Connected to an older install" (npx, npm, old script) or "Connected to another copy of C3D MCP" (the app was moved or reinstalled) in the app, press *Switch to this app*, or *Disconnect* if the user no longer uses that client. Cleanup never edits client entries.
