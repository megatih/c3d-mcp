# Troubleshooting

## First, the control panel
Open **C3D MCP**: **Overview** runs the health check (every failing check says how to fix it), **Activity** shows the helper log, **Cleanup** finds leftovers of older installs. From a terminal the same checks are `c3d-mcp doctor` and `c3d-mcp status` (see [INSTALL.md](INSTALL.md#command-line-optional)).

## App and install problems
| Symptom | Fix |
|---|---|
| macOS says it "cannot verify" C3D MCP the first time | Expected: the app is signed with its own certificate, not an Apple Developer ID. Click **Done**, open *System Settings › Privacy & Security*, click **Open Anyway** next to "C3D MCP", enter your password, then open the app again and click **Open**. Once per Mac. The `curl` one-liner in [INSTALL.md](INSTALL.md) installs the same app without the prompt. |
| "Cheetah3D not found" or the menu item is missing | Install Cheetah3D 8.1.3 (<https://www.cheetah3d.com>), launch it once, then **Bridge › Install or update** and restart Cheetah3D (macros are only scanned at launch). |
| The health check is red although Cheetah3D is running | Since 0.4.2 Overview checks again by itself when Cheetah3D starts or quits and when you return to the window, and the **Re-check** button runs the full check. In 0.4.0 and 0.4.1 the result was from when the app started: press the ↻ button in the toolbar (or update the app). The **Setup** list on Overview names the one step that is still open. |
| Overview says the helper is not running | Open the app; it stays in the menu bar. Another helper (an older separate "C3D Bridge Helper") may hold the socket: **Cleanup** removes it. |
| The app asks for Accessibility again after an update | It should not (every release is signed with the same certificate). If it does, switch *C3D MCP* off and on in *System Settings › Privacy & Security › Accessibility*, or remove it with **−** and re-add it from the Permissions tab. |
| Claude / Cursor / Codex does not list the c3d tools | **AI clients** must show "Connected through this app"; restart the client afterwards. "Connected to an older install" (npx, npm or the old script) or "Connected to another copy of C3D MCP" (the app was moved or reinstalled) means the entry points elsewhere: click *Switch to this app* (or *Disconnect* if you no longer use that client). |
| A client edited by the app has an entry you did not want | Each edited file has a `.c3d-backup-<timestamp>` copy next to it; restore it. |
| Claude Code asks before every c3d tool call | **Permissions › Allow all c3d tools**. In Claude Desktop choose "Always allow" on the first prompt of each tool. |
| c3d-mcp keeps asking to confirm saving the same file | The default (`session`) asks once per action; if you changed it to `strict`, set it back in **Permissions › Confirmation prompts** (restart the client). |
| Cleanup says an app must be quit | Cheetah3D or Claude Desktop is running; Cleanup quits them politely when you press Remove. Claude Code cannot be quit for you: close that session first. |
| An update does not install | Quit and reopen the app, then Overview › Updates › Check now; otherwise download the newest DMG and drag it over the old app. |

Logs: `~/Library/Logs/c3d-mcp/`; the in-app runtime log is available through `c3d_get_console`.

Every tool error carries `{code, message, hint, details}`. All codes:

| Code | Meaning | What to do |
|---|---|---|
| `APP_NOT_RUNNING` | Cheetah3D is not running and could not be launched automatically (C3D MCP is not installed or not allowed Accessibility, or `C3D_MCP_NO_AUTOLAUNCH=1`); `details.autoLaunch` has the reason | Launch it (`open -a Cheetah3D`) or open the C3D MCP app (`c3d_doctor`). |
| `APP_CRASHED` | Cheetah3D exited while a request was in flight | Relaunch; use `c3d_restore_checkpoint` (checkpoints live in `<workDir>/checkpoints`). |
| `APP_BUSY` | A long operation (render, import) is running, or the app does not answer Accessibility | Wait and retry; renders need a larger client timeout. |
| `TRIGGER_FAILED` | The bridge macro could not be started or never ran. Typical causes: the **menu item is missing** (the bridge was installed but Cheetah3D was not restarted), the item is disabled (another app is frontmost, a non-document window such as Render Manager is key, no document window is open), or Accessibility is not granted | Restart Cheetah3D after installing the bridge; open or raise a document window; grant Accessibility to *C3D MCP* (Permissions tab); check Overview or run `c3d_doctor`. |
| `BLOCKED_BY_MODAL` | A dialog is open in Cheetah3D; the message contains its text | Dismiss it by hand. Known ones: "Fileformat … not supported", "Texture baking error!", "The document … could not be opened". |
| `WRONG_DOCUMENT` | The front document is not the one this session works on | `c3d_use_document`, or `c3d_new_document` to start a fresh scratch document. |
| `VERSION_SKEW` | Runtime inside Cheetah3D differs from this server (protocol/major) | Bridge › Install or update in the app; runtime-only updates need no Cheetah3D restart. |
| `BRIDGE_NOT_INSTALLED` | Bridge macro/runtime files are missing | The Bridge tab shows what is missing; *Repair* fixes it (then restart Cheetah3D once if the loader macro was recreated). |
| `PERMISSION_MISSING` | Accessibility or Screen Recording not granted to C3D MCP | See "Granting permissions" below. |
| `NOT_FOUND` | Object, material, node, parameter or file not found | Check names/ids with `c3d_list_scene` / `c3d_list_materials`. |
| `AMBIGUOUS` | A name or path matches several objects (Cheetah3D does not make names unique) | Use the stable `id` returned by the tools. |
| `INVALID_ARGUMENT` | An argument failed validation, or the action was refused (e.g. overwriting a pre-existing file; render extension other than png/jpg/tiff) | Fix the argument as the hint says. |
| `UNSUPPORTED` | Not possible in Cheetah3D 8.1.3 or needs the C3D MCP app (see `docs/limitations.md`) | Use the alternative named in the hint. |
| `SCRIPT_ERROR` | JavaScript error inside Cheetah3D (also: the bridge runtime failed to load) | Read `details` (message, line); `c3d_lint_script` first; if the runtime itself failed to load use Bridge › Repair. |
| `LINT_BLOCKED` | `c3d_run_script` blocked by an error-severity lint rule | Fix the code, or pass `force:true` if you accept the risk. |
| `CONFIRMATION_REQUIRED` | Destructive action needs the user's yes | Retry with `confirm:true` (clients without elicitation) or answer the prompt. |
| `TIMEOUT` | The request deadline passed without an answer | Retry; for renders use a longer timeout. The late request is cancelled and never executes. |
| `CANCELLED` | The client cancelled the call | — |
| `RUNTIME_STUCK` | The bridge reports busy for far too long while Cheetah3D still responds | Look for a hidden dialog; if there is none restart Cheetah3D. |
| `DEPENDENCY_FAILED` | An earlier step of a batch failed | Fix the earlier error. |
| `NOT_AVAILABLE_IN_PROFILE` | Tool disabled by `C3D_MCP_PROFILE` or an opt-out variable | Change the profile/env. |
| `PARSE_ERROR` | Unreadable response from the bridge | Retry; if it persists check Overview and use Bridge › Repair. |
| `INTERNAL` | Unexpected server error (no stack is sent to the client) | Check the log directory above. |

## Granting permissions

Open **C3D MCP › Permissions**. *Grant…* asks macOS for **Accessibility** (needed to press the bridge menu item) and, optionally, **Screen Recording** (only for `c3d_capture_viewport`), and opens the right System Settings page. Switch **C3D MCP** on there; macOS may ask you to quit and reopen the app. *Re-check* confirms, and Overview's health check shows `accessibility` and `screen-recording` as ok.

## Other known situations

| Symptom | Cause | Fix |
|---|---|---|
| glTF/GLB import fails | Cheetah3D 8.1.3 cannot open glTF | Use FBX/OBJ/DAE/STL/3DS/USDZ/DXF; `c3d_import_asset` downloads the FBX variant. |
| Cheetah3D crashed while exporting OBJ | Cheetah3D's OBJ exporter crashed once on a nested scene | Prefer FBX/DAE/STL/USDZ/3DS/DXF; the tool takes a checkpoint first. |
| Non-ASCII text corrupted in your own scripts | `File.write` truncates non-ASCII | Escape as `\uXXXX`. |
| Dark renders | New lights use inverse-square attenuation | Raise `intensity` (about distance²) or set the light's `attenuation` to 0. |
| A render is completely black with no light in the scene | The camera light is `auto`/`off` | `c3d_set_camera {camera_light:"on"}` or add a light (auto lights the scene only while it has none). |
| Shadows too hard / too soft | Falcon soft shadows come from the light's `shadowSoft`, not `radius` | `c3d_set_light {shadow_softness}` (point/spot: light size; distant: angle). |
| Exported mesh or boolean looks inside-out although the render looked fine | Counter-clockwise polygons have inward normals in Cheetah3D (the renderer is two-sided) | `c3d_create_mesh` converts for you; for other meshes `c3d_edit_mesh flip_winding`. |
| `c3d_assign_material` says "already has 24 material tags" | Cheetah3D 8.1.3 crashes with many more material tags on one object | Reuse materials or split the object. |
| `c3d_set_render_settings` refuses `samples` | Falcon `samples` 0 means "refine until stopped" and would never finish | Use a positive value (default 100). |
| Search hits marked `book-unreviewed` or `forum` disagree with a tool | Those sources were not verified in 8.1.3 | Prefer `official` / `verified` / `example` hits and the `NOTE` lines; see `c3d://verified`. |

## Install state (partial, outdated, or "what should I press?")
* **Overview** and **Bridge** name the state: fresh, current, outdated, partial (with the missing or modified parts) or unmanaged (files exist but the install manifest is gone), and offer the right button (Install, Update, Repair). `c3d-mcp status` and `c3d-mcp doctor` print the same.
* **outdated** or **partial**: *Install or update* (or *Repair*, which leaves versions alone). **Still wrong after that**: `c3d-mcp install --reinstall` (rewrites every managed file, keeps the secret, backups and your scripts).
* Start over: **Bridge › Uninstall everything** removes the bridge, skills and client entries (backups are made); your scripts and `MCP-backups` are never touched. Then drag the app to the Trash.
