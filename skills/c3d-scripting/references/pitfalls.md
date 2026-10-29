# Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Cheetah3D hard-crashes while building a mesh | bad polygon index, non-integer index, missing `new` on Vec3D/Vec4D | validate indices against `vertexCount()`; always `new` |
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
| Lint "unknown constant" | constant exists only at runtime | check with `c3d_search_api_docs`; harmless if known |
| Freeze | endless loop (deadline checked only before run) | bounded `for` loops only |
| Z-fighting | coplanar faces | offset >= 0.01 m |

Other: lights via `LIGHT` + `lightType`; mesh requests are capped at 200000 vertices/polygons per tool call; a script timing out means split the work; a dialog open in Cheetah3D blocks tools (`BLOCKED_BY_MODAL`), ask the user to dismiss it.
