// Minimal tool-calling agent loop for local models served through an OpenAI-compatible endpoint (mlx_lm.server, LM Studio, Ollama).
// Drives the c3d MCP server over stdio exactly like an MCP client would, and returns the same shape run.mjs gets from `claude -p`.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export async function runLocalAgent({ prompt, system, serverArgs, env, baseUrl, model, maxTurns = 30, timeoutMs = 600_000 }) {
  const transport = new StdioClientTransport({ command: process.execPath, args: serverArgs, env: { ...process.env, ...env } });
  const client = new Client({ name: 'local-agent', version: '1' });
  await client.connect(transport);
  const transcript = []; let answer = ''; let turns = 0;
  const deadline = Date.now() + timeoutMs;
  try {
    const tools = (await client.listTools()).tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    const messages = [{ role: 'system', content: system }, { role: 'user', content: prompt }];
    while (turns < maxTurns && Date.now() < deadline) {
      turns++;
      const res = await fetch(`${baseUrl}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, tools, temperature: 0.2, max_tokens: 6000, chat_template_kwargs: { enable_thinking: process.env.C3D_LOCAL_THINKING === '1' } }) });
      if (!res.ok) throw new Error(`model server ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const msg = (await res.json()).choices[0].message;
      messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
      if (!msg.tool_calls?.length) { answer = msg.content ?? ''; break; }
      for (const tc of msg.tool_calls) {
        let args = {};
        try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : tc.function.arguments ?? {}; } catch { args = {}; }
        let text; let isError = false;
        try {
          const r = await client.callTool({ name: tc.function.name, arguments: args });
          isError = !!r.isError;
          text = (r.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
        } catch (e) { isError = true; text = String(e); }
        transcript.push({ name: `mcp__c3d__${tc.function.name}`, input: args, isError });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: text.slice(0, 6000) });
      }
    }
  } finally { await client.close(); }
  return { transcript, answer, turns };
}
