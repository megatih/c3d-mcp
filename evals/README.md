# c3d-mcp eval tasks

Each `tasks/<id>.yaml` is one end-to-end task for an agent driving the MCP server (`claude -p --mcp-config`, N=3 per task). The files use YAML flow style for assertions (valid JSON per line), so any YAML parser reads them.

## Task fields

| Field | Meaning |
|---|---|
| `id` | unique slug = file name |
| `title` | human title |
| `prompt` | exactly what the user tells the agent |
| `profile` | `full` or `local` (server `C3D_MCP_PROFILE`) |
| `timeout_s` | wall-clock limit for the agent run |
| `fixture` | `.jas` document to open (a temp copy) before the run; `fixtures/empty.jas` exists, the others must be created by the lead (see below) |
| `tags` | free-form grouping for per-tag pass rates |
| `assertions` | list of assertion objects, ALL must pass (the task score is the share that pass; task passes at 100%) |

## Evidence available to the runner

* **scene dump** taken after the run: `c3d_list_scene` (detailed, depth 32) plus `c3d_get_object` with parameters/tags/bbox for every object, `c3d_list_materials` and `c3d_get_material_graph` for every material, keyframes via `c3d_get_keyframes` for every animated parameter of the objects named in assertions;
* **transcript**: ordered list of tool calls (name, arguments, isError) and the final assistant answer text;
* **work dir**: files under the server `workDir` (renders, exports, checkpoints, assets, sequences);
* the session marker folder `__c3d_mcp_session_*` is excluded from all counts.

All `*_regex` / `name_regex` values are JavaScript/Python-compatible regular expressions matched against object (or material) names; `(?i)` means case-insensitive (translate to the `i` flag).

## Assertion vocabulary

| `type` | Fields | Passes when |
|---|---|---|
| `object_count` | `object_type` (e.g. `BOX`), `min`, `max?` | number of objects with that type name is within range |
| `object_exists` | `name_regex`, `object_type?`, `min_count?` (default 1) | at least `min_count` objects match name (and type) |
| `object_absent` | `name_regex` | no object matches |
| `parent_of` | `child_regex`, `parent_regex` | some matching child has a matching parent (direct) |
| `param_range` | `object_regex` (`@activeCamera` selects the active camera), `param`, `component?` (`x`/`y`/`z`/`w`), `min`, `max` | parameter (component) of the first matching object lies in `[min,max]` |
| `param_at_time` | `object_regex`, `param`, `component?`, `time` (s), `min`, `max` | after `c3d_set_time(time)`, the parameter value lies in range (runner sets time itself) |
| `bbox` | `object` (`scene` or a name regex), `size_min:[x,y,z]`, `size_max:[x,y,z]` | the world-space bounding box SIZE of that object (or of the whole scene) is within the per-axis limits |
| `mesh_stats` | `object_regex`, `min_polygons?`, `max_polygons?`, `min_vertices?`, `max_vertices?` | first matching polygon object has counts in range |
| `material_exists` | `name_regex`, `root_type?` (`material`/`pbrmetal`/`toon`/`dielectric`) | a material with matching name (and root node type) exists |
| `material_param` | `material_regex`, `param`, `min`, `max` | root-node parameter value in range |
| `material_node` | `material_regex`, `node_type` | the graph contains a node of that type |
| `material_connection` | `material_regex`, `to_input` | some connection ends at that input (skipped = pass when the graph reports `connections: "unavailable"`) |
| `material_assigned` | `object_regex`, `material_regex`, `min_objects?` (default 1) | at least that many matching objects carry a SHADERTAG whose material name matches |
| `camera_active` | `name_regex` | the active camera matches |
| `camera_aims_at` / `light_aims_at` | `target_regex`, `max_angle_deg` | every (camera: the active one) matching camera/light has its -Z axis within the angle of the direction to the target object's world position |
| `keyframe_count` | `object_regex`, `param`, `min` | the parameter has at least `min` keys in some component |
| `tag_exists` | `object_regex`, `tag_type` | the object has such a tag |
| `render_nonblank` | `min_width`, `min_height` | a render produced during the run (png/jpg/tiff in workDir) has at least that size and `blank:false` (Vision stats) |
| `file_exists` | `path_regex` | a file under workDir (or the fixture directory) matches |
| `files_exist` | `glob`, `min` | at least `min` files match the glob under workDir |
| `tool_called` / `tool_not_called` | `tool`, `min_count?` | transcript contains (or does not contain) a call of that tool |
| `answer_contains` | `regex` | final answer text matches |
| `scene_unchanged` | - | scene dump equals the dump taken before the run |
| `fixture_unchanged` | - | the original fixture file is byte-identical (checksum) |

Unknown assertion types must FAIL the task (never silently pass).

## Fixtures to create (live, by the lead, via the MCP server itself)

| Path | Content |
|---|---|
| `fixtures/empty.jas` | exists (empty scene with session marker) |
| `fixtures/one_box.jas` | one BOX named `Box` at the origin |
| `fixtures/selected_cube.jas` | one box `Model` that is selected when the document opens (the runner selects it via `c3d_select` before the agent starts) |
| `fixtures/target_ball.jas` | one BALL named `Target` at (0,1,0) |
| `fixtures/tmp_objects.jas` | objects `Tmp1`, `Tmp2` (with 2 children), `Tmp3`..`Tmp7`, plus `Keep1` |
| `fixtures/lamp.jas` | one LIGHT named `Lamp` |
| `fixtures/pyramid.jas` | polygon object `Pyramid` (5 vertices, apex at y=1.5) |

## Window cleanup

The runner snapshots the Cheetah3D window titles before each run and, afterwards, closes every new window with `closeNewWindows` from `packages/server/scripts/window-cleanup.mjs`, answering "Don't Save" on the sheet (the Render Manager is left alone). A final sweep after the last task closes the document window the runner may have created itself. Set `C3D_KEEP_WINDOWS=1` to keep the windows of the final sweep.

## Profiles and reporting

Run every `profile: full` task against `C3D_MCP_PROFILE=full`, and the `local` ones (plus optionally all) against `local`. Report pass rate per profile and per tag, mean tool calls and cost per task; `scene_unchanged` tasks double as read-only safety checks.
