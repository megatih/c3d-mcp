 
import { beforeEach, describe, expect, it } from 'vitest';
import { createMesh, createSpline, editMesh, getMesh, makeEditable } from '../../src/tools/geometry.js';
import { expectCode, makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';
import { BridgeError } from '../../src/toolkit.js';

let t: TestCtx;
beforeEach(() => { t = makeCtx(); });
const quad = { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], polygons: [[0, 1, 2, 3]] };

describe('c3d_create_mesh', () => {
  it('creates a mesh with transform and material in one request', async () => {
    const r = await runTool(createMesh, { ...quad, name: 'Quad', position: [1, 0, 0], material: 'Wood' }, t.ctx);
    expect(r.structured).toMatchObject({ vertexCount: 4, polygonCount: 1, chunks: 1 });
    expect(t.bridge.argsOf('createMesh')[0]).toMatchObject({ name: 'Quad', transform: { position: { x: 1, y: 0, z: 0 } }, material: { name: 'Wood' } });
  });
  it('reverses polygons (and uvs) by default so Cheetah3D gets outward normals; winding:"cw" sends them unchanged', async () => {
    const uvs = [[[0, 0], [1, 0], [1, 1], [0, 1]]];
    await runTool(createMesh, { ...quad, uvs }, t.ctx);
    expect(t.bridge.argsOf('createMesh')[0]).toMatchObject({ polygons: [[0, 3, 2, 1]], uvs: [[[0, 0], [0, 1], [1, 1], [1, 0]]] });
    t = makeCtx();
    await runTool(createMesh, { ...quad, uvs, winding: 'cw' }, t.ctx);
    expect(t.bridge.argsOf('createMesh')[0]).toMatchObject({ polygons: [[0, 1, 2, 3]], uvs });
  });
  it('validates indices client-side and never contacts the bridge', async () => {
    const e = await expectCode(runTool(createMesh, { vertices: quad.vertices, polygons: [[0, 1, 9]] }, t.ctx), 'INVALID_ARGUMENT');
    expect(e.details).toMatchObject({ polygon: 0, index: 9 });
    expect(t.bridge.calls).toHaveLength(0);
  });
  it('rejects schema violations', () => {
    expect(() => createMesh.inputSchema.parse({ vertices: [[0, 0]], polygons: [[0, 1, 2]] })).toThrow();
    expect(() => createMesh.inputSchema.parse({ vertices: [[0, 0, Infinity]], polygons: [[0, 1, 2]] })).toThrow();
    expect(() => createMesh.inputSchema.parse({ vertices: quad.vertices, polygons: [[0, 1]] })).toThrow();
  });
  it('chunks large meshes with append and reassembles them faithfully', async () => {
    const n = 90;
    const vertices: number[][] = [];
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) vertices.push([x, y, 0]);
    const polygons: number[][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) polygons.push([y * (n + 1) + x, y * (n + 1) + x + 1, (y + 1) * (n + 1) + x + 1, (y + 1) * (n + 1) + x]);
    const r = await runTool(createMesh, { vertices, polygons, winding: 'cw' }, t.ctx);
    expect(r.structured.chunks).toBeGreaterThan(1);
    const calls = t.bridge.argsOf('createMesh');
    expect(calls[0]).not.toHaveProperty('append');
    expect(calls.slice(1).every((c) => c.append?.ref?.id !== undefined)).toBe(true);
    const o = [...t.bridge.objects.values()].find((x) => x.type === 'POLYGONOBJ')!;
    expect(o.mesh!.vertices).toEqual(vertices);
    expect(o.mesh!.polygons).toEqual(polygons);
  });
  it('removes the partial object when a later chunk fails', async () => {
    const vertices: number[][] = [];
    for (let i = 0; i < 6000; i++) vertices.push([i, 0, 0]);
    const polygons = Array.from({ length: 5990 }, (_, i) => [i, i + 1, i + 2]);
    t.bridge.failNth.set('createMesh', { n: 2, count: 0, err: new BridgeError('TIMEOUT', 'slow') });
    await expectCode(runTool(createMesh, { vertices, polygons }, t.ctx), 'TIMEOUT');
    expect(t.bridge.opNames()).toContain('deleteObjects');
  });
});

describe('c3d_get_mesh / c3d_edit_mesh', () => {
  it('pages through a mesh', async () => {
    const id = ((await runTool(createMesh, quad, t.ctx)).structured.object as any).id;
    const r = await runTool(getMesh, { ref: id, vertex_limit: 2, polygon_limit: 1 }, t.ctx);
    expect(r.structured).toMatchObject({ vertexCount: 4, next_vertex_offset: 2, next_polygon_offset: null });
    expect((r.structured.vertices as unknown[]).length).toBe(2);
  });
  it('is an error for primitives', async () => {
    const b = t.bridge.addObject('BOX', 'B');
    const e = await expectCode(runTool(getMesh, { ref: b.id }, t.ctx), 'INVALID_ARGUMENT');
    expect(e.hint).toMatch(/editable/);
  });
  it('edits vertices and deletes polygons', async () => {
    const id = ((await runTool(createMesh, quad, t.ctx)).structured.object as any).id;
    const r = await runTool(editMesh, { ref: id, set_vertices: [{ index: 0, position: [5, 5, 5] }], delete_polygons: [0] }, t.ctx);
    expect(r.structured).toEqual({ vertexCount: 4, polygonCount: 0 });
    expect(t.bridge.objects.get(id)!.mesh!.vertices[0]).toEqual([5, 5, 5]);
    expect(t.bridge.argsOf('editMesh')[0]).toMatchObject({ setVertices: [{ index: 0, position: { x: 5, y: 5, z: 5 } }], deletePolygons: [0] });
  });
  it('requires at least one edit', async () => {
    await expectCode(runTool(editMesh, { ref: 1 }, t.ctx), 'INVALID_ARGUMENT');
  });
});

describe('c3d_create_spline', () => {
  it('creates splines', async () => {
    const r = await runTool(createSpline, { name: 'S', paths: [{ points: [{ p: [0, 0, 0] }, { p: [1, 0, 0], c1: [0.5, 0, 0] }], closed: false }] }, t.ctx);
    expect(r.structured.pathCount).toBe(1);
  });
  it('rejects a one-point path', () => expect(() => createSpline.inputSchema.parse({ paths: [{ points: [{ p: [0, 0, 0] }] }] })).toThrow());
});

describe('c3d_make_editable', () => {
  it('presses the menu and reports the converted object', async () => {
    const b = t.bridge.addObject('BOX', 'B');
    t.helper.handlers.set('pressMenu', () => { b.type = 'POLYGONOBJ'; b.mesh = { vertices: [], polygons: [] }; return {}; });
    const r = await runTool(makeEditable, { ref: b.id }, t.ctx);
    expect(r.structured).toMatchObject({ converted: true, object: { type: 'POLYGONOBJ' } });
    expect(t.helper.calls.find((c) => c.cmd === 'pressMenu')!.args).toMatchObject({ path: ['Objects', 'Make Editable'] });
  });
  it('is UNSUPPORTED without helper or when nothing changed', async () => {
    const b = t.bridge.addObject('BOX', 'B');
    await expectCode(runTool(makeEditable, { ref: b.id }, t.ctx), 'UNSUPPORTED');
    t.helper.on = false;
    await expectCode(runTool(makeEditable, { ref: b.id }, t.ctx), 'UNSUPPORTED');
  });
  it('is a no-op for already editable meshes', async () => {
    const m = t.bridge.addObject('POLYGONOBJ', 'M');
    const r = await runTool(makeEditable, { ref: m.id }, t.ctx);
    expect(r.structured.converted).toBe(false);
  });
});
