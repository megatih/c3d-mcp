# Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Cheetah3D hard-crashes while building a mesh | bad polygon index or non-integer index (a missing `new` on Vec3D/Vec4D throws a TypeError in 8.1.3 but crashed older versions) | validate indices against `vertexCount()`; always `new` |
| New object appears under an unexpected parent | `doc.addObject` uses the selected object's parent | `parent.addChildAtIndex(o, parent.childCount())` every time |
| Scene half-built after an error | no rollback on throw | `c3d_list_scene`, delete strays or `c3d_restore_checkpoint`; build in small runs |
| Crash at idle after script | `doc.removeMaterial` on a material created in the same run | never remove in the creating run (runtime blocks it) |
| Edits not visible | missing `obj.update()` | call after parameter/geometry edits |
| Vertex edit has no effect | accessor copy | `core.setVertex(i, core.vertex(i).add(v))` |
| File content cut off | non-ASCII in `File.write` | ASCII only, `\uXXXX` escapes |
| Existing folder vanished | `File.mkDir` deletes existing path | never call it |
| UI frozen / redraw stuck | unbalanced `retainRedrawLock` | `try { ... } finally { doc.releaseRedrawLock(); }` |
| Script result is `null`/missing | trailing expression, non-JSON value | explicit `return {...}` of plain data |
| Macro does nothing | wrong folder or no restart | `Scripts/Macro/`, restart Cheetah3D once |
| Name lookup picks the wrong object | names not unique | keep references/ids |
| Lint "unknown constant" | not in the reference and not found in the 8.1.3 constant table | check with `c3d_search_api_docs`; documented-but-undefined ones (UVTAG, TONEMAPPINGTAG...) really throw |
| Freeze | endless loop (deadline checked only before run) | bounded `for` loops only |
| Z-fighting | coplanar faces | offset >= 0.01 m |
| Cheetah3D aborts while adding material tags | 30 SHADERTAGs on one object (stack-smash abort in buildMaterialArray); 24 are fine, 25-29 untested | at most 24 per object; reuse materials; `c3d_assign_material` refuses more |
| `Vec4D.isEqual` throws "Wrong number or type of arguments" | broken in 8.1.3 | compare `.x .y .z .w` |
| `obj.parent()` / `mat.rib()` TypeError | do not exist | `obj.owner()`; no rib |
| `doc.addObject(POINTLIGHT)` gives an object that is not a light | POINTLIGHT is not an object type | `addObject(LIGHT)` + `setParameter('lightType', 3)` |
| `selectedObject() === null` never true | returns `undefined` when the root is selected | `if (!o)` |
| Normals point into the mesh (`core.normal()` is inverted; exports, booleans and subdivision may look inside-out, only the normal direction was measured) | raw `addIndexPolygon` with counter-clockwise indices; Cheetah3D's front face is clockwise | clockwise indices, `core.flipWinding(p)`, or `c3d_create_mesh` (converts) |
| New script missing from the Tools > Script menu | menus are scanned at launch; there is no Update Menu item | restart Cheetah3D |
| Render may never finish | Falcon `samples` = 0 is reported (book) to mean refine until stopped; not tested | positive samples (default 100) |

Other: lights via `LIGHT` + `lightType`; mesh requests are capped at 200000 vertices/polygons per tool call; a script timing out means split the work; a dialog open in Cheetah3D blocks tools (`BLOCKED_BY_MODAL`), ask the user to dismiss it.
