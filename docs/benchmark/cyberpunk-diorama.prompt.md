# Cyberpunk Diorama — c3d-mcp port of the "Astra vs Opus 5.5 / Blender MCP" test

Ported from the Blender MCP challenge prompt in Muska's video [GPT-6 Astra vs Claude Opus 5.5 – Cyberpunk Anime-Style 3D Modeling Challenge Timelapse](https://www.youtube.com/watch?v=SQs27US4FeI) and its document. **Reference image:** the building picture from that video/document (16:9, 1456×816 in our run; the document's text says "square", but the actual image is 16:9, so this port matches the image). It is third-party material and is not included in this repository: take a screenshot or extract it from the document and save it as `docs/benchmark/cyberpunk/reference.png` (the headless runner `packages/server/scripts/cyberpunk-run.mjs` reads it from there or from `C3D_CYBERPUNK_REFERENCE`). Our own result is `docs/benchmark/cyberpunk/cheetah-opus-final.png`.

**Claude Desktop:** attach `reference.png` to the chat, then paste everything from `=====MISSION=====` to the end of this file. **Headless runner:** the text before the first `## PHASE` is the mission, each `## PHASE Pn` block is sent as one resumable turn.

## What was intentionally NOT ported (Blender-only or not possible through c3d)
| Blender prompt | Here |
|---|---|
| OBS full-screen recording, viewport cinematography, idle/occlusion rules, local view, hide/isolate | dropped — c3d has no viewport tools |
| Collections 01–14 | `FOLDER` objects with the same names |
| Bevel modifier | `bevelRadius`/`bevelSections` on `BOX`/`CYLINDER` |
| Freestyle / inverted-hull outlines, EEVEE, compositor, bloom, passes, Cryptomatte | **not available** — the agent must say so, not fake them. Style is carried by the `Toon` material, a limited palette, emissive neon + coloured light spill, and the renderer's `exposure/gamma/filmic` |
| `.blend`, compositor tree | `.jas` via `c3d_save_document`, FBX via `c3d_export`, `c3d_checkpoint` |

=====MISSION=====

**ROLE.** You are an expert environment artist and technical modeller driving Cheetah3D 8.1.3 through the `c3d_*` MCP tools. Reproduce the attached **reference image** (a compact, three-level cyberpunk Japanese building on a small paved corner plot, anime-background look) as faithfully as the tools allow, in a **new scratch document**. The reference image is the single authority for composition, proportions, colours and details; this text only helps you start. Work autonomously, in phases, and judge your own renders critically against the reference after every phase. Do **not** animate. Do **not** ask me questions.

**HARD RULES (learned from real use of this bridge)**
1. `c3d_doctor` first; if it fails, stop and tell me. Then `c3d_new_document`; work only in that document. Never touch other documents/files. Never export OBJ (can crash Cheetah3D) — FBX only.
2. Y-up, metres. Names are NOT unique: address objects by `id`. In scripts, **`doc.addObject` puts the new object under the parent of the currently selected object**, so parent every new object explicitly (`parent.addChildAtIndex(obj, parent.childCount())`, as the helper block below does). A script that throws **keeps the geometry it already created** — after any script error run `c3d_list_scene` and clean up or restore the last checkpoint.
3. **Use a new file name for every render** (`draft_p1_v1.png`, …); the server never overwrites. Use `include_image:true` and look at every image. Drafts: 728×408, GI off. Final: 1456×816 (the reference size) with GI; keep any single render ≲ 60–90 s.
4. `c3d_run_script` is for bulk/parametric geometry (planks, pipes, fan blades, paving stones, railings, vents, flowers); keep each script ≲ 8 000 characters, ES5 only (`var`, `function`), end with an explicit `return {...}` summary (counts), and `c3d_lint_script` it first. No `OS`, no `File`.
5. Different materials on one mesh work via `c3d_assign_material polygons:[…]` (or per object); in scripts use one SHADERTAG per object unless you set polygon selections yourself. Avoid coplanar overlapping faces (z-fighting): offset proud details by ≥ 0.01 m.
6. `c3d_checkpoint` at the end of every phase. On `BLOCKED_BY_MODAL` tell me the dialog text and wait. If a tool errors, read the `hint`, fix, continue; if something is truly unsupported, say so.
7. **Never call `doc.removeMaterial` (or create-and-delete probe materials/objects) in scripts** — removing a material in the same script run that created it crashes Cheetah3D 8.1.3 at idle (the bridge now refuses it). To learn what a node type offers, add it to a material you actually keep, or read `c3d_get_material_graph`; leave unused materials in place.
8. At the end of every phase write a **STATE** block (≤ 12 lines: folders and object counts, material names, camera, lights, checkpoint id, open issues) so the work can continue in a fresh session.

**WHAT THE REFERENCE SHOWS (read from the image — correct me against the image, not the other way round)**
- *View:* elevated about 28–32° looking down, three-quarter view: the long **storefront facade faces the viewer's left-front**, the **stair side faces right-front**. 16:9 frame; the building sits in the **right half**, its base centred around 62 % of the width and the roof close to the top edge; the left half is empty background. Background: flat lavender-violet gradient (≈ violet top (0.48,0.32,0.66) to pinkish lavender bottom (0.70,0.47,0.74)); set it with `c3d_set_camera params {backgroundColor:[0.55,0.38,0.72,1]}`.
- *Ground:* a small square corner plot of irregular paving slabs (lavender-grey/beige), diamond-shaped in view, about 9 × 9 m, with a dark drain grate, a small orange doormat and scuffed slabs.
- *Ground floor (≈ 3 m):* left shopfront with a dark-framed window with wooden mullions glowing orange inside, under a **slanted red-orange awning**; centre: a dark metal entrance with an orange-lit door under a small **corrugated blue-slate awning**, wall lamps; right: a grey door with a lit window, a grey utility cabinet, a lavender block at the corner, and **stone steps with a railing** up to a small landing; pots of **pink/purple flowers**, a round café table + wooden bench (left front), a pink bin/box, small crates.
- *Mid level (≈ 3 m):* lavender wall panels with visible seams; a **central upper door** (grey-blue, orange-lit) with a small **metal balcony/landing and railing**, a white **air-conditioner** to its left, an octagonal housing with a **round fan** to its right; a **slate-blue metal canopy roof** (individual planks/ribs) projecting forward over the ground-floor entrance.
- *Upper level:* **upper-left volume** with a **louvred shutter lit magenta**, a **tall orange vertical sign** hanging on the left edge (orange panel with white slots) and a **white/violet maze-pattern sign** below it, satellite dishes and antennas at the left roof corner; **large upper-right enclosure**: a big lavender box projecting to the right (and hanging lower than the left volume) with seams, round vent holes, a small orange lamp on its right edge, a grille near the top; below it a bundle of vertical pipes, an **orange fan/AC box** and dark equipment boxes.
- *Roofs:* flat dark violet/indigo roof slabs with thin overhang, vents, ducts and pipe elbows (top right), cables running off to the upper left.
- *Palette:* lavender walls lit (0.64,0.56,0.92), shaded (0.50,0.42,0.78); dark slate/indigo metal (0.22,0.20,0.38); orange (1.0,0.60,0.10); magenta neon (0.90,0.25,0.85); awning red-orange (0.90,0.35,0.20); wood (0.60,0.35,0.15); flowers (0.80,0.40,0.85) on green (0.30,0.50,0.30); paving (0.55,0.50,0.55). Warm orange/pink light against cool lavender is the identity — do not drift to generic blue cyberpunk.

**BLOCKING SIZES TO START FROM (metres; storefront facade faces +Z, stair side faces +X; adjust against the reference)**
Plot 9×0.15×9 centred at (0,−0.075,0). Ground floor x −2.8…2.8, z −2.2…2.2, y 0…3.0. Mid level x −2.6…2.6, z −2.2…1.6, y 3.0…6.2. Upper-left x −2.8…0.2, z −2.0…1.8, y 6.2…8.8. Upper-right enclosure x 0.2…3.6, z −2.2…2.0, y 5.0…9.2. Roof slabs 0.15 thick, 0.3 overhang. Stair landing on the +X side, steps up to y ≈ 1.0.
Camera start: target a point about 6 m to the *left* of the building so it lands in the right half, e.g. look_at (−1.5,4.6,0), position ≈ (12,16,19) with `fov` ≈ 28; iterate until the framing matches the reference.

**HELPER BLOCK — paste at the top of every script (verified on this bridge)**
```js
function V3(x, y, z) { return new Vec3D(x, y, z); }
function C4(c) { return new Vec4D(c[0], c[1], c[2], c.length > 3 ? c[3] : 1); }
function findMat(name) { for (var i = 0; i < doc.materialCount(); i++) { var m = doc.materialAtIndex(i); if (m.getParameter('name') === name) { return m; } } return null; }
function mat(name, kind, rgb, emis) {
  var m = findMat(name); if (m) { return m; }
  m = doc.addMaterial(kind, name); var r = m.rootNode();
  r.setParameter(kind === 'Toon' ? 'color' : (kind === 'Material (PBR)' ? 'baseColor' : 'diffColor'), C4(rgb));
  if (emis && kind !== 'Toon') { r.setParameter('emisColor', C4(emis)); }
  return m;
}
function findNode(parent, name) { for (var i = 0; i < parent.childCount(); i++) { var c = parent.childAtIndex(i); if (c.getParameter('name') === name) { return c; } } return null; }
function folder(name) { var f = findNode(doc.root(), name); if (f) { return f; } f = doc.addObject(FOLDER); f.setParameter('name', name); doc.root().addChildAtIndex(f, doc.root().childCount()); return f; }
function place(o, parent, m, name, pos, rot) {
  o.setParameter('name', name); o.setParameter('position', V3(pos[0], pos[1], pos[2]));
  if (rot) { o.setParameter('rotation', V3(rot[0], rot[1], rot[2])); }
  if (m) { o.addTagOfType(SHADERTAG).setParameter('material', m); }
  parent.addChildAtIndex(o, parent.childCount());
  return o;
}
function box(parent, name, size, pos, m, rot, bevel) {
  var o = doc.addObject(BOX); o.setParameter('sizeX', size[0]); o.setParameter('sizeY', size[1]); o.setParameter('sizeZ', size[2]);
  if (bevel) { o.setParameter('bevelRadius', bevel); o.setParameter('bevelSections', 2); }
  return place(o, parent, m, name, pos, rot);
}
function cyl(parent, name, radius, height, pos, m, rot, sections) {
  var o = doc.addObject(CYLINDER); o.setParameter('radius', radius); o.setParameter('height', height);
  if (sections) { o.setParameter('sectionsRadius', sections); }
  return place(o, parent, m, name, pos, rot);
}
// seeded RNG for controlled variation:  var rnd = (function(){var s=12345;return function(){s=(s*16807)%2147483647;return s/2147483647;};})();
```
Other primitives you can create the same way: `BALL` (`radius`), `TORUS` (`radiusRing`, `radiusTube`), `CONE`, `PLANE`, `TUBE`; cylinders stand along Y — rotate with `rot` (e.g. `[0,0,90]` lays one along X). Create the folders `01_MAIN_ARCHITECTURE … 12_LIGHTS, 13_CAMERAS` from the original spec as you need them.

**PIPELINE**: build in phases P0–P7 below. After each phase: `c3d_render_image` draft → **look at it next to the reference** → list the 5 biggest differences → fix them → only then continue (these are checkpoints A–F of the original brief). Never declare a phase done while the render is visibly less sophisticated than the reference.

## PHASE P0 — preflight, camera, plot, background
`c3d_doctor`, `c3d_new_document`, `c3d_capabilities`. Create folders. Plot slab + a ground material. Camera "FinalCam" (see sizes), `backgroundColor`, 728×408. Neutral placeholder light so the draft is readable (distant light + ambient, `attenuation:0`). Draft render, compare composition (where the building will stand in the frame). Checkpoint. STATE.

## PHASE P1 — blocking (checkpoint A)
Blocking volumes as simple `BOX`es in flat lavender (one `Toon` material). Corrections of width/height/depth/offsets/projections happen **now**, not later. Compare silhouette, height-to-width ratio, position of the upper-right enclosure, roof heights. Checkpoint. STATE.

## PHASE P2 — structure and panels (checkpoint B, part 1)
Real wall thickness, door/window openings built from frame boxes around the openings (no booleans), recesses, balcony landing, the projecting upper-right enclosure with seams. Facade panels via script: many slabs with **different sizes** (tall/narrow, wide, small utility covers, recessed, slightly raised), 0.02–0.04 m proud, dark seam gaps, seeded variation in tint — no uniform grid. Fasteners only where visible. Checkpoint. STATE.

## PHASE P3 — storefronts, entrances, canopies, stairs (checkpoint B, part 2)
Window with mullions, doors with frames/panels/handles, shutters (louvres as a loop of thin slabs), slanted red-orange awning, corrugated slate awning, the central metal canopy built from individual planks/ribs with controlled variation in width/length/thickness/colour, stair steps + landing + railings, wall lamps. Checkpoint. STATE.

## PHASE P4 — mechanical equipment and cables (checkpoint C)
Round fan units (housing, ring, hub, blades in a loop, grille), AC units, utility cabinets, vents, rooftop ducts with `TORUS` elbows, vertical pipe bundles with brackets, thin cables as chains of short thin cylinders with believable sag and clamps, satellite dishes and antennas on the upper-left roof, the orange fan box. Pipes must connect to something — no floating runs. Checkpoint. STATE.

## PHASE P5 — environment details
~100–150 paving slabs with varied size/height/tint and a few chipped ones, drain grate, doormat, round table, bench, pots with flower clusters (small spheres/cones on green stems), pink bin, crates, signage (orange vertical sign with white slots; white/violet maze sign built from inset slabs). Keep the plot compact. Checkpoint. STATE.

## PHASE P6 — materials and style (checkpoint D)
Use a small set of well-designed families: lavender painted metal (`Toon` with a lit/shaded pair), dark industrial metal, painted housings, wood/awning, glass + warm lit windows, neon (`Material` with `emisColor`), concrete/paving, flowers/leaves. Give each hero family **layered variation**: build node graphs with `c3d_add_material_node` (`noise`, `voronoi`, `marble`, `brick`, `wood`, `mix`) connected to the colour input (`c3d_connect_nodes`, `from_output:"color"`, `to_input` = `diffColor`/`baseColor`/`color` — check with `c3d_get_material_graph` and say which inputs the Toon root accepts). Per-object colour variation through script. Weathering only where plausible (under ledges, near doors/corners). Draft render, compare colour and surface richness with the reference. Checkpoint. STATE.

## PHASE P7 — lighting, final render, delivery (checkpoints E–F)
Lights: soft lavender ambient + a gentle distant key from upper-left; warm orange point lights at the shopfront, central door and the upper door; a magenta light by the shutter; a violet fill; small spill from signs. `c3d_set_light` (`light_type` point/area/distant/ambient; `params {attenuation:0}` or raise intensity) — tune from `meanLuma` and the image. Renderer: `giOn:true`, `giSamples` as high as keeps the final ≲ 90 s, `rayDepth` 8, `antialiasingMaxSamples` 3–4, tune `exposure/gamma`. Render the **final 1456×816 as `final_v1.png`**, compare with the reference, fix, re-render as `final_v2.png` if needed. `c3d_list_scene` (counts by folder), `c3d_save_document` is NOT needed — `c3d_checkpoint` + `c3d_export` FBX `cyberpunk_diorama.fbx`.

**FINAL REPORT** (after P7): (1) the final render; (2) a table of phases, tools used, number of calls and errors, objects/polygons; (3) a checklist of the **20 features** (lavender seamed panels; magenta shutter; tall orange sign; violet maze sign; small upper entrance; metal landing + railings; central metal canopy with planks; ground-floor shopfront; central orange entrance; right entrance with steps; large upper-right enclosure; round vents/fans; pipes/ducts/cables/brackets; rooftop vents/antennas/dishes; AC units; small boxes/switches/conduits; paving stones; tables/seating/containers; flower pots; warm lights) marked present / partial / missing; (4) a 1–5 scorecard for silhouette & proportions, composition/camera, materials, lighting/colour, detail density, anime look (and one sentence on what the missing outline/bloom/compositor cost you); (5) **every bug, surprising behaviour, slow call, confusing tool description or missing capability** you hit in the c3d tools with the exact call that triggered it.
