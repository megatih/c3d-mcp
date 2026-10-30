# Troubleshooting

## Installer problems
| Symptom | Fix |
|---|---|
| "Cheetah3D not found" | Install Cheetah3D 8.1.3 (<https://www.cheetah3d.com>), launch it once, rerun the installer. `--skip-cheetah-check` installs only the server side. |
| Node.js missing or older than 22 | Answer yes to the offer (Homebrew or a private copy in `~/.c3d-mcp/node`), or install it yourself (`brew install node@22`) and rerun. `--no-node-install` never installs Node. |
| "checksum mismatch" | The download is incomplete or was tampered with; nothing was installed. Retry on a different network; report it if it repeats. |
| `curl ... | bash` cannot ask questions | Run the download-then-`bash install.sh` form, or pass `--yes`. |
| Settings pane did not open on the right page | The wizard verifies the pane and falls back to showing the click path: System Settings › Privacy & Security › Accessibility (or Screen & System Audio Recording). Add "C3D Bridge Helper" there by hand; the wizard polls until it sees the permission. |
| macOS says the helper "cannot be opened" | It is signed but not notarized: `xattr -dr com.apple.quarantine "$HOME/Library/Application Support/Cheetah3D/MCP/helper/C3D Bridge Helper.app"` |
| Menu item missing in Cheetah3D after install | Restart Cheetah3D once; macros are only scanned at launch. |
| Wizard changed a client config you did not want | Each edited file has a `.c3d-backup-<timestamp>` copy next to it; restore it. |

Run `npx -y c3d-mcp doctor` first; every failing check prints a fix. Logs: `~/Library/Logs/c3d-mcp/`; the in-app runtime log is available through `c3d_get_console`.

Every tool error carries `{code, message, hint, details}`. All codes:

| Code | Meaning | What to do |
|---|---|---|
| `APP_NOT_RUNNING` | Cheetah3D is not running and could not be launched automatically (no helper app, no Accessibility permission, or `C3D_MCP_NO_AUTOLAUNCH=1`); `details.autoLaunch` has the reason | Launch it (`open -a Cheetah3D`) or fix the helper (`c3d_doctor`). |
| `APP_CRASHED` | Cheetah3D exited while a request was in flight | Relaunch; use `c3d_restore_checkpoint` (checkpoints live in `<workDir>/checkpoints`). |
| `APP_BUSY` | A long operation (render, import) is running, or the app does not answer Accessibility | Wait and retry; renders need a larger client timeout. |
| `TRIGGER_FAILED` | The bridge macro could not be started or never ran. Typical causes: the **menu item is missing** (the bridge was installed but Cheetah3D was not restarted), the item is disabled (another app is frontmost, a non-document window such as Render Manager is key, no document window is open), or Accessibility is not granted | Restart Cheetah3D after `install`; open or raise a document window; grant Accessibility to *C3D Bridge Helper*; run `c3d-mcp doctor`. |
| `BLOCKED_BY_MODAL` | A dialog is open in Cheetah3D; the message contains its text | Dismiss it by hand. Known ones: "Fileformat … not supported", "Texture baking error!", "The document … could not be opened". |
| `WRONG_DOCUMENT` | The front document is not the one this session works on | `c3d_use_document`, or `c3d_new_document` to start a fresh scratch document. |
| `VERSION_SKEW` | Runtime inside Cheetah3D differs from this server (protocol/major) | `c3d-mcp install`; runtime-only updates need no Cheetah3D restart. |
| `BRIDGE_NOT_INSTALLED` | Bridge macro/runtime files are missing | `c3d-mcp status` shows what is missing, `c3d-mcp install` repairs it (then restart Cheetah3D once if the loader macro was recreated). |
| `PERMISSION_MISSING` | Accessibility or Screen Recording not granted to the helper (a rebuilt/updated helper must be re-granted) | See "Granting permissions" below. |
| `NOT_FOUND` | Object, material, node, parameter or file not found | Check names/ids with `c3d_list_scene` / `c3d_list_materials`. |
| `AMBIGUOUS` | A name or path matches several objects (Cheetah3D does not make names unique) | Use the stable `id` returned by the tools. |
| `INVALID_ARGUMENT` | An argument failed validation, or the action was refused (e.g. overwriting a pre-existing file; render extension other than png/jpg/tiff) | Fix the argument as the hint says. |
| `UNSUPPORTED` | Not possible in Cheetah3D 8.1.3 or needs the helper (see `docs/limitations.md`) | Use the alternative named in the hint. |
| `SCRIPT_ERROR` | JavaScript error inside Cheetah3D (also: the bridge runtime failed to load) | Read `details` (message, line); `c3d_lint_script` first; if the runtime itself failed to load run `c3d-mcp install`. |
| `LINT_BLOCKED` | `c3d_run_script` blocked by an error-severity lint rule | Fix the code, or pass `force:true` if you accept the risk. |
| `CONFIRMATION_REQUIRED` | Destructive action needs the user's yes | Retry with `confirm:true` (clients without elicitation) or answer the prompt. |
| `TIMEOUT` | The request deadline passed without an answer | Retry; for renders use a longer timeout. The late request is cancelled and never executes. |
| `CANCELLED` | The client cancelled the call | — |
| `RUNTIME_STUCK` | The bridge reports busy for far too long while Cheetah3D still responds | Look for a hidden dialog; if there is none restart Cheetah3D. |
| `DEPENDENCY_FAILED` | An earlier step of a batch failed | Fix the earlier error. |
| `NOT_AVAILABLE_IN_PROFILE` | Tool disabled by `C3D_MCP_PROFILE` or an opt-out variable | Change the profile/env. |
| `PARSE_ERROR` | Unreadable response from the bridge | Retry; if it persists run `doctor` and reinstall. |
| `INTERNAL` | Unexpected server error (no stack is sent to the client) | Check the log directory above. |

## Granting permissions

The helper never triggers macOS's permission prompt by itself, so it will not appear in the list until you add it:

1. System Settings → Privacy & Security → **Accessibility** → click **+** → press ⇧⌘G → paste
   `~/Library/Application Support/Cheetah3D/MCP/helper/C3D Bridge Helper.app` → Open → switch it on.
2. Optional, only for `c3d_capture_viewport`: the same under **Screen Recording**.
3. `npx -y c3d-mcp doctor` should now show `accessibility` and `screen-recording` as ok.

After you update or rebuild the helper, macOS may drop the grant (ad-hoc signatures change): toggle it off and on again.

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

## Install state (partial, outdated, or "which command do I run?")
* `c3d-mcp status` names the state: fresh, current, outdated, newer, partial (with the missing or modified parts) or unmanaged (files exist but the install manifest is gone). `c3d-mcp doctor` shows the same in its `install-state` check.
* **outdated** or **partial**: `c3d-mcp install` (or `c3d-mcp install --repair` to leave versions alone). **Something still wrong after that**: `c3d-mcp install --reinstall`.
* The helper app is old (doctor warns): `c3d-mcp install` replaces it; macOS asks for Accessibility again. If the new helper does not start, the old one is restored automatically and the install report says so.
* Start over: `c3d-mcp uninstall --dry-run` shows what would go, `c3d-mcp uninstall` removes the bridge and helper, `c3d-mcp uninstall --all` also removes skills and MCP client entries (backups are made). Your scripts and `MCP-backups` are never touched.
* Installer menu and flags: [INSTALL.md](INSTALL.md#5-installing-updating-repairing-reinstalling-and-uninstalling).
