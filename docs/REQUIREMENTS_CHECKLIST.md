# Requirements "Done" checklist — evidence (2026-10-29)

> **Snapshot of the 0.1.0 delivery (2026-10-29).** Evidence paths and counts (59 tools, 412 tests, `release/c3d-mcp-0.1.0.tgz`) are historical; the 0.1.0 artifacts were withdrawn. See `CHANGELOG.md` for the current release and `docs/qa/research-traceability-audit.md` for the latest audit.

| §1 item | Status | Evidence |
|---|---|---|
| M0–M7 acceptance; every probe has `RESULT:` | met | `research/08-open-questions-and-probes.md` (P21/P22 recorded as not needed; P25/P26 verified live: capture works, helper is its own TCC subject); `docs/PROGRESS.md` |
| Unit, contract, live tests; lint + typecheck | met | 412 server tests (95.95 % lines), 74 bridge cases, 65 helper tests, 21 live + 1 opt-in kill test, lint/typecheck clean — `docs/qa/*.log` |
| Eval suite ≥ 24 tasks, `claude -p`, N=3, spend cap, ≥ 85 % | met | 31 tasks; 91/93 = 97.8 %; US$ 6.7 of 25 — `docs/qa/eval-notes.md`, `docs/qa/evals-*.json` |
| `local` profile ≥ 70 % with one MLX model | met | Qwen3.8-27B-4bit 9/9 (100 %); smaller models reported honestly |
| 100-request ping soak, extra-press idempotency, fault tests ≤ 2 × deadline | met | `test/live/soak.test.ts`, `faults.test.ts`, `crash.test.ts` (fault 4 run with authorization) |
| `uninstall && install && doctor` < 60 s (excl. restart) | met | 1.5 s, all green; timed fresh-Mac install is, per the requirements, a **manual checklist item for the user** |
| npm tarball | met | `release/c3d-mcp-0.1.0.tgz` (installed in a clean dir; 59 tools, 6 resources, 4 prompts) |
| `.mcpb` (`validate && pack`) | met | `release/c3d-mcp-0.1.0.mcpb` — `mcpb validate` + `pack` with the pinned CLI (2.1.2) succeeded. §1 asks for validate+pack, not for a client install |
| Claude Code plugin + marketplace (`claude plugin validate`) | met | both validate ✔ |
| Helper `.app` zip + Homebrew cask (`brew audit --cask` / `ruby -c`) | met | `release/C3D-Bridge-Helper-0.1.0.zip`; `brew audit --cask --strict` exit 0; `ruby -c` ✔ |
| Registry `server.json` schema-validated | met | validated against the published draft-07 schema |
| `notarize.sh --dry-run` exits 0 and prints the planned `xcrun notarytool submit` | met | verified; no Apple contact. Real notarization needs credentials → requirements section 0 "PAUSE: signing/notarization credential needed" |
| MCP conformance suite | **run** (partial by nature) | 6/30 pass via a dev-only HTTP wrapper of the same server; the other 24 need the suite's own reference fixture tools/resources/prompts or optional capabilities — `docs/qa/conformance.md`. MCP Inspector CLI `tools/list` also run |
| Docs complete | met | README, `docs/SETUP.md`, `TOOLS.md` (generated), `TROUBLESHOOTING.md`, `SECURITY.md`, `limitations.md` |
| `docs/FINAL_REPORT.md` | met | present |

## Not part of §1 / not possible here (listed in FINAL_REPORT)
Runs in Claude Desktop, Gemini CLI, Cursor, LM Studio and Antigravity (not installed here; requirements section 1 asks for *tested config snippets*, which are generated and unit-tested; Claude Code and Codex CLI were exercised for real), the timed fresh-Mac install (manual by definition), Developer ID signing/notarization (needs credentials) and any publishing (requirements section 9: never without explicit user approval).

## Update after your approvals
GitHub repo + v0.1.0 release + Homebrew tap published; helper signed with your Apple Development identity (not notarized); npm/registry skipped by your choice; live suite not re-run against the signed helper (interrupted). See `docs/FINAL_REPORT.md` → *Publishing and signing state*.

## Claude Desktop
`.mcpb` installed and the server answered list requests in Claude Desktop (see FINAL_REPORT); tool call from a chat not yet evidenced.

## Claude Desktop tool call
`c3d_doctor` run from Claude Desktop (installed from the .mcpb) passed all checks. Real clients exercised: Claude Code, Codex CLI, Claude Desktop.

## 0.1.1 (benchmark follow-ups)
Fixes from the Cornell Box and Cyberpunk Diorama runs are released as 0.1.1 (see CHANGELOG.md and docs/benchmark/cyberpunk-diorama-results.md). Remaining open: light `axis` mapping, crash #2 root cause, missing renderer features (docs/limitations.md).
