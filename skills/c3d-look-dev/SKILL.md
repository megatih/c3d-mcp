---
name: c3d-look-dev
description: Guides look development in Cheetah3D 8.1.3 through the c3d_* MCP tools - procedural material node graphs, per-polygon materials, emissive neon, lights, camera framing, render settings, backgrounds and 2D post-processing for toon or anime looks. Use when the user wants a scene to look good (materials, lighting, camera, render quality) rather than to model geometry or write scripts.
---

# Cheetah3D look development

If the c3d_* tools are not available (no MCP, e.g. a plain chat client), do not guess tool calls. Hand off to the `c3d-scripting` skill and use its standalone macro fallback to set materials, lights and camera from a macro script.

## Loop
1. Work in a scratch document (`c3d_new_document`); `c3d_checkpoint` before each look phase.
2. Change one thing, draft-render (small, GI off), read the stats and the image, adjust. Final render last.
3. Address objects and materials by id or returned name. Object names are not unique; material names get `.2` suffixes.

## Materials
- `c3d_create_material` types: `Material` (classic, `color` -> diffColor), `Material (PBR)` (`color` -> baseColor, `metalness`, `roughness`), `Toon`, `Glass`. No other roots.
- Procedural recipe: `c3d_create_material` (returns `rootNodeId`) -> `c3d_add_material_node` (returns `nodeId` and io names) -> `c3d_connect_nodes` (`from_node` nodeId, `from_output` "color", `to_node` rootNodeId, `to_input` "diffColor") -> `c3d_assign_material` -> verify with `c3d_get_material_graph`.
- Node types: wood, marble, checkerboard, noise, voronoi, gradient, image, mix, multiply, add, color, number, hsv2rgb. Names are case-sensitive; read io names from the add result.
- Emissive neon: create the material, then `c3d_set_material_params` with `{emisColor:[r,g,b,1]}` on the root. `emisColor` is clamped to 1. In the FALCON renderer an emissive surface does light its surroundings (measured in 8.1.3); in the CHEETAH renderer earlier benchmarks saw no illumination, so add a real light of matching colour next to it there, and bloom in post for a glow.
- Glass: `c3d_set_material_params` `{transEta:1.52, transAbsorption:0.02}`. Gold/chrome: PBR with `metalness` 1; `reflClearcoat` via params.
- Per-polygon: `c3d_make_editable` first on primitives, then `c3d_assign_material` with `polygons:[...]` (indices from `c3d_get_mesh`). Each material group takes one of 24 polygon-selection slots per object (returned as `slot`).
- Textures: image node + `c3d_set_texture` (absolute path) + connect.
- Details and limits: `references/materials.md`.

## Lights
- `c3d_set_light` `light_type`: 0 ambient, 1 area, 2 distant, 3 point (default), 4 spot. There are no SPOTLIGHT/POINTLIGHT object types. The number-to-type mapping is inferred (4 shows a cone, 0 and 2 have no falloff, 1 and 3 fall off with distance), not confirmed one by one.
- New lights use inverse-square falloff (`params.attenuation` 2): raise `intensity` about distance squared, or set attenuation 0.
- Area light: `params {width, height, attenuation}`. `look_at_point`/`look_at_ref` switches the axis option to -Z before aiming; set position first.
- Tune intensity until `c3d_render_image` `meanLuma` is in the target band (0.2-0.5 interior drafts, 0.3-0.45 finals). `blank:true` means flat colour: no light, camera inside geometry or empty scene.
- Details: `references/lighting-render.md`.

## Camera and framing
- `c3d_set_camera`: `position`, `look_at_point`, `fov` (degrees; 35-50 for product/diorama shots), `active:true`. Cameras look down -Z. Match the render aspect to the target (`c3d_set_render_settings` width/height).
- Frame the whole subject including the floor edge; judge from a draft render, not numbers.

## Render
- `c3d_set_render_settings` `params`: `giOn`, `giSamples`, `rayDepth`, `reflectionOn`, `refractionOn`, `shadowsOn`, `antialiasingMaxSamples`, `exposure`, `gamma`. Unknown names are reported in `errors`.
- Draft: 320-728 px, GI off, rayDepth 6. Final: GI on, samples 150-600+, rayDepth 8-10, keep one render under ~60 s; lower size or samples if it times out.
- Use a new filename for every render (existing files are never overwritten). Request `include_image:true` and look at it.
- `c3d_set_background`: `solid`, `gradient` (stops, `angle_deg`; generated PNG on the active camera) or `image`. Visible only in renders and camera views.

## NPR and anime looks
`Toon` materials plus a limited palette, coloured spill lights, `c3d_set_background` gradient, then `c3d_postprocess_image` (bloom, outline, vignette, grade, posterize) on the finished render. Needs the helper app. See `references/npr-postprocess.md`.

## Honest gaps (say so, do not fake)
- No inked outlines, glow, compositor or render passes in the app; post-processing is 2D only, so outlines and bloom ignore depth and object ids.
- Toon root accepts only `color`; the lit/shaded ramp cannot be set.
- The renderer is two-sided; thin one-sided planes show from both faces.
- Gradient/float-array parameters cannot be written. Render formats are png/jpg/tiff only.

## References
- `references/materials.md` - node recipes, parameter names, PBR/Glass/Toon limits.
- `references/lighting-render.md` - light, camera and render-budget tuning.
- `references/npr-postprocess.md` - toon/anime workflow and post-processing parameters.
