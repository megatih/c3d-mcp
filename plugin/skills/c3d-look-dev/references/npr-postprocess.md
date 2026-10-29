# NPR / anime workflow

Cheetah3D has no outline, Freestyle, bloom or compositor. Build the look from in-scene choices, then finish in 2D.

## In scene
- `Toon` materials for main surfaces (flat `color`); `Material` or PBR for metals and glass accents.
- Limited palette (5-8 colours), pastel gradient background, evenly lit key plus coloured accent lights, emissive signs.
- Higher `exposure`, moderate `gamma`; shadows on, GI optional (flat even light suits anime backgrounds).

## Post-processing (`c3d_postprocess_image`)
Input is a finished render path (relative paths resolve inside `<workDir>/renders`). Output is a new PNG (never overwrites). Needs the helper app; `UNSUPPORTED` with an install hint otherwise.
| block | parameters |
|---|---|
| `bloom` | `threshold` 0..1 (0.7), `radius` px 1..256, `intensity` 0..2 |
| `outline` | `strength` 0..1, `width` 0.5..4 px, `color` [r,g,b] |
| `vignette` | `intensity` 0..1, `radius` 0..2 |
| `grade` | `saturation` 0..2, `contrast` 0.5..1.5, `exposure` -2..2, `shadow_tint`, `highlight_tint`, `tint_amount` |
| `posterize` | `levels` 2..32 |
Blocks can be combined in one call. Starting point: bloom `{threshold:0.75, radius:24, intensity:0.6}`, outline `{strength:0.5, width:1.5, color:[0.1,0.05,0.15]}`, grade `{saturation:1.15, tint_amount:0.2}`, optional posterize 8.

## Limits to report
Outlines are edge-detected on pixels: no per-object lines, thin lines on busy textures, no occlusion-correct glow. The unprocessed render shows no glow around lights. Do not claim inked outlines or true bloom; say the result is a 2D approximation.
