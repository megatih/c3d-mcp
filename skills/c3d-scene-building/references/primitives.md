# Primitives and parameters

Create with `c3d_create_object {type, name, parent, position, rotation, scale, params}`. `params` names are case-sensitive. If a name is rejected, the result lists it in `errors`; call `c3d_get_parameters` on the new object for the real list. `c3d_capabilities` returns all valid object, tag, material and light types.

Names below are the ones that appear in this project's docs and benchmark runs.

| Type | Parameters seen in use | Notes |
|---|---|---|
| `BOX` | `sizeX`, `sizeY`, `sizeZ`; `bevelRadius`, `bevelSections` | Thin slabs make walls, floors and panels; centre is the object origin, so a floor slab of height 0.1 sits at y=-0.05 |
| `BALL` | `radius`, `sections`, `spans` | Cornell run used `sections:48, spans:32` |
| `CYLINDER` | `radius`, `height`, `sectionsRadius` | Stands along Y; rotate `[0,0,90]` (bank) to lay it along X; `bevelRadius`/`bevelSections` also accepted |
| `TORUS` | `radiusRing`, `radiusTube` | No sweep angle; use `c3d_create_pipe` for arcs and bent pipes |
| `CONE`, `PLANE`, `TUBE`, `DISC`, `CAPSULE`, `POLYHEDRA`, `STAIR` | read with `c3d_get_parameters` | Valid primitive type names; parameters not verified in the repo docs |
| `FOLDER`, `NULL` | none | Grouping |
| `LIGHT` | use `c3d_set_light`; `light_type` 0..4; area light `params {width, height, attenuation}`, `intensity` | `attenuation:0` removes falloff |
| `CAMERA` | use `c3d_set_camera`; `fov`, `near`, `far`, `focal_distance`, `active` | A new camera becomes active |

Splines (for Extrude/Lathe/Sweep inputs): `c3d_create_spline paths:[{points:[{p:[x,y,z], c1?, c2?}], closed?}]`. Spline type names in scripts include CIRCLE, RECT, STAR, HELIX, LINE, TEXT.

Script equivalents: `doc.addObject(BOX)` then `o.setParameter('sizeX', 2)`; position and rotation use `setParameter('position', new Vec3D(x,y,z))`.

## Custom mesh
`c3d_create_mesh {vertices:[[x,y,z],...], polygons:[[i,j,k,...],...], uvs?, material?, name, parent, position}`. Polygons are 3 to 64 corners, counter-clockwise seen from outside, Y up. Indices are validated before sending; meshes over ~4000 elements are chunked automatically (limit 200000). A pyramid has its base at y=0 and apex at `[0,height,0]`.

## Pipes
`c3d_create_pipe {points:[[x,y,z],...2..200], radius, segments (6..48, default 16), bend_radius?, arc_steps? (1..24), closed?, caps?, material?}`. `bend_radius` rounds each interior corner and must be at most half the shorter adjacent segment, else `INVALID_ARGUMENT`. Points are relative to the object's `position`. Output is one editable polygon mesh.

## Mesh editing
`c3d_get_mesh` pages vertices and polygons (limits up to 5000). `c3d_edit_mesh` applies in this order: `set_vertices` [{index, position}], `flip_winding`, `delete_polygons` (later indices shift), `merge_distance`. Primitives must go through `c3d_make_editable` first.

## Materials in brief
`c3d_create_material` roots: `Material`, `Material (PBR)` (`color`, `metalness`, `roughness`), `Toon` (only `color`), `Glass` (`transEta`, `transAbsorption` via `c3d_set_material_params`). Emission: `emisColor`. Procedural looks: `c3d_add_material_node` (`wood`, `marble`, `checkerboard`, `noise`, `voronoi`, `brick`, `mix`) then `c3d_connect_nodes from_output:"color" to_input:"diffColor"` into the root id. `c3d_assign_material` with `polygons:[...]` colours parts of an editable mesh (24 selection slots per object).
