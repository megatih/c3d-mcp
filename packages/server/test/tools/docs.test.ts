 
import { beforeEach, describe, expect, it } from 'vitest';
import { allResources } from '../../src/tools/index.js';
import { searchApiDocs } from '../../src/tools/docs.js';
import { makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';

let t: TestCtx;
beforeEach(() => { t = makeCtx(); });

describe('c3d_search_api_docs', () => {
  it('returns ranked snippets', async () => {
    const r = await runTool(searchApiDocs, { query: 'addIndexPolygon', limit: 3 }, t.ctx);
    expect((r.structured.results as any[]).length).toBeGreaterThan(0);
    expect(r.text).toMatch(/addIndexPolygon/);
  });
  it('handles empty results and validates input', async () => {
    const r = await runTool(searchApiDocs, { query: 'qqzzxxyy' }, t.ctx);
    expect(r.structured.count).toBe(0);
    expect(() => searchApiDocs.inputSchema.parse({ query: 'x' })).toThrow();
    expect(() => searchApiDocs.inputSchema.parse({ query: 'abc', limit: 50 })).toThrow();
  });
});

describe('resources', () => {
  it('serves docs, templates and the live scene', async () => {
    const byUri = Object.fromEntries(allResources.map((r) => [r.uri, r]));
    const ctx = { bridge: t.bridge, config: t.ctx.config, session: t.ctx.session };
    expect((await byUri['c3d://api/short']!.read(ctx)).length).toBeGreaterThan(500);
    expect(await byUri['c3d://gotchas']!.read(ctx)).toMatch(/mkDir/i);
    expect(await byUri['c3d://templates/macro']!.read(ctx)).toMatch(/function main/);
    expect(await byUri['c3d://templates/polygon-script']!.read(ctx)).toMatch(/buildObject/);
    t.bridge.addObject('BOX', 'B');
    const scene = JSON.parse(await byUri['c3d://scene']!.read(ctx));
    expect(scene.objects[0]).toMatchObject({ name: 'B', type: 'BOX' });
  });
});
