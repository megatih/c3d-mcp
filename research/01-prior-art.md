# 01 — Prior art (researched 2026-10-29)

## Verdict
**No MCP server, AI bridge or external-control tool exists for Cheetah3D.** Checked: GitHub, the official MCP registry (`registry.modelcontextprotocol.io`, 0 hits for "cheetah"), glama.ai (0), mcp.so (0), npm (0), the Cheetah3D forum, Reddit, general web search. PyPI search page did not load (unchecked, but web search found nothing). **Decision: build the bridge and server from scratch; reuse the documentation assets below.**

## Cheetah3D-related projects
| Project | State | What it is | Reuse |
|---|---|---|---|
| [tonioloewald/c3d-scripting-kb](https://github.com/tonioloewald/c3d-scripting-kb) | Active (Oct 2026), MIT (forum scripts CC BY, official docs © MW3D-Solutions) | 8.1.1 API reference in Markdown + machine-readable `reference/api-index.json`, ~450 "gotchas", templates per script type, 274 archived forum scripts, 539 forum thread transcripts, AI context packs (`dist/c3d-context-short.md` ≈5k tokens, `-full.md` ≈34k), Claude Code `skill/SKILL.md`, `llms.txt`, `tools/c3d_lint.py` linter | **HIGH.** Vendor (pinned commit) as MCP resources, `search_api_docs` corpus, and lint rules. No runtime bridge. Announced in forum thread [Using AI to write / fix / improve scripts](https://www.cheetah3d.com/forum/index.php?threads/14713/) |
| [wholder/Cheetah3DParser](https://github.com/wholder/Cheetah3DParser) | ~2020, Java, MIT, experimental | Read-only `.jas` parser (dd-plist) + OBJ/MTL export | Format notes only: root keys Render/Takes/Materials3/Animation/Layer/Objects/Version; vertices big-endian float4; little-endian `pointArray` with 16-byte header; negative count starts each polygon; UV V flipped; 27-byte keyframes. No `.jas` writer exists anywhere. |
| [Lisapple/Cheetah3D-Collada-Exporter](https://github.com/Lisapple/Cheetah3D-Collada-Exporter) | 2018, JS | In-app Collada exporter incl. animation | Example of scene-graph/animation walking |
| [voidtuxic/Cheetah2Babylon](https://github.com/voidtuxic/Cheetah2Babylon) | old, JS | In-app `.babylon` exporter | Scene serialization example |
| [RomanoMcBride/Cheetah3DPlugins](https://github.com/RomanoMcBride/Cheetah3DPlugins) | 2026, MIT | BakeAOVertex, TerrainProjector scripts | Unrelated to control |
| [draese/Cheetah3DThread](https://github.com/draese/Cheetah3DThread) | 2018 | parametric thread script | trivial |
| [tonioloewald/Learn-3D-with-Cheetah-3D](https://github.com/tonioloewald/Learn-3D-with-Cheetah-3D) | — | "Missing Manual" | background |
| Forum: [Master List of Scripts](https://www.cheetah3d.com/forum/showthread.php?p=42637), Scripting subforums | — | community scripts | already harvested by c3d-scripting-kb |
| lorddevereux/cheetah3d | 2026 | **unrelated** (decompiled "Gepard3D" engine) | ignore |

**Historical external-driving precedent:** Hiroto (tg_jp) 2016 JXA batch renderer, forum [thread 11774](https://www.cheetah3d.com/forum/index.php?threads/11774/): opened `.jas` files, triggered a hotkeyed helper macro, closed docs via simulated keystrokes; users reported timing problems (skipped files, save dialogs). Confirms the "external trigger + loader macro" pattern, and its fragility.

## How other DCC MCP servers are built
| Server | Bridge | Tools | Visual feedback | Safety / packaging |
|---|---|---|---|---|
| [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) (~32.6k★, MIT) | add-on TCP socket :9876, JSON `{type,params}` | 9 tools: `execute_blender_code` + typed scene info/look/search_assets/import_asset/generate_3d | `look` viewport/camera render, multi-angle sheets | no socket auth; `BLENDER_MCP_SAFE_MODE=1` static check; uvx |
| ttiimmaacc/cinema4d-mcp, kumoproductions/mcp-cinema4d | `.pyp` plugin socket | typed + code exec | — | version-mismatch errors between plugin and package |
| gimbalgoats/gg_mayamcp | Maya built-in commandPort 7001 | 71 typed tools; raw exec **off unless opted in** | — | pip |
| capoomgit/houdini-mcp | plugin socket :9876 | node ops + code exec | render script | uv + package json |
| CoplayDev/unity-mcp (~8.9k★) | editor package + Python server | ~47 typed tools | — | uvx |
| chongdashu/unreal-mcp | C++ plugin TCP :55557 | typed (actors, Blueprints, viewport) | viewport | paused |
| mhyrr/sketchup-mcp | Ruby ext TCP :9876 | 7 typed + `eval_ruby` | none | `.rbz` + uvx |
| jingcheng-chen/rhinomcp (~1.2k★) | plugin TCP 127.0.0.1:1999, main-thread exec, 15 s timeout | typed + exec tools, **each disable-able by env var**; **JSON Schema `contracts/` shared by both sides** | `capture_viewport` | Yak package |
| Dakkshin/after-effects-mcp, p10q/ae-mcp | **No sockets: file mailbox**; ExtendScript panel polls / CEP watches command files; results written back as files | typed + `run-script` + `get-results` | — | Node/TS + `install-bridge.js` — **closest analogue to Cheetah3D** |

### Lessons adopted
1. Two parts: thin in-app listener + external MCP server.
2. Typed tools + one escape hatch; make the hatch disable-able (Rhino/Maya).
3. Scene introspection + visual feedback tools are essential.
4. Assets are fetched by the external server (Poly Haven CC0 needs no key); key-gated sources disable their tools when no key.
5. Existing safety is weak (unauthenticated sockets) → do better.
6. Version skew plugin↔server is a known failure → version handshake + shared JSON Schema contracts.
