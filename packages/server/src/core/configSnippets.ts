import { homedir } from 'node:os';
import { join } from 'node:path';

export const CLIENTS = ['claude-desktop', 'claude-code', 'codex', 'gemini-cli', 'antigravity', 'cursor', 'lm-studio'] as const;
export type ClientName = (typeof CLIENTS)[number];

export interface SnippetOptions {
  /** `npx` runs `npx -y c3d-mcp serve`; `absolute` pins node and the installed bin (needed by GUI clients without a login PATH). */
  form?: 'npx' | 'absolute';
  nodePath?: string;
  binPath?: string;
  env?: Record<string, string>;
  serverName?: string;
  home?: string;
}

export interface ConfigSnippet {
  client: ClientName;
  language: 'json' | 'toml';
  /** Where the client reads its configuration (may be project-relative). */
  location: string;
  text: string;
  note: string;
}

const TIMEOUT_SEC = 600;

function launch(o: SnippetOptions): { command: string; args: string[] } {
  if ((o.form ?? 'npx') === 'absolute') return { command: o.nodePath ?? process.execPath, args: [o.binPath ?? '/usr/local/lib/node_modules/c3d-mcp/bin/c3d-mcp.js', 'serve'] };
  return { command: 'npx', args: ['-y', 'c3d-mcp', 'serve'] };
}

const tomlStr = (s: string): string => JSON.stringify(s);

export function configSnippet(client: ClientName, o: SnippetOptions = {}): ConfigSnippet {
  const home = o.home ?? homedir();
  const name = o.serverName ?? 'c3d';
  const { command, args } = launch(o);
  const env = o.env && Object.keys(o.env).length > 0 ? o.env : undefined;
  const json = (extra: Record<string, unknown> = {}): string => JSON.stringify({ mcpServers: { [name]: { command, args, ...(env ? { env } : {}), ...extra } } }, null, 2);

  switch (client) {
    case 'claude-desktop':
      return { client, language: 'json', location: join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), text: json(), note: 'Merge into the existing mcpServers object, then restart Claude Desktop. Prefer --form absolute: GUI apps do not inherit your shell PATH.' };
    case 'claude-code':
      return { client, language: 'json', location: '.mcp.json (project) or `claude mcp add`', text: json({ type: 'stdio' }), note: `Or run: claude mcp add ${name} -- ${[command, ...args].join(' ')}` };
    case 'codex': {
      const lines = [`[mcp_servers.${name}]`, `command = ${tomlStr(command)}`, `args = [${args.map(tomlStr).join(', ')}]`, `tool_timeout_sec = ${TIMEOUT_SEC}`, 'startup_timeout_sec = 30'];
      if (env) lines.push(`env = { ${Object.entries(env).map(([k, v]) => `${k} = ${tomlStr(v)}`).join(', ')} }`);
      return { client, language: 'toml', location: join(home, '.codex', 'config.toml'), text: `${lines.join('\n')}\n`, note: 'tool_timeout_sec defaults to 60 in Codex; renders can take longer.' };
    }
    case 'gemini-cli':
      return { client, language: 'json', location: join(home, '.gemini', 'settings.json'), text: json({ timeout: TIMEOUT_SEC * 1000 }), note: 'timeout is in milliseconds.' };
    case 'antigravity':
      return { client, language: 'json', location: join(home, '.gemini', 'config', 'mcp_config.json'), text: json(), note: 'Sources disagree on the path; Antigravity may also read .agents/mcp_config.json in the workspace (verify in its MCP settings).' };
    case 'cursor':
      return { client, language: 'json', location: join(home, '.cursor', 'mcp.json'), text: json(), note: 'Use .cursor/mcp.json in a project for a per-project install.' };
    case 'lm-studio':
      return { client, language: 'json', location: join(home, '.lmstudio', 'mcp.json'), text: json(), note: 'Edit via LM Studio > Program > Install > Edit mcp.json. Pair with C3D_MCP_PROFILE=local for small models.' };
  }
}
