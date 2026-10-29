import { connect } from './live-driver.mjs';
const { client, close } = await connect();
for (const t of (await client.listTools()).tools) {
  const p = t.inputSchema.properties ?? {}; const req = new Set(t.inputSchema.required ?? []);
  console.log(t.name + '(' + Object.entries(p).map(([k, v]) => `${k}${req.has(k) ? '*' : ''}:${v.enum ? v.enum.join('|') : (v.type ?? (v.anyOf ? 'any' : '?'))}`).join(', ') + ')');
}
await close();
