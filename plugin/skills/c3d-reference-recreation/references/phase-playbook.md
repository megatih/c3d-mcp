# Phase playbook

Reusable condensation of the two benchmark prompts (Cornell Box Deluxe: ~60-120 calls; Cyberpunk Diorama: ~170 calls, 1,100 objects, 29 renders). Adapt sizes to the reference; the structure is what transfers.

## Shared hard rules
1. `c3d_doctor` first, then `c3d_new_document`. Work only there.
2. Y-up, metres, ids not names, new filename per render, FBX not OBJ.
3. Look at every render; list differences; fix; then checkpoint and write STATE.
4. If a tool errors, read its `hint`, fix, continue. If truly unsupported, say so and move on.

## P0 Preflight, camera, plot, background
- `c3d_doctor`, `c3d_new_document`, `c3d_capabilities`, `c3d_get_document_info`.
- Create the folder set. Create the ground/plot slab and a ground material.
- Camera: `c3d_set_camera` with `position`, `look_at_point`, `fov`, `active:true`. To place the subject in one half of the frame, aim at a point offset to the other side. Typical elevated three-quarter view: fov ~28, position ~ (12,16,19), aim near the subject's centre. Iterate until the framing matches the reference.
- Resolution: half the reference size for drafts (`c3d_set_render_settings width/height`, `giOn:false`).
- Background: `c3d_set_background` solid or gradient (stops from the reference's top and bottom colours).
- Neutral placeholder light (distant + ambient, `attenuation:0`) so drafts are readable. Draft render; compare composition only.

## P1 Volumes (blocking)
- Simple BOXes in one flat material for each major volume (ground floor, mid level, upper volumes, projecting enclosures, roof slabs 0.15 m thick with ~0.3 m overhang).
- Compare silhouette, height-to-width ratio, offsets and projections. Corrections happen now.
- Cornell variant: five thin slabs (floor, ceiling, back, left, right wall), coloured materials, area light, camera, lamp panel with `emisColor`.

## P2 Structure and panels
- Real wall thickness; openings built from frame boxes around the hole (no booleans); recesses; balcony landing; seams.
- Facade panels by script: many slabs of different sizes (tall/narrow, wide, small covers, recessed, raised), 0.02-0.04 m proud, dark gaps, seeded variation (`s=(s*16807)%2147483647`). No uniform grid.

## P3 Features
- Windows with mullions, doors with frames/handles, louvred shutters (loop of thin slabs), slanted awnings, corrugated canopies from individual planks with width/length/colour variation, stairs + landing + railings, wall lamps.

## P4 Mechanical
- Fans (housing, ring, hub, blades in a loop, grille), AC units, cabinets, vents, ducts, pipe bundles with brackets, cables as `c3d_create_pipe` runs or chains of short cylinders with sag and clamps, dishes and antennas.
- Every pipe connects to something; no floating runs.

## P5 Environment and props
- 100-150 paving slabs with varied size, height, tint; drain grate, doormat, table, bench, pots with flower clusters, bins, crates, signage. Keep the plot compact.
- Cornell variant (modelling): tall and short boxes with heading rotation, spheres, a hand-built surface of revolution (vase) via `c3d_run_script` with `core.addVertex` / `core.addIndexPolygon`; verify with `c3d_get_mesh` counts and `c3d_get_object include:["bbox"]`; if shading looks inside-out, `c3d_edit_mesh` `flip_winding`.

## P6 Materials
- Small set of families: painted metal, dark industrial metal, housings, wood/awning, glass + lit windows, neon (`emisColor`), concrete, foliage. Give hero families layered variation with node graphs; per-object tint variation through script. Weather only where plausible (under ledges, near doors).
- Cornell variant: wood/marble/checker node graphs into `diffColor`; chrome = `Material (PBR)` metalness 1, roughness 0.04; glass = type `Glass` with `transEta` 1.52; gold PBR with `reflClearcoat`.
- Draft render, compare colour and surface richness.

## P7 Lighting, final, delivery
- Soft ambient + gentle key; warm point lights at shopfronts and doors; coloured accent lights at neon; violet fill. `c3d_set_light`; tune from `meanLuma` and the picture.
- Renderer: `giOn:true`, `giSamples` as high as keeps the final <= ~90 s, `rayDepth` 8, AA 3-4, adjust `exposure`/`gamma`.
- Final at the reference resolution (`final_v1.png`), compare, fix, `final_v2.png` if needed. Cornell reference: 1024x1024, 600 GI samples, about 30 s.
- `c3d_list_scene`, final `c3d_checkpoint`, `c3d_export` FBX. Optional `c3d_postprocess_image`.

## Expected-look checks (Cornell)
Colour bleeding from red/green walls, soft shadows, checker reflected in chrome and refracted (inverted) in glass, visible wood grain and marble veins, whole room in frame, meanLuma ~0.3-0.45.

## STATE block template
```
STATE after Pn: folders {name:count,...}; materials [...]; camera id/name; lights [...];
checkpoint cpN "label"; id table: key objects name->id; open issues: ...
```
