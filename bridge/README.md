# bridge

In-app JavaScript runtime for Cheetah3D 8.1.3 plus its test harness. Protocol: `docs/PROTOCOL.md`; schemas: `contracts/`.

## Layout
| path | purpose |
|---|---|
| `runtime/*.js` | ES5 modules (`util core capabilities params scene geometry materials document anim render exec index`), concatenated in that order by `scripts/build-runtime.mjs` into `dist/runtime.js` (+ `runtime.meta.json`). `VERSION` is embedded. |
| `macro/C3D-MCP Bridge.js.template` | Tiny loader macro (`{{RUNTIME_PATH}} {{MCP_DIR}} {{VERSION}}`); render with `renderMacro()` from `scripts/build-runtime.mjs`. Failures go to `outbox/_bootstrap-error.json` (the server must delete it before each press). |
| `tests/mocks/*.js` | Strict mock of the scripting API (only methods from `api-index.json` plus probe-verified extras exist). `paramdata.js` is generated from `research/raw` by `gen-paramdata.mjs`. |
| `tests/harness` | SwiftPM `c3d-harness` (JavaScriptCore). `cases` runs `tests/cases/*.json`; `run MCPDIR` executes the macro once against a real directory (for Node integration tests; `--setup file.js`, `--presses N`, `--file-name`). |
| `tests/validate-schemas.mjs` | Validates every request/response the cases produced against `contracts/` and checks op coverage. |
| `tests/lint-es5.mjs` | ES5 / ASCII / no-bare-optional-constant guard. |

## Run the tests
`scripts/test-bridge.sh` (about 1 minute from clean, mostly the Swift build).

## Add an op
1. Add the schema to `contracts/ops.src.mjs`, run `node scripts/gen-contracts.mjs`.
2. Register it in the matching module: `C3D.core.define('name', 'R'|'W', function (ctx, args) { ... })`. Throw `U.fail(code, message, details, hint)`; use `C3D.core.partial()` for partial success. Call `update()` on touched objects; `'W'` ops trigger `redrawAll()` and invalidate the scene cache.
3. Add a case to `tests/cases` (happy and error path) and run the script. Every op in `contracts/ops.json` must have an ok and an error call, or the schema step fails.

## Case format
`{"cases":[{"name", "setup":{js,fileName,state,files}, "presses":[{requests:[{label,ops,times,seq,deadlineMs,cancel,preDone,extra,omit,schema,argsSchema}], js, files, state, runtimeSource, runtimeMissing, expect:{responses,noResponse,responseCount,state,files,noFiles,js,fatal,modal,noState}}]}]}`.
Expectations are subset matches with `$any $re $type $gte $lte $len $has $prefix $absent`. `{MCP}` expands to the temp MCP dir, `{i}` to the repeat index. Each press automatically checks: no mock FATAL/modal, redraw lock balanced, global `OS`/`File` restored, `state.busy=false`, `.done` matches the response, all files ASCII.

## Quirks
See `docs/PROTOCOL.md` section 2 (probe-derived facts). The mocks reproduce: non-ASCII `File.write` truncation (P05), byte-counting `read`, sorted `contentOfDir` with dotfiles, `mkDir` wiping, unique materials but not objects (P19/P20), `[object CallbackObject]` vectors, unreadable params, FATAL on bad polygon index, modal on bad render extension / BAKETAG on non-polygon (P08/P24), `selectedObject()` undefined when empty.

## sceneStats
Read-only counts, cheap (one pass over the cached tree, O(1) `PolyCore` counters, no per-polygon reads). Args: `{root?: ref}` limits objects to that subtree (root object included); materials/nodes are document-wide. The `__c3d_mcp_session_*` marker folder is excluded.
Result: `{objectCount, byType:{BOX:n,...}, folderCount (FOLDER+SMARTFOLDER), lightCount (LIGHTFAMILY), cameraCount, splineCount (SPLINEFAMILY), polygonObjectCount (objects whose core() has >0 polygons, parametric primitives use their evaluated mesh), polygonCount, vertexCount, triangleCount, tagCount, materialCount, nodeCount (all material nodes), skipped}`. `skipped` counts objects/materials that threw while being read; they never abort the op.

## Notes on write ops
- `createMesh`/`createSpline`/`createObject`: if anything fails after `addObject`, the half-built object is removed from the parent it was attached to (falling back to the root).
- `setParameters`, `setMaterialParams`, `setRenderSettings` report partial failure as `ok:false` with the error AND `result:{applied:[...],errors:[...]}`; the applied list survives in the response.
- `setKeyframes` on a Vec4D parameter accepts 3 components; `w` is filled with the parameter's current value. Link parameters (via `setParameters`) accept `{ref:<ref object|id|"/path">}`, `{material}` or `null` (null clearing is unverified live). Link parameters cannot be keyframed.
