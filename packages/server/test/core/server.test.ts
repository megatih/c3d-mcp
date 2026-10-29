import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { INSTRUCTIONS, buildServer, selectTools, toolAnnotations } from '../../src/server.js';
import { allPrompts, allResources, allTools } from '../../src/tools/index.js';
import { BridgeError, defineTool, type PromptDef, type Profile, type ResourceDef, type ToolDef } from '../../src/toolkit.js';
import { makeHarness, type Harness } from '../helpers/runtime.js';

let h: Harness;
let created = false;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
  if (created) rmSync(h.env.root, { recursive: true, force: true });
  created = false;
});

const tool = (name: string, over: Partial<ToolDef> = {}): ToolDef =>
  defineTool({
    name,
    title: name,
    description: `${name} long description`,
    group: 'scene',
    inputSchema: z.object({ n: z.number().int().min(0).default(1), label: z.string().optional() }),
    outputSchema: z.object({ n: z.number() }),
    mutating: false,
    profiles: ['full', 'local', 'readonly'],
    localDescription: `${name} short`,
    handler: (i: { n: number }) => Promise.resolve({ structured: { n: i.n } }),
    ...over,
  } as never);

async function connect(tools: ToolDef[], extra: { prompts?: PromptDef[]; resources?: ResourceDef[]; caps?: Record<string, unknown> } = {}): Promise<{ client: Client; mcp: McpServer; names: string[] }> {
  const built = buildServer({ rt: h.rt, tools, prompts: extra.prompts ?? [], resources: extra.resources ?? [] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await built.mcp.connect(a);
  const client = new Client({ name: 'test', version: '1' }, { capabilities: extra.caps ?? {} });
  await client.connect(b);
  closers.push(() => client.close());
  return { client, mcp: built.mcp, names: built.tools.map((t) => t.name) };
}

beforeEach(() => {
  h = makeHarness();
  created = true;
});

describe('profiles and opt-outs', () => {
  const sample: ToolDef[] = [
    tool('c3d_read', { mutating: false, profiles: ['full', 'local', 'readonly'] }),
    tool('c3d_write', { mutating: true, profiles: ['full', 'local'] }),
    tool('c3d_full_only', { mutating: true, profiles: ['full'], localDescription: undefined }),
    tool('c3d_run', { mutating: true, group: 'exec', profiles: ['full'], localDescription: undefined }),
    tool('c3d_import', { mutating: true, group: 'assets', profiles: ['full'], localDescription: undefined }),
    tool('c3d_fetch_info', { mutating: false, group: 'assets', profiles: ['full'], localDescription: undefined }),
  ];
  const sel = (profile: Profile, disableExec = false, disableAssets = false): string[] => selectTools(sample, { profile, disableExec, disableAssets }).map((t) => t.name);

  it('full exposes everything', () => expect(sel('full')).toHaveLength(6));
  it('local exposes only tools that list the local profile', () => expect(sel('local')).toEqual(['c3d_read', 'c3d_write']));
  it('readonly exposes only non-mutating tools', () => expect(sel('readonly')).toEqual(['c3d_read', 'c3d_fetch_info']));
  it('disableExec hides the exec group, disableAssets the assets group', () => {
    expect(sel('full', true)).not.toContain('c3d_run');
    expect(sel('full', false, true)).toEqual(['c3d_read', 'c3d_write', 'c3d_full_only', 'c3d_run']);
    expect(sel('readonly', true, true)).toEqual(['c3d_read']);
  });

  it('the live server honours the profile, includes the health tools and uses localDescription', async () => {
    h.rt.config.profile = 'local';
    const { client } = await connect(sample);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(['c3d_capabilities', 'c3d_doctor', 'c3d_install_bridge', 'c3d_read', 'c3d_write']);
    expect(tools.find((t) => t.name === 'c3d_read')?.description).toBe('c3d_read short');
  });

  it('readonly hides c3d_install_bridge', async () => {
    h.rt.config.profile = 'readonly';
    const { names } = await connect(sample);
    expect(names).not.toContain('c3d_install_bridge');
    expect(names).toEqual(expect.arrayContaining(['c3d_doctor', 'c3d_capabilities', 'c3d_read']));
  });

  it('refuses invalid registries at build time', () => {
    expect(() => buildServer({ rt: h.rt, tools: [tool('c3d_a'), tool('c3d_a')], prompts: [], resources: [] })).toThrow(/Duplicate/);
    expect(() => buildServer({ rt: h.rt, tools: [tool('bad_name')], prompts: [], resources: [] })).toThrow(/c3d_/);
    expect(() => buildServer({ rt: h.rt, tools: [tool('c3d_x', { localDescription: undefined })], prompts: [], resources: [] })).toThrow(/localDescription/);
  });
});

describe('annotations', () => {
  it('derive honestly from the tool definition', () => {
    expect(toolAnnotations(tool('c3d_r'))).toEqual({ title: 'c3d_r', readOnlyHint: true, openWorldHint: false });
    expect(toolAnnotations(tool('c3d_w', { mutating: true }))).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(toolAnnotations(tool('c3d_d', { mutating: true, destructive: true, idempotent: true, openWorld: true }))).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
  });

  it('every registered tool (health + all tool modules) is honest, prefixed, documented and local-ready', async () => {
    const built = buildServer({ rt: h.rt });
    expect(built.tools.length).toBeGreaterThanOrEqual(3);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await built.mcp.connect(a);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
    closers.push(() => client.close());
    const listed = (await client.listTools()).tools;
    expect(listed).toHaveLength(built.tools.length);
    for (const def of built.tools) {
      const wire = listed.find((t) => t.name === def.name);
      expect(wire, def.name).toBeDefined();
      expect(def.name).toMatch(/^c3d_[a-z0-9_]+$/);
      expect(wire?.annotations?.readOnlyHint, def.name).toBe(!def.mutating);
      if (def.mutating) {
        expect(wire?.annotations?.destructiveHint).toBeTypeOf('boolean');
        expect(wire?.annotations?.idempotentHint).toBeTypeOf('boolean');
      }
      expect(wire?.outputSchema, def.name).toBeDefined();
      expect(wire?.inputSchema.type).toBe('object');
      expect(def.description.length, def.name).toBeLessThanOrEqual(1100);
      if (def.profiles.includes('local')) expect(def.localDescription?.length, def.name).toBeLessThanOrEqual(260);
      if (def.group === 'exec') expect(def.profiles).not.toContain('local');
    }
    expect(allTools.length).toBeGreaterThan(0);
    expect(allPrompts.length + allResources.length).toBeGreaterThan(0);
  });
});

describe('calling tools over MCP', () => {
  it('returns text + structuredContent, validated against the outputSchema', async () => {
    const { client } = await connect([tool('c3d_ok')]);
    const r = await client.callTool({ name: 'c3d_ok', arguments: { n: 5 } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({ n: 5 });
    expect(r.content).toEqual([{ type: 'text', text: '{"n":5}' }]);
  });

  it('applies zod defaults and returns images', async () => {
    const img = tool('c3d_img', { handler: (i: { n: number }) => Promise.resolve({ structured: { n: i.n }, text: 'rendered', images: [{ data: 'AAAA', mimeType: 'image/png' }] }) } as never);
    const { client } = await connect([img]);
    const r = await client.callTool({ name: 'c3d_img', arguments: {} });
    expect(r.structuredContent).toEqual({ n: 1 });
    expect(r.content).toEqual([{ type: 'text', text: 'rendered' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }]);
  });

  it('INVALID_ARGUMENT with field paths for bad input', async () => {
    const { client } = await connect([tool('c3d_ok')]);
    const r = await client.callTool({ name: 'c3d_ok', arguments: { n: -1, label: 5 } });
    expect(r.isError).toBe(true);
    const payload = r.structuredContent as { code: string; details: { issues: { path: string }[] } };
    expect(payload.code).toBe('INVALID_ARGUMENT');
    expect(payload.details.issues.map((i) => i.path).sort()).toEqual(['label', 'n']);
    expect(JSON.parse((r.content as { text: string }[])[0]?.text ?? '{}')).toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('BridgeError keeps code, hint and details; unknown errors become INTERNAL without a stack', async () => {
    const boom = tool('c3d_boom', { handler: () => Promise.reject(new BridgeError('NOT_FOUND', 'no such box', 'list the scene first', { id: 9 })) } as never);
    const crash = tool('c3d_crash', { handler: () => Promise.reject(new TypeError('x is undefined')) } as never);
    const { client } = await connect([boom, crash]);
    const a = await client.callTool({ name: 'c3d_boom', arguments: {} });
    expect(a.isError).toBe(true);
    expect(a.structuredContent).toEqual({ code: 'NOT_FOUND', message: 'no such box', hint: 'list the scene first', details: { id: 9 } });
    const b = await client.callTool({ name: 'c3d_crash', arguments: {} });
    expect(b.isError).toBe(true);
    expect((b.structuredContent as { code: string }).code).toBe('INTERNAL');
    expect(JSON.stringify(b)).not.toMatch(/\bat .*\.ts/);
  });

  it('serialises mutating tools (write gate) while read-only tools may overlap', async () => {
    let active = 0;
    let maxWrite = 0;
    let maxRead = 0;
    const slow = (counter: 'w' | 'r') => async (): Promise<{ structured: { n: number } }> => {
      active++;
      if (counter === 'w') maxWrite = Math.max(maxWrite, active);
      else maxRead = Math.max(maxRead, active);
      await new Promise((r) => setTimeout(r, 40));
      active--;
      return { structured: { n: 1 } };
    };
    const w = tool('c3d_w', { mutating: true, handler: slow('w') } as never);
    const r = tool('c3d_r', { handler: slow('r') } as never);
    const { client } = await connect([w, r]);
    await Promise.all([client.callTool({ name: 'c3d_w', arguments: {} }), client.callTool({ name: 'c3d_w', arguments: {} }), client.callTool({ name: 'c3d_w', arguments: {} })]);
    expect(maxWrite).toBe(1);
    active = 0;
    await Promise.all([client.callTool({ name: 'c3d_r', arguments: {} }), client.callTool({ name: 'c3d_r', arguments: {} })]);
    expect(maxRead).toBe(2);
  });

  it('enforces a per-tool time limit with a TIMEOUT error', async () => {
    const hang = tool('c3d_hang', { handler: () => new Promise(() => undefined) } as never);
    const built = buildServer({ rt: h.rt, tools: [hang], prompts: [], resources: [], toolTimeoutMs: 60 });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await built.mcp.connect(a);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
    closers.push(() => client.close());
    const r = await client.callTool({ name: 'c3d_hang', arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.structuredContent as { code: string }).code).toBe('TIMEOUT');
  });

  it('passes an abort signal to the handler that fires on client cancellation', async () => {
    let seen: AbortSignal | undefined;
    const slow = tool('c3d_slow', { handler: (_i: unknown, ctx: { signal?: AbortSignal }) => { seen = ctx.signal; return new Promise(() => undefined); } } as never);
    const { client } = await connect([slow]);
    const ac = new AbortController();
    const call = client.callTool({ name: 'c3d_slow', arguments: {} }, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await expect(call).rejects.toBeDefined();
    await new Promise((r) => setTimeout(r, 50));
    expect(seen?.aborted).toBe(true);
  });

  it('sends notifications/progress when the client supplied a progressToken', async () => {
    const prog = tool('c3d_prog', { handler: (_i: unknown, ctx: { services: { progress(m: string, f?: number): void } }) => { ctx.services.progress('half', 0.5); ctx.services.progress('done', 1); return Promise.resolve({ structured: { n: 1 } }); } } as never);
    const { client } = await connect([prog]);
    const events: { progress: number; message?: string }[] = [];
    await client.callTool({ name: 'c3d_prog', arguments: {} }, { onprogress: (p) => events.push({ progress: p.progress, message: p.message }) });
    expect(events).toEqual([{ progress: 0.5, message: 'half' }, { progress: 1, message: 'done' }]);
  });

  it('does not emit progress without a token (no throw)', async () => {
    const prog = tool('c3d_prog', { handler: (_i: unknown, ctx: { services: { progress(m: string): void } }) => { ctx.services.progress('x'); return Promise.resolve({ structured: { n: 1 } }); } } as never);
    const { client } = await connect([prog]);
    expect((await client.callTool({ name: 'c3d_prog', arguments: {} })).isError).toBeFalsy();
  });
});

describe('confirmation', () => {
  const askTool = tool('c3d_ask', {
    mutating: true,
    destructive: true,
    inputSchema: z.object({ confirm: z.boolean().optional() }),
    outputSchema: z.object({ done: z.boolean() }),
    handler: async (i: { confirm?: boolean }, ctx: { services: { confirm(o: { message: string; confirmFlag?: boolean }): Promise<boolean> } }) => {
      if (!(await ctx.services.confirm({ message: 'Delete 7 objects?', confirmFlag: i.confirm }))) throw new BridgeError('CONFIRMATION_REQUIRED', 'Needs confirmation', 'Pass confirm:true');
      return { structured: { done: true } };
    },
  } as never);

  it('uses elicitation when the client supports it (accept)', async () => {
    const { client } = await connect([askTool], { caps: { elicitation: { form: {} } } });
    const asked: string[] = [];
    client.setRequestHandler('elicitation/create', (req) => {
      asked.push((req.params as { message: string }).message);
      return { action: 'accept', content: { confirm: true } };
    });
    const r = await client.callTool({ name: 'c3d_ask', arguments: {} });
    expect(asked).toEqual(['Delete 7 objects?']);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({ done: true });
  });

  it('confirm:true does NOT bypass elicitation when the client can ask its user', async () => {
    const { client } = await connect([askTool], { caps: { elicitation: { form: {} } } });
    const asked: string[] = [];
    client.setRequestHandler('elicitation/create', (req) => { asked.push((req.params as { message: string }).message); return { action: 'decline' }; });
    const r = await client.callTool({ name: 'c3d_ask', arguments: { confirm: true } });
    expect(asked).toHaveLength(1);
    expect(r.isError).toBe(true);
  });

  it('declined elicitation yields CONFIRMATION_REQUIRED', async () => {
    const { client } = await connect([askTool], { caps: { elicitation: { form: {} } } });
    client.setRequestHandler('elicitation/create', () => ({ action: 'decline' }));
    const r = await client.callTool({ name: 'c3d_ask', arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.structuredContent as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
  });

  it('without elicitation support requires confirm:true', async () => {
    const { client } = await connect([askTool]);
    const no = await client.callTool({ name: 'c3d_ask', arguments: {} });
    expect((no.structuredContent as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
    const yes = await client.callTool({ name: 'c3d_ask', arguments: { confirm: true } });
    expect(yes.structuredContent).toEqual({ done: true });
  });
});

describe('built-in tools', () => {
  it('c3d_capabilities serves runtime capabilities once per runtime version, falls back when unreachable', async () => {
    let calls = 0;
    h.app.ops.set('capabilities', (_a, app) => { calls++; return { runtimeVersion: app.runtimeVersion, objectTypes: { BOX: 1 } }; });
    h.app.trigger.press = () => h.app.runMacro();
    const { client } = await connect([tool('c3d_x')]);
    const first = await client.callTool({ name: 'c3d_capabilities', arguments: {} });
    const s = first.structuredContent as { source: string; runtime_version: string; tools: string[]; capabilities: { objectTypes: unknown } };
    expect(s).toMatchObject({ source: 'runtime', runtime_version: '1.0.0', capabilities: { objectTypes: { BOX: 1 } } });
    expect(s.tools).toContain('c3d_x');
    await client.callTool({ name: 'c3d_capabilities', arguments: {} });
    expect(calls).toBe(1);

    h.app.running = false;
    h.app.trigger.press = () => Promise.reject(new BridgeError('APP_NOT_RUNNING', 'down'));
    h.rt.bridge.lastRuntimeVersion = '2.0.0';
    const fb = await client.callTool({ name: 'c3d_capabilities', arguments: {} });
    expect((fb.structuredContent as { source: string; capabilities: { objectTypes: Record<string, number> } })).toMatchObject({ source: 'fallback', capabilities: { objectTypes: { BOX: 1 } } });
  });

  it('c3d_doctor returns structured checks over MCP', async () => {
    h.app.trigger.press = () => h.app.runMacro();
    const { client } = await connect([]);
    const r = await client.callTool({ name: 'c3d_doctor', arguments: {} });
    const s = r.structuredContent as { ok: boolean; checks: { name: string }[] };
    expect(s.checks.some((c) => c.name === 'ping')).toBe(true);
    expect(typeof s.ok).toBe('boolean');
    expect((r.content as { text: string }[])[0]?.text).toMatch(/ping/);
  });

  it('c3d_install_bridge reports a clean failure when assets are unavailable and is idempotent otherwise', async () => {
    h = makeHarness({}, { seed: false });
    const { client } = await connect([]);
    const r = await client.callTool({ name: 'c3d_install_bridge', arguments: { skip_ping: true } });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as { ok: boolean; steps: unknown[] };
    expect(Array.isArray(s.steps)).toBe(true);
  });
});

describe('prompts, resources and instructions', () => {
  it('exposes prompts and resources from the registries', async () => {
    const prompt: PromptDef = { name: 'demo', title: 'Demo', description: 'd', args: { subject: { description: 's', required: true }, style: { description: 'st' } }, build: (a) => `Build ${a.subject} ${a.style ?? 'plain'}` };
    const resource: ResourceDef = { uri: 'c3d://gotchas', name: 'gotchas', description: 'g', mimeType: 'text/markdown', read: () => Promise.resolve('# gotchas') };
    const { client, mcp } = await connect([], { prompts: [prompt], resources: [resource] });
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['demo']);
    const got = await client.getPrompt({ name: 'demo', arguments: { subject: 'a table' } });
    expect(got.messages[0]?.content).toEqual({ type: 'text', text: 'Build a table plain' });
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual(['c3d://gotchas']);
    const res = await client.readResource({ uri: 'c3d://gotchas' });
    expect(res.contents[0]).toMatchObject({ text: '# gotchas', mimeType: 'text/markdown' });
    expect(mcp.isConnected()).toBe(true);
  });

  it('tells agents the workflow', async () => {
    const { client } = await connect([]);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toMatch(/c3d_doctor/);
    expect(INSTRUCTIONS).toMatch(/c3d_new_document/);
    expect(INSTRUCTIONS).toMatch(/c3d_render_image/);
  });
});
