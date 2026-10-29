# Troubleshooting

Run `npx -y c3d-mcp doctor` first. Logs: `~/Library/Logs/c3d-mcp/` (`c3d-mcp.log`, `helper.log`).

## Decision table

| Symptom / code | Cause | Fix |
|---|---|---|
| No `c3d_*` tools in the client | Server not registered, client not restarted, wrong config path | `c3d-mcp config <client>`; put it in the file named in the comment line; restart the client |
| `spawn npx ENOENT` (Claude Desktop) | GUI app has no shell PATH | `c3d-mcp config claude-desktop --form absolute` |
| `APP_NOT_RUNNING` | Cheetah3D closed | `open -a Cheetah3D` |
| `BRIDGE_NOT_INSTALLED` | Macro/runtime missing | `c3d-mcp install`, then restart Cheetah3D once |
| `TRIGGER_FAILED`, menu item missing | Bridge installed but Cheetah3D not restarted | Restart Cheetah3D |
| `TRIGGER_FAILED`, item disabled | Another app frontmost, a non-document window (Render Manager) is key, or no document window open | Open or raise a document window; retry |
| `TRIGGER_FAILED` / helper unreachable / `PERMISSION_MISSING` | Accessibility not granted, or grant dropped after helper update | Re-add `C3D Bridge Helper.app` under Accessibility, toggle off/on; run `doctor`; check `helper.log` |
| Helper refuses to launch (signature error) | Unsigned local build | `C3D_HELPER_SKIP_VERIFY=1`, or reinstall the signed helper with `c3d-mcp install` |
| `c3d_capture_viewport` fails | Screen Recording missing | Grant Screen Recording to the helper |
| `c3d_new_document` etc. `UNSUPPORTED` | Helper missing or too old | `c3d-mcp install` (updates the helper), grant Accessibility |
| `BLOCKED_BY_MODAL` | A Cheetah3D dialog is open; the message holds its text. Known: "Fileformat ... not supported", "Texture baking error!", "The document ... could not be opened" | Ask the user to dismiss it by hand, then retry |
| `VERSION_SKEW`, stale runtime | In-app runtime differs from the server version | `c3d-mcp install` (no restart needed for runtime-only updates); if it persists restart Cheetah3D |
| `SCRIPT_ERROR` mentioning the runtime failing to load | Corrupt/old runtime | `c3d-mcp install` |
| `RUNTIME_STUCK` | Bridge busy far too long, app still responsive | Look for a hidden dialog; otherwise restart Cheetah3D |
| `APP_BUSY` / `TIMEOUT` on render | Long render, client timeout too short | Raise the tool timeout (600 s), lower resolution or GI samples, retry; the late request is cancelled and never runs |
| `APP_CRASHED` | Cheetah3D exited mid-request | Relaunch; `c3d_restore_checkpoint` (checkpoints live in `<workDir>/checkpoints`) |
| `WRONG_DOCUMENT` | Front document is not the session's | `c3d_use_document`, or `c3d_new_document` |
| `PERMISSION_MISSING` with `chmod 700` hint | Mailbox directory writable by others or owned by another user | `chmod 700` the mailbox directory |
| `CONFIRMATION_REQUIRED` | Destructive action needs a yes | Answer the prompt; on clients without elicitation retry with `confirm:true` (see `C3D_MCP_AUTO_CONFIRM` only for unattended runs) |
| `NOT_AVAILABLE_IN_PROFILE` | Tool disabled by profile or opt-out variable | Change `C3D_MCP_PROFILE` / the `DISABLE_*` variable and restart the client |
| `PARSE_ERROR` | Unreadable bridge response | Retry; then `doctor` and reinstall |
| `INTERNAL` | Unexpected server error | Read the log directory |

## Other situations
- glTF/GLB cannot be opened by Cheetah3D 8.1.3; use FBX, OBJ, DAE, STL, 3DS, USDZ or DXF.
- Cheetah3D crashed once while exporting OBJ; export FBX/DAE/STL/USDZ instead.
- Dark renders: new lights use inverse-square attenuation; raise `intensity` (about distance squared) or set `attenuation` to 0.
- Non-ASCII text in own scripts is corrupted by `File.write`; escape as `\uXXXX`.
- After a crash all windows are lost; reopen from the latest checkpoint.
