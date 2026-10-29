 
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearJobs, getJob } from '../../src/lib/jobs.js';
import { captureViewport, jobCancel, jobStatus, renderImage, renderSequence, setRenderSettings } from '../../src/tools/render.js';
import { BridgeError } from '../../src/toolkit.js';
import { expectCode, makeCtx, makePng, runTool, type TestCtx } from '../helpers/fakeBridge.js';

let t: TestCtx;
beforeEach(() => { t = makeCtx(); clearJobs(); });

const waitDone = async (id: string): Promise<void> => { for (let i = 0; i < 200 && getJob(id)!.status === 'running'; i++) await new Promise((r) => setTimeout(r, 10)); };

describe('c3d_set_render_settings', () => {
  it('sets resolution and engine', async () => {
    const r = await runTool(setRenderSettings, { renderer: 'FALCON', width: 800, height: 600, params: { giOn: true } }, t.ctx);
    expect(r.structured).toMatchObject({ renderer: 'FALCON', resolution: { x: 800, y: 600 } });
  });
  it('validates', async () => {
    await expectCode(runTool(setRenderSettings, {}, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(setRenderSettings, { width: 100 }, t.ctx), 'INVALID_ARGUMENT');
    expect(() => setRenderSettings.inputSchema.parse({ renderer: 'MENTAL' })).toThrow();
  });
});

describe('c3d_render_image', () => {
  it('renders into the work dir and returns stats plus a preview image', async () => {
    const r = await runTool(renderImage, { width: 64, height: 48 }, t.ctx);
    expect(r.structured).toMatchObject({ width: 64, height: 48, blank: false });
    expect(String(r.structured.path)).toMatch(/renders[/\\]render-\d+\.png$/);
    expect(fs.existsSync(String(r.structured.path))).toBe(true);
    expect(r.images).toHaveLength(1);
    expect(r.images![0]!.mimeType).toBe('image/png');
    expect(Buffer.from(r.images![0]!.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(t.bridge.opNames()).toEqual(['setRenderSettings', 'render']);
  });
  it('flags blank renders and can skip the image', async () => {
    t.bridge.blankRender = true;
    const r = await runTool(renderImage, { path: 'flat.png', include_image: false }, t.ctx);
    expect(r.structured.blank).toBe(true);
    expect(r.images).toEqual([]);
    expect(r.text).toMatch(/blank/);
  });
  it('rejects extensions Cheetah would choke on before touching the bridge', async () => {
    for (const p of ['a.bmp', 'a.exr', 'a', 'a.PNGX']) {
      const e = await expectCode(runTool(renderImage, { path: p }, t.ctx), 'INVALID_ARGUMENT');
      expect(e.hint).toMatch(/png/);
    }
    expect(t.bridge.calls).toHaveLength(0);
  });
  it('accepts jpg/tiff and passes the time', async () => {
    await runTool(renderImage, { path: 'x.tiff', time: 2 }, t.ctx);
    expect(t.bridge.argsOf('render')[0]).toMatchObject({ time: 2 });
  });
  it('never overwrites pre-existing files and requires width+height together', async () => {
    const f = path.join(t.dir, 'keep.png'); fs.writeFileSync(f, makePng(2, 2, () => [1, 1, 1]));
    await expectCode(runTool(renderImage, { path: f }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(renderImage, { width: 100 }, t.ctx), 'INVALID_ARGUMENT');
  });
  it('detects a missing output file', async () => {
    t.bridge.canned.set('render', (a: { path: string }) => ({ path: a.path, exists: true }));
    await expectCode(runTool(renderImage, {}, t.ctx), 'INTERNAL');
  });
});

describe('c3d_render_sequence + jobs', () => {
  it('renders frames in the background and reports progress', async () => {
    const r = await runTool(renderSequence, { end: 0.1, fps: 30, prefix: 'f' }, t.ctx);
    expect(r.structured.total_frames).toBe(4);
    const id = String(r.structured.job_id);
    await waitDone(id);
    const s = await runTool(jobStatus, { job_id: id }, t.ctx);
    expect((s.structured.jobs as any[])[0]).toMatchObject({ status: 'done', completed: 4, total: 4 });
    const files = fs.readdirSync(String(r.structured.directory)).sort();
    expect(files).toEqual(['f_0001.png', 'f_0002.png', 'f_0003.png', 'f_0004.png']);
    expect(t.bridge.argsOf('render').map((a) => a.time)).toEqual([0, 1 / 30, 2 / 30, 3 / 30]);
  });
  it('uses the document fps by default', async () => {
    t.bridge.doc.fps = 10;
    const r = await runTool(renderSequence, { end: 1 }, t.ctx);
    expect(r.structured.total_frames).toBe(11);
    await runTool(jobCancel, { job_id: String(r.structured.job_id) }, t.ctx);
  });
  it('can be cancelled mid-way', async () => {
    t.bridge.delayMs = 20;
    const r = await runTool(renderSequence, { end: 5, fps: 10 }, t.ctx);
    const id = String(r.structured.job_id);
    await new Promise((res) => setTimeout(res, 70));
    const c = await runTool(jobCancel, { job_id: id }, t.ctx);
    expect(c.structured.cancelled).toBe(true);
    await waitDone(id);
    const j = getJob(id)!;
    expect(j.status).toBe('cancelled');
    expect(j.completed).toBeLessThan(j.total);
    expect((await runTool(jobCancel, { job_id: id }, t.ctx)).structured.cancelled).toBe(false);
  });
  it('fails the job when a frame fails', async () => {
    t.bridge.failNth.set('render', { n: 2, count: 0, err: new BridgeError('APP_CRASHED', 'gone') });
    const r = await runTool(renderSequence, { end: 0.2, fps: 30 }, t.ctx);
    await waitDone(String(r.structured.job_id));
    expect(getJob(String(r.structured.job_id))).toMatchObject({ status: 'failed', completed: 1 });
  });
  it('validates ranges, frame cap, overwrites and job ids', async () => {
    await expectCode(runTool(renderSequence, { start: 2, end: 1 }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(renderSequence, { end: 1000, fps: 30 }, t.ctx), 'INVALID_ARGUMENT');
    const dir = path.join(t.dir, 'seq'); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'frame_0001.png'), 'x');
    await expectCode(runTool(renderSequence, { end: 0, fps: 30, directory: dir }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(renderSequence, { end: 0, fps: 30, directory: 'rel' }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(jobStatus, { job_id: 'nope' }, t.ctx), 'NOT_FOUND');
    await expectCode(runTool(jobCancel, { job_id: 'nope' }, t.ctx), 'NOT_FOUND');
    expect(() => renderSequence.inputSchema.parse({ end: 1, prefix: '../x' })).toThrow();
    expect(() => renderSequence.inputSchema.parse({ end: 1, format: 'exr' })).toThrow();
  });
  it('lists all jobs without an id', async () => {
    expect((await runTool(jobStatus, {}, t.ctx)).structured.jobs).toEqual([]);
  });
});

describe('c3d_capture_viewport', () => {
  it('captures through the helper and returns an image', async () => {
    t.helper.handlers.set('captureWindow', (a: any) => { fs.mkdirSync(path.dirname(a.outPath), { recursive: true }); fs.writeFileSync(a.outPath, makePng(32, 32, (x, y) => [x * 8, y * 8, 5])); return {}; });
    const r = await runTool(captureViewport, {}, t.ctx);
    expect(r.structured).toMatchObject({ width: 32, height: 32, blank: false });
    expect(r.images).toHaveLength(1);
  });
  it('maps permission problems', async () => {
    t.helper.handlers.set('captureWindow', () => { throw new BridgeError('INTERNAL', 'Screen recording not granted'); });
    await expectCode(runTool(captureViewport, {}, t.ctx), 'PERMISSION_MISSING');
    t.helper.on = false;
    await expectCode(runTool(captureViewport, {}, t.ctx), 'PERMISSION_MISSING');
  });
});
