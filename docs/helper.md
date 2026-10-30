# C3D Bridge Helper

## For users
The helper is a small background app (no Dock icon) that the server starts automatically (`open -g -a`, socket `~/Library/Application Support/Cheetah3D/MCP/helper.sock`). It brings Cheetah3D to the front for a moment, presses the bridge menu item, reports open dialogs, can screenshot the Cheetah3D window and downscale renders, then restores the app you were using.

* Installed by `c3d-mcp install` to `~/Library/Application Support/Cheetah3D/MCP/helper/C3D Bridge Helper.app` (or via the Homebrew cask `c3d-bridge-helper`). `c3d-mcp install` also **updates** it: an older or damaged helper is replaced (the old app is backed up in `MCP-backups/helper-<time>/`, and put back automatically if the new one does not start). A helper from the Homebrew cask is never replaced by c3d-mcp: use `brew upgrade --cask c3d-bridge-helper`.
* Needs **Accessibility** (and optionally **Screen Recording**): add the app with **+** in System Settings → Privacy & Security — see `docs/TROUBLESHOOTING.md#granting-permissions`.
* Remove it with `c3d-mcp uninstall` (it stops the helper process and removes its LaunchAgent first, if one of ours exists). It only talks to the Unix socket owned by your user.
* After an update macOS asks for Accessibility (and Screen Recording) again, because the downloadable helper is ad-hoc signed and each build counts as a new app. A helper you built and signed with your own stable certificate keeps its grants.

The rest of this file is developer documentation (architecture, command reference, live-verification notes).


Swift app (`dev.c3dmcp.helper`) that performs everything needing macOS Accessibility or Screen Recording on behalf
of the c3d-mcp server: pressing Cheetah3D menu items, window/dialog inspection, window capture, image tooling.
Authoritative spec: `docs/PROTOCOL.md` section 2 and 6; wire schema `contracts/helper-ipc.schema.json`.

## Layout

```
helper/Package.swift            SwiftPM (Swift 6 mode, macOS 14+)
helper/Sources/HelperCore       library: all logic
helper/Sources/C3DBridgeHelper  executable (LSUIElement agent)
helper/Sources/c3d-helper-ctl   diagnostics CLI
helper/Tests/HelperCoreTests    XCTests (offline, use FakeAX)
helper/build-app.sh             builds + signs helper/build/C3D Bridge Helper.app
helper/install-launchagent.sh   install / uninstall / start the LaunchAgent (scripts only)
packaging/sign-dev.sh           signing (ad-hoc or $C3D_SIGN_IDENTITY) + verify
packaging/notarize.sh           notarytool + stapler (--dry-run prints only)
packaging/launchagent/          dev.c3dmcp.helper.plist.template
```

HelperCore pieces: `AXProvider` (OS abstraction; `RealAX` = AppKit + ApplicationServices, `FakeAX` = scripted
in-memory Cheetah3D with a virtual clock), `MenuWalker` (title-path resolution, tolerant of the real
`AXMenuBarItem > AXMenu > AXMenuItem` nesting, separators have no title), `ModalDetector` + `OwnModalRegistry`,
`Presser` (press sequence), `Lifecycle` (launchApp, newDocument), `Imaging` (ImageIO), `SCKWindowCapturer`
(ScreenCaptureKit), `CommandRouter` (strict validation, dispatch), `SocketServer`/`SocketClient`.

## Running it

```sh
helper/build-app.sh                                  # -> helper/build/C3D Bridge Helper.app (universal if possible)
open -g -a "C3D Bridge Helper.app" --args --socket "$HOME/Library/Application Support/Cheetah3D/MCP/helper.sock"
# from the repo: open -g -a "$PWD/helper/build/C3D Bridge Helper.app" --args --socket <path>
```

* `--socket <path>` is required. The parent directory must already exist (the helper never creates it; Node does).
* A stale socket file is removed; if a live instance answers on it the new process exits with code **3**; a
  non-socket file at the path is never touched (exit 1).
* Socket mode is 0600. SIGTERM/SIGINT: closes connections, unlinks the socket, exit 0.
* `--version`, `--selftest` (FakeAX self test, touches no real app, exit 0 on success).
* Logs: stderr and `~/Library/Logs/c3d-mcp/helper.log` (rotated at 2 MB to `helper.log.1`).
* Never spawn it as a child of Node (see "Responsible process").

Diagnostics (inside the bundle, or `swift run c3d-helper-ctl`):

```sh
CTL="helper/build/C3D Bridge Helper.app/Contents/MacOS/c3d-helper-ctl"
"$CTL" --socket "$SOCK" status          # also: ping permissions windows listMenus modalState
"$CTL" --socket "$SOCK" --yes-press pressBridge   # state-changing commands need --yes-press
```

Build / test: `cd helper && swift build && swift test` (offline, ~1 s). Release bundle: `helper/build-app.sh`
(`C3D_SIGN_IDENTITY` optional). Version comes from `helper/VERSION` into the Info.plist.

## Protocol

JSON lines over the Unix socket. One request per line: `{"id":"<string>","cmd":"<name>","args":{...}}`.
Exactly these top-level fields are allowed. One response per request:
`{"id","ok":true,"result":...}` or `{"id","ok":false,"error":{"code","message","hint?","details?"}}`.
A connection may pipeline requests; responses are written in **completion order**, so correlate by `id`
(unreadable requests get `id:""`). Lines are capped at 4 MiB. Blank lines are ignored.
Error codes used: `APP_NOT_RUNNING TRIGGER_FAILED BLOCKED_BY_MODAL PERMISSION_MISSING INVALID_ARGUMENT INTERNAL TIMEOUT`.
Unknown arguments are rejected (`INVALID_ARGUMENT`), as are unknown commands and non-string ids.

| cmd | args | result |
|---|---|---|
| `ping` | - | `{version, pid}` |
| `status` | - | `{cheetah:{running,pid\|null,frontmost,version\|null,responsive}, bridgeMenuPresent, modal:{title,text,buttons,own}\|null, windows:[...], permissions}`; never fails |
| `permissions` | - | `{accessibility, screenRecording}` |
| `windows` | - | `[{title, role, subrole, main, focused, minimized, document?}]` |
| `modalState` | - | `{open, dialogs:[{title,text,buttons,own}]}` (`open` = any dialog, own ones included) |
| `listMenus` | `path?:[str]`, `depth?:1..12` (8) | `{title,role,enabled,children?}` tree (shape of `research/raw/menus.json`; separators have title `""`) |
| `pressBridge` | `requireDocTitle?`, `timeoutMs?` (100..30000, 2000), `menuPath?` | `{pressed:true, activatedMs, busy}` |
| `pressMenu` | `path:[str]`, `timeoutMs?`, `requireDocTitle?`, `requireDocument?` (true), `ownModalText?` | same as pressBridge |
| `raiseWindow` | `title` | `{raised:true,title}` (AXRaise only, no activation) |
| `newDocument` | - | `{title}` (File > New, title of the window that appeared) |
| `launchApp` | - | `{pid}` (waits <= 30 s for the AX menu bar) |
| `dismissOwnModal` | `text` | `{dismissed:bool}` - presses `OK` only on a dialog that is registered as own AND contains `text` |
| `captureWindow` | `title?`, `outPath` (abs), `overwrite?` (false), `crop?:{x,y,width,height}` (window points) | `{path,width,height,bytes}` PNG, ScreenCaptureKit |
| `analyzeImage` | `path` (abs) | `{width,height,blank,meanLuma (0..1),stdDev (0..1),histogram[16]}` |
| `downscaleImage` | `path`, `outPath`, `maxDim`, `maxBytes`, `overwrite?` (false) | `{path,width,height,bytes,format}`; PNG, else JPEG (extension rewritten to `.jpg`, use the returned `path`) |
| `postProcessImage` | `path`, `outPath`, `overwrite?` (false), `bloom?:{threshold 0..1, radius px 0..500, intensity 0..2}`, `outline?:{strength 0..1, width px 0.5..4, color?:[r,g,b] 0..1 (black)}`, `vignette?:{intensity 0..1, radius 0..2}`, `grade?:{saturation 0..2 (1), contrast 0.5..1.5 (1), exposure -2..2 EV (0), shadowTint?, highlightTint?:[r,g,b] 0..1, tintAmount 0..1 (0.5)}`, `posterize?:{levels 2..32}` | `{outPath,width,height,bytes,applied:[...]}` |

`postProcessImage` (CoreImage, Metal with software fallback) applies, in this fixed order, `grade -> posterize -> outline -> bloom -> vignette`;
`applied` lists the requested ones in that order and at least one effect is required. `path`/`outPath` must end in png/jpg/jpeg/tif/tiff;
the output encoding follows the `outPath` extension (PNG, JPEG q0.92, TIFF). Input is capped at 64 megapixels; output keeps the input size.
Outline = Sobel-style edge detection on luma, widened by `width`, drawn as ink in `color`. Bloom = soft threshold, gaussian blur, additive.
Split-toning blends a soft-light tint into the shadows / highlights weighted by luma and `tintAmount`.

**Output path rules** (`captureWindow`, `downscaleImage`, `postProcessImage`): every path argument must be absolute and contain no `..`
component (`INVALID_ARGUMENT`); the parent directory must exist; `outPath` may never equal the input; an existing `outPath` is refused
unless `overwrite:true` (new files are created exclusively, `O_EXCL|O_NOFOLLOW`, so a racing file or symlink is not clobbered; overwriting only replaces regular files).

`busy:true` means the press ended in `kAXErrorCannotComplete` (dispatched, Cheetah3D busy running the macro).
`blank` = luma spread (max-min) <= 2/255 of the analysed raster (<= 1024 px thumbnail; width/height are the real size).
Error `details` carry AX facts: menu failures list `failedAt`/`missing`/`available`; stuck-disabled items list `waitedMs`,
`frontmost`, window titles; `BLOCKED_BY_MODAL` lists `dialogs:[{title,text,buttons,own}]`.

### Press sequence (PROTOCOL 2.1)

1. Pre-flight: Accessibility trusted (`PERMISSION_MISSING`), Cheetah3D running (`APP_NOT_RUNNING`), no foreign
   `AXDialog`/`AXSheet`/`AXSystemDialog` window (`BLOCKED_BY_MODAL`; focus untouched), menu path resolves
   (`TRIGGER_FAILED` with alternatives), a document window exists (or the titled one) - the main window that is not
   `Render Manager`.
2. Remember frontmost app, activate Cheetah3D (AXFrontmost + `NSRunningApplication.activate()`), `AXRaise` the target window.
3. Re-resolve the item every 25 ms until `AXEnabled` (<= `timeoutMs`).
4. `AXPress` with 1 s AX messaging timeout; `cannotComplete` => dispatched/busy; any other AX error => `TRIGGER_FAILED{axError}`.
5. Register `ownModalText` (TTL 120 s), settle 50 ms, restore the previous frontmost app **in a `defer`** (also on every failure after activation).
Focus-changing commands (`pressBridge`, `pressMenu`, `raiseWindow`, `newDocument`, `launchApp`) are serialised by a gate.

### Own modals

The helper's own dialogs (e.g. the Import dialog opened by a menu command) must not be reported as blockers.
`pressMenu {ownModalText:"Import"}` registers that text after a successful press; any dialog whose title/text contains it
is `own:true` for 120 s and ignored by the pre-flight check. `dismissOwnModal {text}` clicks OK on such a dialog and
unregisters it. The v1 auto-click allow-list for foreign dialogs is empty.

## Peer authentication

The socket is mode 0600, and additionally every accepted connection is checked with `getpeereid`: if the peer's effective uid is not the
helper's own `geteuid()` (or cannot be read) the connection is closed immediately, nothing is written, and a line is logged
(`dropped connection from unauthorized peer uid ...`). `SocketServer` takes an injectable `peerUID` provider so the check is unit-tested
without a second user (`PeerAuthTests`).

## Permissions and TCC

* The helper is its own TCC client when launched via LaunchServices (`open -g -a`) or a LaunchAgent: grant
  **Accessibility** (and, for `captureWindow`, **Screen & System Audio Recording**) once to "C3D Bridge Helper" in
  System Settings > Privacy & Security. `c3d-helper-ctl ... permissions` / `status` show the current state.
  The helper never touches TCC.db, never self-grants, and `captureWindow` is refused with `PERMISSION_MISSING`
  (it does not trigger the prompt) when `CGPreflightScreenCaptureAccess` is false.
* **Ad-hoc signing invalidates grants on every rebuild** (designated requirement = cdhash). After a rebuild the user
  must re-grant (remove the old entry with "-", add again). To avoid it, sign with a stable self-signed identity:
  see the header of `packaging/sign-dev.sh` (`C3D_SIGN_IDENTITY="C3D Dev Signing" helper/build-app.sh`).
  Quarantined downloads of an unnotarized build need right-click > Open (or "Open Anyway").
* Hardened runtime is enabled; no entitlements are required (non-sandboxed, no JIT, no Apple Events).
* Notarization: `packaging/notarize.sh [--dry-run]`, credentials via `C3D_NOTARY_PROFILE` (notarytool keychain profile).

### Responsible-process spike (P26)

What decides which TCC identity is charged for AX / capture calls is the *responsible process*: normally the
process itself, but children spawned from a terminal/app inherit the responsible process of their ancestor unless
the spawner disclaims responsibility (`responsibility_spawnattrs_setdisclaim`, as Claude Desktop's `disclaimer` helper does).

| launch method | responsible process (expected) | notes |
|---|---|---|
| `open -g -a "C3D Bridge Helper.app" --args --socket ...` | the helper (LaunchServices starts it as its own app) | recommended; `-g` keeps it in the background; survives the terminal |
| LaunchAgent (`launchctl bootstrap gui/$UID`, `LimitLoadToSessionType Aqua`) | the helper (launchd job, Aqua session) | needs the plist's absolute app path; `RunAtLoad false`, start with `launchctl kickstart` |
| `child_process.spawn` from Node | inherited from Node's ancestor (Terminal / VS Code / Claude Desktop, or Node itself if disclaimed) | **do not use**: grants would be attributed to the wrong app |
| executed by hand in a shell (`.../MacOS/C3DBridgeHelper --socket ...`) | the terminal / host app | handy for dev only |

Observed without touching TCC: running the freshly built, never-granted ad-hoc helper binary directly from the
agent's shell reported `accessibility:true, screenRecording:true` in `status`, i.e. the checks were answered for the
*parent* (host) process - consistent with the inheritance rule above and with the table's last row.

Still to verify live (lead): (1) launch via `open -g -a` and confirm `permissions` reports **false** until the helper
itself is granted, then true after granting; (2) same via LaunchAgent `kickstart`; (3) which entry appears in the
Settings lists; (4) `log stream --predicate 'subsystem == "com.apple.TCC"'` while calling `permissions`/`pressBridge`
to read the attributed `responsible` identity (reading the log does not touch TCC.db); (5) whether a self-signed
identity keeps the grant across a rebuild.

## Live-verification checklist (nothing below was exercised against the real Cheetah3D menu)

* `pressBridge` end to end: activation actually enables the item, `AXRaise` of the document window is sufficient,
  the macro runs when the press is followed by a 50 ms settle and restoration of the previous app (if restoring
  too early aborts the macro, raise `Presser.settleMs`).
* AX activation of another app from a background agent (`AXFrontmost` + `NSRunningApplication.activate()`), and restoring the previous app.
* Whether `AXPress` on the macro item returns `success` or `cannotComplete` while the macro runs (`busy` flag).
* `captureWindow` with a real Screen Recording grant (window selection, scale, crop).
* `newDocument` window-title detection, `launchApp` from a not-running state, `Render Manager` (an `AXStandardWindow`
  in the real window list) never chosen as the target.
* Real dialogs: `AXDialog` text/button extraction (tested only against FakeAX and the P24 description).

## Troubleshooting

| symptom | cause / fix |
|---|---|
| `PERMISSION_MISSING` | grant Accessibility (or Screen Recording) to the helper; after any rebuild re-grant (ad-hoc cdhash changed) |
| `permissions` says true but you expected false | the helper was started from a shell and is riding on the terminal's grant (see P26) |
| `APP_NOT_RUNNING` | start Cheetah3D (`launchApp`) |
| `BLOCKED_BY_MODAL` | read `details.dialogs`; dismiss manually (never auto-clicked) |
| `TRIGGER_FAILED` "menu item ... not found" | bridge macro not installed, or Cheetah3D not restarted since install; see `details.available` |
| `TRIGGER_FAILED` "menu item stayed disabled" | no key document window (Render Manager key?), another app stole focus, or Cheetah3D was not activatable |
| helper exits with code 3 | another live instance owns the socket |
| client cannot connect | helper not running; check `~/Library/Logs/c3d-mcp/helper.log`; socket path longer than 103 bytes is rejected |
