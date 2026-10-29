/* eslint-disable eqeqeq, @typescript-eslint/no-unsafe-call, @typescript-eslint/restrict-plus-operands -- loosely typed runtime data; indices are bounds-checked by construction */
import { z } from 'zod';
import { BridgeError, defineTool, type ToolContext } from '../toolkit.js';
import { autoCheckpoint } from '../lib/checkpoints.js';
import { applyLookAt } from '../lib/lookAtOp.js';
import { applyText, runApply } from '../lib/ops.js';
import { assertNotScriptType } from '../lib/scriptTypes.js';
import { clean, ok } from '../lib/result.js';
import { AnyObject, Confirm, Descriptor, Limit, ObjectRef, Offset, ParamMap, ResponseFormat, Vec3, normRef, toXyz } from '../lib/schemas.js';

const Include = z.enum(['parameters', 'tags', 'children', 'bbox', 'worldMatrix', 'materials']);
const xyz = (v: z.infer<typeof Vec3> | undefined): { x: number; y: number; z: number } | undefined => (v ? toXyz(v) : undefined);
const transformArgs = (i: { position?: z.infer<typeof Vec3>; rotation?: z.infer<typeof Vec3>; scale?: z.infer<typeof Vec3> }): Record<string, unknown> =>
  clean({ position: xyz(i.position), rotation: xyz(i.rotation), scale: xyz(i.scale) });

export const listScene = defineTool({
  name: 'c3d_list_scene',
  title: 'List scene',
  description:
    'Paged depth-first listing of the object tree: id, name, type, path, depth, child/tag counts (detailed adds transform and tags). Use it to discover object ids before any edit. Names are not unique: always address objects by id. A hidden root-level folder "__c3d_mcp_session_*" is the session marker - ignore it. Pass next_offset back as offset for more.',
  group: 'scene',
  inputSchema: z.strictObject({
    root: ObjectRef.optional().describe('Subtree root (default: whole scene).'),
    depth: z.number().int().min(0).max(32).optional().describe('Max depth below root (default 4).'),
    offset: Offset,
    limit: Limit(500, 100),
    response_format: ResponseFormat,
  }),
  outputSchema: z.looseObject({ items: z.array(Descriptor), total: z.number().int(), next_offset: z.number().int().nullable() }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'local', 'readonly'],
  localDescription: 'List the scene tree (ids, names, types).',
  async handler(i, ctx) {
    const detailed = i.response_format === 'detailed';
    const r = await ctx.bridge.one<{ items: Array<Record<string, any>>; total: number; nextOffset: number | null }>('listScene', clean({ root: i.root === undefined ? undefined : normRef(i.root), depth: i.depth ?? 4, offset: i.offset ?? 0, limit: i.limit ?? 100, detail: detailed ? 'detailed' : 'concise' }));
    const items = detailed ? r.items : r.items.map((o) => ({ id: o.id, name: o.name, type: o.type, path: o.path, depth: o.depth, childCount: o.childCount }));
    const lines = r.items.map((o) => `${'  '.repeat(o.depth ?? 0)}${o.name} [${o.type}] #${o.id}`).join('\n');
    return ok({ items, total: r.total, next_offset: r.nextOffset ?? null }, `${r.items.length}/${r.total} objects${r.nextOffset != null ? ` (next_offset ${r.nextOffset})` : ''}\n${lines}`);
  },
});

export const getObject = defineTool({
  name: 'c3d_get_object',
  title: 'Get object',
  description: 'Detailed view of one object. concise = descriptor + tags; detailed = also parameters, children, bbox, world matrix and materials (large). Use include to pick sections. Parameter values are typed (vectors as {x,y,z}, textures as paths).',
  group: 'scene',
  inputSchema: z.strictObject({
    ref: ObjectRef,
    include: z.array(Include).max(6).optional().describe('Sections to include (overrides response_format).'),
    response_format: ResponseFormat,
  }),
  outputSchema: z.looseObject({ object: Descriptor }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'local', 'readonly'],
  localDescription: 'Inspect one object (tags, parameters, bbox).',
  async handler(i, ctx) {
    const include = i.include ?? (i.response_format === 'detailed' ? ['parameters', 'tags', 'children', 'bbox', 'materials'] : ['tags']);
    const object = await ctx.bridge.one<Record<string, any>>('getObject', { ref: normRef(i.ref), include });
    return ok({ object }, `${object.name} [${object.type}] #${object.id}, ${object.childCount ?? 0} children, ${object.tagCount ?? 0} tags.`);
  },
});

const BAD_LIGHTS: Record<string, string> = { SPOTLIGHT: 'spot', POINTLIGHT: 'point', DISTANTLIGHT: 'distant', AREALIGHT: 'area', SKYLIGHT: 'sky' };

export const createObject = defineTool({
  name: 'c3d_create_object',
  title: 'Create object',
  description:
    'Creates a scene object by type name (BOX, BALL, CAMERA, LIGHT, FOLDER, NULL... - see c3d_capabilities objectTypes), optionally named, parented, transformed and parametrised. Returns the ACTUAL name and id (names are not uniquified). Lights are type LIGHT plus light_type 0..4 (SPOTLIGHT/POINTLIGHT constants do not exist). New objects are appended under the root. Primitives are not editable per vertex: use c3d_make_editable or c3d_create_mesh.',
  group: 'scene',
  inputSchema: z.strictObject({
    type: z.string().min(2).max(40).describe('Object type name, e.g. "BOX", "BALL", "CAMERA", "LIGHT", "FOLDER".'),
    name: z.string().min(1).max(255).optional().describe('Object name.'),
    parent: ObjectRef.optional().describe('Parent (default: scene root).'),
    position: Vec3.optional().describe('Local position.'),
    rotation: Vec3.optional().describe('Local rotation in degrees (H,P,B for the default HPB order).'),
    scale: Vec3.optional().describe('Local scale.'),
    params: ParamMap.optional().describe('Initial parameters, e.g. {"sizeX": 2} (names are case-sensitive) (see c3d_get_parameters).'),
    light_type: z.number().int().min(0).max(4).optional().describe('Only for LIGHT: lightType 0..4.'),
    select: z.boolean().optional().describe('Select the new object.'),
  }),
  outputSchema: z.looseObject({ object: Descriptor }),
  mutating: true,
  idempotent: false,
  profiles: ['full', 'local'],
  localDescription: 'Create an object: type BOX, BALL, PLANE (use for a floor), CYLINDER, CONE, TORUS, LIGHT, CAMERA or FOLDER, with name/position. Colors are NOT params: use c3d_create_material + c3d_assign_material.',
  async handler(i, ctx) {
    assertNotScriptType(i.type);
    const type = i.type.toUpperCase();
    if (BAD_LIGHTS[type]) throw new BridgeError('INVALID_ARGUMENT', `${type} does not exist in Cheetah3D 8.1.3.`, 'Use type "LIGHT" with light_type 0..4, or c3d_set_light.');
    const object = await ctx.bridge.one<Record<string, any>>('createObject', clean({ type, name: i.name, parent: i.parent === undefined ? undefined : normRef(i.parent), transform: Object.keys(transformArgs(i)).length ? transformArgs(i) : undefined, params: i.params, lightType: i.light_type, select: i.select }));
    return ok({ object }, `Created ${object.type ?? type} "${object.name}" #${object.id}.`);
  },
});

export const deleteObjects = defineTool({
  name: 'c3d_delete_objects',
  title: 'Delete objects',
  description: 'Removes objects (and their children) from the scene. Needs confirmation for more than 5 objects or any object with children. An automatic checkpoint is saved first (restore with c3d_restore_checkpoint). Cheetah3D Undo cannot revert this.',
  group: 'scene',
  inputSchema: z.strictObject({ refs: z.array(ObjectRef).min(1).max(1000).describe('Objects to delete.'), confirm: Confirm }),
  outputSchema: z.looseObject({ removed: z.number().int(), checkpoint: z.string().optional(), warning: z.string().optional() }),
  mutating: true,
  destructive: true,
  idempotent: false,
  profiles: ['full', 'local'],
  localDescription: 'Delete objects by id (confirmation for >5 or with children).',
  async handler(i, ctx) {
    const probe = await ctx.bridge.run(i.refs.map((r) => ({ op: 'getObject', args: { ref: normRef(r) } })));
    let withChildren = 0;
    for (const r of probe.results) {
      if (!r.ok) throw new BridgeError(r.error?.code ?? 'NOT_FOUND', r.error?.message ?? 'Object not found.', r.error?.hint, r.error?.details);
      if (Number(r.result?.childCount ?? 0) > 0) withChildren++;
    }
    if (i.refs.length > 5 || withChildren > 0) {
      const yes = await ctx.services.confirm({ message: `Delete ${i.refs.length} object(s)${withChildren ? `, ${withChildren} with children (children are deleted too)` : ''}?`, confirmFlag: i.confirm });
      if (!yes) throw new BridgeError('CONFIRMATION_REQUIRED', 'Deleting this many objects (or objects with children) needs confirmation.', 'Retry with confirm:true.');
    }
    const cp = await autoCheckpoint(ctx, 'delete');
    const r = await ctx.bridge.one<{ removed: number; ids?: number[] }>('deleteObjects', { refs: i.refs.map(normRef) });
    return ok({ removed: r.removed, ids: r.ids ?? [], ...(cp.checkpoint ? { checkpoint: cp.checkpoint.id } : {}), ...(cp.warning ? { warning: cp.warning } : {}) }, `Removed ${r.removed} object(s).${cp.warning ? ` WARNING: ${cp.warning}` : ''}`);
  },
});

export const reparent = defineTool({
  name: 'c3d_reparent',
  title: 'Reparent object',
  description: 'Moves an object under a new parent (use the scene root path "/" or a FOLDER to group). Optionally keeps the world transform and inserts at a child index. Ids are stable across reparenting.',
  group: 'scene',
  inputSchema: z.strictObject({ ref: ObjectRef, parent: ObjectRef.describe('New parent object.'), index: z.number().int().min(0).optional().describe('Child index (default: append).'), keep_world: z.boolean().optional().describe('Preserve world position (default false).') }),
  outputSchema: z.looseObject({ object: Descriptor }),
  mutating: true,
  idempotent: true,
  profiles: ['full', 'local'],
  localDescription: 'Move an object under another parent.',
  async handler(i, ctx) {
    const object = await ctx.bridge.one<Record<string, any>>('reparent', clean({ ref: normRef(i.ref), parent: normRef(i.parent), index: i.index, keepWorld: i.keep_world }));
    return ok({ object }, `Moved "${object.name}" to ${object.path}.`);
  },
});

export const rename = defineTool({
  name: 'c3d_rename',
  title: 'Rename object',
  description: 'Renames an object. Names are not uniquified and not required to be unique; the id never changes. Returns the actual name.',
  group: 'scene',
  inputSchema: z.strictObject({ ref: ObjectRef, name: z.string().min(1).max(255).describe('New name.') }),
  outputSchema: z.looseObject({ object: Descriptor }),
  mutating: true,
  idempotent: true,
  profiles: ['full', 'local'],
  localDescription: 'Rename an object.',
  async handler(i, ctx) {
    const object = await ctx.bridge.one<Record<string, any>>('rename', { ref: normRef(i.ref), name: i.name });
    return ok({ object }, `Renamed to "${object.name}" (#${object.id}).`);
  },
});

async function copyTree(ctx: ToolContext, srcId: number, parent: unknown, notes: string[]): Promise<Record<string, any>> {
  const src = await ctx.bridge.one<Record<string, any>>('getObject', { ref: { id: srcId }, include: ['parameters', 'tags', 'children'] });
  let created: Record<string, any>;
  if (src.type === 'POLYGONOBJ') {
    const m = await ctx.bridge.one<Record<string, any>>('getMesh', { ref: { id: srcId }, vertexLimit: 200000, polygonLimit: 200000 });
    created = await ctx.bridge.one('createMesh', clean({ name: src.name, parent, vertices: m.vertices, polygons: m.polygons, uvs: m.uvs }));
    if (m.nextVertexOffset != null || m.nextPolygonOffset != null) notes.push(`mesh "${src.name}" truncated to 200000 vertices/polygons`);
  } else created = await ctx.bridge.one('createObject', clean({ type: src.type, name: src.name, parent }));
  const params: Record<string, unknown> = {};
  for (const p of (src.parameters ?? []) as Array<{ name: string; value: any }>) if (p.name !== 'name' && p.value != null && !p.value.unsupported) params[p.name] = p.value;
  if (Object.keys(params).length) {
    const res = (await ctx.bridge.run([{ op: 'setParameters', args: { ref: { id: created.ref?.id ?? created.id }, params } }])).results[0];
    const errs = (res?.result as { errors?: unknown[] } | undefined)?.errors ?? [];
    if (errs.length) notes.push(`${errs.length} parameter(s) of "${src.name}" could not be copied`);
  }
  for (const t of (src.tags ?? []) as Array<{ type: string }>) {
    try {
      await ctx.bridge.one('addTag', { ref: { id: created.ref?.id ?? created.id }, type: t.type });
    } catch {
      notes.push(`tag ${t.type} of "${src.name}" not copied`);
    }
  }
  for (const c of (src.children ?? []) as Array<{ id: number }>) await copyTree(ctx, c.id, { id: created.ref?.id ?? created.id }, notes);
  return created;
}

export const duplicate = defineTool({
  name: 'c3d_duplicate',
  title: 'Duplicate object (experimental)',
  description:
    'EXPERIMENTAL. Duplicates an object with its children. method "menu" selects it and uses Edit > Copy / Paste through the helper (full fidelity, needs Accessibility; verified by diffing the scene); method "copy" rebuilds it from parameters/tags/children over the bridge (LOSSY: no keyframes, clusters, modifier internals, tag parameters). "auto" tries menu then copy. The result says which path ran and lists the new ids.',
  group: 'scene',
  inputSchema: z.strictObject({
    ref: ObjectRef,
    count: z.number().int().min(1).max(50).optional().describe('Number of copies (default 1).'),
    method: z.enum(['auto', 'menu', 'copy']).optional().describe('Default auto.'),
    offset: Vec3.optional().describe('World offset applied cumulatively to each copy (position += offset * n).'),
  }),
  outputSchema: z.looseObject({ method: z.enum(['menu', 'copy']), copies: z.array(Descriptor), lossy: z.boolean(), notes: z.array(z.string()) }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    const count = i.count ?? 1;
    const method = i.method ?? 'auto';
    const notes: string[] = [];
    const copies: Array<Record<string, any>> = [];
    let used: 'menu' | 'copy' = 'copy';
    const idsOf = async (): Promise<Set<number>> => new Set(((await ctx.bridge.one<{ items: Array<{ id: number }> }>('listScene', { depth: 32, limit: 2000, detail: 'concise' })).items).map((o) => o.id));
    if (method !== 'copy' && ctx.helper.available()) {
      try {
        for (let n = 0; n < count; n++) {
          const before = await idsOf();
          await ctx.bridge.one('select', { refs: [normRef(i.ref)] });
          await ctx.helper.call('pressMenu', { path: ['Edit', 'Copy'], timeoutMs: 5000 });
          await ctx.helper.call('pressMenu', { path: ['Edit', 'Paste'], timeoutMs: 5000 });
          const fresh = [...(await idsOf())].filter((id) => !before.has(id));
          if (!fresh.length) throw new BridgeError('UNSUPPORTED', 'Paste did not create an object.');
          copies.push(...(await Promise.all(fresh.map((id) => ctx.bridge.one<Record<string, any>>('getObject', { ref: { id } })))));
        }
        used = 'menu';
      } catch (e) {
        if (method === 'menu') throw e instanceof BridgeError ? e : new BridgeError('UNSUPPORTED', String(e), 'Use method "copy".');
        notes.push(`menu duplicate failed (${e instanceof Error ? e.message : String(e)}); fell back to copy`);
        copies.length = 0;
      }
    } else if (method === 'menu') throw new BridgeError('UNSUPPORTED', 'The helper is not available for menu duplication.', 'Use method "copy" or run c3d_doctor.');
    if (used === 'copy') {
      const src = await ctx.bridge.one<Record<string, any>>('getObject', { ref: normRef(i.ref) });
      const parentRef = src.indexPath && src.indexPath.length > 1 ? { indexPath: src.indexPath.slice(0, -1) } : undefined;
      for (let n = 0; n < count; n++) copies.push(await copyTree(ctx, src.id, parentRef, notes));
    }
    if (i.offset) {
      const d = toXyz(i.offset);
      for (const [n, c] of copies.entries()) {
        const o = await ctx.bridge.one<Record<string, any>>('getObject', { ref: { id: c.ref?.id ?? c.id }, include: ['parameters'] });
        const pos = (o.parameters as Array<{ name: string; value: any }> | undefined)?.find((p) => p.name === 'position')?.value ?? { x: 0, y: 0, z: 0 };
        const k = n + 1;
        await ctx.bridge.one('setTransform', { ref: { id: c.ref?.id ?? c.id }, position: { x: pos.x + d.x * k, y: pos.y + d.y * k, z: pos.z + d.z * k } });
      }
    }
    const out = copies.map((c): Record<string, any> => ({ ...c, id: c.ref?.id ?? c.id }));
    return ok({ method: used, copies: out, lossy: used === 'copy', notes }, `Duplicated via ${used}${used === 'copy' ? ' (lossy)' : ''}: ${out.map((c) => `${c.name} #${c.id}`).join(', ')}.`);
  },
});

export const setTransform = defineTool({
  name: 'c3d_set_transform',
  title: 'Set transform',
  description: 'Sets local position, rotation (degrees, rotation order of the object, default HPB = heading/pitch/bank) and/or scale. space "world" supports position only. Omitted components stay unchanged. To aim an object at a target use c3d_look_at.',
  group: 'scene',
  inputSchema: z.strictObject({ ref: ObjectRef, position: Vec3.optional(), rotation: Vec3.optional().describe('Degrees.'), scale: Vec3.optional(), space: z.enum(['local', 'world']).optional().describe('Default local; world applies to position only.') }),
  outputSchema: z.looseObject({ object: Descriptor, transform: AnyObject.optional() }),
  mutating: true,
  idempotent: true,
  profiles: ['full', 'local'],
  localDescription: 'Set position/rotation(deg)/scale of an object.',
  async handler(i, ctx) {
    const t = transformArgs(i);
    if (!Object.keys(t).length) throw new BridgeError('INVALID_ARGUMENT', 'Provide at least one of position, rotation, scale.');
    if (i.space === 'world' && (i.rotation || i.scale)) throw new BridgeError('INVALID_ARGUMENT', 'World space supports position only.', 'Set rotation/scale in local space.');
    const r = await ctx.bridge.one<Record<string, any>>('setTransform', { ref: normRef(i.ref), ...t, ...(i.space ? { space: i.space } : {}) });
    return ok({ object: r, transform: r.transform }, `Transform updated for "${r.name}".`);
  },
});

export const getParameters = defineTool({
  name: 'c3d_get_parameters',
  title: 'Get parameters',
  description: 'Reads typed parameters of an object (or of one of its tags via tag_index). Use before c3d_set_parameters to learn valid names and value types (Float, Int, Bool, Vec3D, Vec4D colors, Texture paths, Link). Vectors come back as {x,y,z}; Gradient/FloatArray values are marked unsupported.',
  group: 'scene',
  inputSchema: z.strictObject({
    ref: ObjectRef,
    names: z.array(z.string()).max(200).optional().describe('Only these parameters (default: all).'),
    tag_index: z.number().int().min(0).optional().describe('Read a tag of the object instead of the object (index from c3d_get_object tags).'),
    response_format: ResponseFormat,
  }),
  outputSchema: z.looseObject({ parameters: z.array(z.looseObject({ name: z.string(), type: z.string() })) }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'local', 'readonly'],
  localDescription: 'Read object parameters (names, types, values).',
  async handler(i, ctx) {
    const r = await ctx.bridge.one<{ parameters: Array<{ name: string; type: string; value: unknown }> }>('getParameters', clean({ ref: normRef(i.ref), names: i.names, tag: i.tag_index === undefined ? undefined : { index: i.tag_index } }));
    const parameters = i.response_format === 'detailed' ? r.parameters : r.parameters.filter((p) => !['scriptName', 'locked'].includes(p.name));
    return ok({ parameters }, parameters.map((p) => `${p.name} (${p.type}) = ${JSON.stringify(p.value)}`).join('\n'));
  },
});

export const setParameters = defineTool({
  name: 'c3d_set_parameters',
  title: 'Set parameters',
  description: 'Writes typed parameters on an object, or on one of its tags when tag_index is given. Values: numbers, booleans, strings, [x,y,z] / {x,y,z} vectors, {r,g,b,a} colors (0..1), texture paths, {ref} links. Partial success is reported per name (unknown names are listed in errors). Use c3d_get_parameters first to see names.',
  group: 'scene',
  inputSchema: z.strictObject({ ref: ObjectRef, params: ParamMap.describe('Map of parameter name to value.'), tag_index: z.number().int().min(0).optional().describe('Write to this tag of the object instead.') }),
  outputSchema: z.looseObject({ applied: z.array(z.string()), errors: z.array(z.looseObject({ name: z.string() })) }),
  mutating: true,
  idempotent: true,
  profiles: ['full', 'local'],
  localDescription: 'Set object parameters (name->value).',
  async handler(i, ctx) {
    if (!Object.keys(i.params).length) throw new BridgeError('INVALID_ARGUMENT', 'params is empty.');
    const r = await runApply(ctx, 'setParameters', clean({ ref: normRef(i.ref), tag: i.tag_index === undefined ? undefined : { index: i.tag_index }, params: i.params }));
    return ok({ applied: r.applied, errors: r.errors }, applyText('Parameters', r));
  },
});

export const select = defineTool({
  name: 'c3d_select',
  title: 'Select objects',
  description: 'Selects objects in the active document (replacing the selection unless extend:true) and returns the previous selection so it can be restored later. Several editing menu actions (make editable, duplicate) work on the selection. Pass refs:[] to clear.',
  group: 'scene',
  inputSchema: z.strictObject({ refs: z.array(ObjectRef).max(1000).describe('Objects to select (empty array clears the selection).'), extend: z.boolean().optional().describe('Add to the current selection.') }),
  outputSchema: z.looseObject({ previous: z.array(Descriptor), selected: z.array(Descriptor) }),
  mutating: true,
  idempotent: true,
  profiles: ['full'],
  async handler(i, ctx) {
    const r = await ctx.bridge.one<{ previous: unknown[]; selected: unknown[] }>('select', clean({ refs: i.refs.map(normRef), extend: i.extend }));
    return ok({ previous: r.previous, selected: r.selected }, `${r.selected.length} object(s) selected.`);
  },
});

export const lookAt = defineTool({
  name: 'c3d_look_at',
  title: 'Look at target',
  description:
    'Rotates an object (typically a camera or light) so its forward axis (-Z by default) points at a target object or world point. Computes HPB rotation in TypeScript, accounts for the parent rotation, applies it, then re-reads the world matrix and reports residual_deg (should be ~0). Give exactly one of target_ref / target_point. If residual_deg is large, try forward:"+z".',
  group: 'scene',
  inputSchema: z.strictObject({
    ref: ObjectRef.describe('Object to rotate.'),
    target_ref: ObjectRef.optional().describe('Look at this object (its world position).'),
    target_point: Vec3.optional().describe('Look at this world point.'),
    forward: z.enum(['-z', '+z']).optional().describe('Local axis that must face the target (default -z, correct for cameras).'),
    up: Vec3.optional().describe('World up hint (default [0,1,0]).'),
  }),
  outputSchema: z.looseObject({ rotation: z.looseObject({ x: z.number(), y: z.number(), z: z.number() }), residual_deg: z.number().nullable() }),
  mutating: true,
  idempotent: true,
  profiles: ['full', 'local'],
  localDescription: 'Aim a camera/light/object at a target object or point.',
  async handler(i, ctx) {
    const up = i.up ? toXyz(i.up) : undefined;
    const r = await applyLookAt(ctx, i.ref, clean({ ref: i.target_ref, point: i.target_point }), clean({ up: up ? ([up.x, up.y, up.z] as [number, number, number]) : undefined, forward: i.forward }));
    return ok({ ...r }, `Rotation set to (${r.rotation.x.toFixed(2)}, ${r.rotation.y.toFixed(2)}, ${r.rotation.z.toFixed(2)}); residual ${r.residual_deg === null ? 'unknown' : r.residual_deg.toFixed(3)} deg.${r.warning ? ` ${r.warning}` : ''}`);
  },
});

export const sceneTools = [listScene, getObject, createObject, deleteObjects, reparent, rename, duplicate, setTransform, getParameters, setParameters, select, lookAt];
