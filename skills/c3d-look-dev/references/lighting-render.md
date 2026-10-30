# Lighting, camera and render budget

## Lights (`c3d_set_light`)
- Types: 0 ambient, 1 area, 2 distant, 3 point, 4 spot. Pass the integer or a name from `c3d_capabilities` lightTypes.
- A new light casts along local -Y until aimed. `look_at_point` / `look_at_ref` switches the `axis` option to -Z and aims; the result reports the residual angle. Lights carry no other verified forward axis; if aiming looks wrong try `c3d_look_at` with `forward:"+z"`.
- Inverse-square default (`params.attenuation` = 2): a light 5 m away needs intensity ~25. Set `params {attenuation:0}` for constant brightness (typical for ceiling area lights in a closed room, intensity ~1).
- Area light: `params {width, height, attenuation}`; position slightly inside the ceiling and aim at the room centre. `visible_in_camera:true` (parameter `geometry`) shows the lamp panel itself to the camera; alternatively add a thin emissive panel mesh (in Falcon an emissive surface also lights its surroundings).
- Soft shadows (Falcon renderer): `shadow_softness` (parameter `shadowSoft`, 0 = hard): for point/spot lights it is the light size, for distant lights an angle; large values (5+ units at 5 m) make shadows fade away. The `radius` parameter does NOT soften shadows. Measured in 8.1.3.
- Light types 0 ambient / 1 area / 2 distant / 3 point / 4 spot are inferred (measured: 4 has a cone, 1 and 3 fall off with distance).
- `shadowType` (params): 0 none, 1 raytrace, 2 raytrace + transparency (identical to 1 for opaque objects). Other params: `cutOffAngle` / `cutOffAttenuation` (spot cone), `iesProfile`, `photonLight`. Coloured accent lights (magenta, cyan, orange) near emissive signs give the neon spill.
- Three-point starter for a diorama: key (point/spot, warm, intensity by distance squared), fill (area, cool, low), rim (spot behind, aimed at subject).

## Intensity tuning loop
Draft render -> read `meanLuma` -> scale intensity by (target / measured) -> repeat. Interiors 0.2-0.5, bright finals ~0.3-0.45. Also adjust renderer `exposure` / `gamma` before piling on lights.

## Camera
- `c3d_set_camera {position, look_at_point, fov, active:true}`; a new camera becomes active automatically; `focal_distance` for depth of field (renderer `dofOn`); `near`/`far` clip planes; `projection:"orthographic"` (distance-independent view) or `"perspective"`.
- `camera_light`: `auto` (default) switches the built-in camera light on only while the scene has NO light; `off` renders pure black without lights; `on` always lights the scene. Remember it when a scene unexpectedly renders black or flat.
- Interior: camera outside the open front face, fov ~36, aim at room centre height. Elevated diorama: 28-32 degrees down, fov 35-45, subject off-centre per reference.
- `rotation` components are heading, pitch, bank (HPB), not axis rotations.

## Render settings
| purpose | size | params |
|---|---|---|
| draft | 320-728 px | `giOn:false, shadowsOn:true, rayDepth:6` |
| check | same | `giOn:true, giSamples:150, rayDepth:8, reflectionOn:true, refractionOn:true, antialiasingMaxSamples:2` |
| final | 1024-1456 px | `giSamples:600` (up to ~1200 if comfortably < 60 s), `rayDepth:10, antialiasingMaxSamples:4` |
Rendering is synchronous and blocks Cheetah3D; if a call times out, lower resolution or samples. `renderer` is `CHEETAH` (`giOn`, `giType`, `rayDepth`, `antialiasingMode`, `photonMapOn`) or `FALCON` (`samples` default 100, `totalBounces` 10, `causticsReflection`/`causticsRefraction`, `mbCamera`); `gamma` (1.8), `exposure`, `filmic`, `dofOn` exist on both. `samples` must be > 0 (the book reports 0 as "refine until stopped"; not tested).

## Falcon renderer (path tracer)
`c3d_set_render_settings {renderer:"FALCON", params:{...}}` switches the engine for the open document; Falcon has its own parameters, not the classic `giOn/giSamples/rayDepth`: `samples`, `shadowSamples`, `adaptiveSampling`, `totalBounces`, `diffuseBounces`, `glossyBounces`, `specularBounces`, `transparencyDepth`, `causticsReflection`, `causticsRefraction`, `causticsFilter`, `clampSample`, `lightThreshold`, plus the shared `exposure`, `gamma`, `filmic`. It needs no GI switch: global illumination and colour bleeding come from the path tracing itself.
- Cornell-style scene (area light, chrome, glass, gold, wood, marble): `causticsReflection:true, causticsRefraction:true, causticsFilter:4, totalBounces:12, diffuseBounces:6, glossyBounces:6, specularBounces:8, transparencyDepth:8`. A low `causticsFilter` (0.5) leaves visible grain on walls and ceiling; 4 is smooth.
- Cost: 320 px with default samples about 2 s (noisy); 512 px at 512 samples about 28 s; 1024 px at 768 samples a few minutes. Caustics are subtle with a large area light: light refracted through the glass ball shows inside its shadow.
- A very long render can exceed an MCP client's own tool timeout (60 s in some clients) while Cheetah3D keeps rendering and still writes the file: check the file instead of re-rendering, and use a smaller size or fewer samples for drafts.


## Reading stats
`c3d_render_image` returns `{width,height,blank,meanLuma}`. `blank:true` -> check light, camera position (not inside geometry) and that the camera is active. Always view the returned image and compare with the intended look: colour bleeding, soft shadows, reflections in chrome, refraction through glass.

## Backgrounds
`c3d_set_background {kind:"transparent"}` gives `backgroundColor` alpha 0: the PNG written by `c3d_render_image` has alpha 0 wherever no object is (both renderers; use png, not jpg). Combine with a ground using material type `Shadowmat` (shadow catcher: transparent, keeps only shadows) for product shots; in 8.1.3 tests its shadow pixels appeared with the CHEETAH renderer but not with FALCON, so check the alpha of the shadow area before relying on it.

`c3d_set_background {kind:"gradient", stops:[{pos:0,color:"#7a52a8"},{pos:1,color:"#b378bd"}], angle_deg:90, width:1456, height:816}` matches the render aspect to avoid stretching. `solid` sets `backgroundColor`. `image` needs an absolute path.
