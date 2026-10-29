# 07 — Packaging & distribution

| Channel | How |
|---|---|
| **Claude Desktop** | `.mcpb` (zip + `manifest.json`, [spec](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md) 0.3+). `server.type:"node"`, `compatibility.platforms:["darwin"]`, `user_config` (e.g. Cheetah3D Scripts dir, profile, disable-exec). Build: `npm i -g @anthropic-ai/mcpb`; `mcpb init/validate/pack`. **No post-install hook** → install bridge on first server start / `c3d-mcp install` / `c3d_install_bridge` tool. |
| **Claude Code** | `claude mcp add c3d -- npx -y <pkg>`; **plugin** in a git marketplace (`.claude-plugin/marketplace.json`); plugin `mcpServers` may point at the `.mcpb`; `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`; ship a **skill** ("scripting Cheetah3D") and a `SessionStart` hook that runs doctor. Avoid top-level `bin/` (blocks claude.ai/Cowork install). [Plugins reference](https://code.claude.com/docs/en/plugins-reference). |
| **Codex CLI** | `codex mcp add c3d -- npx -y <pkg>` or `[mcp_servers.c3d]` in `~/.codex/config.toml`; raise `tool_timeout_sec` (default 60) for renders; `startup_timeout_sec`. |
| **Gemini CLI** | `mcpServers` in `~/.gemini/settings.json`. |
| **Antigravity** | `mcpServers` in `~/.gemini/config/mcp_config.json` or `.agents/mcp_config.json` (sources disagree on path — verify). |
| **Cursor / LM Studio** | `mcp.json` `mcpServers`. |
| **npm/npx** | Main channel for the TS server. Helper `.app` delivered via GitHub release asset (SHA-256 verified) or Homebrew cask. |
| **Homebrew** | Own tap with a **cask** for `C3D Bridge Helper.app` (+ CLI). Casks suit TCC-granted apps better than formulae. Document quarantine / "Open Anyway". |
| **MCP Registry** | `mcp-publisher init/login/publish` with `server.json` named `io.github.<owner>/c3d-mcp`; `registryType` `npm` and/or `mcpb` (mcpb needs SHA-256; "mcp" must appear in name). [package types](https://modelcontextprotocol.io/registry/package-types.md). |
| **Signing** | Developer ID + hardened runtime + `notarytool` + staple **when available**; currently none → local self-signed cert for dev, ad-hoc for distribution, scripted notarization pipeline verified with `--dry-run`. |

## `c3d-mcp` CLI (also invoked by server at startup, idempotent)
- `install` — tar-backup `Scripts/` (timestamped), create `Scripts/Macro/C3D-MCP/` (via Node, never JS `mkDir`), copy `C3D-MCP Bridge.js` (templated with absolute runtime path + version header), `runtime.js` + op modules into `…/MCP/runtime/` (0700), create mailbox dirs, write 0600 secret; install/launch helper; print "restart Cheetah3D or use Tools › Script › Update Menu".
- `uninstall` — remove exactly `Scripts/Macro/C3D-MCP/` and the MCP dir (flagged), unload LaunchAgent.
- `doctor` — Cheetah3D found/running/version, document open, bridge installed+version match, Accessibility, Screen Recording, helper reachable, ping round-trip, modal check; JSON + human output.
- `config <client>` — print/merge config snippets for Claude Desktop/Code, Codex, Gemini, Antigravity, Cursor, LM Studio.
- `serve` — stdio MCP server (default).
