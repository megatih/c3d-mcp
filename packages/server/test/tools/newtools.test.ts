import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { setBackground } from '../../src/tools/cameraLight.js';
import { createPipe } from '../../src/tools/geometry.js';
import { postprocessImage, setRenderSettings } from '../../src/tools/render.js';
import { getSceneStats, setParameters } from '../../src/tools/scene.js';
import { setTagParams } from '../../src/tools/tags.js';
import { setKeyframes } from '../../src/tools/animation.js';
import { BridgeError } from '../../src/toolkit.js';
import { expectCode, makeCtx, makePng, runTool, type TestCtx } from '../helpers/fakeBridge.js';

let t: TestCtx;
beforeEach(() => { t = makeCtx(); });

describe('c3d_get_scene_stats', () => {
  it('reports counts from the bridge op', async () => {
    const f = t.bridge.addObject('FOLDER', 'F');
    t.bridge.addObject('BOX', 'B', f.id);
    t.bridge.addObject('LIGHT', 'L');
    await runTool(createPipe, { points: [[0, 0, 0], [0, 1, 0]], radius: 0.1, segments: 6 }, t.ctx);
    const r = await runTool(getSceneStats, {}, t.ctx);
    expect(r.structured).toMatchObject({ objectCount: 4, folderCount: 1, lightCount: 1, polygonObjectCount: 1, byType: { BOX: 1, FOLDER: 1 } });
    expect(r.text).toMatch(/4 objects/);
  });
  it('limits to a root and passes it normalised', async () => {
    const f = t.bridge.addObject('FOLDER', 'F');
    t.bridge.addObject('BOX', 'B', f.id);
    const r = await runTool(getSceneStats, { root: f.id }, t.ctx);
    expect(r.structured.objectCount).toBe(2);
    expect(t.bridge.argsOf('sceneStats')[0]).toEqual({ root: { id: f.id } });
  });
});

describe('c3d_create_pipe', () => {
  it('builds the mesh and sends it through createMesh with name/parent/material', async () => {
    t.bridge.materials.push({ index: 0, name: 'Steel', rootNodeType: 'material', nodes: [], connections: [] });
    const folder = t.bridge.addObject('FOLDER', 'F');
    const r = await runTool(createPipe, { name: 'Cable', parent: folder.id, points: [[0, 0, 0], [3, 0, 0], [3, 3, 0]], radius: 0.2, segments: 8, bend_radius: 1, arc_steps: 4, material: 'Steel', position: [1, 2, 3] }, t.ctx);
    expect(r.structured).toMatchObject({ ringCount: 1 + 5 + 1, vertexCount: 7 * 8 + 2, polygonCount: 6 * 8 + 16, chunks: 1 });
    const a = t.bridge.argsOf('createMesh')[0];
    expect(a).toMatchObject({ name: 'Cable', parent: { id: folder.id }, material: { name: 'Steel' }, transform: { position: { x: 1, y: 2, z: 3 } } });
    expect(a.vertices).toHaveLength(7 * 8 + 2);
  });
  it('rejects bad geometry with INVALID_ARGUMENT and sends nothing', async () => {
    await expectCode(runTool(createPipe, { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], radius: 0.1, bend_radius: 5 }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(createPipe, { points: [[0, 0, 0], [0, 0, 0]], radius: 0.1 }, t.ctx), 'INVALID_ARGUMENT');
    expect(t.bridge.calls).toHaveLength(0);
    expect(() => createPipe.inputSchema.parse({ points: [[0, 0, 0]], radius: 1 })).toThrow();
    expect(() => createPipe.inputSchema.parse({ points: [[0, 0, 0], [1, 0, 0]], radius: 1, segments: 3 })).toThrow();
  });
  it('chunks big pipes', async () => {
    const pts = Array.from({ length: 150 }, (_, i) => [i, Math.sin(i), 0]);
    const r = await runTool(createPipe, { points: pts, radius: 0.1, segments: 48 }, t.ctx);
    expect(r.structured.chunks).toBeGreaterThan(1);
    expect(t.bridge.objects.get(Number((r.structured.object as any).id))!.mesh!.vertices).toHaveLength(150 * 48 + 2);
  });
});

describe('c3d_set_background', () => {
  it('gradient: writes a unique PNG into <workDir>/backgrounds and sets backgroundImage on the active camera', async () => {
    const cam = t.bridge.addObject('CAMERA', 'Cam'); t.bridge.doc.activeCamera = cam.id;
    const r = await runTool(setBackground, { kind: 'gradient', stops: [{ pos: 0, color: '#000033' }, { pos: 1, color: '#ff8800' }], width: 32, height: 18 }, t.ctx);
    const file = String(r.structured.path);
    expect(file.startsWith(path.join(t.ctx.config.workDir, 'backgrounds'))).toBe(true);
    expect(fs.readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
    expect(t.bridge.argsOf('setParameters')[0]).toMatchObject({ ref: { id: cam.id }, params: { backgroundImage: file } });
    expect(cam.params.backgroundImage).toBe(file);
    const r2 = await runTool(setBackground, { kind: 'gradient', stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }], angle_deg: 0, width: 8, height: 8 }, t.ctx);
    expect(r2.structured.path).not.toBe(file);
  });
  it('solid sets backgroundColor; image validates the file', async () => {
    const cam = t.bridge.addObject('CAMERA', 'Cam'); t.bridge.doc.activeCamera = cam.id;
    await runTool(setBackground, { kind: 'solid', color: '#ff0000' }, t.ctx);
    expect(cam.params.backgroundColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    await expectCode(runTool(setBackground, { kind: 'solid' }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(setBackground, { kind: 'image', path: 'rel.png' }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(setBackground, { kind: 'image', path: '/tmp/x.bmp' }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(setBackground, { kind: 'image', path: path.join(t.dir, 'nope.png') }, t.ctx), 'NOT_FOUND');
    const img = path.join(t.dir, 'bg.png'); fs.writeFileSync(img, makePng(2, 2, () => [1, 2, 3]));
    const r = await runTool(setBackground, { kind: 'image', path: img }, t.ctx);
    expect(cam.params.backgroundImage).toBe(img);
    expect(r.structured.camera).toEqual({ id: cam.id });
  });
  it('validates gradient stops and needs a camera', async () => {
    expect(() => setBackground.inputSchema.parse({ kind: 'gradient', stops: [{ pos: 0, color: '#000000' }] })).toThrow();
    expect(() => setBackground.inputSchema.parse({ kind: 'gradient', stops: [{ pos: 2, color: '#000000' }, { pos: 1, color: '#000000' }] })).toThrow();
    expect(() => setBackground.inputSchema.parse({ kind: 'gradient', width: 5000, stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#000000' }] })).toThrow();
    t.bridge.canned.set('getDocumentInfo', { activeCamera: null });
    await expectCode(runTool(setBackground, { kind: 'solid', color: '#000000' }, t.ctx), 'NOT_FOUND');
  });
});

describe('c3d_postprocess_image', () => {
  const src = (): string => { const p = path.join(t.ctx.config.workDir, 'renders', 'shot.png'); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, makePng(8, 6, (x, y) => [x * 30, y * 40, 90])); return p; };
  const fakeHelperCmd = (): void => {
    t.helper.handlers.set('postProcessImage', (a: any) => { fs.mkdirSync(path.dirname(a.outPath), { recursive: true }); fs.writeFileSync(a.outPath, makePng(8, 6, () => [200, 100, 50])); return { outPath: a.outPath, width: 8, height: 6, bytes: 99, applied: Object.keys(a).filter((k) => !['path', 'outPath'].includes(k)) }; });
  };
  it('calls the helper with camelCase args, writes <name>_post_<n>.png and returns a preview', async () => {
    const s = src(); fakeHelperCmd();
    const r = await runTool(postprocessImage, { path: s, bloom: { intensity: 0.5 }, outline: { strength: 1, color: [0, 0, 0] }, grade: { saturation: 1.2, tint_amount: 0.3, shadow_tint: [0, 0, 1] }, posterize: { levels: 5 } }, t.ctx);
    expect(String(r.structured.path)).toMatch(/post[/\\]shot_post_1\.png$/);
    expect(r.structured.applied).toEqual(['bloom', 'outline', 'grade', 'posterize']);
    expect(r.images).toHaveLength(1);
    const call = t.helper.calls.find((c) => c.cmd === 'postProcessImage')!;
    expect(call.args).toMatchObject({ path: s, bloom: { intensity: 0.5 }, grade: { saturation: 1.2, tintAmount: 0.3, shadowTint: [0, 0, 1] }, posterize: { levels: 5 } });
    const r2 = await runTool(postprocessImage, { path: s, vignette: { intensity: 0.4 }, include_image: false }, t.ctx);
    expect(String(r2.structured.path)).toMatch(/shot_post_2\.png$/);
    expect(r2.images).toEqual([]);
  });
  it('never overwrites an explicit out_path that exists', async () => {
    const s = src(); fakeHelperCmd();
    const o = path.join(t.dir, 'there.png'); fs.writeFileSync(o, 'x');
    await expectCode(runTool(postprocessImage, { path: s, out_path: o, vignette: {} }, t.ctx), 'INVALID_ARGUMENT');
  });
  it('validates: needs an effect, an existing source, ranges', async () => {
    await expectCode(runTool(postprocessImage, { path: src() }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(postprocessImage, { path: path.join(t.dir, 'missing.png'), vignette: {} }, t.ctx), 'NOT_FOUND');
    expect(() => postprocessImage.inputSchema.parse({ path: 'a.png', posterize: { levels: 1 } })).toThrow();
    expect(() => postprocessImage.inputSchema.parse({ path: 'a.png', outline: { width: 9 } })).toThrow();
    expect(() => postprocessImage.inputSchema.parse({ path: 'a.png', grade: { contrast: 2 } })).toThrow();
  });
  it('returns UNSUPPORTED when the helper is missing or lacks the command', async () => {
    const s = src();
    t.helper.on = false;
    const e = await expectCode(runTool(postprocessImage, { path: s, vignette: {} }, t.ctx), 'UNSUPPORTED');
    expect(e.hint).toMatch(/c3d-mcp install/);
    t.helper.on = true;
    t.helper.handlers.set('postProcessImage', () => { throw new BridgeError('INVALID_ARGUMENT', 'Unknown command postProcessImage'); });
    const e2 = await expectCode(runTool(postprocessImage, { path: s, vignette: {} }, t.ctx), 'UNSUPPORTED');
    expect(e2.hint).toMatch(/c3d-mcp install/);
  });
});

describe('c3d_set_render_settings partial results', () => {
  it('surfaces applied and per-key errors instead of failing', async () => {
    t.bridge.canned.set('setRenderSettings', { renderer: 'CHEETAH', resolution: { x: 640, y: 360 }, applied: ['exposure'], errors: [{ name: 'bogusKey', code: 'NOT_FOUND', message: 'no parameter bogusKey' }] });
    const r = await runTool(setRenderSettings, { width: 640, height: 360, params: { exposure: 1, bogusKey: 2 } }, t.ctx);
    expect(r.structured).toMatchObject({ applied: ['exposure'], errors: [{ name: 'bogusKey', code: 'NOT_FOUND' }], resolution: { x: 640, y: 360 } });
    expect(r.text).toMatch(/bogusKey/);
  });
  it('still fails when nothing was applied', async () => {
    t.bridge.canned.set('setRenderSettings', { applied: [], errors: [{ name: 'bogusKey', code: 'NOT_FOUND', message: 'no parameter bogusKey' }] });
    const e = await expectCode(runTool(setRenderSettings, { params: { bogusKey: 2 } }, t.ctx), 'NOT_FOUND');
    expect(e.message).toMatch(/bogusKey/);
  });
});

describe('Link {ref} normalisation', () => {
  it('turns numeric and path refs into runtime refs in set_parameters and set_tag_params', async () => {
    const o = t.bridge.addObject('BOX', 'B'); const target = t.bridge.addObject('NULL', 'T');
    o.tags.push({ type: 'TARGETTAG', params: {} });
    await runTool(setParameters, { ref: o.id, params: { link: { ref: target.id }, other: { ref: '/T' }, plain: 3, vec: { x: 1, y: 2, z: 3 } } }, t.ctx);
    expect(t.bridge.argsOf('setParameters')[0].params).toEqual({ link: { ref: { id: target.id } }, other: { ref: { path: '/T' } }, plain: 3, vec: { x: 1, y: 2, z: 3 } });
    await runTool(setTagParams, { ref: o.id, tag_index: 0, params: { target: { ref: target.id } } }, t.ctx);
    expect(t.bridge.argsOf('setParameters')[1].params).toEqual({ target: { ref: { id: target.id } } });
  });
});

describe('c3d_set_keyframes', () => {
  it('documents and passes 3-component values for Vec4D parameters', async () => {
    expect(setKeyframes.description).toMatch(/Vec4D/);
    const o = t.bridge.addObject('LIGHT', 'L');
    await runTool(setKeyframes, { ref: o.id, param: 'color', keys: [{ time: 0, value: [1, 0.5, 0.2] }, { time: 1, value: [0, 0, 1, 1] }] }, t.ctx);
    expect((t.bridge.argsOf('setKeyframes')[0] as { keys: Array<{ value: unknown }> }).keys.map((k) => k.value)).toEqual([{ x: 1, y: 0.5, z: 0.2 }, { x: 0, y: 0, z: 1, w: 1 }]);
  });
});
