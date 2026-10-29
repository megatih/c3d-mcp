# Cheetah3D scripting API cheat sheet

Sources: the bundled scripting knowledge base (`vendor/c3d-scripting-kb`, `reference/api-index.json`) and calls verified by the bridge runtime and benchmark scripts. Check anything unlisted with `c3d_search_api_docs`.

## Document
- `doc.root()` root object; `doc.addObject(TYPE)` (BOX, BALL, CYLINDER, POLYGONOBJ, FOLDER, LIGHT, CAMERA ...); `doc.materialCount()`, `doc.materialAtIndex(i)`, `doc.addMaterial(kind, name)` with kind `'Material'`, `'Material (PBR)'`, `'Toon'`, `'Glass'`.
- `doc.retainRedrawLock()` / `doc.releaseRedrawLock()`, `doc.redrawAll()`.

## Objects
- `obj.getParameter(name)`, `obj.setParameter(name, value)`; names: `name`, `position`, `rotation`, `scale`, `sizeX/Y/Z`, `radius`, `height`, `bevelRadius`, `bevelSections`, `sectionsRadius`. Vectors as `new Vec3D(...)`.
- Hierarchy: `obj.childCount()`, `obj.childAtIndex(i)`, `parent.addChildAtIndex(child, index)`, `obj.parent()`.
- `obj.id()`, `obj.update()`, `obj.core()` (editable mesh), `obj.addTagOfType(SHADERTAG)` then `tag.setParameter('material', mat)`.
- `obj.parameterInfo()` -> list of `[name, typeString]`.

## Mesh core (POLYGONOBJ)
- `core.addVertex(false, new Vec3D(x,y,z))` returns the vertex index; `core.vertexCount()`.
- `core.addIndexPolygon(count, [i0,i1,...])` (triangles, quads); winding decides normals; flip order if shading looks inside-out.
- `core.vertex(i)` returns a copy; `core.setVertex(i, vec)`.

## Materials and nodes
- `mat.rootNode()`; root colour params: `diffColor` (Material), `baseColor` (PBR), `color` (Toon), `transColor` (Glass); `emisColor` emission.
- `mat.getParameter('name')` / `setParameter('name', ...)`.

## Math and misc
- `Vec3D`/`Vec4D` with `.x .y .z .w`; arithmetic via methods (`add`, `sub`, ...); `Math.*` is standard.
- Seeded random for repeatable variation (Math.random is not seedable):
  `var rnd = (function(){var s=12345;return function(){s=(s*16807)%2147483647;return s/2147483647;};})();`
- Light objects are `LIGHT` with `lightType` 0..4 (0 ambient, 1 area, 2 distant, 3 point, 4 spot); the constants SPOTLIGHT/POINTLIGHT do not exist.
- Script folders decide type: `Macro` (`main(doc)`), `Tool`, `Polygonobj`, `Splineobj`, `Particle`, `Tag`.
- Prefer the high-level c3d tools over scripts for single objects, materials, lights and cameras; scripts are for volume.
