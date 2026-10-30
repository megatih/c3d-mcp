# 10 — Verification of two external knowledge sources against Cheetah3D 8.1.3

Sources tested (both by Tonio Loewald):
* **c3d-scripting-kb** (MIT), commit `a9008bf`: official 8.1.1 help converted to Markdown, ~450 forum-derived "gotchas", patterns, linter, 17 official example scripts, forum archive.
* **Learn 3D with Cheetah 3D** (learn3d.loewald.com, BSD-2-Clause), commit `caa500d`: 4th edition, reviewed against 8.1.1; parts are marked "AI draft" / "TODO verify".

Method: names compared against the 8.1.3 app bundle (`Cheetah3D.app/.../Cheetah3Dmanual/Scripting`, `PlugIns/Scripts`); behaviour measured in the running app through the c3d-mcp bridge (macOS 27.2, Cheetah3D 8.1.3, 2026-10-30). Probe code: `packages/server/scripts/kb-verify-live.mjs` (phases api, api2, scene, render…render5), `kb-constants-live.mjs`, `matslot-limit-probe.mjs`, `winding-probe.mjs`. Raw results: `research/raw/kb-verify-8.1.3.json`, `research/raw/kb-constants-8.1.3.json`.

Status: **confirmed** (source right), **refined** (right in part / needs a caveat), **refuted** (source wrong for 8.1.3), **not tested** (do not rely on it; stays in the search corpus with its source label only). Nothing "not tested" is stated as fact in skills or tool descriptions.

## A. Official documentation and examples (KB `reference/api`, `examples/official`)
| id | claim | status | evidence |
|---|---|---|---|
| A1 | The 26 class pages list the same methods/constants as the 8.1.3 help | confirmed | name diff of every page against the bundled HTML: no difference |
| A2 | The 17 official example scripts are the ones shipped with 8.1.3 | confirmed | `diff -r` against `PlugIns/Scripts`: identical |
| A3 | Every documented constant exists | **refuted** | 233 ALL-CAPS identifiers checked; 172 exist. Documented but undefined: `SPOTLIGHT`, `DISTANTLIGHT`, `AREALIGHT`, `UVTAG`; also undefined: `SKYLIGHT`, `TONEMAPPINGTAG`, `SUBDIVMOD`, `IDENTITY` (`IDENDITY`=0 exists). `BIG_ENDIAM`/`LITTLE_ENDIA` are typos in the docs. (kb-constants-live) |
| A4 | Documented methods exist | **refined** | `Material.rib()` is documented but absent. `Object.parent()` is not documented and absent (use `owner()`). `id()`, `doc.animationTime/animationFPS/setAnimationFPS/setAnimationTime`, `Parameter.isAnimatable()` exist although undocumented (`isAnimateable` does not). K03/K13/K14 |

## B. Scripting API claims (KB gotchas/patterns, book 16.8)
| id | claim | status | evidence |
|---|---|---|---|
| B1 | Light classes: only `LIGHT` + `lightType`; SPOTLIGHT… give "Can't find variable" | confirmed | `LIGHT`=5, `ENVIRONMENTLIGHT`=89, `LIGHTFAMILY`=3; the others undefined. K01 |
| B2 | (project docs) `POINTLIGHT` does not exist | **refuted** | `POINTLIGHT`=15 exists, but `doc.addObject(POINTLIGHT)` returns an object of type 0 / family 0 without `lightType` (not a light). F02 |
| B3 | `selectedObject()` returns the root (not null) when nothing is selected | **refined** | After `selectObject(root)` it returns `undefined`. A new document starts with a non-root object selected, so "nothing selected" could not be produced. K02a/K02e |
| B4 | `doc.addObject` parents under the parent of the selected object | confirmed | selected Camera (child of root) → new object under root; selected nested object → new object under ITS parent. K02b–d. (research/08 P20 "appended under root" holds only when the selection's parent is the root) |
| B5 | `FLAT_INTERPOL`=3 | **refuted** | `SOFT`=0, `LINEAR`=1, `SPLINE`=2, `FLAT`=2, `CONST`=3 (docs/PROTOCOL.md §2.10 was right). K01 |
| B6 | File constants `READ_MODE`, `WRITE_MODE`, `SEEK_*`, `*_ENDIAN` | confirmed | 0, 1, 0/1/2, `BIG_ENDIAN`=2, `LITTLE_ENDIAN`=3 |
| B7 | PolyCore edge masks | confirmed | `SELECT`=1, `UVPOINT`=4, `UVEDGE`=8, `UVPINNED`=16, `SEAM`=64, `CREASE`=128 |
| B8 | `core.vertex(i)` returns a copy; Vec3D math returns new vectors | confirmed | K04/K05 |
| B9 | `instanceof` fails for native classes | confirmed | `new Vec3D() instanceof Vec3D` is false |
| B10 | Calling `Vec3D(...)` without `new` crashes | **refined** | In 8.1.3 it throws `TypeError: Vec3D is not a function`; no crash. (lint rule kept as error: it is still a bug) |
| B11 | `Vec4D.isEqual` threw in older versions | confirmed | Throws "Wrong number or type of arguments" even for identical vectors; Vec3D.isEqual and Vec3D.dot work. K04/F06 |
| B12 | `uvCoord()` returns a Vec4D (UV1 in x,y; UV2 in z,w) | confirmed | object with numeric x,y,z,w. K05 |
| B13 | `addIndexPolygon` with Vec4D UVs throws "Wrong elemet in uv array" | **refined** | Vec4D UV arrays are accepted in 8.1.3 (returned a polygon index). Plain arrays still throw (research/08). K05 |
| B14 | `getParameter` of a missing name throws | confirmed | "Object.getParameter() couldn't find parameter called X". `parameterInfo()` returns an array-like (no `.slice`) of `[name,type]` pairs. K06/F04 |
| B15 | `addTake` with an existing name returns that take | confirmed | K07. Defaults: 30 fps, `animationEnd` 10, `animationTime()` = `animPosition()` |
| B16 | `keyAtIndex` returns a copy | confirmed | K08 |
| B17 | `setAnimPosition` + `setParameter` does not create keys | confirmed | no take node/key created. K09 |
| B18 | Keyframe interpolation values | confirmed | CONST holds the previous value, LINEAR interpolates (F07); a new `FCurveKey` has `left_type`=`right_type`=0 (`SOFT_INTERPOL`) |
| B19 | Undo recorders usable in macros | **refined** | `recordParametersForUndo()` is callable from a macro without error; Edit > Undo still does not revert script changes (P11). K10 |
| B20 | Tools › Script › Update Menu picks up new scripts | **refuted** | The Tools › Script menu contains only the six type submenus; no update item anywhere (menu scan via Accessibility). Restart is required (P02) |
| B21 | Counter-clockwise (seen from outside) polygons have outward normals | **refuted** | quad (0,0,0)(1,0,0)(1,1,0)(0,1,0) (CCW from +Z) has `normal` (0,0,-1); `flipWinding` reverses it; a native BOX has 6/6 outward normals while a `c3d_create_mesh` cube given CCW-from-outside polygons had 0/6. Cheetah3D's front face is CLOCKWISE. **Fixed in c3d-mcp** (winding-probe: now 6/6 outward; pipes 36/36). F03 |
| B22 | `File.readInt` exists | **refuted** (in the sandbox) | not present on File instances in `c3d_run_script`; readFloat/readShort/readUInt are. F05 |
| B24 | Script-type objects are built by the `buildUI`/`buildObject` hooks | confirmed | Instantiating the official examples through Tools › Script menus (no restart): `Menger.js` → `SCRIPTPOLY` (59) with 1056 polygons, `Grassy Knoll.js` → 4500 polygons, `Sinecircle.js` and `RoundedRectangular.js` → `SCRIPTSPLINE` (60), `Particle Menger.js` → `PARTICLESCRIPT` (81); no crash. kb-hooks-live |
| B25 | `addParameterBool` without all 6 arguments crashed 7.3.3–8.0b3 | **refined** | The official `Menger.js` calls it with 4 arguments and builds fine in 8.1.3. Fewer than 4 arguments was not tried (crash risk), so the linter still errors below 4. kb-hooks-live |
| B26 | Tag scripts run `performExpression` on time changes | confirmed | `CircleExpression.js` adds a `SCRIPTTAG` (115); at animation time 1.0 the object is at (0.540, 0, 0.841) = (cos 1, 0, sin 1). `Physics.js` adds its tag without a crash. |
| B23 | More than ~16 materials per mesh fail (book 8.1.1 notes) | **refined** | 24 material (SHADERTAG) tags on one object work (box and polygon object); 30 crashed Cheetah3D (abort `__stack_chk_fail` in `-[MWMnGon buildMaterialArray::]`, crash report 2026-10-30 10:06). Cap kept at 24 and now enforced. matslot-limit-probe |

## C. Rendering, light and material claims (book chapters 4, 8–11, 14; KB)
| id | claim | status | evidence |
|---|---|---|---|
| C1 | Two renderers with different settings | confirmed | renderer 0 = Cheetah (200): `giOn`, `giType`, `rayDepth`, `antialiasingMode`, `photonMapOn`; renderer 1 = Falcon (201): `samples`=100, `totalBounces`=10, `causticsReflection`=1, `causticsRefraction`=0, `mbCamera`; both: `gamma`=1.8, `exposure`, `filmic`, `dofOn`, `threadCount`. S03 |
| C2 | Light parameters and defaults | confirmed | `lightType`=3, `axis`=1, `samples`=16, `intensity`=1, `attenuation`=2, `geometry`=0, `shadowType`=1, `shadowSoft`=0, `radius`=0.5, `photonLight`=0, `iesProfile`="none", `cutOffAngle`=30, `cutOffAttenuation`=1. S01 |
| C3 | Light type numbers | **refined** | type 4 shows a cone (spot); 0 and 2 have no falloff (uniform); 1 and 3 fall off with distance. Full mapping 0 ambient/1 area/2 distant/3 point/4 spot remains inferred. R1 |
| C4 | `shadowType`: none / raytrace / raytrace+transparency | confirmed | 0 = no shadows; 1 and 2 identical for opaque objects. R8 |
| C5 | Falcon "Shadow softness" (`shadowSoft`) softens shadows; point/spot = light size, distant = angle | confirmed | point light: 0 → hard, 5/20/60 → shadow fades; distant: max gradient 0.104 → 0.073 → 0.032 → 0.010 for 0/5/20/60. R2b |
| C6 | (project docs) `radius` softens shadows | **refuted** | `radius` 0.5/2/8 gave identical renders in Falcon. Cheetah renderer: inconclusive (render stayed black). R2b/R2c |
| C7 | Area light "Visible in camera" = `geometry` | confirmed | `geometry`=1 shows the panel (centre cell 0.061 vs 0.001). R3 |
| C8 | Camera light: off / on / auto | confirmed | `cameraLightOnOff` 0 = off, 1 = on, 2 = auto (lit only when the scene has no light). R5/R5b |
| C9 | Camera `projection` values | **refined** | 0 perspective; 2 orthographic (render identical at camera distance 14 and 28); 1 is neither (book: panorama) — unidentified. R7b |
| C10 | Camera `antialiasing*`/`resolution*` moved to the renderer | **refined** | `antialiasing` is gone from the camera; `resolutionX`=640 and `shadowsOnOff` still exist (effect untested). S02 |
| C11 | Transparent background for compositing | confirmed | `backgroundColor` alpha 0 gives PNG alpha 0 in both engines (PNG is RGBA). R6d (earlier R6/R6b tests were invalid: the floor filled the frame) |
| C12 | Emission lights neighbouring surfaces in Falcon | confirmed | floor next to an emissive box is lit (0.1 vs 0.001 black); `emisColor` is clamped to 1 (readback 5 → 1, renders identical); the Material root has `emisColor` only. (project docs said emission never illuminates: **refuted** for Falcon; Cheetah renderer untested). R4/R4b |
| C13 | Classic material defaults | confirmed | `specColor` black, `specSize` 80, `transEta` 1.5, `reflBlur` 0, `reflFresnel` off, `diffColor` 0.7 grey. S04 |
| C14 | Special material types | confirmed | `addMaterial("Glass")` → dielectric, `"Toon"` → toon, `"Shadowmat"` → root node `shadow` (parameters `color`, `whitePoint`), `"Material (PBR)"` → pbrmetal; unknown strings fall back to `material`. S04/R9 |
| C15 | Shadow-catcher material | **refined** | Ground with Shadowmat is transparent (alpha 0) over a transparent background. Shadow pixels appear with the Cheetah renderer; none were seen with Falcon in our tests. `whitePoint`/`color` changes had no effect on the render. R9/R9b/R9c |
| C16 | HDRI light (`ENVIRONMENTLIGHT`) parameters | confirmed | `image` (Oldtown.hdr), `mapping`=2, `intensity`=1, `clamp`=10, `samples`=32, `visibleInBackground`=1, `shadowType`=1. S07 (effects of `clamp`/`mapping` not tested) |
| C17 | Legacy tags exist | **refined** | constants exist (`DOFTAG`=110, `RADIOSITYTAG`=108, `HDRITAG`=109, `FOGTAG`=107, `CAUSTICTAG`=116, `RENDERTAG`=114, `SPLINETRACKINGTAG`=112, `TARGETTAG`=111); `TONEMAPPINGTAG` does not. Whether the legacy tags do anything under Falcon/8.x is untested; c3d-mcp no longer recommends them |

## D. Not tested (treat as hints, not facts)
Script-type hook details (`setParameter` rebuild loop inside `buildObject` with/without the `false` argument, `addParameterBool` with fewer than 4 arguments, `setCreatorObj`, `obj.update()` re-running `buildObject`, a parameter named `type`, Tool scripts and `recordParametersForUndo`; B24–B26 only show that the official examples work); creators hiding extra child meshes and Sweep/Boolean child order; Falcon refractive caustics (`causticsRefraction`); HDRI `clamp`/`mapping` effect; Sky Light; `transEta`=1.0 for alpha cut-outs; IK/Spline Tracking/particle/dynamics parameters and values; the exact `shadowType`/`giType`/`colliderType` enum labels beyond C4; Falcon `samples`=0 "render until stopped" (c3d-mcp refuses it as a precaution); material node recipes (Fresnel, snow, sky); Cheetah-renderer soft shadows and emission with GI. Temporary probe scripts (which would need installing into the Scripts folder and restarting the app) were not used; the official examples already installed in the menus were instantiated instead (B24–B26).

## E. What changed in c3d-mcp because of this
* `c3d_create_mesh` / `c3d_create_pipe`: polygons are converted to Cheetah3D's front-face order (outward normals); `winding:"cw"` option. (B21)
* `c3d_set_light`: `shadow_softness`, `visible_in_camera`; `c3d_set_camera`: `projection`, `camera_light`; `c3d_set_background`: kind `transparent`; `c3d_create_material`: type `Shadowmat`; render guard for Falcon `samples` <= 0; material-tag cap of 24 enforced in the bridge. (B23, C4–C9, C11, C14)
* Linter: verified constants/methods allow-list, new rules `vec4-isequal`, `many-shader-tags`, `falcon-samples-zero`, corrected `selected-object-null`, `light-constants`, `ctor-without-new` messages, `addParameter*` with 4 arguments accepted. (A3, A4, B2, B3, B10, B11, B23, B25)
* Search: per-method official descriptions, bundled examples, verified notes, the book (unreviewed passages labelled), forum archive (last); hits carry a trust level and 8.1.3 notes.
* Skills and docs: corrected cheat sheet (no `parent()`, POINTLIGHT, enums), look-dev (shadowSoft, emission, camera light, transparent background), scene-building (winding, parenting), limitations (no Update Menu, material-tag crash).
