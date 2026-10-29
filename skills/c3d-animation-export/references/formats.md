# Formats

## Render output
| Format | Status |
|---|---|
| png, jpg, tiff | supported by `c3d_render_image`, `c3d_render_sequence`, `c3d_set_background` (image). TIFF is LZW. |
| anything else (exr, bmp, ...) | rejected client-side; Cheetah3D would raise a blocking modal. Convert externally. |

## Export (`c3d_export`, copy only, document untouched)
| Format | Notes |
|---|---|
| fbx | default recommendation; used for delivery sets |
| dae, stl, 3ds, usdz, dxf | work; stl is geometry only |
| obj | writes a sibling `.mtl`; crashed Cheetah3D 8.1.3 once on a scene with nested folders. Last resort only. A checkpoint is taken automatically before the export; the overwrite guard also checks the `.mtl` |
| gltf, glb | files are written, but Cheetah3D cannot open them again |
| abc, svg, mtl, png | not produced |

Existing files from before the session are never overwritten; relative paths go to `<workDir>/exports`. Missing directories are only created inside the work directory.

## Open / import (`c3d_open_document`, `c3d_merge_file`)
| Format | Status |
|---|---|
| jas | opens as a new window |
| obj, fbx, dae, stl, 3ds, usdz, dxf | open as a new window named after the file; no automatic merge |
| glb, gltf | unsupported; Cheetah3D shows a blocking dialog ("cannot open files in the glb format"). Convert to FBX/OBJ outside Cheetah first |

`c3d_merge_file` is experimental and needs the helper with Accessibility permission; verify by object count and check materials afterwards.

## Save
`c3d_save_document` writes `.jas` only. Relative paths go to `<workDir>/saves`. The target directory must exist unless inside the work directory. Copy semantics: the window title and dirty state do not change.

## Poly Haven
- Source: api.polyhaven.com (listing/search), dl.polyhaven.org (downloads), HTTPS only, 100 MB cap, md5 and SHA-256 recorded.
- Models offer glTF, FBX, USD, Blend; the tool always takes FBX. Resolution `1k`, `2k` or `4k` (default 1k).
- License CC0; authors in the result and in `asset.json`.
- FBX material and texture fidelity inside Cheetah3D is not guaranteed; render a test frame after import and fix materials with `c3d_list_materials` / `c3d_set_texture` if needed.

## Window handling
Each open, import and restore creates an extra window. Close surplus windows manually (the tools cannot close documents). If a later call fails with `WRONG_DOCUMENT`, call `c3d_use_document` with the wanted window title.
