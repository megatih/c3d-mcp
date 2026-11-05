---
name: c3d-setup
description: Installs and verifies c3d-mcp for Cheetah3D 8.1.3 on macOS through the C3D MCP app and connects it to an MCP client (Claude Code, Claude Desktop, Codex CLI, Antigravity, Gemini CLI, Cursor, LM Studio). Covers the one-time DMG install and its Open Anyway prompt, installing the bridge and restarting Cheetah3D, connecting clients, the Accessibility and Screen Recording grants for the app, confirmation prompts, removing older installs, the doctor health check, profiles and environment switches, and a decision table for errors such as BLOCKED_BY_MODAL, TRIGGER_FAILED or an unreachable helper. Use when the c3d_* tools are missing, doctor fails, a tool returns a bridge or permission error, or the user asks how to set up or configure c3d-mcp.
---

# c3d-setup

If the `c3d_*` tools are not available: on clients without the MCP server (for example ChatGPT) hand off to the `c3d-scripting` skill's standalone-macro fallback. For install problems stay here.

## Requirements
macOS 14+ on Apple Silicon and Cheetah3D 8.1.3 (installed and launched once). Nothing else: the C3D MCP app carries its own Node.js and the server, so no Node, Homebrew, npm or Terminal is needed. Without the app running, `c3d_new_document`, `c3d_make_editable`, `c3d_merge_file` and `c3d_capture_viewport` are unavailable and the server falls back to `osascript` (slower; the terminal/MCP client then needs Accessibility).

## One-time install (tell the user; you cannot click for them)
1. Download `C3D-MCP-<version>.dmg` from https://github.com/megatih/c3d-mcp/releases/latest and drag **C3D MCP** to Applications.
2. First launch only: macOS says it cannot verify the app (it is signed with its own certificate, not an Apple Developer ID). Click Done, open System Settings > Privacy & Security, click **Open Anyway** next to "C3D MCP", enter the password, open the app again, click Open. To skip this prompt, the user can paste into Terminal: `curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/get-c3d-mcp.sh | bash` (downloads the same app, verifies its SHA-256, copies it to Applications, opens it).
3. In the app: **Bridge** > Install or update (backs up Cheetah3D's `Scripts/` first, installs the macro and runtime, installs the agent skills), then **restart Cheetah3D once**: macros are scanned only at launch. The macro appears under Tools > Script > Macro Script > C3D-MCP > C3D-MCP Bridge.js; never run it by hand, the helper presses it.
4. **AI clients** > connect the clients in use (Claude Desktop, Claude Code, Codex, Antigravity, Gemini CLI, Cursor), then restart those clients. The app writes absolute paths into the app, so no `npx` or shell PATH is involved.
5. **Permissions** > Grant Accessibility to C3D MCP (macOS may ask to quit and reopen the app). Screen Recording is needed only for `c3d_capture_viewport`. Optionally choose the confirmation level and press *Allow all c3d tools* for Claude Code.
6. Verify: the app's **Overview** (a Setup list ticks the four steps off and the health check re-checks by itself when Cheetah3D starts; **Re-check** runs it now), or `c3d_doctor` in chat.

Updates arrive inside the app (Overview > Updates). Every release is signed with the same certificate, so macOS should keep the grants; if it asks again, switch C3D MCP off and on under Accessibility.

When the tools are already connected, `c3d_doctor` is the in-chat health check, and `c3d_install_bridge` repeats the bridge install (`mode`: auto, repair or reinstall; `dry_run` previews; a restart of Cheetah3D is still the user's job). `c3d_capabilities` lists the object, tag, material and light types and the tools active in the current profile.

## Older installs
If the user installed an earlier version some other way (install script, npm or npx, a Homebrew cask, the separate "C3D Bridge Helper" app, the Claude Desktop extension, the Claude Code plugin, a hand copy), tell them to open the app's **Cleanup** tab: it finds and removes those (files go to the Trash, scripts and backups are kept). Old `c3d` entries in AI clients are not part of Cleanup: **AI clients** shows them as "Connected to an older install" or "Connected to another copy of C3D MCP" with *Switch to this app* and *Disconnect*.

## Command line (optional)
The bundled server is a normal CLI: `"/Applications/C3D MCP.app/Contents/Resources/node/bin/node" "/Applications/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js" <command>` with `status`, `doctor` (`--brief`, `--json`), `install [--repair|--reinstall|--dry-run]`, `clients list|add|remove`, `permissions allow|revoke`, `legacy scan|remove`, `skills install|uninstall`, `uninstall [--all]`, `config <client>`. Details: [clients](references/clients.md).

## Profiles and switches
Set in the client config `env` block or the shell.

| Variable | Effect |
|---|---|
| `C3D_MCP_PROFILE` | `full` (default), `local` (<= 25 tools, short descriptions, no scripting; for small local models), `readonly` (read tools only) |
| `C3D_MCP_DISABLE_EXEC=1` | hide `c3d_run_script` |
| `C3D_MCP_DISABLE_ASSETS=1` | hide the Poly Haven asset tools |
| `C3D_MCP_DISABLE_SHELL=1` | never allow `OS.system` in scripts |
| `C3D_MCP_APPROVAL` | `session` (default; an accepted confirmation is not repeated for the same action), `strict` (ask every time), `trusted` (never ask). The app's Permissions tab stores it in `MCP/settings.json`; the variable wins. Pre-existing files are never overwritten in any mode |
| `C3D_MCP_AUTO_CONFIRM=1` | same as `trusted`; meant for unattended runs (e.g. `claude -p`). Never set it in shared configs |
| `C3D_MCP_WORKDIR` | renders, checkpoints, exports, downloads (default `~/Library/Application Support/Cheetah3D/MCP/tmp`) |
| `C3D_MCP_TRIGGER` | `auto` (default), `helper`, `osascript` |
| `C3D_HELPER_APP` | use a different app bundle as the helper (development) |
| `C3D_HELPER_SKIP_VERIFY=1` | skip the code-signature check of a locally built, unsigned app |
| `C3D_MCP_DIR`, `C3D_CHEETAH_SUPPORT_DIR` | override the mailbox / Cheetah3D support dir (tests) |
| `C3D_MCP_LOG_DIR`, `C3D_MCP_LOG_LEVEL` | log location (default `~/Library/Logs/c3d-mcp`) and `debug|info|warn|error` |

Long operations: renders can take minutes, so raise the client's tool timeout (the Codex and Gemini entries the app writes already do).

## First diagnosis
1. Run `c3d_doctor` (or the app's Overview, which lists a Setup checklist, re-checks by itself when Cheetah3D starts and has a Re-check button; a result from before Cheetah3D was started is simply old); read the failing check's `fix`.
2. Look up the error code in [troubleshooting](references/troubleshooting.md). Every tool error carries `{code, message, hint, details}`; follow `hint`.
3. Logs: `~/Library/Logs/c3d-mcp/` (the app's Activity tab shows the helper log); the in-app bridge log comes from `c3d_get_console`.

## Rules
- Do not edit TCC permissions yourself (no `tccutil`, no database edits); ask the user to click through System Settings or the app's Permissions tab.
- Never dismiss Cheetah3D dialogs on the user's behalf: report the text from `BLOCKED_BY_MODAL` and wait.
- Do not uninstall unless asked (Bridge > Uninstall everything, or `uninstall --all`): it keeps backups and the user's scripts, but removes the agent skills and the c3d entries in MCP client configs.
- For building scenes once the setup works, use the `c3d-scene-building` skill.
