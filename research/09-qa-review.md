# 09 — Independent QA review of the design (2026-10-29)

An independent review agent audited the plan against the bundled manual, `MainMenu.nib`, the strings dump and prior probe scripts. Findings and resolutions:

| # | Finding | Resolution (where) |
|---|---|---|
| 1 | `File.mkDir` deletes existing path (manual) | Banned; Node creates dirs; lint+guard in `run_script` (requirements section 7, 02 §2) |
| 2 | JSON works (`JSON.parse` in `build_cheetah.js`) | P05 reduced to nested-host-object check |
| 3 | Menu bar has Clone/Import/Merge/Make editable/Undo/Save As/New | New **menu-command channel** (requirements section 3.6), P10 |
| 4 | No stable object ids; names uniquified | Path/indexPath addressing + `$n` batch refs + `AMBIGUOUS` (requirements section 6.0) |
| 5 | Vector params serialize as `[object CallbackObject]` | Serialize via `parameterInfo` + per-type component reads (requirements section 4 runtime) |
| 6 | Manual constants ≠ runtime constants (lights) | `capabilities` op builds type map (requirements section 6) |
| 7 | `addIndexPolygon` can crash on bad indices | Validate in TS and runtime (requirements `c3d_create_mesh`) |
| 8 | `record*ForUndo` Tool-scripts only | File-based checkpoints; P11 (requirements `c3d_checkpoint`) |
| 9 | Manual: new scripts need restart | Doctor detects & explains; P02 |
| 10 | CLI-spawned helper would inherit wrong TCC responsibility | Helper = LaunchAgent / `open -g` + Unix socket; M0/M1 use osascript (requirements section 3.3) |
| 11 | AXPress blocks; busy app | Short AX timeout; `kAXErrorCannotComplete` ⇒ busy; check `AXEnabled` (requirements section 3.4) |
| 12 | `mv` via `OS.system` is slow/quoting-fragile; no rename in File | `.json` then `.done` marker; server deletes files (requirements section 3.2) |
| 13 | `File.read(n)` counts chars ⇒ non-ASCII hazards | ASCII-only `\uXXXX` payloads + `名前` test (requirements section 3.2) |
| 14 | Finished vs running vs crashed ambiguity | `state.json` + process liveness + retry-once (requirements section 3.5) |
| 15 | Repeat presses | Idempotent bounded drain; server presses only if not busy (requirements section 3.5) |
| 16 | Exceptions in runtime eval | try/catch in macro, `_bootstrap-error.json`; P12 for lock nesting |
| 17 | Modal dialogs block everything | AX modal detection pre-press; shadowed `OS`/`File` in `run_script` (requirements section 3.7, §7) |
| 18 | Multiple documents | `expectDocument` + `WRONG_DOCUMENT` + AXRaise (requirements section 3.8) |
| 19 | App not running / no document | `open -a`, wait for AX menu bar, `newDocument:` (requirements section 3.9) |
| 20 | JS has no `$HOME`/`__filename` | Install-time templating of absolute runtime path (requirements section 9) |
| 21 | Cross-process concurrency | FIFO in-process + `flock` lock file across servers; per-uuid result reads (requirements section 3.10) |
| 22 | Per-session token adds little | Install-time 0600 secret; same-user threat model documented |
| 23 | Long sync renders | One frame per macro run for sequences; elapsed-time progress; downscale images (requirements section 6 render) |
| 24 | `duplicate` has no API | Clone via AX first, JS deep-copy fallback with documented losses |
| 25 | `open_or_import` conflated | Split `c3d_open_document` / `c3d_merge_file` (experimental) |
| 26 | `saveToFile` may re-point document | P07; backups via file copy or `saveDocumentTo:` |
| 27 | Unsupported features | Explicit `UNSUPPORTED` errors: vertex colors, close/quit, gradient params, in-place primitive edit |
| 28 | JS unit-test harness | Swift `JSContext`/`jsc` with strict generated mocks; not JXA |
| 29 | Live test reliability | Temp copies of `fixtures/empty.jas`, `expectDocument`, serial, 5 fault tests |
| 30 | Un-testable acceptance criteria | Reworded (requirements section 1, §12) |
| 31 | Ad-hoc signing loses TCC on rebuild | Self-signed dev cert; documented re-grant (05) |
| 32 | `/goal` autonomy guardrails | requirements section 0 & §12: prohibitions, stop conditions, gates |

---
# requirements review (second independent pass, 2026-10-29)
Blockers found and fixed in the requirements spec:
1. Duplicate execution of mutating requests on extra/retry presses → `lastSeq` watermark, skip-if-`.done`, server deletes inbox first, never reuses `id`; acceptance test §3.13.
2. `seq` undefined across servers/restarts → 16-digit `Date.now()*1000+counter` + strict filename regex.
3. No way to create `fixtures/empty.jas` → M0 step 3 (AX newDocument + `saveToFile` from scratch doc, `plutil -lint`).
4. M0 safety vs user's live session → M0 step 0 (dirty-window check → PAUSE), session marker object, `expectDocument` on every probe, probe safety limits.
High/Med fixed: exec "shadowing is the guarantee" corrected to best-effort containment + global swap + per-escape tests; stale request after timeout (`deadlineAt`, `cancel/`); non-atomic JS writes (`.done` with length/checksum, retry parse); checkpoint circularity (outcome A/B); per-polygon material, camera switching, `get_console`, delete-frees probes (P31–P37); Swift JSContext harness (no `jsc`); thresholds for RUNTIME_STUCK/APP_BUSY and fault-test timing; helper-owned-modal flag, empty allow-list; `as`/`$a` refs + `DEPENDENCY_FAILED`; extra error codes; testable acceptance criteria (spend cap, offline "not run", dry-run definitions); baseline checksum comparison; helper-optional install until M2; `sips` fallback.
Low items (ES5 wording, spec-date caveat, vendoring offline, coverage tool, drain tuning from P03/P36) applied in requirements section 0/§3/§8.
