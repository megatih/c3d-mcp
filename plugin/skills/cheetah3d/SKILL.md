---
name: cheetah3d
description: Work with Cheetah3D 8.1.3 through the c3d MCP tools, or write Cheetah3D JavaScript (macro/polygon/spline/tag/tool scripts). Use when the user wants to build, edit, animate, light, material or render a 3D scene in Cheetah3D, or asks about its scripting API.
---

# Cheetah3D via the `c3d_*` MCP tools

## Workflow
1. `c3d_doctor` first. If the bridge is not installed run `c3d_install_bridge` (the user must then **restart Cheetah3D once** — new macros only appear after a restart).
2. Work in a scratch document: `c3d_new_document` (never edit the user's saved files unless asked), or `c3d_use_document` to pick an open window.
3. Inspect before editing: `c3d_get_document_info`, `c3d_list_scene`, `c3d_get_object`.
4. Build with `c3d_create_object` / `c3d_create_mesh` / materials / lights / cameras. Address objects by `{id}` (stable) — names are NOT unique in Cheetah3D.
5. Check your work: `c3d_render_image` returns a downscaled image plus blank/luma stats. Iterate.
6. Take a `c3d_checkpoint` before risky steps; Cheetah's own Undo does not revert tool/macro changes.

## Facts that surprise people
- Render formats: png / jpg / tiff only. Any other extension pops a modal inside Cheetah3D.
- glTF/GLB cannot be opened by Cheetah3D 8.1.3; FBX / OBJ / DAE / STL / 3DS / USDZ / DXF can (each opens as a new window).
- Rotation is in degrees, default rotation order HPB. Lights are `LIGHT` with `lightType` 0–4. The active camera is the one whose `activeCamera` parameter is 1.
- Primitives (BOX, BALL …) are parametric; use `c3d_make_editable` (experimental) or `c3d_create_mesh` for point-level edits.
- Per-polygon materials are not supported by these tools.
- A dialog open in Cheetah3D blocks everything: tools return `BLOCKED_BY_MODAL` with the dialog text — ask the user to dismiss it.

## Writing Cheetah3D JavaScript (when `c3d_run_script` or a script file is needed)
- Entry point for macros: `function main(doc) { ... }`. Engine: JavaScriptCore, no timers, no network, no `require`.
- Always `obj.update()` after editing parameters/geometry. Pair `doc.retainRedrawLock()` with `releaseRedrawLock()` in `try/finally`.
- Validate polygon indices before `core.addIndexPolygon` — a bad index can crash the app.
- `File.write` of non-ASCII text truncates: escape non-ASCII as `\uXXXX`. Never call `File.mkDir` (it deletes an existing path).
- `parameterInfo()` returns `[name, typeString]`; vectors are read via `.x .y .z .w`.
- Use `c3d_search_api_docs` for signatures and `c3d_lint_script` before running code.
