/* eslint-disable @typescript-eslint/no-unsafe-call -- loosely typed runtime data; indices are bounds-checked by construction */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as opener from '../../src/lib/opener.js';
import { importAsset, searchAssets } from '../../src/tools/assets.js';
import { expectCode, makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';

vi.mock('../../src/lib/opener.js', () => ({ openWithCheetah: vi.fn(async () => undefined) }));

const md5 = (b: Buffer | string): string => createHash('md5').update(b).digest('hex');
const FBX = Buffer.from('fake-fbx-data');
const TEX = Buffer.from('fake-texture');

interface Hit { url: string }
let t: TestCtx;
let hits: Hit[];
let files: Record<string, any>;
let bodies: Record<string, Buffer>;

function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    hits.push({ url: u });
    if (u.startsWith('https://api.polyhaven.com/assets')) return Response.json({ chair_01: { name: 'Chair 01', categories: ['furniture', 'seating'], tags: ['wood', 'chair'], download_count: 900 }, lamp_02: { name: 'Lamp', categories: ['lighting'], tags: ['metal'], download_count: 5 }, table_03: { name: 'Table', categories: ['furniture'], tags: ['wood'], download_count: 300 } });
    if (u.includes('/info/')) return Response.json({ name: 'Chair 01', type: 2, authors: { 'Jane Doe': 'All' } });
    if (u.includes('/files/')) return Response.json(files);
    const body = bodies[u];
    return body ? new Response(new Uint8Array(body), { headers: { 'content-length': String(body.length) } }) : new Response('nope', { status: 404 });
  }));
}

beforeEach(() => {
  t = makeCtx(); hits = [];
  vi.mocked(opener.openWithCheetah).mockClear();
  bodies = { 'https://dl.polyhaven.org/chair.fbx': FBX, 'https://dl.polyhaven.org/tex/wood.jpg': TEX };
  files = { fbx: { '1k': { fbx: { url: 'https://dl.polyhaven.org/chair.fbx', md5: md5(FBX), size: FBX.length, include: { 'textures/wood.jpg': { url: 'https://dl.polyhaven.org/tex/wood.jpg', md5: md5(TEX), size: TEX.length } } } } } };
  t.helper.handlers.set('windows', () => [{ title: 'chair.fbx', role: 'AXWindow', main: true }]);
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe('c3d_search_assets', () => {
  it('filters by keyword and sorts by popularity', async () => {
    const r = await runTool(searchAssets, { query: 'wood' }, t.ctx);
    expect((r.structured.assets as any[]).map((a) => a.id)).toEqual(['chair_01', 'table_03']);
    expect(hits[0]!.url).toBe('https://api.polyhaven.com/assets?t=models');
  });
  it('paginates and passes category/type', async () => {
    const r = await runTool(searchAssets, { limit: 1, type: 'hdris', category: 'outdoor' }, t.ctx);
    expect(r.structured).toMatchObject({ total: 3, next_offset: 1 });
    expect(hits[0]!.url).toContain('t=hdris&c=outdoor');
  });
  it('is disabled by config and surfaces HTTP failures', async () => {
    await expectCode(runTool(searchAssets, {}, makeCtx({ config: { disableAssets: true } }).ctx), 'NOT_AVAILABLE_IN_PROFILE');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    await expectCode(runTool(searchAssets, {}, t.ctx), 'DEPENDENCY_FAILED');
  });
});

describe('c3d_import_asset', () => {
  it('downloads FBX + textures, verifies md5, writes a license sidecar and opens the model', async () => {
    const r = await runTool(importAsset, { id: 'chair_01' }, t.ctx);
    const dir = path.join(t.ctx.config.workDir, 'assets', 'chair_01');
    expect(fs.readFileSync(path.join(dir, 'chair.fbx'))).toEqual(FBX);
    expect(fs.readFileSync(path.join(dir, 'textures', 'wood.jpg'))).toEqual(TEX);
    const side = JSON.parse(fs.readFileSync(path.join(dir, 'asset.json'), 'utf8'));
    expect(side).toMatchObject({ id: 'chair_01', license: 'CC0', authors: ['Jane Doe'], resolution: '1k' });
    expect(side.files.find((f: any) => f.path === 'chair.fbx').sha256).toBe(createHash('sha256').update(FBX).digest('hex'));
    expect(r.structured).toMatchObject({ license: 'CC0', authors: ['Jane Doe'], window: 'chair.fbx' });
    expect(opener.openWithCheetah).toHaveBeenCalledWith(path.join(dir, 'chair.fbx'));
    expect(t.ctx.session.expectDocument).toBeTruthy();
    expect(hits.some((h) => h.url.endsWith('.glb') || h.url.includes('gltf'))).toBe(false);
  });
  it('can skip opening', async () => {
    const r = await runTool(importAsset, { id: 'chair_01', open: false }, t.ctx);
    expect(r.structured.window).toBeUndefined();
    expect(opener.openWithCheetah).not.toHaveBeenCalled();
  });
  it('rejects an md5 mismatch', async () => {
    bodies['https://dl.polyhaven.org/chair.fbx'] = Buffer.from('tampered');
    const e = await expectCode(runTool(importAsset, { id: 'chair_01' }, t.ctx), 'DEPENDENCY_FAILED');
    expect(e.message).toMatch(/MD5/);
    expect(opener.openWithCheetah).not.toHaveBeenCalled();
  });
  it('enforces the 100 MB cap (declared sizes and actual bytes)', async () => {
    files.fbx['1k'].fbx.size = 120 * 1024 * 1024;
    await expectCode(runTool(importAsset, { id: 'chair_01' }, t.ctx), 'INVALID_ARGUMENT');
    files.fbx['1k'].fbx.size = 10;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes('/info/') ? Response.json({ authors: {} }) : u.includes('/files/') ? Response.json(files) : new Response('x', { headers: { 'content-length': String(200 * 1024 * 1024) } }))));
    await expectCode(runTool(importAsset, { id: 'chair_01' }, t.ctx), 'INVALID_ARGUMENT');
  });
  it('refuses non-https and foreign hosts', async () => {
    files.fbx['1k'].fbx.url = 'http://dl.polyhaven.org/chair.fbx';
    await expectCode(runTool(importAsset, { id: 'chair_01' }, t.ctx), 'INVALID_ARGUMENT');
    files.fbx['1k'].fbx.url = 'https://evil.example.com/chair.fbx';
    await expectCode(runTool(importAsset, { id: 'chair_01' }, t.ctx), 'INVALID_ARGUMENT');
  });
  it('enforces the extension allow-list and path safety for included files', async () => {
    files.fbx['1k'].fbx.include['bin/payload.exe'] = { url: 'https://dl.polyhaven.org/x.exe', size: 1 };
    await expectCode(runTool(importAsset, { id: 'chair_01' }, t.ctx), 'INVALID_ARGUMENT');
    delete files.fbx['1k'].fbx.include['bin/payload.exe'];
    files.fbx['1k'].fbx.include['../../escape.jpg'] = { url: 'https://dl.polyhaven.org/tex/wood.jpg', size: 1 };
    await expectCode(runTool(importAsset, { id: 'chair_01' }, t.ctx), 'INVALID_ARGUMENT');
    expect(fs.existsSync(path.join(t.ctx.config.workDir, 'escape.jpg'))).toBe(false);
  });
  it('reports missing FBX variants and invalid ids; respects the disable flag', async () => {
    files = { gltf: { '1k': {} } };
    const e = await expectCode(runTool(importAsset, { id: 'chair_01' }, t.ctx), 'NOT_FOUND');
    expect(e.message).toMatch(/FBX/);
    expect(() => importAsset.inputSchema.parse({ id: '../etc/passwd' })).toThrow();
    await expectCode(runTool(importAsset, { id: 'chair_01' }, makeCtx({ config: { disableAssets: true } }).ctx), 'NOT_AVAILABLE_IN_PROFILE');
  });
});
