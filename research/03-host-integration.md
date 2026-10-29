# 03 — Host integration: how an external program can drive Cheetah3D

## Verified on this Mac (2026-10-29)
- Cheetah3D **8.1.3** (CFBundleShortVersionString = CFBundleVersion = 8.1.3), universal x86_64+arm64, `LSMinimumSystemVersion 10.15`, bundle id **`de.wengenmayer.Cheetah3D`**, process path `/Applications/Cheetah3D.app/Contents/MacOS/Cheetah3D`.
- macOS 27.2 (build 26B123), arm64.
- Links: Cocoa, AppKit, MetalKit, Metal, AVFoundation, CoreMedia, Security, IOKit; `MWM.framework` links **JavaScriptCore**, SceneKit, ModelIO, Accelerate, CoreImage.
- **No** `NSAppleScriptEnabled`, no `.sdef`, no `CFBundleURLTypes`, no `NSServices`. Not sandboxed (empty entitlements).
- JS bindings in `MWM`: `JSBase JSCluster JSDocument JSFCurve JSFCurveKey JSFile JSGlobal JSMat3D JSMat4D JSMaterial JSNode JSObject JSOS JSParameter JSParticle JSParticleCore JSPolyCore JSSplineCore JSTag JSTake JSTakeNode JSTexture JSVec2D JSVec3D JSVec4D` (`research/raw/jsapi_symbols.txt`).
- User dir `~/Library/Application Support/Cheetah3D/{Brushes,Environment,Materials,Render History,Samples,Scripts}`; Scripts has Macro/Particle/Polygonobj/Splineobj/Tag/Tool.
- Document types opened: jas, pdf, obj, fbx, dxf, dae, 3ds, stl, gltf, glb, usdz, svg, sia, scn (from Info.plist) → `open -a Cheetah3D file` works as an *open* path.
- **Accessibility from the Terminal works** (System Events): menu bar items = Apple, Cheetah3D, File, Edit, Selection, Objects, Tools, Render, Animation, Window, Help. **Tools** menu = Character, Particle, Polygon, Spline, UV, Mirror, Insert Point, Quantize, Transform, Ruler, Coord System, Merge, Object Info, Scene Info, **Script**. Script submenu lists `Macro Script` (User Macro.js, Parameter Info.js, QTVR Helper.js, RotateObject.js, Simple ASCII Export.js, splineExport.js), Particle/Polygon/Spline/Tag/Tool Script lists. Render menu: Render, Render Animation, Bake Texture, Show Render Manager, Renderer.
- Preferences domain `de.wengenmayer.Cheetah3D` (AutoSave=0).
- `.jas` = **Apple binary plist** (`bplist00`); top keys Render, Version, Takes, Objects, Materials3, Dynamics, Animation, Layer. Offline *reading* is feasible with `plutil`/plist libs; raw geometry blobs need wholder's notes.
- A prior project (`~/Documents/user_project_dir/`) already used a "loader macro" (`User Macro.js` reading `native_action.js` and `eval`ing it) and produced `UserFile.jas` — **evidence the pattern works in 8.1.x**. Those files belong to the user: **never modify them**.

## Candidate integration channels
| Channel | Verdict |
|---|---|
| AppleScript / `osascript -e 'tell app "Cheetah3D" …'` | **Impossible** (no dictionary). Only System Events UI scripting. |
| Socket / HTTP server inside Cheetah3D | **Impossible** (no networking, no timers, no threads in JS). |
| CLI flags / URL scheme / Services | **None.** |
| Tag-script or script-object polling | Rejected: only fires on scene evaluation, not a clock. |
| Blocking poll loop in a macro (`while(1){OS.system("sleep 0.2")}`) | Rejected: freezes UI and redraw; only as a bounded "burst drain" (N requests / T seconds). |
| **File mailbox + external trigger of a bridge macro** | **CHOSEN.** Works with all constraints; analog of After Effects MCP servers. |
| Direct `.jas` authoring (binary plist writer) | High risk (undocumented geometry blobs); optional offline *read* only. |

## Trigger options for the bridge macro (ranked)
1. **AXPress on the menu item** `Tools › Script › Macro Script › C3D-MCP/…` via AXUIElement (helper app). Needs Accessibility. Press returns when the action completes or AX timeout hits → use short `AXUIElementSetMessagingTimeout` (~1 s); `kAXErrorCannotComplete` ⇒ "sent, app busy".
2. **System Events `click menu item`** via `osascript` (M0/M1 bootstrap path; needs Accessibility for the parent terminal + Automation prompt).
3. **Keyboard shortcut**: assign via Cheetah3D keyboard prefs or `defaults write de.wengenmayer.Cheetah3D NSUserKeyEquivalents -dict-add "<exact menu title>" "@~^b"`; send via `CGEventPost`. Fallback only (background delivery unreliable).
4. **Manual**: user runs the macro by hand (always available as last resort).

## Bridge protocol (see PRD §3 for the authoritative version)
- Directory `~/Library/Application Support/Cheetah3D/MCP/` (0700): `inbox/`, `outbox/`, `state.json`, `log/`, `secret` (0600).
- Server writes `inbox/<uuid>.json.tmp` → rename to `.json`. Macro lists `inbox/` with `File.contentOfDir`, processes sorted by sequence, writes `outbox/<uuid>.json` then empty `outbox/<uuid>.done`. Server reads JSON only after `.done`. No `mv` via `OS.system` in the hot path. JS cannot rename/delete; the *server* deletes processed files.
- ASCII-only payloads with `\uXXXX` escapes (File.read counts chars; size counts bytes).
- `state.json` `{busy, reqId, op, startedAt, runtimeVersion}` distinguishes crashed / busy / never-ran.
- Macro (`C3D-MCP Bridge.js`) is tiny: try/catch around `geval(readFile(runtimePath))`; errors → `outbox/_bootstrap-error.json`. `runtime.js` is re-read each run (hot-updatable). Install templating writes the absolute runtime path into the macro.
- Request fields: `id, seq, v (protocol), secret, expectDocument?, ops[]`. Response: `id, ok, results[], error{code,message,hint}, runtimeVersion, log[]`.

## Threats and constraints
- Same-user threat model; mailbox + runtime dirs 0700; secret file 0600.
- `run_script` executes inside `new Function('doc','OS','File',code)` with shadowed `OS` (messageBox/panels throw; `system` gated) and guarded `File` (writes confined to allowed dirs; `mkDir` throws). Lint is advisory (`OS['sys'+'tem']` evades it); shadowing is the real guard.
- Modal dialogs block the main thread: helper checks `AXSheet`/`AXDialog` before pressing → `BLOCKED_BY_MODAL`.
- Multiple documents: `main(doc)` receives the front document → `expectDocument` check → `WRONG_DOCUMENT`; helper may `AXRaise` the window.
- Cheetah not running → `open -a Cheetah3D`, wait for AX menu bar; no document → `newDocument:` via AX.
