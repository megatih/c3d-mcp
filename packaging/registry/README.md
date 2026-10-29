# MCP Registry (not published yet)

`server.json` is schema-valid but must not be published until the npm package `c3d-mcp` exists (its `mcpName` is already set in `package.json`) and `mcp-publisher login github` has been run by the owner. Steps: `npm publish` in `packages/server` → `npx mcp-publisher@0.4.2 publish` in `packaging/registry`.
