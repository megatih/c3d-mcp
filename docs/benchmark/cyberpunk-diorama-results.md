# Cyberpunk Diorama — Cheetah3D + c3d MCP + Claude Opus 5.5 vs the Blender MCP / Opus result

Date: 2026-10-29. Prompt: `docs/benchmark/cyberpunk-diorama.prompt.md` (port of `Cyberpunk_Diorama_Astra_vs_Opus_Styled.docx`). Run: headless `claude -p --model claude-opus-5-5` against the real c3d MCP server and the real Cheetah3D 8.1.3, one resumable session, phases P0–P7 (not the Claude Desktop GUI, which cannot be driven from here). Reference image = the one at the top of page 2 of the Word file; it is **16:9 (1456×816)**, not square as the document's text says, so the run matched the real image.

| | |
|---|---|
| ![montage](cyberpunk/montage.png) | Left to right: reference · Blender MCP / Opus 5.5 (right-hand building of the Word file's page-1 thumbnail) · **Cheetah3D + c3d MCP / Opus 5.5** (`cyberpunk/cheetah-opus-final.png`, 1456×816). Full frames: `cyberpunk/montage-fullframe.png`. |

## What the run did
| Phase | c3d calls | Errors | Renders | Minutes | Notes |
|---|---|---|---|---|---|
| P0 camera/plot/background | 44 | 6* | 9 | 3.3 | *3 `keep_world` refusals + 3 harness memory-write attempts (not c3d) |
| P1 blocking | 12 | 0 | 3 | 3.5 | 20 lavender boxes, silhouette matched |
| P2 structure/panels | 11 | 0 | 3 | 4.8 | walls with openings, irregular panels |
| P3 storefronts/canopy/stairs | 10 | 0 | 3 | 3.5 | awning slope fixed after seeing a render |
| P4 mechanical/cables | 13 | 0 | 2 | 5.6 | fans, AC, pipes, dishes, cables |
| P5 environment/signs | 10 | 0 | 2 | 3.0 | 141 paving slabs, props, plants, signs |
| P6 materials (**Cheetah3D crashed once here; redone from the P5 checkpoint**) | 14 + 22 | 2 + 0 | 1 + 2 | 1.9 (redo) | layered Toon/node materials |
| P7 lighting/final/export | 45 | 0 | 4 | 3.0 | 10 lights, GI, final 1456×816, FBX |
| **Total** | **167 (+14 lost to the crash)** | | 29 | ≈ 29 + crash recovery | API-equivalent cost reported by the CLI ≈ US$9.7 (covered by the subscription) |

Final scene (verified by me, not taken from the agent's report): **1,101 objects, 67 materials**, 13 named folders with exactly the counts the agent reported (architecture 15, roofs 17, facade panels 122, windows/doors 75, awnings/canopies 64, signs 32, pipes/cables 142, machines 77, railings/stairs 49, ground 155, props/plants 318, lights 18, cameras 1). I opened a copy of the final checkpoint in Cheetah3D and **re-rendered it at 1456×816 in 2.4 s** (GI on); output matches the agent's final. Delivered: `final_v2.png`, checkpoint `P7-final-delivered.jas`, `cyberpunk_diorama.fbx` (13 MB) — all under `evals/results/cyberpunk-main/work/`.

## Comparison with the reference and with the Blender MCP / Opus result
(Scores 1–5 are my own judgement from the images above; the Blender image is a post-processed promotional thumbnail with a dark vignette, bloom and a reflective floor, so it is not a like-for-like render.)

| Criterion | Cheetah3D + c3d | Blender MCP / Opus | Comment |
|---|---|---|---|
| Silhouette & proportions vs reference | 4 | 4 | Both reproduce the stacked three-level masses and the big projecting upper-right box. Cheetah's enclosure side face is too wide/bright |
| Composition / camera | **5** | 3 | Cheetah matches the reference framing, 16:9 aspect and plain lavender backdrop (building in the right half); Blender shows a dark, centred, vignetted presentation |
| Architectural features (20-item list) | 14 present · 6 partial · 0 missing | similar | Partial: upper-right enclosure shape, thin conduits/switches, density of pipe bundles, rooftop clutter, warm light spill/glow |
| Detail density & weathering | 3 | 4 | Blender result has finer grilles, gauges, pipe runs, dirt; Cheetah is clean and geometric |
| Materials / surface richness | 3 | 4 | Cheetah: flat Toon-style colours with node variation; Blender: painterly gradients and grime |
| Lighting & atmosphere | 3 | 4 | Cheetah: even pastel light, orange/magenta accents but no glow halos; colour is bluer than the reference (mean RGB 139/104/172 vs 140/91/146) |
| Anime / NPR look | 2 | 3 | Neither has convincing inked outlines; Cheetah has no outline/bloom/compositor at all (reported as missing) |
| Fidelity to the *reference image itself* | **4** | 3 | Cheetah stays closer to the supplied reference (colours, background, framing); Blender drifts toward a darker, moodier look |

Palette note (quantised colour bins, building region): reference dominated by pinks/mauves/lavender with a warm cast; Cheetah by lavender/indigo (cooler); Blender by deep violet with near-black. The warm orange/pink identity of the reference is present in Cheetah only through the lit windows, doors and signs.

**Bottom line:** the c3d bridge was able to drive a 1,100-object, multi-phase environment build to a recognisably faithful reproduction of the reference in about half an hour of agent time, with fast renders (seconds), and one app crash. It does not reach the Blender result's finish, mainly because of missing renderer features (outlines, bloom, compositing, gradient backdrop) and a clean-but-flat material/lighting treatment, not because of modelling capacity.

## Tool defects / limitations found (with status)
| # | Finding | Status |
|---|---|---|
| 1 | **Cheetah3D crashed** (EXC_BAD_ACCESS in `objc_release` at idle) right after a probe script that created a material with 6 nodes and called `doc.removeMaterial`; all windows were lost | root cause isolated later: removing a material in the same script run that created it (guarded since 0.1.2); lint rule `remove-material` (warn) + prompt rule added; recorded in `research/08` (crash #2) |
| 2 | `c3d_set_light` + `look_at` for **distant lights** aimed the light the wrong way; residual check reported 0° | open: lights have an `axis` parameter (default 1) that the aim math ignores; my probe of axis values was inconclusive. Workaround: set rotation by hand and verify with a render |
| 3 | `c3d_reparent keep_world:true` into a folder → UNSUPPORTED, not mentioned in the tool description | fixed (description) |
| 4 | **Rotation components are HPB: `x`=heading (yaw about vertical Y), `y`=pitch, `z`=bank**; undocumented, agent and I both mis-assumed `y`=yaw (the first Cornell prompt tilted its boxes) | fixed (tool descriptions); Cornell prompt corrected and reference render regenerated |
| 5 | **Checkpoint registry lost after a server restart** (list empty, ids restarted at cp1, collisions) | fixed: checkpoints are also read from disk, ids continue; test added |
| 6 | `c3d_restore_checkpoint confirm:true` kept returning CONFIRMATION_REQUIRED in a headless run | root cause was my earlier security hardening (elicitation-capable clients ignore the flag); fixed with opt-in `C3D_MCP_AUTO_CONFIRM=1` for unattended runs (default off, documented, tested); the four confirmation evals re-run green |
| 7 | `doc.addObject` in scripts creates the object under the parent of the *selected* object (nested objects into folders); a script that throws keeps partial geometry | documented in the `c3d_run_script` description and the prompt; helper block parents explicitly |
| 8 | Toon material root accepts only `color` (its ramp can't be set); TORUS has no sweep angle; BACKGROUND/camera background are flat or image only (no gradient); no polygon/vertex statistics tool; no outlines/bloom/compositor | open limitations (recorded; stats tool is a candidate feature) |

## Verdict on the test itself
The converted prompt works as a repeatable benchmark: the agent followed the phase structure, compared each draft with the reference, self-corrected (camera, awning slope, neon saturation, exposure), recovered from a real crash using checkpoints, and produced a delivery set. It also surfaced two genuine product defects (checkpoint registry, headless confirmation) and one documentation gap (rotation convention) that the earlier test suites had missed.
