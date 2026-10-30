---
name: c3d-setup
description: Installs and verifies the c3d-mcp bridge for Cheetah3D 8.1.3 on macOS and connects it to an MCP client (Claude Code, Claude Desktop, Codex CLI, Antigravity, Gemini CLI, Cursor, LM Studio). Covers the one-time install, the Cheetah3D restart, Accessibility and Screen Recording grants for the helper app, the doctor health check, profiles and environment switches, and a decision table for errors such as BLOCKED_BY_MODAL, TRIGGER_FAILED or an unreachable helper. Use when the c3d_* tools are missing, doctor fails, a tool returns a bridge or permission error, or the user asks how to set up or configure c3d-mcp.
---

# c3d-setup

If the `c3d_*` tools are not available: on clients without the MCP server (for example ChatGPT) hand off to the `c3d-scripting` skill's standalone-macro fallback. For install problems stay here.

## Requirements
macOS 14+ on Apple Silicon, Cheetah3D 8.1.3, Node.js >= 22. The helper app is optional but strongly recommended: without it `c3d_new_document`, `c3d_make_editable`, `c3d_merge_file` and `c3d_capture_viewport` are unavailable and the server falls back to `osascript` (slower; the terminal/MCP client then needs Accessibility).

## One-time install
Easiest for a new user (tell them to run it in Terminal; it asks before every change and never uses sudo): `curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/install.sh | bash`. It checks macOS, Cheetah3D and Node.js 22+, can install Node.js, installs c3d-mcp, then runs `c3d-mcp setup` (bridge, helper, Accessibility pane, client configs, skills, test render). Use `--dry-run` to only report. The manual steps below are the equivalent.

Replace `c3d-mcp` with the release tarball URL while the package is not on npm (`npx -y <tarball-url> <command>`).

1. `npx -y c3d-mcp install` - detects a fresh, outdated or partial install and does what is needed: backs up Cheetah3D's `Scripts/`, installs or updates the bridge macro, runtime and helper app (to `~/Library/Application Support/Cheetah3D/MCP/helper/`), repairs what is missing. Idempotent. `c3d-mcp status` shows the state without changing anything; `install --dry-run` shows the plan; `install --repair` fixes only what is broken; `install --reinstall` rewrites everything.
2. Restart Cheetah3D once. New macros are scanned only at launch. The macro appears under Tools > Script > Macro Script > C3D-MCP > C3D-MCP Bridge.js; never run it by hand, the helper presses it.
3. Grant the helper Accessibility: System Settings > Privacy & Security > Accessibility > `+` > Shift-Cmd-G > paste `~/Library/Application Support/Cheetah3D/MCP/helper/C3D Bridge Helper.app` > enable. The helper never triggers the macOS prompt itself, so it is not listed until added. Screen Recording (same way) is needed only for `c3d_capture_viewport`. After the helper is rebuilt or updated, toggle the grant off and on.
4. `npx -y c3d-mcp doctor` (add `--brief` for one line when healthy, `--json` for machine output). Every failing check prints a fix.
5. Register the server with the client: `npx -y c3d-mcp config <client>` prints a ready snippet (`--raw` prints only the snippet, `--form absolute` uses absolute node paths). Clients: `claude-desktop`, `claude-code`, `codex`, `gemini-cli`, `antigravity`, `cursor`, `lm-studio`. Paths and snippets: [clients](references/clients.md).

Runtime-only updates (`c3d-mcp install` after a package upgrade) need no Cheetah3D restart; the first install does. An update that replaces the helper app makes macOS ask for Accessibility (and Screen Recording) again: the downloadable helper is ad-hoc signed, so each build counts as a new app. Tell the user to grant it again (step 3) or run `c3d-mcp setup`.

When the tools are already connected, `c3d_doctor` is the in-chat equivalent of `doctor`, and `c3d_install_bridge` of `install` (`mode`: auto, repair or reinstall; `dry_run` previews; a restart of Cheetah3D and the permission grant are still the user's job). `c3d_capabilities` lists the object, tag, material and light types and the tools active in the current profile.

## Profiles and switches
Set in the client config `env` block or the shell.

| Variable | Effect |
|---|---|
| `C3D_MCP_PROFILE` | `full` (default), `local` (<= 25 tools, short descriptions, no scripting; for small local models), `readonly` (read tools only) |
| `C3D_MCP_DISABLE_EXEC=1` | hide `c3d_run_script` |
| `C3D_MCP_DISABLE_ASSETS=1` | hide the Poly Haven asset tools |
| `C3D_MCP_DISABLE_SHELL=1` | never allow `OS.system` in scripts |
| `C3D_MCP_AUTO_CONFIRM=1` | unattended runs only (e.g. `claude -p`): honour model-supplied `confirm:true`. Off by default; a client with elicitation is always asked and the model's flag is ignored. Never set it for interactive use or in shared configs |
| `C3D_MCP_WORKDIR` | renders, checkpoints, exports, downloads (default `~/Library/Application Support/Cheetah3D/MCP/tmp`) |
| `C3D_MCP_TRIGGER` | `auto` (default), `helper`, `osascript` |
| `C3D_HELPER_APP` | use a helper bundle from a custom path |
| `C3D_HELPER_SKIP_VERIFY=1` | skip the code-signature check of a locally built, unsigned helper |
| `C3D_MCP_DIR`, `C3D_CHEETAH_SUPPORT_DIR` | override the mailbox / Cheetah3D support dir (tests) |
| `C3D_MCP_LOG_DIR`, `C3D_MCP_LOG_LEVEL` | log location (default `~/Library/Logs/c3d-mcp`) and `debug|info|warn|error` |

Long operations: renders can take minutes, so raise the client's tool timeout (the Codex and Gemini snippets already do).

## First diagnosis
1. Run `doctor`; read the failing check's `fix`.
2. Look up the error code in [troubleshooting](references/troubleshooting.md). Every tool error carries `{code, message, hint, details}`; follow `hint`.
3. Logs: `~/Library/Logs/c3d-mcp/`; the in-app bridge log comes from `c3d_get_console`.

## Rules
- Do not edit TCC permissions yourself (no `tccutil`, no database edits); ask the user to click through System Settings.
- Never dismiss Cheetah3D dialogs on the user's behalf: report the text from `BLOCKED_BY_MODAL` and wait.
- Do not uninstall (`c3d-mcp uninstall --yes`) unless asked; it keeps backups and the user's scripts. `uninstall --dry-run` lists what would go; `--all` also removes agent skills and the c3d entries in MCP client configs, so only use it when the user wants everything gone.
- For building scenes once the setup works, use the `c3d-scene-building` skill.
