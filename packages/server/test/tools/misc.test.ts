/* eslint-disable @typescript-eslint/no-unsafe-call -- loosely typed runtime data; indices are bounds-checked by construction */
import { beforeEach, describe, expect, it } from 'vitest';
import { setKeyframes, getKeyframes, setFps, setTime, takes } from '../../src/tools/animation.js';
import { setCamera, setLight } from '../../src/tools/cameraLight.js';
import { addTag, removeTag, setTagParams } from '../../src/tools/tags.js';
import { expectCode, makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';

let t: TestCtx;
beforeEach(() => { t = makeCtx(); });

describe('tags', () => {
  it('adds, configures and removes tags', async () => {
    const o = t.bridge.addObject('BOX', 'B');
    const a = await runTool(addTag, { ref: o.id, type: 'targettag' }, t.ctx);
    expect(a.structured).toMatchObject({ tagIndex: 0, type: 'TARGETTAG' });
    const s = await runTool(setTagParams, { ref: o.id, tag_index: 0, params: { priority: 5 } }, t.ctx);
    expect(s.structured.applied).toEqual(['priority']);
    await expectCode(runTool(setTagParams, { ref: o.id, tag_index: 4, params: { a: 1 } }, t.ctx), 'NOT_FOUND');
    const r = await runTool(removeTag, { ref: o.id, tag_index: 0 }, t.ctx);
    expect(r.structured.tags).toEqual([]);
    await expectCode(runTool(removeTag, { ref: o.id, tag_index: 3 }, t.ctx), 'NOT_FOUND');
    expect(() => addTag.inputSchema.parse({ ref: 1 })).toThrow();
  });
});

describe('c3d_set_camera', () => {
  it('creates an aimed active camera with fov', async () => {
    const r = await runTool(setCamera, { name: 'Main', position: [0, 2, 8], look_at_point: [0, 0, 0], fov: 35, active: true }, t.ctx);
    const id = (r.structured.object as any).id;
    expect(t.bridge.objects.get(id)!.params.fieldOfView).toBe(35);
    expect((r.structured.look_at as any).residual_deg).toBeLessThan(1e-6);
    expect(t.bridge.doc.activeCamera).toBe(id);
    expect(t.bridge.opNames()).toContain('setActiveCamera');
  });
  it('reconfigures an existing camera and rejects non-cameras', async () => {
    const c = t.bridge.addObject('CAMERA', 'C');
    await runTool(setCamera, { ref: c.id, name: 'Renamed', far: 500 }, t.ctx);
    expect(c.name).toBe('Renamed');
    expect(c.params.clipFar).toBe(500);
    const b = t.bridge.addObject('BOX', 'B');
    await expectCode(runTool(setCamera, { ref: b.id }, t.ctx), 'INVALID_ARGUMENT');
    expect(() => setCamera.inputSchema.parse({ fov: 500 })).toThrow();
  });
});

describe('c3d_set_light', () => {
  it('creates a colored light aimed at a target with a type name', async () => {
    const target = t.bridge.addObject('BOX', 'T', null, { position: { x: 0, y: 0, z: 0 } });
    const r = await runTool(setLight, { name: 'Key', light_type: 'spot', position: [3, 4, 3], color: '#ffeedd', intensity: 1.5, look_at_ref: target.id }, t.ctx);
    const l = t.bridge.objects.get((r.structured.object as any).id)!;
    expect(l.params).toMatchObject({ lightType: 2, intensity: 1.5 });
    expect(l.params.color.r).toBeCloseTo(1);
    expect((r.structured.look_at as any).residual_deg).toBeLessThan(1e-6);
    // Cheetah3D lights cast along their `axis` option; aiming with -Z needs axis 2 (live probe: 0=-X, 1=-Y default, >=2=-Z)
    expect(l.params.axis).toBe(2);
  });
  it('rejects unknown light type names and wrong object types', async () => {
    const e = await expectCode(runTool(setLight, { light_type: 'laser' }, t.ctx), 'INVALID_ARGUMENT');
    expect(e.hint).toMatch(/point/);
    const b = t.bridge.addObject('BOX', 'B');
    await expectCode(runTool(setLight, { ref: b.id }, t.ctx), 'INVALID_ARGUMENT');
  });
});

describe('animation', () => {
  it('sets time and fps', async () => {
    expect((await runTool(setTime, { time: 1.5 }, t.ctx)).structured.time).toBe(1.5);
    expect((await runTool(setFps, { fps: 24 }, t.ctx)).structured.fps).toBe(24);
    expect(() => setTime.inputSchema.parse({ time: -1 })).toThrow();
    expect(() => setFps.inputSchema.parse({ fps: 0 })).toThrow();
  });
  it('manages takes', async () => {
    await runTool(takes, { action: 'add', name: 'Alt' }, t.ctx);
    const r = await runTool(takes, { action: 'list' }, t.ctx);
    expect((r.structured.takes as unknown[]).length).toBe(2);
    await runTool(takes, { action: 'select', name: 'Alt' }, t.ctx);
    expect(t.bridge.doc.current).toBe('Alt');
    await expectCode(runTool(takes, { action: 'add' }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(takes, { action: 'rename', name: 'Alt' }, t.ctx), 'INVALID_ARGUMENT');
  });
  it('sets and reads vector keyframes, passing arrays and objects to the runtime unchanged', async () => {
    const o = t.bridge.addObject('BALL', 'Ball');
    const r = await runTool(setKeyframes, { ref: o.id, param: 'position', keys: [{ time: 0, value: [0, 2, 0] }, { time: 1, value: [0, 0, 0], interpolation: 'soft' }, { time: 2, value: { x: 0, y: 2, z: 0 } }] }, t.ctx);
    expect(r.structured.components).toHaveLength(3);
    expect(t.bridge.argsOf('setKeyframes')[0]).toMatchObject({ replace: true, keys: [{ value: [0, 2, 0] }, { value: [0, 0, 0], interpolation: 'soft' }, { value: { x: 0, y: 2, z: 0 } }] });
    const g = await runTool(getKeyframes, { ref: o.id, param: 'position' }, t.ctx);
    expect((g.structured.components as any[])[1].keys.map((k: any) => k.value)).toEqual([2, 0, 2]);
  });
  it('rejects duplicate times and bad keys', async () => {
    const o = t.bridge.addObject('BALL', 'Ball');
    await expectCode(runTool(setKeyframes, { ref: o.id, param: 'intensity', keys: [{ time: 1, value: 1 }, { time: 1, value: 2 }] }, t.ctx), 'INVALID_ARGUMENT');
    expect(() => setKeyframes.inputSchema.parse({ ref: o.id, param: 'p', keys: [] })).toThrow();
    expect(() => setKeyframes.inputSchema.parse({ ref: o.id, param: 'p', keys: [{ time: -1, value: 1 }] })).toThrow();
    expect(() => setKeyframes.inputSchema.parse({ ref: o.id, param: 'p', keys: [{ time: 0, value: [1, 2] }] })).toThrow();
  });
});
