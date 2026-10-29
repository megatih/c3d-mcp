# Security model

c3d-mcp lets an AI agent drive a desktop application. This page states what is protected, what is not, and how to reduce risk. It is deliberately honest: several controls are guard rails against mistakes, not boundaries against a hostile process.

## Threat model

* **Same user, same machine.** Everything runs as the logged-in macOS user. Anything else running as that user (including any other program you have started) can already read your files, drive your apps through Accessibility, and read the mailbox. c3d-mcp does not defend against that.
* **In scope:** other local users and sandboxed/low-privilege processes reading or writing the bridge files; accidental or prompt-injected destructive tool calls from the connected agent; a second MCP server interleaving requests; stale requests running later than intended; leaking secrets into logs.
* **Out of scope:** a malicious process running as you; a malicious or compromised MCP client with legitimate access to the tools (it can do whatever the enabled tools allow, see "Reducing exposure"); malicious `.jas` files or assets opened in Cheetah3D itself.

## Components and trust boundaries

| Component | Runs as | Trusts |
|---|---|---|
| MCP client (Claude, Codex, ...) | user | the model's tool calls are *untrusted input* to the server |
| `c3d-mcp serve` (Node) | user, stdio only (no network listener) | MCP client over stdio; files in the mailbox directory |
| Loader macro + runtime (inside Cheetah3D) | user, in Cheetah3D's process | requests carrying the shared secret |
| C3D Bridge Helper (optional Swift app) | user, own TCC grants | callers that can connect to its Unix socket |

The server never opens a TCP/HTTP port. Transport is stdio; stdout carries only protocol traffic.

## Mailbox (`~/Library/Application Support/Cheetah3D/MCP/`)

* All directories are created from Node with mode `0700`; the `secret` file is `0600`. A pre-existing directory is only tightened (chmod) when it is owned by the current user and is empty or already looks like a mailbox: a user-supplied `C3D_MCP_DIR` that points at someone else's or an unrelated directory is never chmod-ed. The server refuses to write requests into a mailbox directory owned by another user or writable by group/others (`PERMISSION_MISSING`, hint `chmod 700`). `c3d_doctor` warns when permissions drift. (Cheetah3D's JavaScript cannot create directories, so Node/Swift own that.)
* **Secret.** 32 random bytes (hex) generated at install. Every request carries it and the runtime rejects mismatches without running any op. It stops *other users* and accidental cross-talk; it does not stop another process of the same user, which can read the file. It is never logged (log lines are scrubbed of secret-like values and keys named `secret`/`token`/`password`).
* **Request integrity.** Requests are written to `*.json.tmp`, fsynced and renamed, so the runtime never sees a partial request. Responses are accepted only when the `.done` marker's byte length and Adler-32 match (a corruption check, not a MAC).
* **Staleness and replay.** Each request has a uuid, a monotonic `seq`, and an absolute `deadlineAt`. The runtime skips requests it already answered or whose `seq` is not newer than `lastSeq`, answers expired requests with `TIMEOUT` without running any op, and honours `cancel/<id>` markers. A client that gives up writes the cancel marker, so a late menu press can never execute an abandoned request. Extra presses of the macro are harmless.
* **Document binding.** Requests carry `expectDocument` (file name and/or a session marker object); the runtime answers `WRONG_DOCUMENT` instead of editing a different front document.
* **Cross-process lock.** `MCP/lock` (O_EXCL, PID, heartbeat, stale detection) serialises two servers. Reclaiming a stale lock is not perfectly atomic; the worst case is two servers interleaving one press, which the uuid addressing tolerates.

## Helper app and socket

* The helper listens on `MCP/helper.sock` (mode `0600`, inside the `0700` directory) and speaks JSON lines. Any process of the same user that can open the socket can ask it to press menus, capture the Cheetah3D window, or read the Accessibility tree; the helper holds the TCC grants (Accessibility, Screen Recording), so treat socket access like access to those permissions.
* The server only launches the helper with `open -g -a "<helper app>" --args --socket <path>` (never as a Node child process) and only from the known install locations (`MCP/helper/`, `~/Applications`, `/Applications`, or `C3D_HELPER_APP`). Before the first launch the bundle's code signature is checked with `codesign --verify --deep --strict`; a bundle that fails is not launched (error with a hint). Locally built, unsigned helpers need `C3D_HELPER_SKIP_VERIFY=1`.
* The helper clicks buttons only in dialogs *it* created (`dismissOwnModal`). Foreign dialogs are reported as `BLOCKED_BY_MODAL`; Save / Don't Save are never clicked.
* Without the helper the server falls back to `osascript` + System Events, which needs Accessibility for the app that launched `c3d-mcp` (your terminal or MCP client). `doctor` reports this as degraded mode.
* Permissions are never self-granted: c3d-mcp does not touch the TCC database or run `tccutil`.

## Scripting tool (`c3d_run_script`) is NOT a sandbox

The runtime wraps user code (strict mode, shadowed `eval`/`Function`/`geval`, guarded `OS` and `File` including temporary replacement of the global bindings, `mkDir` always throwing). This catches mistakes and the escape routes we tested; it is **not a security boundary**. Cheetah3D's JavaScriptCore exposes `OS.system`, file I/O and the whole scene to scripts, and a determined script can find another route. Treat any script you let an agent run as running with your user's full privileges.

* `OS.system` is blocked unless the user confirms (below). `c3d_lint_script` is advisory only.
* Disable the tool entirely with `C3D_MCP_DISABLE_EXEC=1` (also hidden in the `local` and `readonly` profiles).

## Confirmation and elicitation

Destructive or hard-to-undo actions (deleting more than five objects or objects with children, overwriting files, scripts that use `OS.system` or write files, restoring checkpoints) call `services.confirm`:

1. if the client declared the `elicitation` capability, the user is asked through the MCP elicitation flow (works in both the 2025 and 2026 protocol eras; the SDK answers on the server's behalf for older clients);
2. otherwise the tool requires an explicit `confirm: true` argument and fails with `CONFIRMATION_REQUIRED` and a hint.

A declined or cancelled elicitation is a refusal. Note that `confirm: true` supplied by the model is only as trustworthy as the model; elicitation puts a human in the loop.

## Existing files, backups and checkpoints

* Tools refuse to overwrite a file that existed before the session unless it was created or opened through this server and the call is confirmed. Companion files count too (the `.mtl` next to an `.obj` export); a dangling symlink counts as existing. Missing parent directories are created only inside the work directory; elsewhere the directory must already exist (`INVALID_ARGUMENT`). Files the server writes itself (gradient backgrounds) are created with exclusive `O_EXCL` creation. Files written by Cheetah3D (`saveToFile`) or the helper (post-processing) are checked beforehand but not created exclusively, so the check is not atomic.
* `c3d-mcp install` takes a timestamped `tar.gz` of `Scripts/` into `Cheetah3D/MCP-backups/` *before* modifying anything and aborts if the backup fails. `uninstall` removes only what the install manifest lists as created by install (the loader macro only if install created it: a macro file that existed before is kept; the `MCP/` directory) and never touches `MCP-backups/` or your own scripts/macros; entries outside the managed directories are refused even if a manifest lists them.
* Edit > Undo does not revert macro changes (probe P11); safety comes from file checkpoints, not undo.

## Network and downloads

* The server itself makes no network connections except the asset tools (Poly Haven by default), which are optional (`C3D_MCP_DISABLE_ASSETS=1`).
* Downloads: HTTPS only, size caps enforced while streaming (the transfer is aborted as soon as the cap is exceeded, with or without `Content-Length`; JSON API responses are capped at 8 MB), extension allow-list, SHA-256 recorded next to the file, licence/attribution recorded. Downloaded files are untrusted data and are only ever opened by Cheetah3D as geometry/images, never executed.
* The optional helper download at install time must be HTTPS with a pinned SHA-256; the installer step is injectable so offline installs never touch the network. Nothing is published or uploaded by c3d-mcp.

## Logging

* stderr and `~/Library/Logs/c3d-mcp/c3d-mcp.log` (mode `0600`, rotated at 2 MB, three generations). `C3D_MCP_LOG_LEVEL=debug|info|warn|error`.
* Logs contain tool names, error codes and timings. They never contain the secret (scrubbed by value and by key). Tool arguments are not logged by default; scene content and file paths can appear in error messages, so review a log before sharing it.
* Client-visible errors never include stack traces: unexpected exceptions become `INTERNAL` with a short message; the stack goes to the local log only.

## Reducing exposure

| Goal | Setting |
|---|---|
| Read-only agent | `C3D_MCP_PROFILE=readonly` (only non-mutating tools are registered) |
| Small local models | `C3D_MCP_PROFILE=local` (curated subset, short descriptions, no scripting) |
| No scripting | `C3D_MCP_DISABLE_EXEC=1` |
| No internet access | `C3D_MCP_DISABLE_ASSETS=1` |
| No shell from scripts | `C3D_MCP_DISABLE_SHELL=1` |
| Keep state elsewhere | `C3D_MCP_DIR`, `C3D_MCP_WORKDIR`, `C3D_MCP_LOG_DIR` |

Honest annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are generated from each tool's definition and checked by tests (a mutating tool can never advertise `readOnlyHint: true`), so clients can apply their own approval policies.

## Reporting

Please report vulnerabilities privately to the maintainers rather than in a public issue.


## Reporting a vulnerability
Open a private security advisory on the GitHub repository (Security → Advisories) rather than a public issue.

## Confirmation, in plain words
Before deleting more than 5 objects (or objects with children), overwriting a file, restoring a checkpoint, or running a script that touches files or the shell, the server asks you: through MCP elicitation if your client supports it, otherwise the tool refuses until the agent repeats the call with `confirm:true` (which your client may in turn show you for approval).

## Unattended runs
`C3D_MCP_AUTO_CONFIRM=1` makes the server accept `confirm:true` from the model without asking a human, even if the client supports elicitation. Use it only for headless/automation runs on a scratch Cheetah3D document; it is deliberately off by default and not set by any client config snippet.
