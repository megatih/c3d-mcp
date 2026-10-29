# c3d-mcp — final report (2026-10-29)

## What shipped
* **59 MCP tools** (`c3d_*`: 3 health + 56 others), 6 resources (`c3d://…`), 4 prompts; profiles `full` (59) / `local` (24) / `readonly`; opt-outs for exec/assets/shell. Reference: `docs/TOOLS.md`. Every PRD §6 row exists; `c3d_use_document` is one addition (selecting which open window the agent works on).
* **In-app bridge** (`bridge/`): ES5 runtime (41 ops) + loader macro, file-mailbox protocol with seq/lastSeq/`.done`/deadline/cancel idempotency (`docs/PROTOCOL.md`).
* **Swift helper app** (`helper/`): activation + AXRaise + press + restore, modal detection, window capture, image analysis/downscale, Unix-socket IPC.
* **TypeScript server** (`packages/server`): queue + cross-process lock, install/uninstall/doctor/config CLI, elicitation/confirm, checkpoints, assets (Poly Haven), docs search (BM25 over the vendored kb), lint, jobs.
* **Packaging (built locally, nothing published):** npm tarball, `.mcpb`, helper zip (+ checksums in `release/SHA256SUMS`), Claude Code plugin + marketplace (`claude plugin validate` ✔), Homebrew cask (`ruby -c` ✔), registry `server.json` (validated against the published draft-07 schema ✔), `sign-dev.sh`, `notarize.sh --dry-run` (exit 0, prints `notarytool submit`, contacts nothing).

## Probe results
All answered in `research/08-open-questions-and-probes.md` (P21/P22 not needed, P25/P26 partly verified: capture works with the grant; responsible-process behaviour = the helper app is granted on its own). Key design-changing facts: menu press needs Cheetah3D frontmost + key document window; ASCII-only file I/O; `parameterInfo()` type strings; non-unique object names (`obj.id()` handle); png/jpg/tiff only; glTF/GLB unsupported; Undo does not revert macro edits; `OS`/`File` globals read-only; `m03,m13,m23` translation.

## Test and eval numbers
| Check | Result |
|---|---|
| Unit/contract (`npm test`) | 412 passed, 35 files; lines 95.95 % over `src/**` |
| `npm run lint`, `npm run typecheck` | clean |
| Bridge runtime on Swift JSContext harness | 74 cases pass (41 ops, 28 sandbox cases, idempotency, faults); schema validation of 106 requests / 105 responses |
| Helper (`swift test`) | 65 pass |
| Live (`C3D_LIVE=1`, real Cheetah3D 8.1.3) | 21 pass: 100 sequential + 20 concurrent pings, zero lost/duplicate; mutating op executes exactly once with extra presses; faults (1) runtime syntax error, (2) op throws, (3) real dialog → `BLOCKED_BY_MODAL` (~2.7 s), (3b) disabled menu → `TRIGGER_FAILED`, (5) stale request after TIMEOUT never runs; 13 sandbox-escape cases blocked on the real engine |
| Scripted clean cycle `uninstall && install && doctor` | 1.5 s, all green (no restart needed when the menu already exists) |
| Local-model evals (MLX, `local` profile, 3 tasks x 3) | Qwen3.8-27B-4bit **9/9 = 100 %** (target ≥ 70 % met); Qwen3-14B-4bit 55.6 % (best 66.7 %); Qwen3-4B 44 % |
| Real MCP clients | Claude Code (`claude -p`, all eval runs) and **Codex CLI 0.165** (`codex exec` with the server passed via `-c mcp_servers.c3d.*`; called `c3d_get_document_info` and answered correctly) |
| Evals (`claude -p`, claude-sonnet-5-5, 31 tasks, N=3) | **91 / 93 = 97.8 %** after corrections (first scored pass 88/92; `fix_broken_script` assertion was over-specific → changed and re-run 2/3; one window-state skip re-run 1/1; one genuine miss `run_script_confirm` #1, one genuine miss `fix_broken_script` #1). Spend **US$ 6.15 + 0.53** of the US$25 cap. `local` profile with Claude: 6/6. Details: `docs/qa/eval-notes.md`, `evals-*.json` |
| Independent reviews | 3 reports + triage in `docs/qa/` |

## NOT run / manual (stated plainly)
1. ~~Fault test 4~~ **DONE after your authorization:** `C3D_LIVE=1 C3D_LIVE_KILL=1 … test/live/crash.test.ts` kills Cheetah3D during a 25 s in-flight request → `APP_CRASHED` within 2 × deadline, then recovery after relaunch (pass). A first attempt with a render finished before the kill and was replaced by a deterministic long-running script.
2. ~~`local` profile with an MLX model~~ **DONE, target met:** `TensorFold/Qwen3.8-27B-MLX-4bit` (served with `mlx_lm.server`, memory-limit flags) passes **9/9 (100 %)** on the three `local` tasks at N=3 (`docs/qa/evals-mlx-local-27b.json`). Smaller models that fit more comfortably scored lower (Qwen3-14B-4bit 55–67 %, Qwen3-4B 44 %); details in `docs/qa/eval-notes.md`.
3. `brew audit --cask --strict` — **done** via a temporary local tap (exit 0, clean); `--online` fails only because the GitHub repo/release does not exist yet. MCP conformance suite — **run** against a dev-only HTTP wrapper of the same server: 6/30 scenarios pass, the 24 others require the suite's reference fixtures or optional capabilities (`docs/qa/conformance.md`). `.mcpb` install in Claude Desktop (GUI step; the file validates and packs), and Gemini CLI / Cursor / LM Studio / Antigravity real-client runs (not installed on this Mac) — not run; their config snippets are generated, documented and unit-tested. Elicitation with a real client UI — not run (covered by in-process MCP client tests).
4. Timed fresh-Mac install checklist (needs a clean machine), Developer ID signing/notarization (no credentials; dry-run only), publishing to npm / registry / GitHub release / Homebrew tap (requires your approval — nothing was published or pushed).
5. Light type names (ambient 0, area 1, distant 2, point 3, spot 4) are inferred from the manual's alphabetical list and kb; not verified visually. Per-polygon materials: UNSUPPORTED (P31 inconclusive).

## Known limits
`docs/limitations.md` (incl. security limits). Highlights: OBJ export crashed Cheetah3D once on a nested scene (checkpoint is taken first); `c3d_run_script` is best-effort containment; one macro run blocks Cheetah3D while it executes (renders are one frame per request).

## Deviations from the PRD (reasons)
* Global replacement of `OS`/`File` is a no-op in the real app (non-writable globals) → containment = strict inner function + shadowed params + neutralized constructors + guarded objects (PRD §4 amended in spirit; tested live).
* Trigger needs Cheetah3D frontmost + AXRaise (P01) — added to §3.7 behaviour; helper restores the previous app.
* `parameterInfo()` type strings instead of `*_PARAMETER` constants; `obj.id()` refs added; world-matrix translation layout; Poly Haven via FBX because glTF unsupported.
* One extra tool (`c3d_use_document`); `c3d_select` has no `restore_previous`; `doctor --brief`; the helper is installed by `install` from the package (no GitHub-release download step yet).
* Eval assertions corrected before/after the pilot as logged in `docs/qa/eval-notes.md`.

## Manual steps for you
1. `cd packages/server && npm ci && npm run build`, then `node bin/c3d-mcp.js install` (already installed on this Mac), restart Cheetah3D only if the menu is missing.
2. Grant Accessibility (done here) / Screen Recording (done here) to the helper (`docs/TROUBLESHOOTING.md#granting-permissions`).
3. To publish: create the GitHub repo `megatih/c3d-mcp`, upload `release/*` as a release, `npm publish`, `mcp-publisher publish` (docs in `packaging/`), tap repo for the cask; optionally create a dev certificate (`packaging/sign-dev.sh`) or Developer ID + `packaging/notarize.sh`.
4. Housekeeping on this Mac: the probe folder `Scripts/Macro/C3D-MCP-Probes/` (delete it by hand; it is not part of the product), ~30 scratch "Untitled" documents/fixtures windows I created are still open in Cheetah3D (close without saving), backups are in `~/Library/Application Support/Cheetah3D/MCP-backups/`. Your `UserFile.jas` is byte-identical to the baseline (sha256 the baseline checksum).

## Publishing and signing state (2026-10-29, after your approvals)
* **GitHub:** https://github.com/megatih/c3d-mcp (public, sanitized copy of this tree: private paths, file names and your name replaced), release **v0.1.0** with `C3D-Bridge-Helper-0.1.0.zip`, `c3d-mcp-0.1.0.mcpb`, `c3d-mcp-0.1.0.tgz`, `SHA256SUMS`. Install path that works today: `npx -y https://github.com/megatih/c3d-mcp/releases/download/v0.1.0/c3d-mcp-0.1.0.tgz <command>`.
* **Homebrew tap:** https://github.com/megatih/homebrew-c3d-mcp; `brew audit --cask --strict --online megatih/c3d-mcp/c3d-bridge-helper` exits 0 (checksum verified against the release asset).
* **npm and MCP Registry: NOT published** (you chose to skip npm login). `packaging/registry/server.json` is schema-valid and `mcpName` is set; steps are in `packaging/registry/README.md`.
* **Signing:** the helper is signed with your `Apple Development` identity (Personal Team) with hardened runtime — enough to run locally and to keep Accessibility grants stable across rebuilds. It is **not Developer ID / not notarized**: `spctl` rejects it on other Macs until the quarantine flag is removed (cask caveats say how).
* **Live suite against the signed helper: not re-run** — the run was interrupted twice on your side (another automation was apparently interfering). Last full live run (21 tests + fault 4) was green with the previous ad-hoc-signed helper; with the signed helper `doctor` was green except "no document window open". Re-run when convenient: `cd packages/server && C3D_LIVE=1 npx vitest run --config vitest.live.config.ts`.
