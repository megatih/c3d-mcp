// Dev-only: serves the SAME server definition (buildServer) over Streamable HTTP on 127.0.0.1 so the official MCP conformance suite
// (which only speaks HTTP) can be pointed at it:  node scripts/conformance-http.mjs [port]
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { loadConfig } from '../dist/config.js';
import { createRuntime } from '../dist/core/runtime.js';
import { buildServer } from '../dist/server.js';

const port = Number(process.argv[2] ?? 8099);
const rt = createRuntime(loadConfig());
const handler = createMcpHandler(() => buildServer({ rt }).mcp);
createServer(async (req, res) => {
  const url = `http://127.0.0.1:${port}${req.url}`;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, { method: req.method, headers: req.headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: 'half' });
  const response = await handler.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) { for await (const chunk of response.body) res.write(chunk); }
  res.end();
}).listen(port, '127.0.0.1', () => console.error(`conformance endpoint on http://127.0.0.1:${port}/mcp`));
