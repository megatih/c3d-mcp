import type { PromptDef } from './toolkit.js';

export const buildSceneFromDescription: PromptDef = {
  name: 'build_scene_from_description',
  title: 'Build a scene from a description',
  description: 'Step-by-step workflow to model, light, camera and render a scene from a text description.',
  args: { description: { description: 'What the scene should contain.', required: true }, style: { description: 'Optional look: realistic, toon, studio...' } },
  build: (a) => `Build this Cheetah3D scene: ${a.description ?? ''}${a.style ? ` (style: ${a.style})` : ''}

Follow these steps and verify after each:
1. c3d_get_document_info, then c3d_list_scene to see what exists. If the scene is not empty or unsaved, call c3d_checkpoint first.
2. Plan the objects with real-world sizes (Y is up, units are meters). Group related parts under a FOLDER (c3d_create_object type FOLDER, then c3d_reparent).
3. Create geometry: primitives with c3d_create_object (BOX, BALL, CAPSULE...) and params; custom shapes with c3d_create_mesh (check vertex counts and index ranges) or c3d_create_spline plus an Extrude/Lathe object. Use c3d_set_transform for placement; use ids returned by each call.
4. Materials: c3d_create_material (type "Material (PBR)" for metals/plastics), then c3d_assign_material per object.
5. Lighting: c3d_set_light (3-point or studio) and an environment if needed; aim with look_at_ref.
6. Camera: c3d_set_camera with look_at_point at the subject, fov 35-50, active:true.
7. c3d_render_image at 960x540 and inspect the image and the blank/meanLuma stats. If blank or too dark/bright, adjust lights/camera and re-render. Then c3d_save_document.
Rules: never guess ids, re-read with c3d_list_scene after structural edits; prefer dedicated tools over c3d_run_script.`,
};

export const turntableRender: PromptDef = {
  name: 'turntable_render',
  title: 'Turntable render',
  description: 'Workflow for a 360 degree turntable animation of an object.',
  args: { object: { description: 'Object name/id to rotate (default: the selection).' }, seconds: { description: 'Duration in seconds (default 4).' }, fps: { description: 'Frame rate (default 30).' } },
  build: (a) => `Create a turntable of ${a.object ?? 'the selected object'} lasting ${a.seconds ?? '4'} s at ${a.fps ?? '30'} fps.
1. c3d_get_document_info and c3d_list_scene; resolve the target object id (c3d_select / c3d_get_object if it is the selection).
2. c3d_create_object type FOLDER named "Turntable" at the object's position, c3d_reparent the object into it (keep_world true).
3. c3d_set_fps, then c3d_set_keyframes on the folder: param "rotation", keys at time 0 -> [0,0,0] and time ${a.seconds ?? '4'} -> [360,0,0] with interpolation "linear". Verify with c3d_get_keyframes.
4. Make sure a camera frames the object (c3d_set_camera with look_at_ref) and lights exist (c3d_set_light).
5. c3d_render_image at time 0 and at the middle to check framing; then c3d_render_sequence (start 0, end ${a.seconds ?? '4'}) and poll c3d_job_status until done (c3d_job_cancel to stop).
6. Report the output directory and frame count. Warn that the animation time was moved.`,
};

export const materialStudy: PromptDef = {
  name: 'material_study',
  title: 'Material study',
  description: 'Workflow to build and compare material variants on a test object.',
  args: { material: { description: 'Target look, e.g. "brushed copper" or "frosted glass".', required: true } },
  build: (a) => `Develop the material "${a.material ?? ''}":
1. Create a test scene: a BALL (or the user's object) named "MaterialTest", a ground BOX, two lights (c3d_set_light) and a camera (c3d_set_camera with look_at_ref).
2. c3d_create_material with a suitable type ("Material (PBR)" for metals/plastics, "Glass" for transparent) and shortcuts color/metalness/roughness.
3. If textures or procedural patterns are needed: c3d_add_material_node (noise, wood, image...), c3d_set_texture for image nodes, c3d_connect_nodes into the root inputs; inspect with c3d_get_material_graph.
4. c3d_assign_material, then c3d_render_image. Judge the image (and meanLuma).
5. Create 2 more variants with c3d_set_material_params (different roughness/color), re-render each, and recommend one. Keep names descriptive (material names are unique).`,
};

export const debugScript: PromptDef = {
  name: 'debug_script',
  title: 'Debug a Cheetah3D script',
  description: 'Workflow to find and fix errors in a Cheetah3D JavaScript.',
  args: { script: { description: 'The script source (or a description of the failure).', required: true }, error: { description: 'Error message or symptom, if any.' } },
  build: (a) => `Debug this Cheetah3D script${a.error ? ` (symptom: ${a.error})` : ''}:

\`\`\`js
${a.script ?? ''}
\`\`\`
1. c3d_lint_script on the code; fix every error-severity finding first.
2. For each API call you are unsure about use c3d_search_api_docs (e.g. the method name, "gotchas").
3. c3d_checkpoint, then run a minimal reproduction with c3d_run_script (use print() to inspect values; the log is returned). Do not use File.mkDir or OS.system.
4. On SCRIPT_ERROR read details.line/message, fix, and rerun. After geometry edits call obj.update(); wrap loops in bounds.
5. Verify the result with c3d_list_scene / c3d_get_object / c3d_render_image. Present the corrected script and what was wrong.`,
};

export const allPromptDefs: PromptDef[] = [buildSceneFromDescription, turntableRender, materialStudy, debugScript];
