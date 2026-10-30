# Cheetah3D scripting API cheat sheet

Sources: the bundled scripting knowledge base (`vendor/c3d-scripting-kb`, by Tonio Loewald) and calls measured in Cheetah3D 8.1.3. Facts below were measured in 8.1.3 unless marked (inferred) or (reported) (`c3d://verified` lists what was confirmed or refuted). Search hits tagged `kb`, `book-unreviewed` or `forum` are hints to test, not facts. Check anything unlisted with `c3d_search_api_docs`.

## Document
- `doc.root()` root object; `doc.addObject(TYPE)` (BOX, BALL, CYLINDER, POLYGONOBJ, FOLDER, LIGHT, CAMERA ...); `doc.materialCount()`, `doc.materialAtIndex(i)`, `doc.addMaterial(kind, name)` with kind `'Material'`, `'Material (PBR)'`, `'Toon'`, `'Glass'`.
- `doc.retainRedrawLock()` / `doc.releaseRedrawLock()`, `doc.redrawAll()`.

## Objects
- `obj.getParameter(name)`, `obj.setParameter(name, value)`; names: `name`, `position`, `rotation`, `scale`, `sizeX/Y/Z`, `radius`, `height`, `bevelRadius`, `bevelSections`, `sectionsRadius`. Vectors as `new Vec3D(...)`.
- Hierarchy: `obj.childCount()`, `obj.childAtIndex(i)`, `parent.addChildAtIndex(child, index)`, `obj.owner()` (the parent; there is NO `obj.parent()`). `doc.addObject` puts the new object under the parent of the selected object.
- `obj.id()`, `obj.update()`, `obj.core()` (editable mesh), `obj.addTagOfType(SHADERTAG)` then `tag.setParameter('material', mat)`.
- `obj.parameterInfo()` -> array-like (index with `[i]`, `.length`; no `.slice`) of `[name, typeString]` pairs. `getParameter` of an unknown name throws.
- `doc.selectedObject()` returns `undefined` (not `null`) when the root is selected: test `!o`.

## Mesh core (POLYGONOBJ)
- `core.addVertex(false, new Vec3D(x,y,z))` returns the vertex index; `core.vertexCount()`.
- `core.addIndexPolygon(count, [i0,i1,...])` (triangles, quads); winding decides normals. Cheetah3D's FRONT face is CLOCKWISE seen from outside (a native BOX has outward normals; a counter-clockwise quad gets the opposite normal). `c3d_create_mesh` converts counter-clockwise input for you; in a raw script give clockwise indices or call `core.flipWinding(p)`. Polygon UVs: `Vec2D` per corner (Vec4D is also accepted); `core.uvCoord(p, corner)` returns x,y,z,w.
- `core.vertex(i)` returns a copy; `core.setVertex(i, vec)`.

## Materials and nodes
- `mat.rootNode()`; root colour params: `diffColor` (Material), `baseColor` (PBR), `color` (Toon), `transColor` (Glass); `emisColor` emission.
- `mat.getParameter('name')` / `setParameter('name', ...)`.

## Math and misc
- `Vec3D`/`Vec4D` with `.x .y .z .w`; arithmetic via methods (`add`, `sub`, ...); `Math.*` is standard.
- Seeded random for repeatable variation (Math.random is not seedable):
  `var rnd = (function(){var s=12345;return function(){s=(s*16807)%2147483647;return s/2147483647;};})();`
- Light objects are `LIGHT` (5) with `lightType` 0..4 (0 ambient, 1 area, 2 distant, 3 point, 4 spot; (inferred): measured only that 4 has a cone and 1/3 fall off). `SPOTLIGHT`, `DISTANTLIGHT`, `AREALIGHT`, `SKYLIGHT` are undefined (ReferenceError); `POINTLIGHT` (15) exists but `doc.addObject(POINTLIGHT)` creates a non-light object. `ENVIRONMENTLIGHT` (89) is the HDRI light.
- Constants measured in 8.1.3: `SOFT_INTERPOL`=0 `LINEAR_INTERPOL`=1 `SPLINE_INTERPOL`=2 `FLAT_INTERPOL`=2 `CONST_INTERPOL`=3; `READ_MODE`=0 `WRITE_MODE`=1 `SEEK_SET/CUR/END`=0/1/2 `BIG_ENDIAN`=2 `LITTLE_ENDIAN`=3 (the docs misspell BIG_ENDIAM); `ROT_HPB`=6.
- Missing or broken in 8.1.3: `Material.rib()`, `File.readInt` (absent on File instances inside `c3d_run_script`), `Vec4D.isEqual()` (throws; compare components), `instanceof` on native classes (always false), `Vec3D(...)` without `new` (TypeError).
- Keyframes: `Parameter.isAnimatable()` (not `isAnimateable`); `doc.animationFPS()` / `setAnimationFPS(n)` (default 30); `setAnimPosition` plus `setParameter` does not create keys; `keyAtIndex` returns a copy.
- At most 24 material (SHADERTAG) tags per object: 24 were fine, 30 crashed Cheetah3D 8.1.3 (25-29 untested). Do not set Falcon `samples` to 0 (reported by the book to mean "refine until stopped"; not tested).
- Tools › Script has no "Update Menu" item: new script files need a restart of Cheetah3D.
- Script folders decide type: `Macro` (`main(doc)`), `Tool`, `Polygonobj`, `Splineobj`, `Particle`, `Tag`.
- Prefer the high-level c3d tools over scripts for single objects, materials, lights and cameras; scripts are for volume.
