---
name: c3d-reference-recreation
description: Guides a phased, self-correcting recreation of a scene from a reference image or written spec in Cheetah3D 8.1.3 through the c3d_* MCP tools, with draft renders compared against the reference after every phase, checkpoints, crash recovery, bounded GI budgets, a delivery set and an honest gap report. Use when asked to rebuild, match, reproduce or benchmark a scene (diorama, Cornell box, building, interior) from a picture or a detailed brief.
---

# Recreating a reference scene in Cheetah3D

If the c3d_* tools are not available: use the c3d-scripting skill's macro fallback (run Cheetah3D macros by hand), or the c3d-setup skill to install and verify the bridge. Do not pretend to have built or rendered anything.

## Principles
- The reference image is the single authority for composition, proportions and colour. A spec only helps you start; if they disagree, the image wins. Match the real image aspect ratio, not the one quoted in text.
- Work in a new scratch document. Never open, save over or modify the user's files. Do not animate unless asked. Do not ask the user questions mid-run; decide, record the decision, continue.
- Look at every render. Pass `include_image:true` and actually inspect the picture; `meanLuma` and `blank` are only sanity checks.

## Before building
1. Read the reference: write down view angle, framing (where the subject sits in the frame), aspect ratio, palette (rough RGB values), a numbered feature list (aim for ~20), and the visible hierarchy of volumes with estimated metre sizes.
2. `c3d_doctor`. If it fails, stop and report the failing check (see c3d-setup). Then `c3d_new_document`, `c3d_capabilities`, `c3d_get_document_info`.
3. Keep a name -> id table in your notes. Object names are NOT unique; always address objects by integer id.

## Phase loop (details in [references/phase-playbook.md](references/phase-playbook.md))
P0 preflight, camera, plot, blocking, background. P1 volumes. P2 structure and panels. P3 features (openings, awnings, stairs). P4 mechanical (fans, pipes, cables). P5 environment and props. P6 materials. P7 lighting, final render, export.

After EVERY phase:
1. `c3d_render_image` a draft with a NEW filename (`draft_p2_v1.png`). The server never overwrites.
2. View it next to the reference. List the 5 biggest differences (silhouette, proportions, framing, colour, missing features).
3. Fix them. Re-render as `_v2` if the fix was large.
4. `c3d_checkpoint` with a label (`P2-structure`), then write a STATE block (<= 12 lines: folders and counts, materials, camera, lights, latest checkpoint id, open issues) so a fresh session can resume.
Never call a phase done while the draft is visibly less sophisticated than the reference. Fix volumes in P1, not later.

## Conventions that avoid known failures
- Y-up, metres. `rotation` components are HPB: x = heading (yaw about vertical Y), y = pitch, z = bank. Do not assume y is yaw.
- Lights: `light_type` point/area/distant/ambient; use `look_at` to aim; tune intensity from `meanLuma` (target roughly 0.2-0.5 for drafts) and the image. Add `params {attenuation:0}` for flat fill.
- `c3d_reparent keep_world:true` only works between root-level parents; otherwise reparent then fix the transform.
- Organise in `FOLDER` objects (architecture, roofs, panels, openings, awnings, signs, pipes, machines, stairs, ground, props, lights, cameras). Create the folder first, parent into it.
- Offset proud details by >= 0.01 m to avoid z-fighting. Bevels: `bevelRadius`/`bevelSections` on BOX/CYLINDER. Bent pipes, cables and partial torus arcs: `c3d_create_pipe` (TORUS has no sweep angle).
- Per-polygon materials: `c3d_assign_material` with `polygons`. Different materials on separate objects is the default.
- Bulk geometry (planks, slabs, fan blades, railings, cables) via `c3d_run_script`: run `c3d_lint_script` first, ES5 only (`var`, `function`), keep each script under ~8000 chars, finish with `return {...counts}`, no `OS`/`File`. Scripts rules:
  - `doc.addObject` parents the new object under the parent of the currently selected object. Parent every object explicitly with `parent.addChildAtIndex(obj, parent.childCount())`.
  - A script that throws keeps the geometry it already created. After any script error run `c3d_list_scene` and delete the debris or restore the last checkpoint.
  - Never remove a material (`doc.removeMaterial`) or create-then-delete probe materials in the same script; it crashes Cheetah3D 8.1.3 at idle. Leave unused materials in place and inspect node types with `c3d_get_material_graph`.
- Materials: roots are `Material`, `Material (PBR)`, `Toon`, `Glass`. The Toon root accepts only `color` (no ramp). Variation via `c3d_add_material_node` (noise, voronoi, marble, brick, wood, checkerboard, mix) wired with `c3d_connect_nodes` (`from_output:"color"`, `to_input` = `diffColor` / `baseColor` / `color`; confirm with `c3d_get_material_graph`).
- Backgrounds: `c3d_set_background` (solid, gradient, image) acts on the active camera; create the camera first.

## Render budgets
- Drafts: about half the final resolution, `giOn:false`. Final: the reference resolution/aspect, `giOn:true`.
- Keep any single render under ~60-90 s: raise `giSamples` only while the final stays inside that; `rayDepth` 8-10, `antialiasingMaxSamples` 3-4. If a call times out, lower resolution or GI samples and retry. Tune with `c3d_set_render_settings` (reports unknown keys in `errors`).
- Formats: png, jpg, tiff only. Use a new filename every time.

## Crash recovery
Cheetah3D 8.1.3 can crash (a script removing a material it just made; OBJ export). All windows are lost.
1. Relaunch Cheetah3D, run `c3d_doctor`.
2. `c3d_restore_checkpoint list_only:true`, then restore the latest checkpoint taken before the crash (opens as a new window; needs confirmation, unattended runs need `C3D_MCP_AUTO_CONFIRM=1`).
3. Re-read the scene with `c3d_list_scene`, rebuild the id table (ids may change), redo only the lost calls. Record the crash and its triggering call for the report.
Checkpoint before every risky step (large scripts, material graph surgery, exports).

## Delivery set
- Final PNG at the reference aspect ratio (new filename, e.g. `final_v1.png`; re-render `_v2` after fixes).
- `.jas` checkpoint of the final state (`c3d_checkpoint`; `c3d_save_document` only if the user wants a path of their choice).
- FBX via `c3d_export` (never OBJ). `c3d_list_scene` / `c3d_get_scene_stats` for counts.
- Optional look pass: `c3d_postprocess_image` on the final render (bloom, outline, vignette, grade, posterize). Say plainly it is 2D image processing applied after the render, not in-app.

## Honest gap reporting
State what Cheetah3D cannot do instead of faking it: no inked/inverted-hull outlines (the renderer is two-sided, so flipped shells do not work; use `c3d_postprocess_image` outline, which has no depth or object ids), no in-app bloom/glow/compositor/render passes, Toon ramp not settable, TORUS without sweep angle, no per-object polygon statistics, no vertex colours. Gradient backgrounds are supported via `c3d_set_background`. Report clean-but-flat material or lighting results as such. See [references/report-template.md](references/report-template.md) for the final report (phases/calls/errors table, 1-5 scorecard, every bug or limitation with its triggering call).

## Lessons from the benchmark runs
- Rotation convention was the commonest mistake (tilted boxes instead of yawed). Verify with a render.
- Distant-light aim: if a light shines the wrong way, check its `axis` (0 = -X, 1 = -Y default, >=2 = -Z); `look_at` on a light sets -Z. Verify by render, not by the residual number.
- After a server restart, re-list checkpoints with `c3d_restore_checkpoint list_only:true` before relying on remembered ids.
- Unattended runs: `confirm:true` is ignored by elicitation-capable clients unless the server has `C3D_MCP_AUTO_CONFIRM=1`.
- `BLOCKED_BY_MODAL`: report the dialog text to the user and wait; do not retry blindly.
- A 1,100-object scene renders at 1456x816 with GI in a few seconds; object count is rarely the bottleneck, GI samples are.
