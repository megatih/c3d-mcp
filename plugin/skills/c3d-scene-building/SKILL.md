---
name: c3d-scene-building
description: Builds and edits 3D scenes in Cheetah3D 8.1.3 through the c3d_* MCP tools. Covers the safe working loop (doctor, scratch document, inspect, build, render-verify, checkpoint), coordinate and rotation conventions, addressing objects by id, parenting and folders, primitives and their parameter names, custom meshes and pipes, bulk building with run_script, scene statistics and safety rules. Use when asked to model, arrange, light, texture or render something in Cheetah3D, to generate many objects procedurally, or to fix a scene that looks wrong.
---

# c3d-scene-building

If the `c3d_*` tools are not available: on clients without the MCP server (for example ChatGPT) hand off to the `c3d-scripting` skill's standalone-macro fallback. For install or connection problems hand off to `c3d-setup`.

## Core loop
1. `c3d_doctor`. If anything fails, stop and report (see `c3d-setup`).
2. `c3d_new_document` - always work in a scratch document. Never open, save over or modify the user's files unless they ask. `c3d_use_document` binds an already open window.
3. Inspect: `c3d_get_document_info`, `c3d_list_scene` (ignore the hidden `__c3d_mcp_session_*` folder), `c3d_capabilities` for valid type names.
4. Build in phases (room/ground, main forms, details, materials, lights, camera). Keep a name-to-id table.
5. Verify after every phase: `c3d_render_image` (draft, small size such as 320x320, `include_image:true`) and look at it. `blank:true` means empty scene, camera inside geometry or no light; `meanLuma` roughly 0.2-0.5 is a readable exposure. Cross-check counts with `c3d_get_scene_stats`.
6. `c3d_checkpoint` after each good phase and before risky steps. Cheetah3D's Undo does not revert tool or script changes.
7. Final render at full size, then optionally `c3d_postprocess_image` (bloom, outlines, vignette; needs the helper).

## Conventions that cause most mistakes
- Y-up, metres. Heights go on y; a floor is a thin BOX or PLANE at y=0.
- Address objects by integer id returned from creation tools. Names are not unique; a name or path matching several objects returns `AMBIGUOUS`. Materials are referenced by name (made unique, `Name.2`).
- Rotation is degrees in HPB order: `x`=heading (turn about vertical Y), `y`=pitch (about X; positive tips the +Z end down), `z`=bank (about Z). It is not x/y/z axis rotation. To turn a box on the floor, set `rotation:{x:20,y:0,z:0}`.
- Aim cameras and lights with `c3d_look_at` / `c3d_set_camera look_at_point` / `c3d_set_light look_at_*`, then check the render. A new light casts along local -Y until aimed.
- Lights are type `LIGHT` with `light_type` 0 ambient, 1 area, 2 distant, 3 point, 4 spot. New lights use inverse-square attenuation: if renders are dark raise `intensity` (about distance squared) or set `attenuation` to 0.
- Colour is not a primitive parameter: `c3d_create_material` then `c3d_assign_material`. Material colours are `[r,g,b,a]` in 0-1.
- Parameter names are case-sensitive. Read them with `c3d_get_parameters` before `c3d_set_parameters`; unknown names come back in `errors`.

## Hierarchy
- Group with FOLDER objects (`c3d_create_object type:"FOLDER"`), then create children with `parent:<id>` or `c3d_reparent`. Local transforms are relative to the parent.
- `c3d_reparent keep_world:true` only works between root-level parents (otherwise `UNSUPPORTED`); set the local position afterwards instead.
- Splines used for Extrude/Lathe/Sweep: create the spline, create the generator object, reparent the spline under it.
- In scripts, `doc.addObject` puts the new object under the parent of the currently selected object. Always parent explicitly (see [recipes](references/recipes.md)).

## Choosing a geometry tool
| Need | Tool |
|---|---|
| Boxes, spheres, cylinders, cones, planes, tori | `c3d_create_object` with `params` - [primitives](references/primitives.md) |
| Arbitrary shapes, n-gons, UVs | `c3d_create_mesh` (CCW winding seen from outside, validated, chunked) |
| Pipes, cables, rails, bent tubes, partial torus arcs | `c3d_create_pipe` (TORUS has no sweep angle) |
| Per-vertex edit of an existing shape | `c3d_make_editable` (experimental, id may change; use the returned object), then `c3d_get_mesh` / `c3d_edit_mesh` |
| Paths for Extrude/Lathe | `c3d_create_spline` |
| Dozens to hundreds of similar objects, surfaces of revolution | `c3d_run_script` |
| Copies | `c3d_duplicate` (experimental, `count` and `offset`); for many, script it |

Primitives cannot be edited per vertex. If shading looks inside-out on a custom mesh, flip with `c3d_edit_mesh flip_winding`.

## Bulk building with c3d_run_script
Use it when no dedicated tool fits or when making many objects; one call replaces hundreds of tool calls. A real run built a 1,100-object scene with scripts for panels, paving and railings.
1. `c3d_search_api_docs` for signatures, then `c3d_lint_script` on non-trivial code.
2. Entry is a plain script body with `doc` available; return a JSON value with an explicit `return` (a trailing expression is not returned); `print()` goes to `log`.
3. Parent every object explicitly: `parent.addChildAtIndex(obj, parent.childCount())`. Set `name` via `setParameter('name', ...)`.
4. Call `obj.update()` after geometry or parameter edits. Validate polygon indices before `core.addIndexPolygon`; a bad index crashes Cheetah3D.
5. Do not remove a material in the same script run that created it (crashes the app at idle). Never call `File.mkDir`. Escape non-ASCII text as `\uXXXX`.
6. A script that throws keeps what it already created: check `c3d_list_scene` and restore a checkpoint if needed. An automatic checkpoint is taken before each run.
7. Verify with `c3d_get_scene_stats` (objects by type, polygons, vertices) and a render.

## Safety rules
- Scratch documents only; the server never overwrites files that existed before the session and refuses sibling `.mtl` overwrites.
- Use a new filename for every render (`draft_v1.png`, `draft_v2.png`, ...). Render outputs: png, jpg, tiff only.
- Avoid OBJ export (crashed Cheetah3D once); export FBX, DAE, STL or USDZ. glTF/GLB cannot be opened.
- Deleting more than 5 objects, or objects with children, restoring checkpoints and scripts touching files need confirmation; pass `confirm:true` only after the user agreed.
- `BLOCKED_BY_MODAL`: report the dialog text and wait for the user to dismiss it.
- `c3d_save_document` and checkpoints write copies; the open window keeps its title and dirty state. `c3d_restore_checkpoint` opens a new window.
- Rendering is synchronous; keep drafts small, and lower resolution or GI samples if a call times out.

## Further material
- [primitives](references/primitives.md) - object types and verified parameter names.
- [recipes](references/recipes.md) - lathe vase script, repeated planks and paving, pipe runs, folder organisation, render workflow.
