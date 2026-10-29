# Review triage (M7)

Reports: `review-security.md`, `review-api.md`, `review-ux.md` (independent fresh-context agents, read-only).

## Fixed
| Finding | Fix |
|---|---|
| SEC-H1 sandbox escape via getter/`toString` on the returned value running after teardown | `exec.js`: result is serialized inside the guarded region, only own data properties are read; 2 harness regression cases + live test on the real engine (no side effect). |
| SEC-H3 `confirm:true` bypassed human elicitation | `toolServices.confirm`: a client that supports elicitation is always asked; `confirm:true` only counts for clients without it. `run_script` prompt now shows the code (and the retry key is tied to it). Test added. |
| SEC-M4 script objects/tags run unsandboxed JS | `assertNotScriptType` blocks `SCRIPT*` types in `c3d_add_tag` / `c3d_create_object`. Test added. |
| SEC-M6 guarded `File` write check used the mutable `READ_MODE` global; reads of `MCP/secret` | value captured at load; reading `…/MCP/secret` blocked. |
| SEC-M8 bad-secret request advanced `lastSeq` | `core.js`: not advanced for a bad secret. |
| SEC-M7 plugin hook ran `npx -y` on every session start | hook only runs `c3d-mcp doctor --brief` if `c3d-mcp` is already on PATH. |
| API-2 `c3d_select restore_previous` did nothing | parameter removed. |
| API-3/4/5/9 wrong claims in tool descriptions (trailing expression, `replace_existing` default, `sizex` example, `render_sequence` responsiveness) | descriptions corrected. |
| UX-B1 `c3d_install_bridge` did not install the helper; UX-B2 Accessibility step not actionable | tool now installs the helper too; docs give the "+ → ⇧⌘G → path" steps. |
| UX-M3/M4/M5/M6/M7/M9 error-code table, SETUP inaccuracies, requirements, stale TOOLS.md, tool-description wording, helper.md user section | rewritten / regenerated. |
| Found live (not by reviewers) | stale `busy` state after a crash blocked all triggers → `dropStaleBusy` + inbox sweep; `BLOCKED_BY_MODAL` was reported as `RUNTIME_STUCK`/`TRIGGER_FAILED` → modal probe during waits and in timeout classification; world-matrix translation is `m03,m13,m23`; real-app `OS`/`File` globals are non-writable (global shadowing is a no-op); `addObject` can nest cameras under the last folder; Poly Haven models are `type 2`; opened `.jas` may be saved (confirm) via `markOpened`. |

## Open / accepted (documented in docs/limitations.md)
- SEC: `c3d_run_script` is best-effort containment (an endless loop freezes Cheetah3D); `c3d_export` sibling files and TOCTOU; helper socket authorisation is file-mode only; downloads buffered before the cap; helper app not signature-checked before launch.
- API (b): `createMesh` failure cleanup for non-root parents and `createSpline` cleanup; `setRenderSettings` partial-failure details lost through `bridge.one`; Vec4D keyframe values given as 3-arrays; Link params `{ref}` not normalised; `look_at` ignores rotation order ≠ HPB and pre/post rotation (residual check reports it); the session marker folder is included in saves/exports; list_scene `depth:0` means direct children.
- UX minor items (version duplicated in 8 files, glossary, `config` output starts with `#` comments).
