# Known limitations (tools layer)

Honest list of what the c3d-mcp tools cannot do or only do experimentally in Cheetah3D 8.1.3. IDs refer to `research/08-open-questions-and-probes.md`. "Experimental" means the path exists but has not been verified live yet (see the lead's live-test list) and may return `UNSUPPORTED`.

## Unsupported (returns `UNSUPPORTED` with an alternative)

| Area | Limitation | Probe | Alternative |
|---|---|---|---|
| Files | `.glb` / `.gltf` cannot be opened or merged (Cheetah3D shows a blocking dialog) | P09 | Use FBX/OBJ; `c3d_import_asset` downloads the FBX variant |
| Render | Only `.png`, `.jpg`, `.tiff` outputs; other extensions open a modal dialog, so they are rejected client-side | P08 | Convert externally |
| Parameters | Gradient and float-array parameters can be listed (`{unsupported:true}`) but not written | P16 | none |
| Undo | Cheetah3D Undo does not revert macro/bridge changes; no access to its undo stack | P11 | `c3d_checkpoint` / `c3d_restore_checkpoint` |
| Console | Cheetah3D's own Console cannot be read; `c3d_get_console` returns the bridge runtime log only, `c3d_run_script` returns `print()` output in its result | P35 | - |
| Primitives | Primitives (BOX, BALL...) cannot be edited per vertex | - | `c3d_make_editable` (experimental) or `c3d_create_mesh` |
| Documents | Closing documents / quitting the app is not offered | - | close windows manually |
| Geometry | Vertex colors | - | - |

## Experimental (menu automation, needs the helper and Accessibility)

| Tool | How it works | Risk | Fallback |
|---|---|---|---|
| `c3d_duplicate` | select, `Edit > Copy`, `Edit > Paste` via helper `pressMenu`; success verified by diffing object ids | menu enablement depends on focus; pasted object lands wherever Cheetah puts it | `method:"copy"` rebuilds from parameters/tags/children (LOSSY: no keyframes, clusters, modifier internals, tag parameters, materials by link) |
| `c3d_make_editable` | select, `Objects > Make Editable`, read selection back | the converted object can get a new id; menu may be disabled for some types | `UNSUPPORTED` -> `c3d_create_mesh` |
| `c3d_merge_file` | open file in a temporary window, select roots, `Edit > Copy`, raise original, `Edit > Paste`; verified by object count | cross-document paste untested; materials may not survive; extra window remains | `UNSUPPORTED` + hint to `c3d_use_document` on the opened window |
| `c3d_import_asset` | Poly Haven FBX + textures downloaded to `<workDir>/assets/<id>/`, opened with `open -a Cheetah3D` as a NEW window | the model is not merged into the previous scene; FBX material/texture fidelity unknown | `c3d_merge_file` |
| `c3d_look_at` | HPB math calibrated to P15 (R = Ry(H)Rx(P)Rz(B), forward = -Z); closed-loop residual read-back | light/other object forward axes unverified; parent scale/shear is ignored | `forward:"+z"` |
| `c3d_restore_checkpoint` | reopens the checkpoint as a NEW window (extra window stays) | the original window is not touched | close the extra window manually |
| `c3d_new_document` / `c3d_open_document` | helper `newDocument` / `open -a` + window adoption by title | window title heuristics | `c3d_use_document` |

## Newly possible (since the benchmark runs)

* **Per-polygon materials** work: `c3d_assign_material` with `polygons` (24 polygon-selection slots per object).
* **Gradient / image background:** `c3d_set_background` (solid, gradient generated as PNG, image) on the active camera. Experimental until verified in a live render: the exact parameter behaviour (`backgroundImage` / `backgroundColor`) is set through the generic parameter path.
* **Post-processing (bloom, outlines, vignette, grade, posterize):** `c3d_postprocess_image` on an existing render, via the helper app (`UNSUPPORTED` with an install hint when the helper is missing or too old).
* **Pipes, cables, partial torus arcs:** `c3d_create_pipe`.
* **Scene statistics:** `c3d_get_scene_stats`.
* **Partial render-setting failures** are reported (`applied` plus per-key `errors`) instead of discarded.

## Behavioural caveats

* **Object names are not unique** (P20). Always use ids; path references that match several objects return `AMBIGUOUS` with candidates. Materials are uniquified (`Name.2`).
* **Session marker**: untitled documents get a hidden root-level folder `__c3d_mcp_session_<uuid>` used to recognise the document; it shows up in `c3d_list_scene` and `c3d_get_document_info`.
* **Save semantics**: `c3d_save_document` / `c3d_export` / checkpoints write a COPY (`saveToFile` does not re-point the document, P07). The window title and dirty state do not change.
* **No overwrite**: files that existed before the session are never overwritten; session-owned files only after confirmation.
* **Rendering is synchronous** and may open the Render Manager window, which temporarily disables the bridge trigger menu (the helper re-raises the document window). `c3d_render_sequence` renders one frame per bridge request and does not restore the animation time.
* **Lights** are `LIGHT` + `lightType` 0..4; the constants `SPOTLIGHT`, `POINTLIGHT`, ... do not exist (P05/P17).
* **Keyframes** use seconds, linear by default; vector parameters create three F-curves (P14).
* **Mesh size**: single requests are capped at 200000 vertices/polygons; `c3d_create_mesh` splits into chunks of ~4000 automatically and removes the partial object if a chunk fails.
* **`c3d_run_script`** is advisory-linted (blocked only on error-severity findings unless `force:true`); it is not a security sandbox. Scripts that use `OS.system` or file access require confirmation; `C3D_MCP_DISABLE_EXEC`, `C3D_MCP_DISABLE_SHELL` turn them off.
* **Assets** need network access to api.polyhaven.com / dl.polyhaven.org (HTTPS only, 100 MB cap, allow-listed extensions). `C3D_MCP_DISABLE_ASSETS=1` disables the tools.
* **`c3d_get_parameters tag_index`** requires the bridge `getParameters` op to accept a `tag` argument (contract amendment pending).


## Known security limitations (from the independent review, docs/qa/review-security.md)
- `c3d_run_script` containment is best-effort, not a boundary. A script with an endless loop freezes Cheetah3D (the deadline is only checked before a run); lint blocks the obvious `while(true)` forms.
- Script objects/tags (`SCRIPTTAG`, `SCRIPTPOLY`, …) cannot be created through the tools because they execute unsandboxed JavaScript.
- `c3d_export` / `c3d_save_document`: the overwrite guard now also checks sibling files (`.mtl`), treats dangling symlinks as existing and creates parent directories only inside the work directory, but the actual write is done by Cheetah3D, so check-then-write is still not atomic.
- The helper socket is protected by file mode (0600) only; any process of the same user can use it. The helper bundle's code signature is verified before auto-launch (`C3D_HELPER_SKIP_VERIFY=1` for unsigned dev builds).
- Downloads are capped at 100 MB (enforced while streaming) and JSON API responses at 8 MB.


## Found by the benchmark runs (docs/benchmark/)
- **Rendering features Cheetah3D itself does not offer:** no outlines / Freestyle-style line work, no bloom or glow, no compositor or render passes. These are now available as image post-processing: render with `c3d_render_image`, then run `c3d_postprocess_image` (bloom, edge outlines, vignette, colour grade, posterize; needs the helper app, `c3d-mcp install` updates it). They are applied to the finished 2D image, so they cannot use depth/object IDs (no per-object outlines, no glow that is occluded correctly) and the unprocessed render has no glow to lights. **Gradient backgrounds** are supported by `c3d_set_background` (the tool generates a PNG and assigns it as the active camera's background image; sizes up to 4096 px; not visible in the editor viewport).
- **Materials:** the `Toon` root only accepts `color` (its lit/shaded ramp cannot be set); only `Material`, `Material (PBR)`, `Toon` and `Glass` roots are created by `c3d_create_material`.
- **Geometry:** `TORUS` has no sweep angle; use `c3d_create_pipe` for bent pipes, cables and partial torus arcs (circular cross-section only, fillets are polylines sampled at `arc_steps`). Scene totals (objects by type, polygons, vertices, triangles, materials) come from `c3d_get_scene_stats`; per-object statistics are not offered.
- **Lights:** a new light casts along its local -Y (its `axis` option defaults to 1; 0 = -X, 1 = -Y, >=2 = -Z). `look_at` on a light now switches the axis to -Z before aiming (verified by render).
- **Rotation:** `rotation` components are x=heading, y=pitch, z=bank (default HPB order), not x/y/z axis rotations.
- **Reparenting:** `keep_world` only works between root-level parents.
- **Scripts:** `doc.addObject` creates objects under the parent of the currently selected object (parent explicitly), a script that throws keeps the geometry it already created, and removing a material (`doc.removeMaterial`) in the same script run that created it crashes Cheetah3D at idle (crash #2, root cause isolated by bisect in research/08). Since 0.1.2 the script `doc` refuses that case with UNSUPPORTED; removing a material created in an earlier call is safe.
- **Unattended runs:** a client that supports elicitation is always asked and the model's `confirm:true` is ignored unless the server was started with `C3D_MCP_AUTO_CONFIRM=1`.
