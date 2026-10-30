import { beforeEach, describe, expect, it } from 'vitest';
import { takes } from '../../src/tools/animation.js';
import { editMesh } from '../../src/tools/geometry.js';
import { removeTag } from '../../src/tools/tags.js';
import { BridgeError } from '../../src/toolkit.js';
import { makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';

let t: TestCtx;
beforeEach(() => { t = makeCtx(); });

describe('automatic checkpoints before lossy edits', () => {
  it('c3d_edit_mesh checkpoints before delete_polygons and merge_distance, not before vertex moves', async () => {
    const o = t.bridge.addObject('POLYGONOBJ', 'M');
    o.mesh = { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], polygons: [[0, 1, 2], [0, 2, 3]], uvs: undefined };
    await runTool(editMesh, { ref: o.id, set_vertices: [{ index: 0, position: [0, 0, 0] }] }, t.ctx);
    await runTool(editMesh, { ref: o.id, flip_winding: [0] }, t.ctx);
    expect(t.bridge.opNames()).not.toContain('saveTo');
    const r = await runTool(editMesh, { ref: o.id, delete_polygons: [0] }, t.ctx);
    expect(t.bridge.opNames().slice(-2)).toEqual(['saveTo', 'editMesh']);
    expect(r.structured).toHaveProperty('checkpoint');
    await runTool(editMesh, { ref: o.id, merge_distance: 0.01 }, t.ctx);
    expect(t.bridge.opNames().slice(-2)).toEqual(['saveTo', 'editMesh']);
  });
  it('c3d_remove_tag checkpoints first', async () => {
    const o = t.bridge.addObject('BOX', 'B');
    o.tags.push({ type: 'SHADERTAG', params: {} });
    const r = await runTool(removeTag, { ref: o.id, tag_index: 0 }, t.ctx);
    expect(t.bridge.opNames().slice(-2)).toEqual(['saveTo', 'removeTag']);
    expect(r.structured).toHaveProperty('checkpoint');
  });
  it('c3d_takes checkpoints only for remove', async () => {
    await runTool(takes, { action: 'add', name: 'Alt' }, t.ctx);
    await runTool(takes, { action: 'select', name: 'Alt' }, t.ctx);
    expect(t.bridge.opNames()).not.toContain('saveTo');
    const r = await runTool(takes, { action: 'remove', name: 'Alt' }, t.ctx);
    expect(t.bridge.opNames().slice(-2)).toEqual(['saveTo', 'takes']);
    expect(r.structured).toHaveProperty('checkpoint');
  });

  it('a failing checkpoint does not block the operation; the result carries a warning instead', async () => {
    const o = t.bridge.addObject('BOX', 'B');
    o.tags.push({ type: 'SHADERTAG', params: {} });
    t.bridge.failNth.set('saveTo', { n: 1, count: 0, err: new BridgeError('INTERNAL', 'disk full') });
    const r = await runTool(removeTag, { ref: o.id, tag_index: 0 }, t.ctx);
    expect(o.tags).toHaveLength(0);
    expect(r.structured.warning).toMatch(/cannot be undone/);
    expect(r.structured).not.toHaveProperty('checkpoint');
  });
});
