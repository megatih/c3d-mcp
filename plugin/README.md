# c3d-mcp Claude Code plugin

Adds the `c3d` MCP server (via `npx -y https://github.com/megatih/c3d-mcp/releases/download/v0.1.0/c3d-mcp-0.1.0.tgz serve` until the package is on npm), a `cheetah3d` skill (workflow + Cheetah3D scripting facts) and a SessionStart hook that prints a one-line `c3d-mcp doctor --brief` status when `c3d-mcp` is installed on your PATH (`npm i -g c3d-mcp`); the hook never downloads anything.

```
claude plugin marketplace add megatih/c3d-mcp
claude plugin install c3d-mcp
```

The plugin does not install the in-app bridge: run `npx -y c3d-mcp install` once (or ask Claude to call `c3d_install_bridge`), restart Cheetah3D, and grant the helper Accessibility (see `docs/SETUP.md`).
