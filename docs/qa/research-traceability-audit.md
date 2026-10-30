# Research-to-code traceability audit (2026-10-30)

Question: is everything the research, the vendored knowledge sources, the QA reviews and the benchmarks established actually used by the code, linter, tool descriptions, skills and docs? What is still contradicted, missing or wrong?

## Method
1. Three read-only audits (API and probe findings; architecture, MCP and packaging; vendored knowledge, QA reports, evals) produced ~60 candidate findings.
2. **No finding was accepted on the auditors' word.** Each one was re-read in the code, reproduced (a failing unit or bridge test, or a live probe against the running Cheetah3D 8.1.3 through c3d-mcp) and only then fixed. Findings that could not be reproduced, or were not defects, were dropped and are listed below with the reason.
3. Live checks ran against the working-tree build in scratch documents. The installed 0.3.0 server and runtime were not modified (the working-tree runtime was deployed only for the live runs and the original was restored; see "State left behind").

Baseline before any change: typecheck and lint clean, 541 unit tests, 81 bridge cases. After: 564 unit tests, 83 bridge cases, live suite 23 passed / 1 skipped (the opt-in kill test).

## Fixed (each with a test, and a live check where the app is involved)
| # | Finding | Fix | Evidence |
|---|---|---|---|
| 1 | `c3d_set_keyframes` with a 3-component colour (`[r,g,b]`) failed with "component 3 is not a finite number", although the tool promised it works. The server turned arrays into `{x,y,z}`, an object shape the runtime could not pad with an alpha (plain arrays and `{r,g,b}` were already padded with alpha 1). | Server passes arrays through; runtime fills the alpha for `[r,g,b]`, `{x,y,z}` and `{r,g,b}` from the parameter's current value (before, only arrays were padded, with alpha 1) (`bridge/runtime/anim.js`). | Reproduced live on 0.3.0 before; bridge case `27-color-keyframes`; two corrected unit tests; live after: all three shapes work, midpoint colour correct. |
| 2 | Skill said the default interpolation is `linear`; `flat` and `spline` were presented as different. | Skill and tool text: default `soft`; `flat` = `spline` = 2 and reads back as `spline`. | Live: default key read back `soft`, `flat` read back `spline`. |
| 3 | `Shadowmat` accepted by `c3d_create_material` but missing from `c3d_capabilities` (runtime and fallback). | Added to both; drift test between the fallback and the tool's enum. | Live `c3d_capabilities`; bridge case `10-pipeline`; unit test. |
| 4 | `File.readInt` was reported absent (research/10 B22). The probe ran through our own sandbox `File` wrapper, whose method list lacked it. | Wrapper, mock, linter (verified methods) and KB note updated; research/10 B22 reversed. | App's method table lists it; live big-endian `writeInt`/`readInt` round trip returned 123456 and -7; lint test; sandbox bridge case. |
| 5 | Lint: `isAnimateable` (documented spelling) passed silently; Falcon `samples` of -1 or 0.0 passed. | New absent-method entry; regex extended. | Lint tests; live `c3d_lint_script`. (The tool already refused `samples <= 0` itself.) |
| 6 | Lint message claimed the runtime always refuses a same-run `removeMaterial`; a document reached through `obj.document()` is not guarded. | Message corrected; limitation documented. A runtime guard is impossible: `obj.document()` returns a new wrapper each call and expandos do not persist (live probe). | Live probe; lint test. |
| 7 | Slow calls gave the client no sign of life although the bridge client had a heartbeat ("Waiting for Cheetah3D (Ns)"); nothing passed `onProgress`. | `withProgress` wraps the bridge for every tool call. `scopeProgress` stops progress when the request ends: a first version would have let `c3d_render_sequence`'s background loop notify an already finished request (found while verifying item 14). | Unit tests; live: a 5 s render delivered `rendering` and `Waiting for Cheetah3D (3s)` to the client. |
| 8 | `c3d_remove_tag`, `c3d_takes remove` and lossy `c3d_edit_mesh` (`delete_polygons`, `merge_distance`) had no automatic checkpoint (research/00 decision 9: backups before destructive and exec operations). | `autoCheckpoint` first; vertex moves and winding flips stay un-checkpointed on purpose (cheap to repeat). | Unit tests; live: `cp160`, `cp161`, `cp162` returned. |
| 9 | Doctor reported a stale helper (0.1.1) as ok. | Warns when older than the version this release ships (0.2.1); a test ties the constant to `helper/VERSION`. | Live doctor on this Mac flagged 0.1.1 with the fix. |
| 10 | `ERROR_CODES` and `contracts/errors.json` could drift. | Test. | Test. |
| 11 | `.mcpb` manifest had no `disable_shell` option. | Added. | JSON validated; `mcpb validate` not run (CLI not installed). |
| 12 | Wrong or stale statements: `render_sequence` "time NOT restored"; `c3d_duplicate` "World offset"; `depth` 0, `bbox` space, `blank` definition, strict mode, 24-tag cap undocumented; docs said light axes were unverified and the transparent background experimental; `tag_index` "pending"; `PROTOCOL.md` (parenting, `point:0`, `assignMaterial` result); skills (missing `new` "crashes", `OS.system` "blocked", ES5 as an engine limit); "Vision" in the helper docs (the helper uses ImageIO/CoreGraphics); README macOS version and tool count. | Edited to the measured facts; PRD, FINAL_REPORT, REQUIREMENTS_CHECKLIST and triage got dated notes instead of rewritten history. | Live: sequence time restored (2 before, 2 after), duplicate offset lands in the parent's space (child at local x=1 plus offset 2 gives x=3 under a 90° folder); code read for the rest. |
| 13 | Knowledge not used: the book author's errata for 8.1.1 (`vendor/learn3d-cheetah/reviews`) were not searchable; measured shadow-softness, Shadowmat, `isAnimateable` and legacy-tag facts were not attached to search hits; two shipped KB files were never read. | Errata indexed with the label "not verified in 8.1.3" and shipped in the package; four new measured notes (tokens checked against the corpus first); the two unused files no longer shipped. | Unit tests; live `c3d_search_api_docs` returned notes and errata hits. |
| 14 | `c3d://templates/macro` contained a `new Object()` placeholder and did not parent its object (contradicting the tool descriptions). | Fixed; test lints both templates. | Live: the template ran through `c3d_run_script` and created `/Example` as a root child. |
| 15 | **Found during live QA:** the live-test window cleanup did not close edited scratch documents on this macOS: the close prompt is "Do you want to keep this new document?" with Delete / Cancel / Save, the old code looked for "Don't Save" and never waited for the sheet, and reported windows as closed that were not. Windows were left open. | `scripts/window-cleanup.mjs` rewritten (button by name; if the sheet is not reachable, activate Cheetah3D and press command-delete, never Return; restore the frontmost app; report only windows that really closed). New live regression test. | Live: 3 edited scratch documents closed in 2.2 s, nothing saved to Downloads, original window untouched; live suite green. |

## Independent review of the changes
A fresh agent, given only the file list and the risk areas, reviewed the finished changes read-only. Each of its findings was checked against the code before acting:
| Finding | Outcome |
|---|---|
| `disable_shell` was described as blocking file writes; it only refuses `OS.system` (`tools/exec.ts`). | **Confirmed, fixed** (manifest and `docs/limitations.md`). |
| `skills/c3d-animation-export` still said the sequence time is "NOT restored". | **Confirmed, fixed** (plugin copy re-synced). |
| Progress could go backwards: a heartbeat (no fraction) used its own counter, so after a fraction update of 1 the next heartbeat reported 1 again; MCP needs strictly increasing progress. | **Reproduced** by a new test (`1`, `1`), **fixed**. |
| My "late progress" test passed even with the `endProgress()` wiring removed (the SDK client drops events for finished requests itself). | **Confirmed by mutation test.** The test now spies on what the server sends and fails when the wiring is removed. |
| Bridge case 27 only asserted `ok:true`, so reverting the runtime fix would not fail it for arrays and `{r,g,b}`. | **Confirmed by mutation test.** The case now reads the alpha back (current value 0.5, explicit alpha kept) and fails against the old `keyComponents`. |
| Cleanup keystroke could reach another document if `AXRaise` failed. | **Fixed:** the key is sent only when the target is the front window and still shows its sheet. The race (target closed between check and key) is the only case it addresses; the other title-handling remarks (titles containing ", ", the frontmost-app name) are pre-existing and unchanged. |
| `withProgress` lost the heartbeat when a caller passed `onProgress: undefined`. | Fixed with a test. |
| A failing checkpoint blocking the operation was untested. | Test added (the operation runs, the result carries a warning). |
| Wording "before 0.3.1" in a KB note; audit text overstating the keyframe failure and the PRD requirement. | Corrected. |
| `c3d_duplicate` with method `menu` offsets every object the paste created, including descendants of a duplicated group. | **Suspected, not reproduced** (no document could be created at that point, see below); the code is unchanged by this work. The parameter text now says what the code does and that it was not verified live. |
| The `falcon-samples-zero` lint rule also matches a light's or HDRI light's `samples` (any `setParameter('samples', 0)`), and scans comments. | True and pre-existing (the literal-0 form existed before; negatives were added). A light with `samples` 0 is not meaningful, so the rule is left as is. |
| Checkpoints are taken before the operation is validated (a bad tag index costs a `.jas` save). | Accepted. |

## Observations (not fixed)
* **`c3d_new_document` fails from a no-window state** (`TRIGGER_FAILED: AXRaise failed for Cheetah3D`) on the installed helper 0.1.1, and `File > New` via System Events does not open a window while Cheetah3D cannot be activated. The PRD's "no document: create one" bootstrap therefore does not work in that state. Whether helper 0.2.1 behaves differently was not tested.
* **Cheetah3D logs a non-fatal "Application Triggered Fault" report (`EXC_GUARD`, `is_simulated`) in `~/Library/Logs/DiagnosticReports` for each render.** They also exist from before this work (10:10, 29 Oct). System-written; not touched.
* The pre-existing empty "Untitled" window was no longer open at the end. No step of this work closes windows it did not open (every path uses a before-snapshot); the cause is unknown.

## Audit claims that were wrong (not changed)
* "`C3D_MCP_DISABLE_EXEC` also hides the lint and console tools": false; only `c3d_run_script` is in the `exec` group.
* "The health tools are undocumented": false; `docs/TOOLS.md` already has a section (my first attempt to add one created a duplicate and was reverted).
* "Helper version mismatch (0.2.1 vs 0.3.0)": the 0.3.0 release zip contains helper 0.2.1, equal to `helper/VERSION`. The real issue was the stale *installed* helper (item 9).

## Dropped after inspection (not a defect, not reproducible, or not worth the change)
Vec2D keyframes (needs a contract change for a rare case); a runtime `removeMaterial` same-run guard (no tool sends that op); render extension case (the runtime already rejects `.PNG` cleanly before Cheetah3D is involved); `.preview.*` overwrite guard and export `format` vs extension (intended behaviour); create-rollback after a failed reparent (not reproducible); `destructiveHint` on save/export and `response_format` on more tools (judgement calls with no evidence of benefit); viewport crop (the viewport is not exposed through Accessibility); plugin SessionStart hook via `npx` (would fetch a package every session); LaunchAgent unload and `packaging/configs/` (optional, manual); indexing `ExecuteScript.md` and the forum-script list; extra Tool/Tag/Spline/Particle template resources (`c3d://patterns` already serves them); light-type visual test and export option keys (optional, not run; the light-type mapping stays labelled inferred).

## Needs a decision
* **Auto-launch of Cheetah3D** when it is not running (research/03, PRD §3.9): changes behaviour (launches an app unprompted) and can only be verified live by quitting Cheetah3D.
* **Evals** (3 new tasks at N=3, plus the two flaky tasks): costs API spend and needs the live app.
* **Release 0.3.1:** version bump, runtime version bump (the runtime content changed but still says 1.0.0, and capabilities are cached per runtime version), rebuild of the release artifacts and checksums, `mcpb validate`. Not done: overwriting the published 0.3.0 artifacts would break their checksums.
* **Installed helper** on this Mac is 0.1.1; `c3d-mcp install` updates it (macOS may ask for the permissions again).

## State left behind
Environment snapshot taken before the first live run and compared after cleanup: no differences in the Cheetah3D MCP directory, Render History, Scripts, logs or LaunchAgents; only the original "Untitled" window remains; the installed runtime and manifest were restored (hash `4dc498dc…`). Files created by the live runs (checkpoints, captures, sequences, previews, 10 Render History folders) were deleted. The repository contains only the intended source changes plus regenerated, git-ignored build outputs.
