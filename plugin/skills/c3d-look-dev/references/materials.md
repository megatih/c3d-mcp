# Materials and node graphs

## Root types and colour inputs
| type | colour input | notes |
|---|---|---|
| `Material` | `diffColor` | classic; `emisColor` for emission; specular/reflection params via `c3d_set_material_params` |
| `Material (PBR)` | `baseColor` | `metalness`, `roughness`, `reflClearcoat` |
| `Toon` | `color` | only `color` is settable; ramp is fixed |
| `Glass` | `transColor` | `transEta` (IOR, 1.52 glass), `transAbsorption` |

The `color`, `metalness`, `roughness` shortcuts of `c3d_create_material` / `c3d_set_material_params` resolve against the root type. Colours are 0..1 RGBA arrays. Other parameters: `params` (inspect names with `c3d_get_material_graph`; unknown names are reported per name, partial success).

## Procedural recipe (verified)
1. `c3d_create_material {name:"WoodMat", type:"Material"}` -> note `rootNodeId`.
2. `c3d_add_material_node {material:"WoodMat", type:"wood", params:{color0:[0.45,0.28,0.12,1], color1:[0.22,0.11,0.04,1]}}` -> note `nodeId`.
3. `c3d_connect_nodes {material, from_node:nodeId, from_output:"color", to_node:rootNodeId, to_input:"diffColor"}`.
4. `c3d_assign_material {ref:{id}, material:"WoodMat"}`.
5. `c3d_get_material_graph` to confirm (connections may read "unavailable"; the API cannot always enumerate them).

Starting params that worked: marble `{color0:[0.93,0.93,0.9,1], color1:[0.2,0.24,0.3,1]}`; checkerboard `{color0:[0.9,0.9,0.9,1], color1:[0.06,0.06,0.06,1]}`. Keep the default `scale` first and adjust only if grain or squares are unclear; a checker rug of 3.6 x 2.2 m wants about 8 x 5 squares.

Combine nodes (`mix`, `multiply`, `add`, `gradient`, `noise`, `voronoi`, `hsv2rgb`, `color`, `number`) by connecting outputs to inputs of the next node; connect the final node to the root input. Add a node to a material you keep: do not create throwaway probe materials (see `c3d-scripting` pitfalls on `doc.removeMaterial`). Leave unused materials in place.

## Image textures
`c3d_add_material_node type:"image"` -> `c3d_set_texture {material, node, path:<absolute existing file>}` -> connect `color` to `diffColor`/`baseColor`. Clear with `c3d_set_material_params` and an empty path.

## Emissive neon
`c3d_set_material_params {material, params:{emisColor:[1,0.2,0.8,1]}}`. Emission is shading only: it neither illuminates neighbours nor blooms. Place a point/area light of matching colour close to the sign for spill, then add bloom with `c3d_postprocess_image`.

## Per-polygon materials
`c3d_make_editable` (primitives become editable polygon objects; the id may change, re-read it) -> `c3d_get_mesh` for polygon indices -> `c3d_assign_material {polygons:[...]}` per material. At most 24 slots per object. Whole-object assignment adds a SHADERTAG; `replace_existing` (default true) swaps the previous one.

## Avoiding artefacts
Offset proud details at least 0.01 m from coplanar faces (z-fighting). Prefer one material per object for many small props.
