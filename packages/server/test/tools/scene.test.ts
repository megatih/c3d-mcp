/* eslint-disable @typescript-eslint/no-unsafe-call -- loosely typed runtime data; indices are bounds-checked by construction */
import { beforeEach, describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/toolkit.js';
import { createObject, deleteObjects, duplicate, getObject, getParameters, listScene, lookAt, rename, reparent, select, setParameters, setTransform } from '../../src/tools/scene.js';
import { eulerToMatrix } from '../../src/lib/lookAt.js';
import { expectCode, makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';

let t: TestCtx;
beforeEach(() => { t = makeCtx(); });
const mk = (type = 'BOX', name = 'Obj', parent?: number): number => t.bridge.addObject(type, name, parent ?? null).id;

describe('c3d_list_scene', () => {
  it('lists with pagination and concise/detailed formats', async () => {
    for (let i = 0; i < 5; i++) mk('BOX', `B${i}`);
    const a = await runTool(listScene, { limit: 2 }, t.ctx);
    expect((a.structured.items as any[]).map((x) => x.name)).toEqual(['B0', 'B1']);
    expect(a.structured).toMatchObject({ total: 5, next_offset: 2 });
    const b = await runTool(listScene, { offset: 4, limit: 2, response_format: 'detailed' }, t.ctx);
    expect(b.structured.next_offset).toBeNull();
    expect((b.structured.items as any[])[0].indexPath).toBeTruthy();
  });
  it('honours root and depth, and validates limits', async () => {
    const f = mk('FOLDER', 'F'); mk('BOX', 'In', f); mk('BOX', 'Out');
    const r = await runTool(listScene, { root: f }, t.ctx);
    expect((r.structured.items as any[]).map((x) => x.name)).toEqual(['In']);
    expect(() => listScene.inputSchema.parse({ limit: 9999 })).toThrow();
  });
  it('maps NOT_FOUND roots', async () => expectCode(runTool(listScene, { root: 12345 }, t.ctx), 'NOT_FOUND'));
});

describe('c3d_get_object', () => {
  it('requests tags by default and parameters on detailed', async () => {
    const id = mk();
    await runTool(getObject, { ref: id }, t.ctx);
    expect(t.bridge.argsOf('getObject')[0]).toMatchObject({ ref: { id }, include: ['tags'] });
    const r = await runTool(getObject, { ref: `/Obj`, response_format: 'detailed' }, t.ctx);
    expect((r.structured.object as any).parameters).toBeTruthy();
  });
  it('reports AMBIGUOUS with candidates', async () => {
    mk('BOX', 'Dup'); mk('BOX', 'Dup');
    const e = await expectCode(runTool(getObject, { ref: '/Dup' }, t.ctx), 'AMBIGUOUS');
    expect((e.details as any).candidates).toHaveLength(2);
  });
  it('rejects unknown include values', () => expect(() => getObject.inputSchema.parse({ ref: 1, include: ['x'] })).toThrow());
});

describe('c3d_create_object', () => {
  it('creates with transform, params and light type', async () => {
    const r = await runTool(createObject, { type: 'light', name: 'Key', position: [1, 2, 3], light_type: 2, params: { intensity: 2 } }, t.ctx);
    expect(t.bridge.argsOf('createObject')[0]).toMatchObject({ type: 'LIGHT', name: 'Key', lightType: 2, transform: { position: { x: 1, y: 2, z: 3 } }, params: { intensity: 2 } });
    expect((r.structured.object as any).name).toBe('Key');
  });
  it('rejects non-existent light constants with a hint', async () => {
    const e = await expectCode(runTool(createObject, { type: 'SPOTLIGHT' }, t.ctx), 'INVALID_ARGUMENT');
    expect(e.hint).toMatch(/LIGHT/);
    expect(t.bridge.calls).toHaveLength(0);
  });
  it('validates input', () => {
    expect(() => createObject.inputSchema.parse({})).toThrow();
    expect(() => createObject.inputSchema.parse({ type: 'BOX', light_type: 9 })).toThrow();
    expect(() => createObject.inputSchema.parse({ type: 'BOX', bogus: 1 })).toThrow();
  });
});

describe('c3d_delete_objects', () => {
  it('deletes a few leaf objects without confirmation but with an auto checkpoint', async () => {
    const a = mk(); const b = mk();
    const r = await runTool(deleteObjects, { refs: [a, b] }, t.ctx);
    expect(r.structured.removed).toBe(2);
    expect(t.confirmCalls).toHaveLength(0);
    expect(t.bridge.opNames()).toContain('saveTo');
    expect(r.structured.checkpoint).toBe('cp1');
  });
  it('asks for confirmation for objects with children and aborts when declined', async () => {
    const f = mk('FOLDER'); mk('BOX', 'c', f);
    t.setConfirm(false);
    await expectCode(runTool(deleteObjects, { refs: [f] }, t.ctx), 'CONFIRMATION_REQUIRED');
    expect(t.bridge.opNames()).not.toContain('deleteObjects');
    await runTool(deleteObjects, { refs: [f], confirm: true }, t.ctx);
    expect(t.bridge.opNames()).toContain('deleteObjects');
  });
  it('asks for confirmation for more than 5 objects', async () => {
    const ids = Array.from({ length: 6 }, () => mk());
    t.setConfirm(false);
    await expectCode(runTool(deleteObjects, { refs: ids }, t.ctx), 'CONFIRMATION_REQUIRED');
  });
  it('fails early on unknown objects and warns when the checkpoint is impossible', async () => {
    await expectCode(runTool(deleteObjects, { refs: [999] }, t.ctx), 'NOT_FOUND');
    const id = mk();
    t.bridge.failures.set('saveTo', new BridgeError('INTERNAL', 'x'));
    const r = await runTool(deleteObjects, { refs: [id] }, t.ctx);
    expect(r.structured.warning).toMatch(/cannot be undone/);
    expect(r.structured.removed).toBe(1);
  });
});

describe('reparent / rename / transform', () => {
  it('reparents under a folder', async () => {
    const f = mk('FOLDER', 'F'); const b = mk('BOX', 'B');
    const r = await runTool(reparent, { ref: b, parent: f, keep_world: true }, t.ctx);
    expect((r.structured.object as any).path).toBe('/F/B');
    expect(t.bridge.argsOf('reparent')[0]).toMatchObject({ keepWorld: true });
  });
  it('renames and supports path refs', async () => {
    mk('BOX', 'Old');
    const r = await runTool(rename, { ref: '/Old', name: 'New' }, t.ctx);
    expect((r.structured.object as any).name).toBe('New');
    expect(() => rename.inputSchema.parse({ ref: 1, name: '' })).toThrow();
  });
  it('sets transform and validates combos', async () => {
    const id = mk();
    const r = await runTool(setTransform, { ref: id, position: { x: 1, y: 2, z: 3 }, rotation: [10, 20, 30] }, t.ctx);
    expect((r.structured.transform as any).rotation).toEqual({ x: 10, y: 20, z: 30 });
    await expectCode(runTool(setTransform, { ref: id }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(setTransform, { ref: id, rotation: [1, 2, 3], space: 'world' }, t.ctx), 'INVALID_ARGUMENT');
  });
});

describe('parameters', () => {
  it('gets typed parameters and hides noise in concise mode', async () => {
    const id = mk();
    const r = await runTool(getParameters, { ref: id }, t.ctx);
    expect((r.structured.parameters as any[]).some((p) => p.name === 'scriptName')).toBe(false);
    expect((await runTool(getParameters, { ref: id, response_format: 'detailed' }, t.ctx)).structured.parameters).toHaveLength(4);
    await runTool(getParameters, { ref: id, tag_index: 0 }, t.ctx);
    expect(t.bridge.argsOf('getParameters')[2]).toMatchObject({ tag: { index: 0 } });
  });
  it('sets parameters with partial success and fails when nothing applies', async () => {
    const id = mk();
    const r = await runTool(setParameters, { ref: id, params: { sizex: 3, bogusName: 1 } }, t.ctx);
    expect(r.structured.applied).toEqual(['sizex']);
    expect((r.structured.errors as any[])[0].name).toBe('bogusName');
    const e = await expectCode(runTool(setParameters, { ref: id, params: { bogusA: 1 } }, t.ctx), 'NOT_FOUND');
    expect(e.hint).toMatch(/c3d_get_parameters/);
    await expectCode(runTool(setParameters, { ref: id, params: {} }, t.ctx), 'INVALID_ARGUMENT');
  });
  it('writes tag parameters when tag_index is given', async () => {
    const id = mk(); t.bridge.resolve({ id }).tags.push({ type: 'SHADERTAG', params: {} });
    await runTool(setParameters, { ref: id, tag_index: 0, params: { priority: 3 } }, t.ctx);
    expect(t.bridge.resolve({ id }).tags[0]!.params.priority).toBe(3);
  });
});

describe('c3d_select', () => {
  it('returns the previous selection', async () => {
    const a = mk(); const b = mk();
    await runTool(select, { refs: [a] }, t.ctx);
    const r = await runTool(select, { refs: [b] }, t.ctx);
    expect((r.structured.previous as any[])[0].id).toBe(a);
    expect(() => select.inputSchema.parse({})).toThrow();
  });
});

describe('c3d_look_at', () => {
  it('aims a camera at a point and reports a ~0 residual', async () => {
    const cam = t.bridge.addObject('CAMERA', 'Cam', null, { position: { x: 2.5, y: 2.34, z: 4.34 } });
    const r = await runTool(lookAt, { ref: cam.id, target_point: [0, 0, 0] }, t.ctx);
    expect(r.structured.residual_deg as number).toBeLessThan(1e-6);
    const rot = (r.structured.rotation as any);
    expect(rot.x).toBeCloseTo(30, 0);
    expect(rot.y).toBeCloseTo(-25, 0);
  });
  it('aims at an object, accounting for a rotated parent', async () => {
    const parent = t.bridge.addObject('FOLDER', 'P', null, { rotation: { x: 40, y: -10, z: 25 }, position: { x: 1, y: 0, z: 0 } });
    const cam = t.bridge.addObject('CAMERA', 'C', parent.id, { position: { x: 0, y: 2, z: 5 } });
    const target = t.bridge.addObject('BOX', 'T', null, { position: { x: -3, y: 1, z: -2 } });
    const r = await runTool(lookAt, { ref: cam.id, target_ref: target.id }, t.ctx);
    expect(r.structured.residual_deg as number).toBeLessThan(1e-5);
  });
  it('requires exactly one target and rejects coincident targets', async () => {
    const cam = mk('CAMERA');
    await expectCode(runTool(lookAt, { ref: cam }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(lookAt, { ref: cam, target_ref: 1, target_point: [0, 0, 0] }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(lookAt, { ref: cam, target_point: [0, 0, 0] }, t.ctx), 'INVALID_ARGUMENT');
  });
  it('warns when the read-back is off (wrong forward axis)', async () => {
    const cam = t.bridge.addObject('CAMERA', 'C', null, { position: { x: 0, y: 0, z: 5 } });
    const orig = t.bridge.exec.bind(t.bridge);
    t.bridge.exec = (op: string, a: any) => { const r = orig(op, a); if (op === 'getObject' && a.include?.includes('worldMatrix') && cam.params.rotation.x !== 0) r.worldMatrix.rows = eulerToMatrix(90, 0, 0); return r; };
    const r = await runTool(lookAt, { ref: cam.id, target_point: [3, 4, 0] }, t.ctx);
    expect(r.structured.warning).toMatch(/forward/);
  });
});

describe('c3d_duplicate', () => {
  it('copy method rebuilds the tree (lossy) with offsets', async () => {
    const f = t.bridge.addObject('FOLDER', 'F', null, { position: { x: 1, y: 0, z: 0 } });
    t.bridge.addObject('BOX', 'Child', f.id, { sizex: 2 });
    const r = await runTool(duplicate, { ref: f.id, method: 'copy', count: 2, offset: [0, 0, 5] }, t.ctx);
    expect(r.structured).toMatchObject({ method: 'copy', lossy: true });
    expect((r.structured.copies as any[]).length).toBe(2);
    const names = [...t.bridge.objects.values()].map((o) => o.name);
    expect(names.filter((n) => n === 'Child')).toHaveLength(3);
    const copies = (r.structured.copies as any[]).map((c) => t.bridge.objects.get(c.id)!);
    expect(copies[1]!.params.position.z).toBe(10);
  });
  it('copy method duplicates polygon meshes through getMesh/createMesh', async () => {
    const o = t.bridge.addObject('POLYGONOBJ', 'Mesh'); o.mesh = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], polygons: [[0, 1, 2]] };
    const r = await runTool(duplicate, { ref: o.id, method: 'copy' }, t.ctx);
    expect(t.bridge.objects.get((r.structured.copies as any[])[0].id)!.mesh!.polygons).toEqual([[0, 1, 2]]);
  });
  it('menu method uses Edit>Copy/Paste and detects new objects', async () => {
    const b = mk();
    t.helper.handlers.set('pressMenu', (a: any) => { if (a.path[1] === 'Paste') t.bridge.addObject('BOX', 'Obj'); return { pressed: true }; });
    const r = await runTool(duplicate, { ref: b }, t.ctx);
    expect(r.structured).toMatchObject({ method: 'menu', lossy: false });
    expect(t.helper.calls.filter((c) => c.cmd === 'pressMenu').map((c) => (c.args as any).path)).toEqual([['Edit', 'Copy'], ['Edit', 'Paste']]);
  });
  it('auto falls back to copy when paste produces nothing; explicit menu fails', async () => {
    const b = mk();
    const r = await runTool(duplicate, { ref: b }, t.ctx);
    expect(r.structured.method).toBe('copy');
    expect((r.structured.notes as string[])[0]).toMatch(/fell back/);
    await expectCode(runTool(duplicate, { ref: b, method: 'menu' }, t.ctx), 'UNSUPPORTED');
    t.helper.on = false;
    await expectCode(runTool(duplicate, { ref: b, method: 'menu' }, t.ctx), 'UNSUPPORTED');
  });
});
