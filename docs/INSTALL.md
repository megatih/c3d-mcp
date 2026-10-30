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

Useful flags: `--dry-run` (report only, change nothing), `--yes` (accept the defaults), `--no-node-install`, `--skip-cheetah-check`, `--prefix <dir>` (default `~/.c3d-mcp`), `--clients <list|all|none>`, `--no-skills`, `--no-setup` (install or update the package only; skip the Cheetah3D setup wizard), and the lifecycle flags in section 5 (`--status`, `--update`, `--repair`, `--reinstall`, `--uninstall`).

## 2. What it does, step by step

| Step | What happens | If something is missing |
|---|---|---|
| Platform | Checks macOS ≥ 14 and the CPU | Stops with a message |
| Cheetah3D | Looks for `Cheetah3D.app` (in `/Applications` and `~/Applications`), its version, and that it has been launched once | It cannot be installed for you: get it from <https://www.cheetah3d.com>, launch it once, run the installer again |
| Node.js ≥ 22 | Checks `node` | Asks first. With Homebrew: `brew install node@22`. Without: downloads the official tarball from nodejs.org, **verifies its SHA-256**, unpacks it into `~/.c3d-mcp/node` (no admin rights). Decline and it prints manual steps |
| c3d-mcp | Downloads the release tarball, verifies its SHA-256, installs it into `~/.c3d-mcp/app`, creates `~/.c3d-mcp/bin/c3d-mcp` | Aborts on any checksum mismatch |
| Setup wizard | `c3d-mcp setup`: installs the bridge macro + runtime and the helper app into Cheetah3D's folders (it backs up your Scripts folder first), opens the right System Settings pane, configures your AI clients, installs the agent skills, verifies everything and runs a test render | See the wizard notes below |

Everything it changes is listed at the end and can be undone (section 5). Run it again later to update, repair or uninstall.

## 3. The two manual moments

1. **Restart Cheetah3D once.** Cheetah3D only scans its macros at launch. The wizard tells you when; it never closes the app for you.
2. **Grant Accessibility to "C3D Bridge Helper".** The wizard opens System Settings on the Accessibility pane (it checks which pane really opened, because Apple has moved these panes between macOS versions, and falls back to showing you the click path: *System Settings › Privacy & Security › Accessibility*), reveals the helper app in Finder so you can drag it into the list or switch it on, and waits until permission is detected. Screen Recording is optional (only for `c3d_capture_viewport`). The installer never edits macOS privacy settings itself.

The helper is signed but **not notarized**. If macOS blocks it the first time, run `xattr -dr com.apple.quarantine "$HOME/Library/Application Support/Cheetah3D/MCP/helper/C3D Bridge Helper.app"` and open it once.

## 4. Connecting your AI client

The wizard detects Claude Desktop, Claude Code, Codex CLI, Antigravity (`agy`), Gemini CLI and Cursor and asks, one by one, before adding the `c3d` server to each (existing entries are never overwritten; a timestamped backup of every file it edits is kept next to it). Claude Desktop can also use the `.mcpb` extension from the release. Manual configs for every client: [SETUP.md](SETUP.md). Agent skills that teach the AI to use the tools well: [SKILLS.md](SKILLS.md).

Then try: *"Run c3d_doctor, then build a small table with four legs, light it and render it."*

## 5. Installing, updating, repairing, reinstalling and uninstalling

Run the same installer again whenever you like. It first **detects what is there** and tells you:

| It finds | What it says | What it does by default |
|---|---|---|
| nothing | `no existing install (fresh)` | installs everything |
| c3d-mcp, same version as the release | `up to date` | leaves the package alone; `setup` still checks the Cheetah3D side and the helper app |
| an older c3d-mcp | `update available: 0.3.1 -> 0.3.2` | downloads and verifies the new version; the setup step then updates the bridge runtime and **replaces an older helper app** |
| a newer c3d-mcp than the release | `newer than the release` | never downgrades |
| a bridge installed by hand, or whose manifest was lost | `unmanaged install` | `install` adopts the files that carry c3d-mcp's markers and records them, so a later uninstall can remove them |
| a partial install | `partial install: launcher missing; app missing; launcher points at a Node.js that is gone` | repairs exactly what is missing, keeping versions |

In a terminal, when an install already exists, you get a menu: **1) Update · 2) Repair · 3) Reinstall · 4) Uninstall the bridge and helper · 5) Uninstall everything · 6) Show status · q) Quit** (the recommended entry is marked). With `--yes` or `--dry-run` no menu is shown and the sensible default is used.

Or choose directly with flags:

| Flag | Meaning |
|---|---|
| `--status` | show what is installed (the installer's part and, through `c3d-mcp status`, the Cheetah3D side) and what to run next; changes nothing |
| `--update` | move to the pinned/latest version |
| `--repair` | fix a partial or broken install; versions stay as they are |
| `--reinstall` | download and rewrite everything again; keeps your settings, backups and scripts |
| `--uninstall` | remove the bridge from Cheetah3D (macro, runtime, mailbox) and the helper app, after listing what will go and asking |
| `--uninstall --all` | also remove the agent skills, the `c3d` entries in your MCP client configs (a backup is made, other entries are untouched), `~/.c3d-mcp` (private Node.js, package, launcher) and the `# c3d-mcp` PATH line the installer added |
| `--keep-prefix` | with `--all`: keep `~/.c3d-mcp` and the PATH line |
| `--dry-run` | with any of the above: show the plan and change nothing |

The same lifecycle exists inside the package, without the shell installer: `c3d-mcp status`, `c3d-mcp install` (auto: fresh, update or repair), `c3d-mcp install --repair`, `c3d-mcp install --reinstall`, `c3d-mcp install --dry-run`, `c3d-mcp uninstall [--all] [--dry-run]`. Extra `install` flags: `--no-helper` (leave the helper app alone) and `--skip-ping` (do not wait for a live Cheetah3D, e.g. before its first restart). `c3d-mcp doctor` has an `install-state` check that names what is wrong and which command fixes it.

**The helper app and macOS permissions.** The helper is replaced when it is older than the one in the package (or damaged). The previous app is copied to `~/Library/Application Support/Cheetah3D/MCP-backups/helper-<time>/`, the running helper is stopped, the new one is started and must answer with the expected version, otherwise the old one is put back automatically. Because the downloadable helper is ad-hoc signed, macOS treats a new build as a new app: **grant Accessibility (and Screen Recording for screenshots) again** after an update. The installer tells you; `c3d-mcp setup` opens the right Settings page and waits.

**Uninstall never removes** your Cheetah3D scripts, the `MCP-backups` folder, or files it did not create. Without an install manifest (hand-installed, or the manifest was lost) it removes only files that carry c3d-mcp's own markers and lists what it left. A LaunchAgent for the helper is removed only if it starts the helper c3d-mcp installed.

## Troubleshooting
See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) (installer problems are in its first section) or run `c3d-mcp doctor`.
