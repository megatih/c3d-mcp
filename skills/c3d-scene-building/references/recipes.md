# Recipes

## Lathe vase (surface of revolution via run_script)
Profile points are `[radius, height]` pairs from the bottom centre to the top centre. Run `c3d_lint_script` first; "unknown constant" warnings are harmless. Expect 626 vertices and 672 polygons with N=48 and this profile, then move the returned id with `c3d_set_transform` and check size with `c3d_get_object include:["bbox"]`.
```js
var N = 48, twoPi = Math.PI * 2;
var prof = [[0,0],[0.38,0],[0.42,0.02],[0.42,0.06],[0.2,0.12],[0.12,0.25],[0.12,0.4],[0.22,0.55],[0.36,0.72],[0.4,0.9],[0.34,1.05],[0.26,1.12],[0.28,1.18],[0.22,1.2],[0,1.2]];
var obj = doc.addObject(POLYGONOBJ);
obj.setParameter('name', 'Vase');
var core = obj.core(), rings = [], i, j, t, ring;
for (i = 0; i < prof.length; i++) {
  if (prof[i][0] === 0) { rings.push([core.addVertex(false, new Vec3D(0, prof[i][1], 0))]); continue; }
  ring = [];
  for (j = 0; j < N; j++) { t = twoPi * j / N; ring.push(core.addVertex(false, new Vec3D(prof[i][0] * Math.cos(t), prof[i][1], prof[i][0] * Math.sin(t)))); }
  rings.push(ring);
}
var nv = core.vertexCount(), polys = 0, last = prof.length - 1, j1;
function add(list) {
  for (var k = 0; k < list.length; k++) { if (list[k] < 0 || list[k] >= nv || list[k] !== Math.floor(list[k])) { throw new Error('bad index ' + list[k]); } }
  core.addIndexPolygon(list.length, list); polys++;
}
for (j = 0; j < N; j++) { j1 = (j + 1) % N; add([rings[0][0], rings[1][j], rings[1][j1]]); }
for (i = 1; i < last - 1; i++) { for (j = 0; j < N; j++) { j1 = (j + 1) % N; add([rings[i][j], rings[i + 1][j], rings[i + 1][j1], rings[i][j1]]); } }
for (j = 0; j < N; j++) { j1 = (j + 1) % N; add([rings[last][0], rings[last - 1][j1], rings[last - 1][j]]); }
obj.update();
return { id: obj.id(), vertices: nv, polygons: polys };
```
If shading looks inside-out, `c3d_edit_mesh flip_winding` over all polygon indices.

## Helper block for repeated primitives
Paste at the top of a bulk script. It reuses a folder by name, parents explicitly and assigns a material by link.
```js
function V3(x, y, z) { return new Vec3D(x, y, z); }
function findNode(parent, name) { for (var i = 0; i < parent.childCount(); i++) { var c = parent.childAtIndex(i); if (c.getParameter('name') === name) { return c; } } return null; }
function folder(name) { var f = findNode(doc.root(), name); if (f) { return f; } f = doc.addObject(FOLDER); f.setParameter('name', name); doc.root().addChildAtIndex(f, doc.root().childCount()); return f; }
function place(o, parent, m, name, pos, rot) {
  o.setParameter('name', name); o.setParameter('position', V3(pos[0], pos[1], pos[2]));
  if (rot) { o.setParameter('rotation', V3(rot[0], rot[1], rot[2])); }
  if (m) { o.addTagOfType(SHADERTAG).setParameter('material', m); }
  parent.addChildAtIndex(o, parent.childCount());
  return o;
}
function box(parent, name, size, pos, m, rot) {
  var o = doc.addObject(BOX); o.setParameter('sizeX', size[0]); o.setParameter('sizeY', size[1]); o.setParameter('sizeZ', size[2]);
  return place(o, parent, m, name, pos, rot);
}
// seeded RNG: var rnd = (function(){var s=12345;return function(){s=(s*16807)%2147483647;return s/2147483647;};})();
```

## Planks, paving, panels
Loop `box()` with seeded variation so nothing looks like a uniform grid: vary size per item, offset by 0.02-0.04 m proud of the surface, leave dark seam gaps, tint per item by choosing from a small list of materials. A run built about 140 paving slabs and 120 facade panels this way in a few script calls. End the script with `return {count: n}` and confirm with `c3d_get_scene_stats`.

## Pipe and cable runs
- Straight or bent pipe: one `c3d_create_pipe` with the corner points and `bend_radius`; assign the material through its `material` argument.
- Pipes must connect to something: end points on walls or equipment, no floating runs.
- Sagging cable: sample a catenary or parabola into 10-20 points and pass them to `c3d_create_pipe` with a small `radius` and `segments:6..8`, rather than chaining cylinders.
- Rooftop duct elbows: use `c3d_create_pipe` instead of TORUS.
- Bundles: loop in a script, or call the tool once per pipe with offset points.

## Folder organisation
Create numbered root folders up front (`01_MAIN_ARCHITECTURE`, `02_ROOFS`, ..., `12_LIGHTS`, `13_CAMERAS`), store their ids, and pass `parent:<folderId>` on every creation. Check with `c3d_list_scene root:<folderId> depth:1` and `c3d_get_scene_stats root:<folderId>` for per-folder counts.

## Phase-based render workflow
1. Draft render at 320x320 or smaller, GI off (`c3d_set_render_settings params {giOn:false, shadowsOn:true, rayDepth:6}`); check framing and luma.
2. Fix lights/camera, `c3d_checkpoint label:"phase-1"`.
3. Final: raise width/height, `giOn:true`, `giSamples` 150 for review then 600 for final, `rayDepth` 8-10, `antialiasingMaxSamples` 2-4, a new filename each time. Reflections and refractions need `reflectionOn` and `refractionOn`.
4. Compare with the reference or brief, list the biggest differences, fix, repeat. Do not declare done while the render is visibly less detailed than the target.
5. Missing renderer features (outlines, bloom, gradient backdrops) come from `c3d_postprocess_image` and `c3d_set_background`, not from material tricks.
