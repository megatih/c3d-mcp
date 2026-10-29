 
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { addMaterialNode, assignMaterial, connectNodes, createMaterial, getMaterialGraph, listMaterials, setMaterialParams, setTexture } from '../../src/tools/materials.js';
import { expectCode, makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';

let t: TestCtx;
beforeEach(() => { t = makeCtx(); });

describe('materials', () => {
  it('creates a PBR material with shortcuts mapped to root params', async () => {
    const r = await runTool(createMaterial, { name: 'Steel', type: 'Material (PBR)', color: '#808080', metalness: 1, roughness: 0.2 }, t.ctx);
    expect((r.structured.material as any).rootNodeType).toBe('pbrmetal');
    expect(t.bridge.argsOf('createMaterial')[0].params).toMatchObject({ baseColor: { r: 128 / 255, g: 128 / 255, b: 128 / 255, a: 1 }, reflMetalness: 1, reflRoughness: 0.2 });
  });
  it('maps color to diffColor for classic materials and rejects PBR-only shortcuts', async () => {
    await runTool(createMaterial, { name: 'Wood', color: [0.5, 0.3, 0.1] }, t.ctx);
    expect(t.bridge.argsOf('createMaterial')[0].params.diffColor).toMatchObject({ r: 0.5, g: 0.3, b: 0.1, a: 1 });
    await expectCode(runTool(createMaterial, { name: 'X', metalness: 1 }, t.ctx), 'INVALID_ARGUMENT');
    expect(() => createMaterial.inputSchema.parse({ name: 'x', type: 'Bogus' })).toThrow();
  });
  it('uniquifies names and lists with pagination', async () => {
    await runTool(createMaterial, { name: 'A' }, t.ctx);
    const b = await runTool(createMaterial, { name: 'A' }, t.ctx);
    expect((b.structured.material as any).name).toBe('A.2');
    const l = await runTool(listMaterials, { limit: 1 }, t.ctx);
    expect(l.structured).toMatchObject({ total: 2, next_offset: 1 });
  });
  it('sets material params, resolving the root type for shortcuts', async () => {
    await runTool(createMaterial, { name: 'P', type: 'Toon' }, t.ctx);
    const r = await runTool(setMaterialParams, { material: 'P', color: '#ff0000' }, t.ctx);
    expect(r.structured.applied).toEqual(['color']);
    await expectCode(runTool(setMaterialParams, { material: 'Nope', color: '#ff0000' }, t.ctx), 'NOT_FOUND');
    await expectCode(runTool(setMaterialParams, { material: 'P' }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(setMaterialParams, { material: 'P', node: 1, color: '#fff000' }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(setMaterialParams, { material: 'P', params: { bogusX: 1 } }, t.ctx), 'NOT_FOUND');
  });
  it('builds a node graph', async () => {
    const m = (await runTool(createMaterial, { name: 'G' }, t.ctx)).structured.material as any;
    const n = await runTool(addMaterialNode, { material: 'G', type: 'noise' }, t.ctx);
    const c = await runTool(connectNodes, { material: 'G', from_node: n.structured.nodeId, from_output: 'color', to_node: m.rootNodeId, to_input: 'diffColor' }, t.ctx);
    expect(c.structured.connected).toBe(true);
    const g = await runTool(getMaterialGraph, { material: 'G' }, t.ctx);
    expect((g.structured.nodes as any[])).toHaveLength(2);
    expect('params' in (g.structured.nodes as any[])[0]).toBe(false);
    expect('params' in ((await runTool(getMaterialGraph, { material: 'G', response_format: 'detailed' }, t.ctx)).structured.nodes as any[])[0]).toBe(true);
    await expectCode(runTool(connectNodes, { material: 'G', from_node: 1, from_output: 'a', to_node: 2, to_input: 'b' }, t.ctx), 'NOT_FOUND');
  });
  it('assigns a material to the whole object or to selected polygons', async () => {
    await runTool(createMaterial, { name: 'M' }, t.ctx);
    const o = t.bridge.addObject('BOX', 'B');
    const r = await runTool(assignMaterial, { ref: o.id, material: 'M' }, t.ctx);
    expect(r.structured.tagIndex).toBe(0);
    await runTool(assignMaterial, { ref: o.id, material: 'M', replace_existing: true }, t.ctx);
    expect(o.tags).toHaveLength(1);
    const pr = await runTool(assignMaterial, { ref: o.id, material: 'M', polygons: [0, 1] }, t.ctx);
    expect(pr.structured).toMatchObject({ slot: 1, polygons: 2 });
    expect(t.bridge.argsOf('assignMaterial').at(-1)).toMatchObject({ polygons: [0, 1] });
    expect(() => assignMaterial.inputSchema.parse({ ref: o.id, material: 'M', polygons: [] })).toThrow();
    await expectCode(runTool(assignMaterial, { ref: o.id, material: 'Missing' }, t.ctx), 'NOT_FOUND');
  });
  it('sets textures after checking the path', async () => {
    await runTool(createMaterial, { name: 'T' }, t.ctx);
    const img = path.join(t.dir, 'wood.png'); fs.writeFileSync(img, 'x');
    const r = await runTool(setTexture, { material: 'T', path: img }, t.ctx);
    expect(r.structured.path).toBe(img);
    expect(t.bridge.argsOf('setTexture')[0].param).toBe('texture');
    await expectCode(runTool(setTexture, { material: 'T', path: 'rel.png' }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(setTexture, { material: 'T', path: path.join(t.dir, 'x.exe') }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(setTexture, { material: 'T', path: path.join(t.dir, 'missing.png') }, t.ctx), 'NOT_FOUND');
  });
});
