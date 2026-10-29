# API-correctness review: in-app runtime + server op mapping (c3d-mcp 0.1.0, Cheetah3D 8.1.3)

Scope: `bridge/runtime/*.js`, `packages/server/src/tools/*.ts`, `src/lib/*.ts`, checked against `research/02-cheetah3d-js-api.md`,
`research/08-...md` (Probe results M0 win over docs), `research/raw/param_dumps/*.json`, `research/raw/probe_PA/PB*.json`,
`vendor/c3d-scripting-kb/reference/api-index.json` and the bundled manual (`Classes/*.html`). Read-only review. I did not touch the app.
Side effects: I ran offline node snippets only (lookAt round-trip, `planChunks` fuzz) from the scratchpad. One throw-away vitest file was created
in `packages/server/test/` for a few seconds and deleted again (verified gone).

Legend: (a) definite bug with evidence, (b) likely bug / doc-vs-code mismatch, (c) unverified assumption plus the exact tiny probe.

## What I verified as correct (no action)

- ES5 purity of `bridge/runtime/*.js`: grep for `=>`, `let`, `const`, template literals, spread, `class`, `includes/startsWith/padStart/Object.assign/find`, `for..of`
  finds only strings inside `capabilities.jsFeatures()` and comment/hint text. Clean.
- look_at math (`lib/lookAt.ts`): `eulerToMatrix(30,45,60)` reproduces the P15 world-matrix rows to 1e-15
  (`[0.7392,-0.5732,0.3536 | 0.6124,0.3536,-0.7071 | 0.2803,0.7392,0.6124]`). 20 000 random (H,P,B) round-trips through `matrixToEuler`
  and back reproduce the matrix to 3e-15. Camera sample from the dump (pos 2.5,2.34,4.34 -> origin) yields (29.94,-25.04,0) versus the stored (30,-25,0);
  residual 0.066 deg. Straight up/down (gimbal) gives residual 0. Parent handling (`transpose(parentRot) * world`) is right for orthonormal parents.
- World matrix: runtime `worldMatrix()` reads 3x3 rows `m[r][c]` and translation from `m03,m13,m23`. This is consistent with P15 and the live finding, and `parseWorldMatrix` consumes `{rows,position}` correctly.
- Constants: NGONFAMILY=5 exists (probe PA), SHADERTAG=102, FOLDER=11, CAMERA=2, LIGHT=5, POLYGONOBJ=36 are used via `typeof` checks (`CAP.constant`) and never bare.
  `UVTAG/SPOTLIGHT/SKYLIGHT/SUBDIVMOD/LINEAR/...` are only referenced as names in tables, so a missing constant degrades to "absent", never ReferenceError.
  LIGHT + `lightType` instead of POINTLIGHT is right.
- `planChunks` fuzz (3000 random meshes, random chunk limits): every chunk has >=1 vertex and >=1 polygon, every index < vertices sent so far, totals match. No off-by-one.
- Mesh page logic (`page()`, `nextVertexOffset`) is correct, including offset>total and limit=0.
- Error-code mapping: all codes the runtime emits (`AMBIGUOUS, DEPENDENCY_FAILED, INTERNAL, INVALID_ARGUMENT, NOT_FOUND, SCRIPT_ERROR, UNSUPPORTED, CANCELLED, PARSE_ERROR, TIMEOUT, VERSION_SKEW, WRONG_DOCUMENT`) exist in `ERROR_CODES`. Nothing falls into the INTERNAL fallback by accident.
- Bool is written as 0/1, matching how dumps read Bool (`v: 0/1`); reads normalise with `!!v`.
- Texture is set as an absolute path string (P18); Vec params as `new Vec2D/3D/4D`; Link as the object/material itself (matches the SHADERTAG recipe).
- ASCII-escaped JSON both directions (server `asciiJson`, runtime `toJSON`), atomic request write; consistent with P05.
- Document/api signatures cross-checked against `api-index.json`: `addVertex(Boolean meshed, Vec3D)`, `addIndexPolygon(size, vindex[], uv[])`,
  `addChildAtIndex(child,index)`, `selectObject(obj,extend)`, `selectedObjects(flat)`, `addMaterial(type,name)`, `addNodeOfType(str)`,
  `addConnection(fromID,fromPara,toID,toPara)`, `FCurve.addKey/keyAtIndex/removeKeyAtIndex/removeAllKeys/update`, `Parameter.takeNodeWithName/addTakeNode`,
  `doc.render(path)`, `saveToFile(path,type)`, `SplineCore.move/line/curve/close`. Argument order and types match.

## (a) Definite bugs

### A1. `c3d_select` `restore_previous` is a no-op that clears the selection
- `tools/scene.ts` sends `restore: i.restore_previous` but the runtime `select` op (`bridge/runtime/scene.js`, `def('select'...)`) never reads `a.restore`.
  `refs` is a required array in the schema, so a "restore" call with `refs:[]` just clears the selection (`selectObject(root,false)`).
  The server also keeps no previous-selection state, so there is nothing to restore from.
- Fix: either drop the parameter, or have the tool pass the `previous` ids it received earlier as `refs`; remove `restore` from the runtime call.

### A2. `c3d_run_script` promises "trailing expression is returned in value", the runtime does not do that
- Tool description: "a trailing expression or return value is returned in value" and the `code` param says "the value of the last expression is returned".
  `bridge/runtime/exec.js` wraps the code as `return (function(){ 'use strict'; <code> }).call(undefined)`, so only an explicit `return` yields a value; a trailing expression yields `null`/`undefined`.
- Fix: correct the descriptions ("use `return x`"), or emulate completion value with an indirect eval of the body.

### A3. `c3d_assign_material` `replace_existing`: documented default and semantics differ from the runtime
- Schema/description: "Remove other material tags first (default false)". Runtime (`materials.js assign`, `a.replaceExisting !== false`) defaults to TRUE and does not remove tags: it reuses/overwrites the first
  whole-object SHADERTAG (`shadeSelection` falsy) and leaves any other material tags alone. `clean()` drops `undefined`, so the omitted argument reaches the runtime as "true".
  Net effect: calling with no flag overwrites an existing material instead of adding one, and `replace_existing:true` never removes extra tags.
- Fix: pass `replaceExisting: i.replace_existing ?? false` and either implement "remove other whole-object shader tags" or fix the wording.

### A4. `c3d_create_object` documentation example uses a non-existent parameter name
- `tools/scene.ts`: `params: ... e.g. {"sizex": 2}`. Real parameter names are case-sensitive (`sizeX/sizeY/sizeZ` in `param_dumps/objects.json` for BOX; runtime `hasOwn(tm.types,k)`), so the example returns NOT_FOUND `no parameter called sizex` in `paramErrors`.
  An LLM client will copy it. Fix the example to `{"sizeX": 2}`.

## (b) Likely bugs / mismatches

### B1. `createMesh` failure cleanup removes from the wrong parent
`geometry.js`: on failure of `fill()` it calls `S.tree(ctx).root.obj.removeChild(obj)`. If `parent` was a non-root object, the new POLYGONOBJ is a child of that parent, and removing from root does nothing (orphan
empty mesh stays in the scene). Use `parentEntry.obj.removeChild(obj)`. Same for `createSpline` (no cleanup at all after `S.create` if `core.move/curve` throws).
For the `append` path a failure leaves partially appended vertices; the server deletes the whole object afterwards (fine), but a direct runtime caller gets a half-filled mesh.

### B2. Partial-failure semantics lost for `c3d_set_render_settings`
`setRenderSettings` applies renderer + resolution, then throws `PartialResult` if any `params` entry fails. The tool uses `bridge.one(...)`, which throws on `ok:false` and discards `result`
(`applied`, new resolution). The caller sees an error although the resolution/renderer change was already applied. Use `runApply`-style handling, or return `paramErrors` instead of throwing as `createObject/createMaterial` do.
Also `c3d_render_image` / `c3d_render_sequence` call the same op via `applyResolution`: a bad `params` is impossible there (not exposed), so only the settings tool is affected.

### B3. Keyframe value normalisation breaks 3-component values on Vec4D (colors) and 2-vectors
`animation.ts normValue` turns a 3-array into `{x,y,z}` and a 4-array into `{x,y,z,w}`. For a Vec4D parameter (colors) a 3-array `[r,g,b]` becomes `{x,y,z}` and runtime `numbers()` (object branch) then builds `[x,y,z,undefined]` -> "component 3 is not a finite number".
(The array branch has the 3->4 alpha completion, the object branch does not.) Also `KeyValue` requires arrays of length 3..4, so Vec2D keys can only be sent as `{x,y}`.
Fix: in `numbers()` fill missing `w/a` with 1 for the object branch too; allow `min(2)`.

### B4. Link parameters: `{ref: <id|path|number>}` is not normalised
`ParamValue` is a generic record, so `{ref: 5}` or `{ref: "/Cam"}` reach `toNative(Link)` -> `C3D.scene.resolve(ctx, 5)` -> INVALID_ARGUMENT "object reference must be {id}...".
The tool text advertises "{ref} links". Normalise numbers/strings in the TS layer (or in `toNative`: number -> `{id}`, string -> `{path}`).

### B5. `getObject.include=['bbox']` is object-local and primitive-agnostic, but not documented
Runtime `bbox()` reads `obj.core()` vertices in local space, ignores `scale`, modifiers (`modCore`), children and the world transform. For BOX/BALL it relies on `core()` of a primitive. Callers will assume world-space AABB.
Rename to `localBbox`, or transform by `obj2WorldMatrix()`; at least document.

### B6. Session marker folder pollutes user data
`setMarker` creates a root FOLDER `__c3d_mcp_session_<uuid>` in the user's untitled documents. It is counted in `getDocumentInfo.objectCount` and `listScene.total`, is deletable via `c3d_delete_objects`, and is written into every
`saveToFile` output (checkpoints, `c3d_save_document` copies the user keeps, and exports: FBX/DAE/etc.; `fixtures/empty.jas` already contains one fixed uuid). The tool text says "hidden", but it is not hidden.
Consider excluding it in `listScene`/`objectCount`, and delete it from the copy being exported, or document it prominently in `c3d_save_document`/`c3d_export`.

### B7. `c3d_duplicate` offset documented as "World offset", applied to the local position
`position += offset * n` is applied to the `position` parameter (parent space), so for children of transformed parents the offset is not in world space. Doc fix or apply through the parent's rotation.

### B8. `c3d_list_scene` depth semantics
Schema: "Max depth below root (default 4)". Runtime: depth 0 = direct children, so `depth:0` returns one level and the default 4 returns five levels. `merge_file` relies on `depth:0` == "root children", which is correct,
but the public description is ambiguous. Clarify ("0 = direct children only"). `limit: 0` falls back to the default 500 in the runtime (`a.limit || DEFAULT`) while the schema forbids 0, so harmless.

### B9. `c3d_run_script` user code runs in strict mode
`exec.js` forces `'use strict'`. Legacy Cheetah macros that assign undeclared variables (`x = 1;`), use `arguments.callee`, `with`, or octal literals throw `ReferenceError/SyntaxError`
(reported as SCRIPT_ERROR). The tool description says only "ES5-style". Document strict-mode, or run sloppy and rely on the shadowed parameters for containment.

### B10. Look-at ignores `rotorder`, `prerot/prefrot/postrot`, and non-uniform parent scale
`applyLookAt` assumes HPB (rotorder 6) and zero pre/post-rotation, and `transpose(parentRotation)` is only the inverse for orthonormal parents. The closed-loop residual catches this and reports `warning`, so the failure is visible but the tool does not
try to fix it. Pragmatic: read `rotorder` in `getObject include parameters` and refuse (UNSUPPORTED) when it is not 6; mention in `docs/limitations.md` (currently only says parent scale/shear is ignored).

### B11. `render` extension check is case-sensitive in the runtime, lowercase-normalised in the server
Server `ext()` lowercases, so `foo.PNG` passes `checkRenderPath`; runtime regex `/\.(png|jpg|tiff)$/` rejects it with INVALID_ARGUMENT. Not harmful (rejection is the safe direction), but the error is confusing.
Normalise the extension in the TS layer, or make the regex `i`.

### B12. `c3d_render_sequence` description contradicts the runtime
Description: "The animation time is moved per frame and is NOT restored." Runtime `render` (when `time` is passed) restores `previous` in `finally`. Fix the text (it is restored after every frame).

### B13. Colour/hex tolerance: `Color` hex path vs. node param names
`COLOR_PARAM` maps toon -> `color`, dielectric -> `transColor`, pbrmetal -> `baseColor`, material -> `diffColor`; all confirmed against `camera_renderer_materials_nodes.json`. `reflMetalness/reflRoughness` also exist. No issue; noted because it is the most
common failure point and is correct.

## (c) Unverified assumptions: proposed live probes

Each probe is a few lines in a macro (run via the bridge `run` op, on a scratch document).

| # | Assumption (where) | Risk if wrong | Probe |
|---|---|---|---|
| U1 | `core.addVertex(false, v)` returns a stable index == `base+i` (`geometry.js fill`) | every mesh create throws INTERNAL after partial fill | `var o=doc.addObject(POLYGONOBJ),c=o.core();print([c.addVertex(false,new Vec3D(0,0,0)),c.addVertex(false,new Vec3D(0,0,0)),c.addVertex(false,new Vec3D(1,0,0))].join(), c.vertexCount())` Expect `0,1,2 3` (coincident vertices must not merge). |
| U2 | `addIndexPolygon(n, idx[], uv[])` accepts a JS array of `Vec2D` and a JS array of ints | uv meshes crash/ignore uvs | After U1 add 3 verts, `c.addIndexPolygon(3,[0,1,2],[new Vec2D(0,0),new Vec2D(1,0),new Vec2D(0,1)]); print(c.uvCoord(0,1).x, c.uvCoord(0,2).y, c.polygonCount())` Expect `1 1 1`. Also try without uv and read `uvCoord(0,0)` to see default/exception behaviour (getMesh's `hasUV` try/catch assumes a throw). |
| U3 | `setParameter(name, null)` clears a Link (`params.js` Link null) | silently ignored or throws | `var m=doc.addMaterial('Material','p'); var b=doc.addObject(BOX); var t=b.addTagOfType(SHADERTAG); t.setParameter('material',m); t.setParameter('material',null); print(String(t.getParameter('material')))` Expect `undefined`. |
| U4 | Bool accepts 0/1 numbers (and `true`) | Bool writes ignored | `var b=doc.addObject(BOX); b.setParameter('locked',1); print(b.getParameter('locked')); b.setParameter('locked',0); print(b.getParameter('locked')); b.setParameter('locked',true); print(b.getParameter('locked'))` |
| U5 | `selectedObjects(false)` semantic (flat=false returns only top-selected? includes root?) (`scene.js selectedEntries`) | selection reported incorrectly for groups | Create folder F with 2 boxes; `doc.selectObject(F,false)`; print `selectedObjects(false).length` and `selectedObjects(true).length`; then select a box only and repeat. |
| U6 | `doc.takeWithName(missing)` returns null/undefined/throws (not a dummy take) (`anim.js takeNamed`) | `takes add` always reports "already exists", `select/rename` never NOT_FOUND | `print(String(doc.takeWithName('__nope__')))` (wrap in try/catch and print the exception). |
| U7 | `doc.addTake(name)` returns the Take (docs say it returns the existing one when duplicated) | stale take info only; runtime ignores the return value, so low risk | `var t=doc.addTake('t1'); print(t.name, doc.takeCount()); var u=doc.addTake('t1'); print(doc.takeCount())` |
| U8 | `Material.nodeAtIndex` enumerates the root node as index 0 (`getMaterialGraph`, `connectionsOf`) and `Parameter.name()` works on `inputAtIndex/outputAtIndex` (`ioNames`) | missing root in graph / names `undefined` (UI would be unable to connect nodes) | `var m=doc.addMaterial('Material','g'); print(m.nodeCount(), m.nodeAtIndex(0).nodeType(), m.rootNode().id(), m.nodeAtIndex(0).id()); var n=m.addNodeOfType('image'); var p=n.outputAtIndex(0); print(typeof p.name, p.name(), n.inputAtIndex(0).name())` |
| U9 | `Parameter.connected()/connectedWithID()/connectedWithParameter()` return what `connectionsOf` expects | graph connections reported wrongly/unavailable | After U8: `m.addConnection(n.id(),'color',m.rootNode().id(),'diffColor')`, then loop root inputs and print `connected(), connectedWithID(), connectedWithParameter(), name()`. Check `addConnection` return value for a bad parameter name (does it return false or throw?). |
| U10 | `reparent` / `attach` with `index == childCount()` for an object that is already a child of the target parent (off-by-one after implicit detach) | out-of-range index crash/no-op when moving "to the end" within the same parent | Folder F with 3 boxes; `F.addChildAtIndex(box0, F.childCount())`; print children order; also `F.addChildAtIndex(box0, F.childCount()-1)`. |
| U11 | `FCurve.addKey` keeps keys sorted when keys are added out of order (non-replace mode; sorted input only protects the same call) (`setKeyframes`) | wrong curve order when merging with existing keys | `fc` of a Vec3 position take node: add key t=2, then t=1, then t=3; print `keyAtIndex(i).time` for i<3. |
| U12 | Interpolation constants (`LINEAR_INTERPOL=1, SOFT=0, SPLINE=2, FLAT=2, CONST=3`; note SPLINE and FLAT both 2 is suspicious) | wrong easing, `interpolationName()` always says "spline" for flat | Print the five constants; make two keys (0 -> 1 at t=0..1) with `left_type=right_type=` each constant and print `valueAtTime(0.25)` for each. Compare with linear. |
| U13 | `addCurve` absolute coordinates: `SplineCore.curve(cp1,cp2,to)` takes absolute control points (`geometry.js segment`) | bezier shapes wrong | `core.move(new Vec3D(0,0,0)); core.curve(new Vec3D(0,1,0),new Vec3D(1,1,0),new Vec3D(1,0,0)); var pts=core.cache(0)`; check the mid sample height (~0.75 if absolute, differs if relative). |
| U14 | `Tag` default for freshly created objects: the dumps show `tags: 1` for every object type, including FOLDER/CAMERA. What type is it? Does a new BOX already carry a SHADERTAG? (`assign`, `tagList`, `removeTag` indices) | `assign(replace)` may overwrite an unexpected tag; tag indices shift | `['BOX','FOLDER','CAMERA','LIGHT'].forEach(...)` create and print `tagCount()` and `tagAtIndex(i).type()` for each. |
| U15 | `doc.currentRenderer().type()` equals `CHEETAH(200)/FALCON(201)` (`capabilities.rendererName/rendererIndex`) | `setRenderSettings{renderer}` returns UNSUPPORTED | `print(doc.currentRenderer().type(), CHEETAH, FALCON, doc.rendererAtIndex(1).type())`. |
| U16 | Light `lightType` name table `{ambient:0, area:1, distant:2, point:3, spot:4}` and the `axis` param (value 1 default) meaning for the aim axis (`capabilities`, `setLight`) | spot/distant lights aimed on wrong local axis, wrong names | Create LIGHT per type, print `lightType`, then render a plane with a spot light aimed with look_at at different `axis` values (0/1/2) and compare the lit spot; `look_at` residual only checks -Z, not the real emission axis. |
| U17 | `setParameter('texture','')` clears a Texture (`toNative`, docs of `c3d_set_texture`) | cannot clear textures | On an `image` node: set a path, then set `''`, read back; also try `null`. |
| U18 | `removeMaterial(mat)` while a SHADERTAG still links it | dangling Link, possible crash on render/save | Assign mat to a box, `removeMaterial`, then `print(String(tag.getParameter('material')))` and `box.update()`. Do this on a scratch doc only. |
| U19 | `doc.createMaterial` index: `index: doc.materialCount()-1` assumes append (`createMaterial`) | wrong `index` in the result when Cheetah inserts differently | `var m=doc.addMaterial('Material','x'); print(doc.materialAtIndex(doc.materialCount()-1)===m, m.getParameter('name'))`. |
| U20 | `doc.selectObject(root,false)` as "clear selection" and `selectedObject()` then being undefined (`select` op) | selection not cleared; `{selected:true}` refs resolve to a stale object | `doc.selectObject(box,false); doc.selectObject(doc.root(),false); print(String(doc.selectedObject()), doc.selectedObjects(false).length)` (P30 already shows root-selected -> undefined, so low risk). |
| U21 | World-space `position` for root-level objects: `setTransform{space:'world'}` writes the same value as local (valid only at root) | none if root children; flagged UNSUPPORTED for nested | no probe needed. |
| U22 | Rotation-order assumption in `look_at` for nodes whose `rotorder != 6` or non-zero `prerot/postrot` | wrong aim, caught by residual | Set `rotorder` of a camera to 0 (XYZ), run look_at; confirm warning appears (closed-loop test). |
| U23 | `doc.render()` behaviour with no active camera or with a hidden Render Manager window (P08) | helper-level, not runtime | covered by P08 notes. |

## Other observations (no change required, FYI)

- `core.js execOps`: `PartialResult` ops keep `ok:false` but retain `result`, aliases of failed ops cause `DEPENDENCY_FAILED` in dependents. Consistent. The scene cache is invalidated after every `W` op, so stale-tree lookups across ops in one batch are not an issue. Within a single op (`createMesh` append, `deleteObjects`) the tree is read-only except `describe()` which invalidates.
- `deleteObjects` validates all refs before the first removal (all-or-nothing resolve), then removes sequentially; a removal failure mid-way would be partial but the only realistic failure is the API throwing, which is not observed.
- `editMesh` order of operations and validation are right (flip before delete; deletes in descending order; indices validated against the original counts). `mergeVertices` after `setVertex` and delete is fine.
- `render`: path validated for directory, extension, absolute; modal-triggering extensions blocked; seconds used throughout (`animPosition` is seconds, FPS only for frame stepping). Frame count `floor((end-start)*fps+1e-9)+1` and time `start + n/fps` are correct and inclusive.
- `getDocumentInfo.fileName`: handles both `undefined` (measured) and `null` (documented).
- `core.js` `REF_RE` batch references would also rewrite a legitimate string parameter value that looks like `$alias.path` (e.g. an object named "$cam"); extremely unlikely, mentioning for completeness.

## Top priorities

1. A1 (`select` restore) and A2/A3/A4 (description vs behaviour): cheap fixes, directly mislead LLM clients.
2. B1/B2/B3/B4: small robustness fixes in cleanup, partial failure and value normalisation.
3. Run probes U1, U2, U6, U8, U9, U11, U12, U14 first: they gate mesh creation, takes, material graphs, keyframing and tag assignment, which are the highest-traffic features resting on unverified API behaviour.
