# Installing c3d-mcp on a new Mac

One download, a graphical control panel, nothing to type. You need **macOS 14 or newer on Apple Silicon** and **Cheetah3D 8.1.3** (commercial software, installed and launched once). Node.js is **not** needed: the app carries its own, and neither Homebrew nor Terminal is required.

1. Download `C3D-MCP-<version>.dmg` from the [latest release](https://github.com/megatih/c3d-mcp/releases/latest) and drag **C3D MCP** onto **Applications**.
2. **First launch only: macOS will say it cannot verify the app.** The app is signed with its own certificate rather than an Apple Developer ID (there is no paid Apple membership behind this project), so this prompt is expected. Click **Done**, open *System Settings › Privacy & Security*, scroll to the message about "C3D MCP", click **Open Anyway** and enter your password. Open the app again and click **Open**. You do this once per Mac.
   *Prefer not to click through?* This one line downloads the same app straight into Applications; files downloaded with `curl` are not flagged by macOS, so there is no prompt:
   ```bash
   curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/get-c3d-mcp.sh | bash
   ```
   (It only downloads, verifies the SHA-256, copies and opens the app. Read it first if you like: it is about 40 lines.)
3. In the app:
   * **Bridge**: *Install or update*, then restart Cheetah3D once (it only scans macros at launch).
   * **AI clients**: tick Claude Desktop, Claude Code, Codex, Antigravity, Gemini CLI or Cursor. The app writes the config with absolute paths into the app, so no `npx` or login PATH is needed.
   * **Permissions**: grant Accessibility (and optionally Screen Recording) to *C3D MCP* once, and choose how often c3d-mcp should ask for confirmation. *Allow all c3d tools* stops Claude Code asking before every tool call.
   * **Activity** shows the helper log, **Overview** the health check, **Cleanup** removes older installs.
4. **Updating**: the app checks for updates by itself (Overview › Updates). Because every release is signed with the same certificate, macOS should keep your permissions across updates.
5. **Uninstalling**: *Bridge › Uninstall everything* removes the bridge, the agent skills and the client entries (your Cheetah3D scripts and backups stay); then drag the app to the Trash.

### Coming from an older install?
The app finds installs made by any earlier method, including manual ones, and removes them (everything goes to the Trash, your scripts and `MCP-backups` are kept): the `install.sh` install in `~/.c3d-mcp` and its PATH line, `npm i -g` and the npx cache, the separate *C3D Bridge Helper* app (any folder, also a Homebrew cask copy), its LaunchAgent and old permission entry, the Claude Desktop extension, the Claude Code plugin, `c3d` entries in client configs that still launch an old install, and a copy of the loader macro placed outside the `C3D-MCP` folder. It opens by itself on first launch when it finds something, and any time under **Cleanup**; command line: `c3d-mcp legacy scan` / `c3d-mcp legacy remove` (with `--ids`, `--dry-run`, `--yes`).

**What it keeps:** the bridge in Cheetah3D (the `C3D-MCP` macro and the `MCP` folder), the agent skills and the logs are shared by every version, including this app, so an older install is simply taken over and updated by **Bridge › Install or update**. Cleanup never lists them, so it can never remove a working install.

## What the app puts where
| Where | What | Removed by |
|---|---|---|
| `/Applications/C3D MCP.app` (or `~/Applications`) | the app: control panel, helper, bundled Node.js and server | drag to the Trash |
| `~/Library/Application Support/Cheetah3D/Scripts/Macro/C3D-MCP/` | the loader macro Cheetah3D runs | Bridge › Uninstall everything |
| `~/Library/Application Support/Cheetah3D/MCP/` | mailbox, secret, runtime, `settings.json`, logs | Bridge › Uninstall everything |
| `~/Library/Application Support/Cheetah3D/MCP-backups/` | backups of your Scripts folder made before each change | never removed automatically |
| the config of each client you connect | a `c3d` entry (a timestamped `.c3d-backup-*` copy of the file is kept next to it) | AI clients › Disconnect, or Uninstall everything |
| `~/.claude/skills`, `~/.agents/skills`, `~/.gemini/config/skills` | the agent skills (folders marked `.c3d-mcp-skill`) | Bridge › Remove agent skills |
| `~/Library/Logs/c3d-mcp/` | helper log, cleanup reports | Cleanup keeps its reports |

Nothing is installed with administrator rights, and nothing outside this table is touched.

## Command line (optional)
Everything the control panel does is a command of the bundled server (add `--json` for machine-readable output):

```bash
APP="/Applications/C3D MCP.app/Contents/Resources"
"$APP/node/bin/node" "$APP/server/bin/c3d-mcp.js" status          # what is installed
"$APP/node/bin/node" "$APP/server/bin/c3d-mcp.js" doctor          # health check
"$APP/node/bin/node" "$APP/server/bin/c3d-mcp.js" legacy scan     # leftovers of older installs
```
See `--help` for all commands: `install`, `uninstall`, `clients`, `permissions`, `legacy`, `skills`, `config`, `status`, `doctor`.
