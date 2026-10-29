# 04 — MCP spec, SDKs, best practices (researched 2026-10-29)

> Version numbers below were reported by research agents from web sources; **re-verify on npm/PyPI at the start of M1 and pin exact versions.**

## Spec **2026-07-28** (released 2026-07-28) — [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- **Stateless core:** no `initialize` handshake / `Mcp-Session-Id`; each request carries protocol version + client capabilities in `_meta`; servers implement `server/discover`. Cross-call state = server-minted handles passed back as ordinary args (e.g. `render_id`).
- **Multi Round-Trip Requests (MRTR, SEP-2322):** replaces server-initiated elicitation/sampling/roots. Server returns `resultType:"input_required"` + `inputRequests`; client retries with `inputResponses`. Every result has `resultType`. Elicitation still available via MRTR → use for destructive confirmations.
- **Deprecated (12-month window):** Sampling, Roots, Logging → log to stderr/files; optional OpenTelemetry (`traceparent` in `_meta`).
- **Tasks** are an extension (`io.modelcontextprotocol/tasks`); SDK support incomplete (Python 2.0 excludes; TS v2 passes conformance except Tasks) → **do not depend on Tasks**; use server-minted handles + polling tools for long ops, plus `notifications/progress` on the request's stream.
- **Schemas:** any JSON Schema 2020-12 in `inputSchema`/`outputSchema`; `structuredContent` any JSON value. `tools/list` results carry `ttlMs`/`cacheScope`; keep tool order stable.
- **Tool annotations:** `readOnlyHint destructiveHint idempotentHint openWorldHint title`; defaults assume writable+destructive+open-world; hints are not security. Codex `default_tools_approval_mode="writes"` keys off `readOnlyHint`.
- **MCP Apps** (first official extension, Apr 2026): `_meta.ui.resourceUri: "ui://…"`, `text/html;profile=mcp-app` in sandboxed iframe (Claude, ChatGPT, VS Code, Goose). Optional later (scene tree / render preview panel); not for v1.

## SDKs ([tiers](https://modelcontextprotocol.io/docs/sdk))
| SDK | Tier | Reported latest | Notes |
|---|---|---|---|
| TypeScript v2 `@modelcontextprotocol/server` (+ client pkg) | 1 | 2.4.0 (≈2026-10-23) | Zod v4/ArkType/Valibot/JSON Schema, `registerTool()`; [docs](https://ts.sdk.modelcontextprotocol.io/v2/) |
| Python `mcp` v2 (`MCPServer`, ex-FastMCP) | 1 | 2.3.0 | no Tasks |
| Swift `modelcontextprotocol/swift-sdk` | 3 | 0.12.1 | only spec 2025-11-25 |
**Decision: TypeScript server + Swift helper** (user-approved). Claude Desktop bundles Node → `.mcpb type:node` is one-click.

## Best practices adopted
- Few, high-level, namespaced tools (`c3d_*`) + one code-exec escape hatch (`c3d_run_script`); expose API docs as resources/search so agents write JS against the API ([Anthropic: writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), [code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp); independent test ≈78 % fewer input tokens).
- Always return `structuredContent` + `outputSchema` + a short text summary; `response_format: concise|detailed`; pagination; truncation hints.
- Failures = `isError:true` results with: what failed, why, how to fix, JS exception + line, valid example. No protocol errors for tool failures.
- Security: honest annotations; MRTR elicitation for destructive/bulk/`OS.system`/file-write; fall back to `confirm:true` argument if client lacks elicitation; 0700 mailbox; secret; atomic writes; timeouts; opt-out env vars per exec tool.
- stdio hygiene: **nothing but protocol on stdout**; log to stderr + `~/Library/Logs/c3d-mcp/`.
- Testing: MCP Inspector, official conformance suite, scene-task evals (multi-step, checkable via scene dump), `claude plugin validate`.
