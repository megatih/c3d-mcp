# 06 — Frontier agents vs. local MLX models

## Evidence (leaderboard snapshots; figures vary by source — treat as indicative)
- **MCP-Atlas** (BenchLM, 2026-09-29): frontier leads (Muse Spark 1.1 88.1 %, Fable 5.1 87.2 %; Opus 5 85.8 % in July). Best open-weight: GLM-5.3 84.2 %, Inkling-Small 79.2 % — hundreds of B params (Kimi K3 2.8T) ⇒ **not runnable on a typical Mac**. [BenchLM](https://benchlm.ai/benchmarks/mcpatlas), [DataLearner](https://www.datalearner.com/en/benchmarks/mcp-atlas).
- **BFCL v4:** frontier leads; open-weight trails ≈5–10 pts ([BenchLM](https://benchlm.ai/benchmarks/bfcl-v4), [presenc](https://presenc.ai/research/open-weight-function-calling-tool-use-2026)).
- Mac-runnable (4-bit MLX: Qwen3-32B, Qwen3-Coder-30B-A3B, Gemma 4 27B): ~93–97 % well-formed simple tool calls (unverified source: [PromptQuorum](https://www.promptquorum.com/power-local-llm/best-local-models-tool-calling-2026)); Qwen most reliable in community tests; <4B params unreliable.
- The gap is **long multi-step agent runs and writing correct code against an obscure API** (Cheetah3D JS), not single calls.

## Decision
1. **Primary target: frontier agent clients** — Claude Code / Claude Desktop (Opus/Sonnet 5.x), OpenAI Codex, Google Antigravity/Gemini. Best at the `c3d_run_script` escape hatch and error recovery.
2. **Second tier: local MLX** via LM Studio (MCP host since 0.3.17, MLX engine), Ollama (MLX backend ≥0.19), `mlx_lm.server` + any MCP client. Server flag/env **`C3D_MCP_PROFILE=local`**: small strict schemas with enums, curated high-level tools only, **no `run_script`**, shorter descriptions, deterministic outputs, tool list ≤ ~25 (LM Studio warns big tool lists overflow small contexts).
3. **No LLM inside the server** (sampling is deprecated; let the client's model reason).
4. **On-device ML that is worth it:** Apple Vision in the helper (render checks); BM25 over the vendored API index for `c3d_search_api_docs` (corpus is small; embeddings via `NLContextualEmbedding` optional, not required).
5. Run the **same eval suite across clients/models** (frontier + one MLX model) and publish pass rates per profile.
6. Apple Silicon unified-memory/GPU relevance is mostly **inside Cheetah3D's Metal renderer** (the app is universal; it already uses Metal). The server's own hot paths (JSON, file polling, image downscale via ImageIO/vImage, Vision) are light; use native arm64 builds only (no Rosetta) and Accelerate/vImage for downscaling in the helper.
