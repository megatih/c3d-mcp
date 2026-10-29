# 05 — macOS automation, TCC, screen capture

## Pressing a menu item in another app
`AXUIElementCreateApplication(pid)` → AXMenuBar → menu → AXMenuItem → `AXUIElementPerformAction(kAXPressAction)`.
- Usually does not activate the app, but behaviour may depend on key window/menu validation ([MacScripter](https://www.macscripter.net/t/selecting-a-oebackgrounda-app-menu-bar-menu-items/52903)) → **Phase 0 probe: press while Cheetah is in background.** If it needs focus: activate briefly, press, restore previous frontmost app.
- Press blocks until the action returns or AX timeout (default ~6 s) → `AXUIElementSetMessagingTimeout(~1 s)`; treat `kAXErrorCannotComplete` as "dispatched, app busy".
- Check `AXEnabled` on the item first (disabled when no document is open). Cache the element path; re-resolve on invalidation.
- Detect modals: windows/sheets with role `AXSheet` / `AXDialog` / subrole `AXSystemDialog` on the Cheetah process → `BLOCKED_BY_MODAL` with title, text, buttons.
- Alternatives: `NSUserKeyEquivalents` + `CGEventPostToPid` (unreliable for background); AppleScript System Events `click menu item` (slower; also needs Automation consent for System Events).

## TCC / "responsible process"
- Permission is attributed to the *responsible* app: Terminal/iTerm/Ghostty for CLI Claude Code; VS Code/Cursor for editors.
- **Claude Desktop** spawns MCP commands via `Claude.app/Contents/Helpers/disclaimer` which calls `responsibility_spawnattrs_setdisclaim()` → children are their own responsible process; a bare `node` has no stable TCC identity (user analysis, [issue mirror](https://claudeissues.com/issue/55169-claude-desktop-on-macos-spawned-mcp-servers-cant-reach-lan-ehostunreach); reports in [macctl](https://images.glama.ai/mcp/servers/sitharaj88/macctl)).
- **Decision:** all AX + capture work lives in a signed **`C3D Bridge Helper.app`** (own bundle id e.g. `dev.c3dmcp.helper`), launched via LaunchServices (`open -g -a`) or a **LaunchAgent**, talking to the Node server over a **Unix domain socket** (`~/Library/Application Support/Cheetah3D/MCP/helper.sock`, 0600). Never spawn it as a child of Node (a child inherits the wrong responsible process). User grants Accessibility + Screen Recording **once, to the helper**.
- APIs: `AXIsProcessTrustedWithOptions`, `CGPreflightScreenCaptureAccess`/`CGRequestScreenCaptureAccess`; `c3d_doctor` reports status.
- **Signing reality:** ad-hoc signature's designated requirement = cdhash ⇒ **TCC grants reset on every rebuild**. Dev: create a local self-signed code-signing cert (stable leaf) — user step, documented. Distribution without Developer ID: users re-grant after updates and use "Open Anyway" for quarantined apps. Notarization pipeline (`notarytool`, staple) is scripted and activates when `DEVELOPER_ID`/notary profile is set; acceptance = `--dry-run`.
- Never touch TCC.db or self-grant.

## Screen capture on macOS 26/27
- Use ScreenCaptureKit: `SCShareableContent` → find window by Cheetah PID/bundle id (not title) → `SCContentFilter(desktopIndependentWindow:)` → `SCScreenshotManager.captureImage`. Size = `contentRect × pointPixelScale` or images blur ([Apple forum 765360](https://developer.apple.com/forums/thread/765360)). Crop to viewport via the viewport AX element frame.
- macOS 27 reports: `CGWindowListCreateImage` returns gray ([847998](https://developer.apple.com/forums/thread/847998)); window owner names nil without Screen Recording ([839069](https://developer.apple.com/forums/thread/839069)); Accessibility PPPC payload removed for MDM ([836770](https://developer.apple.com/forums/thread/836770)); no consent-free ScreenCaptureKit ([849969](https://developer.apple.com/forums/thread/849969)). → Don't use CGWindowListCreateImage.
- **Primary visual feedback = Cheetah's own `doc.render(path.png)`** (no Screen Recording needed). `c3d_capture_viewport` (ScreenCaptureKit) is optional/secondary.
- On-device ML: Apple **Vision** in the helper for render sanity (blank/black detection, histogram, saliency) — deterministic, no model shipped.
