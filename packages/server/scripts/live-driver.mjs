// Dev driver: runs a scenario of tool calls against the REAL Cheetah3D through `serve`. Usage: node scripts/live-driver.mjs <scenario.json|name>
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export async function connect(env = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'bin/c3d-mcp.js'), 'serve'], env: { ...process.env, ...env }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => { if (process.env.C3D_DEBUG) process.stderr.write(c); });
  const client = new Client({ name: 'live', version: '1' });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const t0 = Date.now();
    const r = await client.callTool({ name, arguments: args });
    const ms = Date.now() - t0;
    return { name, args, ms, isError: !!r.isError, sc: r.structuredContent, text: r.content?.map((c) => c.type === 'text' ? c.text : `[${c.type}]`).join(' ').slice(0, 300) };
  };
  return { client, call, close: () => client.close() };
}
