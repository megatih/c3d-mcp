# Cornell Box Deluxe — Claude Desktop benchmark prompt

**How to use:** open a Cheetah3D with the c3d bridge installed (`c3d_doctor` green), start a new Claude Desktop chat with the c3d extension enabled, and paste everything between the two `=====` lines. It takes the agent roughly 60–120 tool calls. Close any dialogs in Cheetah3D first and do not touch it while the agent works.

**What a good result looks like** (see `reference-render.png`, produced by running this recipe through the bridge): a classic Cornell Box — red left wall, green right wall, white room lit by a ceiling area light — with colour bleeding on the white surfaces, soft shadows, a marble ball on a tall white box, a gold vase on a wood-textured box, and a chrome ball and a glass ball sitting on a black-and-white checkerboard that is visibly reflected in the chrome and refracted through the glass. A 1024×1024 final render with 600 global-illumination samples takes about 30 s.

=====

**ROLE / MISSION**
You are driving Cheetah3D 8.1.3 through the `c3d_*` MCP tools. Build the **Cornell Box Deluxe** benchmark scene described below from scratch in a **new scratch document**, then render it. Work autonomously; do not ask me questions. This is a stress test of the tool bridge: be precise, check your work after every phase, and report honestly. Do **not** attempt animation.

**HARD RULES**
1. Start with `c3d_doctor`; if anything fails, stop and tell me. Then `c3d_new_document`. Work only in that document; never open, save over or modify any other document or file.
2. Cheetah3D is **Y-up**; units are metres. Object names are NOT unique: address objects by the `id` returned when you create them (keep a name→id table in your notes).
3. Render formats are png/jpg/tiff only. **Never export OBJ** (it can crash Cheetah3D); export FBX if you export. Use `c3d_run_script` only for the vase step. **Use a new file name for every render** (e.g. `draft_v1.png`, `draft_v2.png`, `final_v1.png`): the server refuses to overwrite existing files.
4. Materials are per object here (each surface is its own object); `c3d_assign_material polygons:[…]` can also colour parts of one editable mesh. If a tool returns an error, read its `hint`, fix it and continue. If something is genuinely unsupported, say so — do not fake it.
5. Take `c3d_checkpoint` after phases 1, 2 and 3. If a call returns `BLOCKED_BY_MODAL`, tell me the dialog text and wait for me.
6. Look at every image `c3d_render_image` returns (use `include_image: true`) and judge it critically against the "expected look" in Phase 4. Draft renders take about a second; the final should stay under ~60 s — if a call times out, lower the resolution or GI samples and retry.

**PHASE 0 – Preflight.** `c3d_doctor`, `c3d_new_document`, `c3d_capabilities` (note the object, light and material types), `c3d_get_document_info`.

**PHASE 1 – Room, light, camera.**
- Create thin `BOX` slabs with `params {sizeX, sizeY, sizeZ}` (case-sensitive) and `position`: **Floor** 5×0.1×5 at y=−0.05; **Ceiling** 5×0.1×5 at y=5.05; **BackWall** 5×5×0.1 at (0,2.5,−2.55); **LeftWall** 0.1×5×5 at (−2.55,2.5,0); **RightWall** 0.1×5×5 at (2.55,2.5,0).
- Materials (type `Material`, `color` = [r,g,b,a] in 0–1): **CornellWhite** [0.725,0.71,0.68,1] → Floor, Ceiling, BackWall; **CornellRed** [0.63,0.065,0.05,1] → LeftWall; **CornellGreen** [0.14,0.45,0.091,1] → RightWall. Assign with `c3d_assign_material`.
- Lamp: `c3d_set_light` name "AreaLight", `light_type` "area", position [0,4.93,0], `look_at_point` [0,0,0], color [1,1,1,1], `intensity` 1, `params {width:1.4, height:1.4, attenuation:0}`. Add a thin BOX **LampPanel** 1.4×0.02×1.4 at (0,4.98,0) with material **LampEmissive** (`color` white, then `c3d_set_material_params params {emisColor:[1,1,1,1]}`).
- Camera: `c3d_set_camera` name "Cam", position [0,2.5,11], `look_at_point` [0,2.5,0], `fov` 36, `active` true.
- `c3d_set_render_settings` width 320, height 320, `params {giOn:false, shadowsOn:true, rayDepth:6}`; render a draft. Check: red wall on the left, green on the right, lamp visible on the ceiling, whole room in frame (including the front edge of the floor), **meanLuma 0.2–0.5** — adjust the light `intensity` until it is. Confirm the light really behaves like an area light; if not, replace it with point lights and say so. Checkpoint.

**PHASE 2 – Modelling.**
- **TallBox** BOX 1.4×3.0×1.4 at (−1.1,1.5,−1.2), heading +20° (`c3d_set_transform rotation:{x:20,y:0,z:0}` — rotation is x=heading about the vertical axis, y=pitch, z=bank), material CornellWhite. **ShortBox** BOX 1.4×1.4×1.4 at (0.9,0.7,−0.6), heading −18° (`rotation:{x:-18,y:0,z:0}`). **CheckerRug** BOX 3.6×0.02×2.2 at (−0.2,0.011,1.1).
- Spheres (`BALL`, `params {radius, sections:48, spans:32}`; check real names with `c3d_get_parameters` if rejected): **MarbleBall** r 0.5 at (−1.1,3.5,−1.2); **ChromeBall** r 0.55 at (−1.2,0.57,1.1); **GlassBall** r 0.65 at (0.9,0.67,1.3).
- **Vase (hand-built surface of revolution):** run `c3d_lint_script`, then `c3d_run_script` with exactly this code (ignore the harmless "unknown constant" warnings if any):
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
  Expect `vertices 626, polygons 672`. Then `c3d_set_transform` the returned id to position [0.9,1.4,−0.6] (so it stands on the ShortBox) and verify with `c3d_get_mesh` (counts) and `c3d_get_object` with `include:["bbox"]` (≈ 0.84 × 1.2 × 0.84). If the shading later looks inside-out, flip it with `c3d_edit_mesh` `flip_winding` over all polygon indices.
- Checkpoint. `c3d_list_scene` and report the object count per type.

**PHASE 3 – Texturing and materials.** For a procedural material: `c3d_create_material` (it returns `rootNodeId`), `c3d_add_material_node` (it returns `nodeId`), `c3d_connect_nodes` with `from_node` = nodeId, `from_output` "color", `to_node` = rootNodeId, `to_input` "diffColor", then `c3d_assign_material`; inspect with `c3d_get_material_graph`.
- **WoodMat** (type `Material`) → ShortBox: `wood` node `params {color0:[0.45,0.28,0.12,1], color1:[0.22,0.11,0.04,1]}`; the default `scale` is a good start — adjust only if the grain is unclear.
- **MarbleMat** → MarbleBall: `marble` node `{color0:[0.93,0.93,0.9,1], color1:[0.2,0.24,0.3,1]}`.
- **CheckerMat** → CheckerRug: `checkerboard` node `{color0:[0.9,0.9,0.9,1], color1:[0.06,0.06,0.06,1]}`; you want roughly 8 × 5 squares across the rug.
- **ChromeMat** → ChromeBall: type `Material (PBR)`, `color` [0.95,0.95,0.97,1], `metalness` 1, `roughness` 0.04.
- **GlassMat** → GlassBall: type `Glass`, then `c3d_set_material_params params {transEta:1.52, transAbsorption:0.02}`.
- **GoldMat** → Vase: type `Material (PBR)`, `color` [1.0,0.78,0.34,1], `metalness` 1, `roughness` 0.18, then `c3d_set_material_params params {reflClearcoat:0.6}`.
Render a draft (GI off) and check that every material reads correctly. Checkpoint.

**PHASE 4 – Rendering.**
`c3d_set_render_settings` width 320, height 320, `params {giOn:true, giSamples:150, rayDepth:8, reflectionOn:true, refractionOn:true, shadowsOn:true, antialiasingMaxSamples:2}`. Render and judge it against this **expected look**: red/green **colour bleeding** onto the white walls, floor and tall box; **soft shadows** under the boxes and spheres; the **checkerboard visibly reflected in the chrome ball and refracted (inverted) through the glass ball**; the room reflected in the gold vase; clear **wood grain** and **marble veins**; the whole room framed with the lamp visible; mean luma ≈ 0.3–0.45. Fix whatever is off (light intensity, exposure/gamma, texture scales, camera) and say what you changed. Then render the **final**: 1024×1024, `giSamples` 600 (raise up to ~1200 only if the call stays comfortably under ~60 s), `rayDepth` 10, `antialiasingMaxSamples` 4, file `final_v1.png`. Try `c3d_capture_viewport` once as well.

**PHASE 5 – QA and report.**
`c3d_list_scene` (all objects, counts by type), `c3d_get_material_graph` for WoodMat, MarbleMat and CheckerMat, `c3d_export` to `cornell_deluxe.fbx`, a final `c3d_checkpoint`. Then give me a report with: (1) the final render; (2) a table of phases, tools used, number of calls and errors; (3) a 1–5 scorecard for modelling, texturing, lighting/GI, camera/framing and render quality, one sentence each; (4) **every bug, surprising behaviour, slow call, confusing tool description or missing capability** you met in the c3d tools, each with the exact tool call that triggered it; (5) what you would change in the scene to make it better.

=====
