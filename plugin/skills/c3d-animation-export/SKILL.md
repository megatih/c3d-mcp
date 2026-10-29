---
name: c3d-animation-export
description: Covers animation, rendering sequences, saving, export and asset import in Cheetah3D 8.1.3 through the c3d_* MCP tools - fps, time and takes, keyframes, image sequences with background jobs, viewport capture, export formats (FBX, DAE, STL, USDZ, 3DS, DXF, risky OBJ, unsupported glTF/GLB), .jas saves, opening and merging files, and Poly Haven models. Use when a task involves keyframes, turntables, sequences, exporting a scene, saving a copy, or importing a model.
---

# Animation, rendering output, export and import

If the c3d_* tools are not available: use the c3d-scripting skill's macro fallback (keyframes and `saveToFile` can be done in a macro), or the c3d-setup skill to install and verify the bridge.

Honesty note: animation was tested far less than modelling. Verified live: fps/time, keyframe creation on vector parameters, and sequence rendering for short clips. Everything else here follows the tool descriptions; always read results back (`c3d_get_keyframes`, `c3d_set_time` + `c3d_get_parameters`) and view a test frame before a long render.

## Time, fps, takes
- Time is always in seconds, never frames: frame = seconds * fps. Default fps is 30; call `c3d_set_fps` before keyframing when frame accuracy matters.
- `c3d_set_time` moves the playhead so animated parameters re-evaluate; use it before reading values.
- Keyframes live in takes. `c3d_takes` actions: list, add, rename, remove, select. `c3d_set_keyframes` writes into the current take unless `take` is given. Removing a take is destructive; checkpoint first.

## Keyframes
- `c3d_set_keyframes {ref, param, keys:[{time, value, interpolation?}], take?, replace?}` handles one parameter per call. `ref` is an object id (preferred), path or `{selected:true}`.
- Interpolation per key: `linear` (default), `soft`, `spline`, `flat`, `const`. Use `const` for stepped/cut animation, `soft` or `spline` for ease.
- Values: number for scalars; `[x,y,z]` or `{x,y,z}` for Vec3D (position, rotation, scale); colours (Vec4D) accept 3 components `[r,g,b]` or 4 `[r,g,b,a]`. One F-curve per component is created. Times must be unique.
- `replace` defaults to true: the parameter's existing keys in that take are cleared first. Pass `replace:false` to add to an existing curve.
- Rotation is HPB (x = heading about vertical Y, y = pitch, z = bank). For a turntable, animate heading x from 0 to 360 on a parent `FOLDER` that contains the model; use `linear` interpolation for constant speed. For a seamless loop the last key (360) shows the same pose as the first (0), so render one frame fewer than the key span (stop the sequence one frame before the 360 key).
- Link parameters (object references) are not keyframable through `c3d_set_keyframes`, which accepts numbers and 3-4 component vectors only. Set a link with `c3d_set_parameters` using `{ref: id|"/path"}` (null clears); to switch what a link points at over time, animate a numeric parameter instead (visibility, intensity, position) or render segments with different settings.
- Animatable parameter names: read them with `c3d_get_parameters` first (for example `position`, `rotation`, `scale`, light `intensity`). Verify with `c3d_get_keyframes {ref, param}` (components 0=x/r, 1=y/g, 2=z/b, 3=w/a) and spot-check frames with `c3d_set_time` + `c3d_get_parameters`.
- To follow a target with the camera, keyframe camera `position` and re-aim by keyframing `rotation` (compute with `c3d_look_at` at sample times and read the rotation back), or parent the camera under an animated folder.

## Rendering
- Single frame: `c3d_render_image {path, width, height, time?}`. `time` renders at that second. Formats png, jpg, tiff only; any other extension is rejected. Use a new filename every call; the server never overwrites. Rendering is synchronous and may open Cheetah's Render Manager window; the helper re-raises the document window.
- Sequence: `c3d_render_sequence {end, start?, fps?, width?, height?, prefix?, directory?, format?}` starts a background job and returns `job_id`, `total_frames` and the directory immediately. Frames are named `prefix_0001.png ...`. Max 3600 frames. Each frame still blocks Cheetah3D while rendering, one bridge request per frame, so other tools interleave between frames but the app is busy.
  - Poll with `c3d_job_status {job_id}` (omit the id to list jobs; jobs vanish when the server restarts). Stop with `c3d_job_cancel`; the current frame finishes and rendered frames are kept.
  - The animation time is NOT restored after a sequence. Call `c3d_set_time` afterwards.
  - Size the job first: render one test frame with `c3d_render_image time:...`, multiply its time by the frame count, and keep tool timeouts in mind. Use low resolution and `giOn:false` for previews (160x120, 12 fps, 2 s = 24 frames is a good smoke test).
  - Assembling video is outside the tools; report the directory and the frame naming, and say an external encoder is needed.
- `c3d_capture_viewport` returns a screenshot of the editor window (gizmos, grid, selection), not a render. Needs Screen Recording permission for the helper (`PERMISSION_MISSING` otherwise). Useful to show the user selection state or to debug camera framing.
- Post-processing (bloom, outline, vignette, grade, posterize) applies to a finished image through `c3d_postprocess_image`; it is not applied inside the sequence render.

## Export, save, open, import
Details and per-format notes in [references/formats.md](references/formats.md).
- `c3d_export {path, format?}` writes obj/fbx/dae/stl/3ds/usdz/gltf/glb/dxf as a copy and leaves the open document untouched. Prefer FBX (or DAE/USDZ/STL/3DS/DXF). OBJ crashed Cheetah3D 8.1.3 once on a nested-folder scene: use it only as a last resort; a checkpoint is taken automatically first, expect to restore from it on a crash.
- glTF/GLB: the exporter can write them, but Cheetah3D cannot open or merge glTF/GLB (blocking dialog). Do not offer them as a round-trip format, and never try to open one.
- `c3d_save_document {path}` saves a `.jas` COPY (the open window is not re-pointed and keeps its dirty state). Never overwrites a file that existed before the session; a file the server wrote earlier needs confirmation. Never choose a user file name to "save over" it; pick a new name. `c3d_checkpoint` is the fast safety net; `c3d_restore_checkpoint` reopens it as a NEW window.
- `c3d_open_document {path}` opens a `.jas` or an importable model (obj, fbx, dae, stl, 3ds, usdz, dxf) as a new window and binds the session to it. Imported models do not merge into the current scene. `c3d_merge_file {path}` is experimental (copy/paste via helper, materials may not survive, extra window stays); if it returns UNSUPPORTED, work in the opened window and use `c3d_use_document` to choose the target window.
- Poly Haven (CC0): `c3d_search_assets {query, type, category, limit}` finds models (HDRIs and textures are listed but only models import). `c3d_import_asset {id, resolution}` downloads the FBX variant with textures to the work directory, records license and author in `asset.json`, and opens it as a new window. Report the license and author to the user. Needs network; may be disabled by `C3D_MCP_DISABLE_ASSETS=1`.

## Safe workflow
1. `c3d_checkpoint` before restructuring animation or exporting OBJ.
2. Set fps, create or select the take, keyframe, read back, test-render one frame, then run the sequence.
3. After a sequence call `c3d_set_time 0` (or the desired time).
4. Deliver paths: frames directory, final export file, `.jas` copy; state which formats were skipped and why.
