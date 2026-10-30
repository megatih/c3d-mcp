/* eslint-disable @typescript-eslint/no-unsafe-call -- loosely typed runtime data; indices are bounds-checked by construction */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { BridgeError, defineTool } from '../toolkit.js';
import { applyText, runApply } from '../lib/ops.js';
import { clean, ok, page } from '../lib/result.js';
import { Color, Limit, MaterialRef, ObjectRef, Offset, ParamMap, ResponseFormat, normMat, normRef, toColor } from '../lib/schemas.js';

const COLOR_PARAM: Record<string, string> = { material: 'diffColor', pbrmetal: 'baseColor', toon: 'color', dielectric: 'transColor', shadow: 'color' };
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'hdr', 'exr', 'tga', 'bmp', 'gif'];

const Shortcuts = {
  color: Color.optional().describe('Main color (diffuse / PBR base / toon color / glass tint).'),
  metalness: z.number().min(0).max(1).optional().describe('PBR materials only.'),
  roughness: z.number().min(0).max(1).optional().describe('PBR materials only.'),
};

function expand(rootType: string, s: { color?: z.infer<typeof Color>; metalness?: number; roughness?: number }, params: Record<string, unknown> = {}): Record<string, unknown> {
  const out = { ...params };
  if (s.color !== undefined) out[COLOR_PARAM[rootType] ?? 'diffColor'] = toColor(s.color);
  if (s.metalness !== undefined || s.roughness !== undefined) {
    if (rootType !== 'pbrmetal') throw new BridgeError('INVALID_ARGUMENT', `metalness/roughness only apply to "Material (PBR)" (root node pbrmetal), not "${rootType}".`, 'Create the material with type "Material (PBR)" or use params.');
    if (s.metalness !== undefined) out.reflMetalness = s.metalness;
    if (s.roughness !== undefined) out.reflRoughness = s.roughness;
  }
  return out;
}

const ROOT_FOR_TYPE: Record<string, string> = { 'Material (PBR)': 'pbrmetal', Toon: 'toon', Glass: 'dielectric', Shadowmat: 'shadow' };

export const listMaterials = defineTool({
  name: 'c3d_list_materials',
  title: 'List materials',
  description: 'Lists the document materials with index, name and root node type (material, pbrmetal, toon, dielectric...). Material names are unique per document (duplicates get ".2" suffixes) and are the preferred handle.',
  group: 'materials',
  inputSchema: z.strictObject({ offset: Offset, limit: Limit(200, 50), response_format: ResponseFormat }),
  outputSchema: z.looseObject({ materials: z.array(z.looseObject({ index: z.number().int(), name: z.string() })), total: z.number().int(), next_offset: z.number().int().nullable() }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'readonly'],
  async handler(i, ctx) {
    const r = await ctx.bridge.one<{ materials: Array<Record<string, any>> }>('listMaterials');
    const p = page(r.materials, i.offset ?? 0, i.limit ?? 50);
    return ok({ materials: p.items, total: p.total, next_offset: p.next_offset }, p.items.map((m) => `#${m.index} ${m.name} (${m.rootNodeType}, ${m.nodeCount} nodes)`).join('\n') || 'No materials.');
  },
});

export const createMaterial = defineTool({
  name: 'c3d_create_material',
  title: 'Create material',
  description: 'Creates a material. type: "Material" (classic, default), "Material (PBR)", "Toon", "Glass" or "Shadowmat" (shadow catcher: renders transparent and keeps only the shadows cast on it; use with c3d_set_background kind transparent; shadow pixels were seen with the Cheetah renderer, not with Falcon, in 8.1.3 tests). Classic defaults: specColor black, specSize 80, transEta 1.5. Emission (emisColor, clamped to 1) lights neighbouring surfaces in Falcon. Shortcuts color/metalness/roughness map to the right root-node parameters (diffColor / baseColor / color / transColor); other parameters go in params (see c3d_get_material_graph). Returns the ACTUAL name (collisions get ".2"). Assign it with c3d_assign_material.',
  group: 'materials',
  inputSchema: z.strictObject({ name: z.string().min(1).max(255).describe('Material name (made unique by Cheetah3D).'), type: z.enum(['Material', 'Material (PBR)', 'Toon', 'Glass', 'Shadowmat']).optional().describe('Material type (default Material).'), ...Shortcuts, params: ParamMap.optional().describe('Extra root-node parameters.') }),
  outputSchema: z.looseObject({ material: z.looseObject({ index: z.number().int().optional(), name: z.string() }) }),
  mutating: true,
  idempotent: false,
  profiles: ['full', 'local'],
  localDescription: 'Create a material (Material, Material (PBR), Toon, Glass, Shadowmat) with color/metalness/roughness.',
  async handler(i, ctx) {
    const type = i.type ?? 'Material';
    const params = expand(ROOT_FOR_TYPE[type] ?? 'material', i, i.params);
    const r = await ctx.bridge.one<Record<string, any>>('createMaterial', clean({ name: i.name, type, params: Object.keys(params).length ? params : undefined }));
    return ok({ material: r }, `Created material "${r.name}" (${r.rootNodeType ?? type}).`);
  },
});

export const setMaterialParams = defineTool({
  name: 'c3d_set_material_params',
  title: 'Set material parameters',
  description: 'Sets parameters on a material node (root node by default; pass node id for others from c3d_get_material_graph). Shortcuts color/metalness/roughness resolve against the root type. Colors are 0..1 RGBA. Textures: use c3d_set_texture. Partial success is reported per name.',
  group: 'materials',
  inputSchema: z.strictObject({ material: MaterialRef, node: z.number().int().optional().describe('Node id (default: root node).'), ...Shortcuts, params: ParamMap.optional().describe('Node parameters, e.g. {"specColor": {"r":1,"g":1,"b":1}}.') }),
  outputSchema: z.looseObject({ applied: z.array(z.string()), errors: z.array(z.looseObject({ name: z.string() })) }),
  mutating: true,
  idempotent: true,
  profiles: ['full', 'local'],
  localDescription: 'Set material parameters (color, metalness, roughness, any root-node param).',
  async handler(i, ctx) {
    let params: Record<string, unknown> = i.params ?? {};
    if (i.color !== undefined || i.metalness !== undefined || i.roughness !== undefined) {
      if (i.node !== undefined) throw new BridgeError('INVALID_ARGUMENT', 'Shortcuts (color/metalness/roughness) only work on the root node; use params with a node id.');
      const list = await ctx.bridge.one<{ materials: Array<{ index: number; name: string; rootNodeType: string }> }>('listMaterials');
      const m = normMat(i.material) as { name?: string; index?: number };
      const found = list.materials.find((x) => (m.name !== undefined ? x.name === m.name : x.index === m.index));
      if (!found) throw new BridgeError('NOT_FOUND', `Material ${JSON.stringify(i.material)} not found.`, 'List materials with c3d_list_materials.');
      params = expand(found.rootNodeType, i, params);
    }
    if (!Object.keys(params).length) throw new BridgeError('INVALID_ARGUMENT', 'Nothing to set: give params or color/metalness/roughness.');
    const r = await runApply(ctx, 'setMaterialParams', clean({ material: normMat(i.material), node: i.node, params }));
    return ok({ applied: r.applied, errors: r.errors }, applyText('Material parameters', r));
  },
});

export const addMaterialNode = defineTool({
  name: 'c3d_add_material_node',
  title: 'Add material node',
  description: 'Adds a node to a material graph (types e.g. image, noise, checkerboard, wood, marble, mix, multiply, add, color, number, gradient, hsv2rgb). Returns the node id plus its input/output names for c3d_connect_nodes. Look at the root node ids/inputs with c3d_get_material_graph.',
  group: 'materials',
  inputSchema: z.strictObject({ material: MaterialRef, type: z.string().min(2).max(40).describe('Node type name, e.g. "image", "noise", "mix".'), params: ParamMap.optional().describe('Initial node parameters.') }),
  outputSchema: z.looseObject({ nodeId: z.number().int(), type: z.string(), inputs: z.array(z.string()), outputs: z.array(z.string()) }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    const r = await ctx.bridge.one<Record<string, any>>('addMaterialNode', clean({ material: normMat(i.material), type: i.type, params: i.params }));
    return ok({ nodeId: r.nodeId, type: r.type ?? i.type, inputs: r.inputs ?? [], outputs: r.outputs ?? [] }, `Added node ${r.type ?? i.type} #${r.nodeId}; inputs: ${(r.inputs ?? []).join(', ')}; outputs: ${(r.outputs ?? []).join(', ')}.`);
  },
});

export const connectNodes = defineTool({
  name: 'c3d_connect_nodes',
  title: 'Connect material nodes',
  description: 'Connects an output of one node to an input of another in the same material (e.g. image node output "color" -> root input "diffColor"). Use node ids and io names from c3d_add_material_node / c3d_get_material_graph; names are case-sensitive.',
  group: 'materials',
  inputSchema: z.strictObject({ material: MaterialRef, from_node: z.number().int().describe('Source node id.'), from_output: z.string().min(1).describe('Source output name, e.g. "color".'), to_node: z.number().int().describe('Target node id (root node id for material inputs).'), to_input: z.string().min(1).describe('Target input name, e.g. "diffColor".') }),
  outputSchema: z.looseObject({ connected: z.boolean() }),
  mutating: true,
  idempotent: true,
  profiles: ['full'],
  async handler(i, ctx) {
    const r = await ctx.bridge.one<Record<string, any>>('connectNodes', { material: normMat(i.material), fromNode: i.from_node, fromPara: i.from_output, toNode: i.to_node, toPara: i.to_input });
    return ok({ connected: r.connected !== false }, `Connected #${i.from_node}.${i.from_output} -> #${i.to_node}.${i.to_input}.`);
  },
});

export const getMaterialGraph = defineTool({
  name: 'c3d_get_material_graph',
  title: 'Get material graph',
  description: 'Returns a material\'s node graph: nodes with ids, types, parameters, input/output names and connections (connections may be "unavailable" - the API cannot always enumerate them). concise omits node parameters.',
  group: 'materials',
  inputSchema: z.strictObject({ material: MaterialRef, response_format: ResponseFormat }),
  outputSchema: z.looseObject({ name: z.string(), nodes: z.array(z.looseObject({ id: z.number().int(), type: z.string() })), connections: z.any() }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'readonly'],
  async handler(i, ctx) {
    const r = await ctx.bridge.one<{ name: string; nodes: Array<Record<string, any>>; connections: unknown }>('getMaterialGraph', { material: normMat(i.material) });
    const nodes = i.response_format === 'detailed' ? r.nodes : r.nodes.map(({ params: _p, ...n }) => n);
    return ok({ name: r.name, nodes, connections: r.connections }, `${r.name}: ${r.nodes.length} node(s): ${r.nodes.map((n) => `${n.type}#${n.id}`).join(', ')}`);
  },
});

export const assignMaterial = defineTool({
  name: 'c3d_assign_material',
  title: 'Assign material',
  description: 'Assigns a material to the whole object by adding a SHADERTAG (replace_existing swaps the previous whole-object material), or - with polygons - only to those polygon indices of an EDITABLE polygon object (use c3d_make_editable first on primitives). Per-polygon assignment uses one of the object\'s 24 polygon-selection slots per material group (returned as slot); the polygon indices come from c3d_get_mesh. An object holds at most 24 material (SHADERTAG) tags: more crashed Cheetah3D 8.1.3, so the tool refuses the 25th with UNSUPPORTED.',
  group: 'materials',
  inputSchema: z.strictObject({ ref: ObjectRef, material: MaterialRef, replace_existing: z.boolean().optional().describe('Replace the existing whole-object material instead of adding another SHADERTAG (runtime default: true).'), polygons: z.array(z.number().int().min(0)).min(1).max(200000).optional().describe('Polygon indices (c3d_get_mesh) that get this material instead of the whole object.'), slot: z.number().int().min(1).max(24).optional().describe('Polygon-selection slot to use (default: first free).') }),
  outputSchema: z.looseObject({ tagIndex: z.number().int().optional(), material: z.any(), slot: z.number().int().optional(), polygons: z.number().int().optional() }),
  mutating: true,
  idempotent: false,
  profiles: ['full', 'local'],
  localDescription: 'Assign a material (by name) to a whole object, or to only some polygons via polygons:[indices] of an editable mesh.',
  async handler(i, ctx) {
    const r = await ctx.bridge.one<Record<string, any>>('assignMaterial', clean({ ref: normRef(i.ref), material: normMat(i.material), replaceExisting: i.replace_existing, polygons: i.polygons, slot: i.slot }));
    return ok(clean({ tagIndex: r.tagIndex, material: r.material, slot: r.slot, polygons: r.polygons }), i.polygons ? `Assigned material ${JSON.stringify(r.material)} to ${r.polygons} polygon(s) via selection slot ${r.slot} (tag ${r.tagIndex}).` : `Assigned material ${JSON.stringify(r.material)} (tag ${r.tagIndex}).`);
  },
});

export function checkTexturePath(p: string): string {
  if (!path.isAbsolute(p)) throw new BridgeError('INVALID_ARGUMENT', 'Texture path must be absolute.');
  const e = path.extname(p).slice(1).toLowerCase();
  if (!IMAGE_EXT.includes(e)) throw new BridgeError('INVALID_ARGUMENT', `Unsupported texture type .${e}.`, `Allowed: ${IMAGE_EXT.join(', ')}.`);
  if (!fs.existsSync(p)) throw new BridgeError('NOT_FOUND', `Texture file not found: ${p}`);
  return p;
}

export const setTexture = defineTool({
  name: 'c3d_set_texture',
  title: 'Set texture',
  description: 'Sets a Texture parameter (default "texture" on an image node) to an absolute image path; the file must exist. Typical flow: c3d_add_material_node type "image", c3d_set_texture on that node, then c3d_connect_nodes image.color -> root diffColor. Pass an empty path via c3d_set_material_params to clear.',
  group: 'materials',
  inputSchema: z.strictObject({ material: MaterialRef, node: z.number().int().optional().describe('Node id of the image node (default root).'), param: z.string().optional().describe('Texture parameter name (default "texture").'), path: z.string().min(1).describe('Absolute path of the image file.') }),
  outputSchema: z.looseObject({ path: z.string() }),
  mutating: true,
  idempotent: true,
  profiles: ['full'],
  async handler(i, ctx) {
    const p = checkTexturePath(i.path);
    const r = await ctx.bridge.one<Record<string, any>>('setTexture', clean({ material: normMat(i.material), node: i.node, param: i.param ?? 'texture', path: p }));
    return ok({ path: r.path ?? p }, `Texture set to ${r.path ?? p}.`);
  },
});

export const materialTools = [listMaterials, createMaterial, setMaterialParams, addMaterialNode, connectNodes, getMaterialGraph, assignMaterial, setTexture];
