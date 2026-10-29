# Progress log

## M0 — Probes (gate PASSED, 2026-10-29)
- Step 0 live-session check: Cheetah3D was running with two pre-existing "Untitled" windows; AX exposes no dirty flag; user confirmed they are disposable. `UserFile.jas` sha256 == baseline (`the baseline checksum`) at start and after probes.
- Step 1: backup `~/Library/Application Support/Cheetah3D/MCP-backups/Scripts-<ts>.tar`; probe macro folder `Scripts/Macro/C3D-MCP-Probes/` (loader macro `P00 Hello.js` hot-loads `current.js`). Restart required for new macros (P02) — user restarted Cheetah3D once.
- Step 2–3: scratch document (`Untitled 2`) with marker folder; `fixtures/empty.jas` created via `saveToFile` (P07/P37).
- Step 4: probes P01–P24, P27–P33, P35–P37 answered (RESULT lines in `research/08-…`); P21/P22 not run (not needed); P25/P26 deferred to M2 (helper).
- Step 5: `vendor/c3d-scripting-kb` vendored (commit a9008bf…, MIT); SDK/CLI versions pinned (P27).
- Contradictions found & amended in PRD/PROTOCOL: trigger needs Cheetah frontmost (P01), ASCII-only I/O, param type strings, non-unique names/`obj.id()`, render formats, glb/gltf unsupported, Undo does not revert macro edits (see PRD Changelog).
- Modal dialogs caused by probes ("Texture baking error!", 3× "Fileformat … not supported", "could not be opened") were dismissed only by clicking OK on those exact dialogs.

## M1–M7
(see sections appended by milestone)

## M1–M7 summary (2026-10-29)
M1 bridge+ping (live soak, faults 1/2/3/5; fault 4 manual), M2 helper (live: grant, press, modal, capture), M3–M5 tools verified live (docs/qa/live-tests.log, eval N=3), M6 safety fixes from the security review, M7 packaging + reviews + final report. See docs/FINAL_REPORT.md.
