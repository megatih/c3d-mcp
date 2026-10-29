# Installing c3d-mcp on a new Mac

You need three things: **macOS 14 or newer** (Apple Silicon recommended), **Cheetah3D 8.1.3** (commercial software, installed and launched once), and **Node.js 22 or newer**. The installer checks all of them and offers to install what it can (Node.js); it never uses `sudo`.

## 1. One command

Open Terminal and run:

```bash
curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/install.sh | bash
```

Prefer to read the script first? That is encouraged:

```bash
curl -fsSL https://github.com/megatih/c3d-mcp/releases/latest/download/install.sh -o install.sh
less install.sh
bash install.sh
```

Or download `Install-c3d-mcp.command` from the [latest release](https://github.com/megatih/c3d-mcp/releases/latest) and double-click it (macOS may ask you to confirm opening a downloaded file: right-click → Open).

Useful flags: `--dry-run` (report only, change nothing), `--yes` (accept the defaults), `--no-node-install`, `--skip-cheetah-check`, `--prefix <dir>` (default `~/.c3d-mcp`), `--clients <list|all|none>`, `--no-skills`.

## 2. What it does, step by step

| Step | What happens | If something is missing |
|---|---|---|
| Platform | Checks macOS ≥ 14 and the CPU | Stops with a message |
| Cheetah3D | Looks for `Cheetah3D.app` (in `/Applications` and `~/Applications`), its version, and that it has been launched once | It cannot be installed for you: get it from <https://www.cheetah3d.com>, launch it once, run the installer again |
| Node.js ≥ 22 | Checks `node` | Asks first. With Homebrew: `brew install node@22`. Without: downloads the official tarball from nodejs.org, **verifies its SHA-256**, unpacks it into `~/.c3d-mcp/node` (no admin rights). Decline and it prints manual steps |
| c3d-mcp | Downloads the release tarball, verifies its SHA-256, installs it into `~/.c3d-mcp/app`, creates `~/.c3d-mcp/bin/c3d-mcp` | Aborts on any checksum mismatch |
| Setup wizard | `c3d-mcp setup`: installs the bridge macro + runtime and the helper app into Cheetah3D's folders (it backs up your Scripts folder first), opens the right System Settings pane, configures your AI clients, installs the agent skills, verifies everything and runs a test render | See the wizard notes below |

Everything it changes is listed at the end and can be undone (section 5).

## 3. The two manual moments

1. **Restart Cheetah3D once.** Cheetah3D only scans its macros at launch. The wizard tells you when; it never closes the app for you.
2. **Grant Accessibility to "C3D Bridge Helper".** The wizard opens System Settings on the Accessibility pane (it checks which pane really opened, because Apple has moved these panes between macOS versions, and falls back to showing you the click path: *System Settings › Privacy & Security › Accessibility*), reveals the helper app in Finder so you can drag it into the list or switch it on, and waits until permission is detected. Screen Recording is optional (only for `c3d_capture_viewport`). The installer never edits macOS privacy settings itself.

The helper is signed but **not notarized**. If macOS blocks it the first time, run `xattr -dr com.apple.quarantine "$HOME/Library/Application Support/Cheetah3D/MCP/helper/C3D Bridge Helper.app"` and open it once.

## 4. Connecting your AI client

The wizard detects Claude Desktop, Claude Code, Codex CLI, Antigravity (`agy`), Gemini CLI and Cursor and asks, one by one, before adding the `c3d` server to each (existing entries are never overwritten; a timestamped backup of every file it edits is kept next to it). Claude Desktop can also use the `.mcpb` extension from the release. Manual configs for every client: [SETUP.md](SETUP.md). Agent skills that teach the AI to use the tools well: [SKILLS.md](SKILLS.md).

Then try: *"Run c3d_doctor, then build a small table with four legs, light it and render it."*

## 5. Updating and uninstalling

- Update: run the installer again (it is idempotent) or `c3d-mcp setup`.
- Remove the bridge from Cheetah3D: `c3d-mcp uninstall` (your scripts and backups are kept).
- Remove skills: `c3d-mcp skills uninstall`.
- Remove the installer's own files: delete `~/.c3d-mcp` and the PATH line it may have added to `~/.zprofile`; remove the `c3d` entry from client configs (backups are next to them).

## Troubleshooting
See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) (installer problems are in its first section) or run `c3d-mcp doctor`.
