# MCP conformance suite (`@modelcontextprotocol/conformance` 0.1.16) — RUN, partial by nature

The suite only speaks HTTP, so `packages/server/scripts/conformance-http.mjs` (dev-only, not shipped) serves the *same* `buildServer()` definition through the SDK's `createMcpHandler` on 127.0.0.1:8099, and the suite was run with `conformance server --url http://127.0.0.1:8099/mcp` (2026-10-29).

**Result: 6 passed, 24 failed of 30 scenarios.**

* Passed (generic protocol behaviour): `server-initialize`, `ping`, `tools-list`, `resources-list`, `prompts-list`, `server-sse-multiple-streams`.
* Failed because the suite expects its own reference fixtures, which a Cheetah3D server does not define: `tools-call-*` (`test_simple_text`, `test_image_content`, …: "Tool … not found"), `resources-read-*`/`resources-templates-read`/`resources-subscribe`/`unsubscribe` (`test://static-text`…), `prompts-get-*` (`test_simple_prompt`…), `elicitation-sep*` and `tools-call-sampling/elicitation/with-progress/with-logging` (need fixture tools).
* Failed because the optional capability is not declared: `logging-set-level`, `completion-complete` ("Method not found").
* `dns-rebinding-protection`: Host/Origin validation was not enabled in the dev HTTP wrapper; the shipped transport is stdio, where it does not apply.

Interpretation: no protocol-level violations were found in the scenarios that apply to this server; the rest of the suite cannot pass for any server that does not ship the suite's fixture tools. Tool-call behaviour, progress, elicitation and error shapes are covered instead by the in-process MCP client tests (`test/core/server.test.ts`, `stdio.test.ts`), the MCP Inspector CLI `tools/list` run, and real-client runs with Claude Code and Codex CLI.
