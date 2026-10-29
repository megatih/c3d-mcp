# Eval notes
- fix_broken_script: original assertion required an explicit `c3d_lint_script` call although the prompt never asks for linting and `c3d_run_script` lints internally; all 3 repeats solved the task (5 boxes, correct diagnosis) but failed that assertion. Assertion changed to `tool_called c3d_run_script` (2026-10-29) and the task re-run.
- turntable_selected: prompt reduced from a 4 s/30 fps sequence (120 frames, exceeded the 15 min limit) to 2 s/12 fps at 160x120; glob fixed to the actual `turntable_*` prefix.
- edit_mesh_move / table_four_legs / camera_fov_render: assertions corrected after the first pilot (bbox of the table parts only, pyramid base is 1 m wide, `@activeCamera` selector). Corrections were made before the scored N=3 run, not after seeing its results.

## Local-model (MLX) eval — requirements target ≥ 70 %: MET with Qwen3.8-27B (9/9); smaller models below
Harness: `evals/runner/mlx-agent.mjs` (`node evals/runner/run.mjs --agent=mlx --model=<id> --profile=local --n=3`) drives the c3d MCP server (profile `local`, 24 tools) through `mlx_lm.server` (OpenAI-compatible tool calling). Tasks with `profile: local`: local_rename_move, local_simple_scene, mesh_pyramid (3 x 3 runs).

| Model | Result | Notes |
|---|---|---|
| mlx-community/Qwen3-4B-Instruct-2507-4bit | 4/9 (44 %) | pyramid: answered without calling a tool |
| TensorFold/Qwen3.8-27B-MLX-4bit (cached locally) | not measurable | Metal out-of-memory on this 32 GB Mac with the 24-tool prompt |
| mlx-community/Qwen3-14B-4bit, first descriptions | 3/9 (33 %) | invented a `FLOOR` type and a `color` param; pyramid height put on z |
| same, after description changes (Y-up, PLANE for floors, "no color param", longer `localDescription` cap 120→260 chars) | best run 6/9 (66.7 %); same config re-run 5/9 (55.6 %) and 3/9 | run-to-run variance is large; 3/3 on local_rename_move throughout |
| same, thinking mode on | 4/9 (44 %) | pyramid 2/3 but rename_move regressed |

With Qwen3-14B the final configuration scores about 55–67 %. Its remaining failures are model reasoning (pyramid apex on the wrong axis; stops after a batch of tool calls without lights/materials), not tool errors; the 27B model, which handles the same tool set perfectly, shows the tool design itself is sound for local models.

**Update:** the 27B model was retried with the server memory limits (`--decode-concurrency 1 --prompt-concurrency 1 --prefill-step-size 256 --prompt-cache-size 1 --prompt-cache-bytes 800000000`, which the first attempt lacked) and no longer runs out of Metal memory: **9/9 (100 %)** on local_rename_move, local_simple_scene and mesh_pyramid (`docs/qa/evals-mlx-local-27b.json`). The "Final configuration scores about 55–67 %" paragraph above refers to Qwen3-14B-4bit only.
