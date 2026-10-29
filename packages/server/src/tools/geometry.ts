import { z } from 'zod';
import { BridgeError, defineTool } from '../toolkit.js';
import { sendMesh } from '../lib/meshSend.js';
import { buildPipe } from '../lib/pipe.js';
import { clean, ok } from '../lib/result.js';
import { Descriptor, MaterialRef, ObjectRef, Vec3, Vec3Mesh, normMat, normRef, toXyz } from '../lib/schemas.js';

const xyz = (v: z.infer<typeof Vec3> | undefined): { x: number; y: number; z: number } | undefined => (v ? toXyz(v) : undefined);

export const createMesh = defineTool({
  name: 'c3d_create_mesh',
  title: 'Create polygon mesh',
  description:
    'Builds an editable polygon object (Cheetah3D is Y-up: put heights on the y axis) from vertices ([x,y,z]) and polygons (arrays of vertex indices, 3..64 corners, n-gons allowed, consistent counter-clockwise winding seen from outside) with optional per-corner uvs and a whole-object material. Indices are validated client-side first (bad indices crash Cheetah3D). Large meshes are sent in chunks automatically. Per-polygon materials: assign afterwards with c3d_assign_material polygons:[...]. For tubes/cables use c3d_create_pipe. Y is up.',
  group: 'geometry',
  inputSchema: z.strictObject({
    name: z.string().min(1).max(255).optional().describe('Object name.'),
    parent: ObjectRef.optional().describe('Parent (default root).'),
    position: Vec3.optional().describe('Local position.'),
    rotation: Vec3.optional().describe('Degrees.'),
    scale: Vec3.optional().describe('Local scale.'),
    vertices: z.array(Vec3Mesh).min(1).max(200000).describe('Vertex positions [x,y,z].'),
    polygons: z.array(z.array(z.number().int().min(0)).min(3).max(64)).min(1).max(200000).describe('Vertex index lists, one per polygon.'),
    uvs: z.array(z.array(z.tuple([z.number(), z.number()]))).optional().describe('Per polygon, per corner [u,v]; same shape as polygons.'),
    material: MaterialRef.optional().describe('Material to assign to the whole object.'),
  }),
  outputSchema: z.looseObject({ object: Descriptor, vertexCount: z.number().int(), polygonCount: z.number().int(), chunks: z.number().int() }),
  mutating: true,
  idempotent: false,
  profiles: ['full', 'local'],
  localDescription: 'Create a mesh. Y is UP: height goes on the y axis, e.g. a pyramid has its base on y=0 and its apex at [0,height,0]. Vertices are [x,y,z]; polygons are vertex-index lists, counter-clockwise seen from outside.',
  async handler(i, ctx) {
    const t = clean({ position: xyz(i.position), rotation: xyz(i.rotation), scale: xyz(i.scale) });
    const sent = await sendMesh(ctx, { mesh: { vertices: i.vertices, polygons: i.polygons, uvs: i.uvs }, name: i.name, parent: i.parent === undefined ? undefined : normRef(i.parent), transform: t, material: i.material === undefined ? undefined : normMat(i.material) });
    const res = sent.res;
    const object: Record<string, any> = { ...res, id: sent.id };
    return ok({ object, vertexCount: res.vertexCount ?? i.vertices.length, polygonCount: res.polygonCount ?? i.polygons.length, chunks: sent.chunks }, `Created mesh "${String(object.name)}" #${sent.id}: ${res.vertexCount ?? i.vertices.length} vertices, ${res.polygonCount ?? i.polygons.length} polygons (${sent.chunks} request(s)).`);
  },
});

export const getMesh = defineTool({
  name: 'c3d_get_mesh',
  title: 'Read mesh',
  description: 'Reads vertices, polygons and uvs of an editable polygon object in pages (primitives like BOX are not polygon objects: use c3d_make_editable first). Pass the returned next_vertex_offset / next_polygon_offset to continue.',
  group: 'geometry',
  inputSchema: z.strictObject({
    ref: ObjectRef,
    vertex_offset: z.number().int().min(0).optional().describe('First vertex index (default 0).'),
    vertex_limit: z.number().int().min(0).max(5000).optional().describe('Default 500.'),
    polygon_offset: z.number().int().min(0).optional().describe('First polygon index (default 0).'),
    polygon_limit: z.number().int().min(0).max(5000).optional().describe('Default 500.'),
  }),
  outputSchema: z.looseObject({ vertices: z.array(z.array(z.number())), polygons: z.array(z.array(z.number())), vertexCount: z.number().int(), polygonCount: z.number().int(), next_vertex_offset: z.number().int().nullable(), next_polygon_offset: z.number().int().nullable() }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'readonly'],
  async handler(i, ctx) {
    const r = await ctx.bridge.one<Record<string, any>>('getMesh', clean({ ref: normRef(i.ref), vertexOffset: i.vertex_offset ?? 0, vertexLimit: i.vertex_limit ?? 500, polygonOffset: i.polygon_offset ?? 0, polygonLimit: i.polygon_limit ?? 500 }));
    return ok({ ...r, next_vertex_offset: r.nextVertexOffset ?? null, next_polygon_offset: r.nextPolygonOffset ?? null }, `${r.vertices?.length ?? 0}/${r.vertexCount} vertices, ${r.polygons?.length ?? 0}/${r.polygonCount} polygons returned.`);
  },
});

export const editMesh = defineTool({
  name: 'c3d_edit_mesh',
  title: 'Edit mesh',
  description: 'In-place edits on an editable polygon object: move vertices (set_vertices), delete polygons by index, flip polygon winding, and weld vertices closer than merge_distance. Order: set_vertices, flip_winding, delete_polygons, merge. Indices are those from c3d_get_mesh; deleting shifts later polygon indices. Primitives are not editable: c3d_make_editable first.',
  group: 'geometry',
  inputSchema: z.strictObject({
    ref: ObjectRef,
    set_vertices: z.array(z.strictObject({ index: z.number().int().min(0), position: Vec3 })).max(100000).optional().describe('Vertices to move: [{index, position}].'),
    delete_polygons: z.array(z.number().int().min(0)).max(100000).optional().describe('Polygon indices to delete.'),
    flip_winding: z.array(z.number().int().min(0)).max(100000).optional().describe('Polygon indices whose winding (normal) is reversed.'),
    merge_distance: z.number().min(0).max(1000).optional().describe('Weld vertices within this distance.'),
  }),
  outputSchema: z.looseObject({ vertexCount: z.number().int(), polygonCount: z.number().int() }),
  mutating: true,
  destructive: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    if (!i.set_vertices && !i.delete_polygons && !i.flip_winding && i.merge_distance === undefined) throw new BridgeError('INVALID_ARGUMENT', 'Nothing to do: give set_vertices, delete_polygons, flip_winding or merge_distance.');
    const r = await ctx.bridge.one<Record<string, any>>('editMesh', clean({ ref: normRef(i.ref), setVertices: i.set_vertices?.map((v) => ({ index: v.index, position: xyz(v.position) })), deletePolygons: i.delete_polygons, flipWinding: i.flip_winding, mergeVertices: i.merge_distance }));
    return ok({ vertexCount: r.vertexCount, polygonCount: r.polygonCount }, `Mesh now has ${r.vertexCount} vertices, ${r.polygonCount} polygons.`);
  },
});

const Pt = z.strictObject({ p: Vec3Mesh.describe('Point.'), c1: Vec3Mesh.optional().describe('Incoming bezier handle.'), c2: Vec3Mesh.optional().describe('Outgoing bezier handle.') });

export const createSpline = defineTool({
  name: 'c3d_create_spline',
  title: 'Create spline',
  description: 'Creates a SPLINE object from one or more paths of points (p, optional bezier handles c1/c2; closed:true to close). Use splines as Extrude/Lathe/Sweep inputs: create the spline, then c3d_create_object (EXTRUDE etc.) and reparent the spline under it.',
  group: 'geometry',
  inputSchema: z.strictObject({
    name: z.string().min(1).max(255).optional().describe('Object name.'),
    parent: ObjectRef.optional().describe('Parent (default root).'),
    position: Vec3.optional().describe('Local position.'),
    rotation: Vec3.optional().describe('Degrees.'),
    scale: Vec3.optional().describe('Local scale.'),
    paths: z.array(z.strictObject({ points: z.array(Pt).min(2).max(10000), closed: z.boolean().optional() })).min(1).max(100).describe('Sub-paths: [{points:[{p:[x,y,z], c1?, c2?}], closed?}].'),
  }),
  outputSchema: z.looseObject({ object: Descriptor, pathCount: z.number().int() }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    const t = clean({ position: xyz(i.position), rotation: xyz(i.rotation), scale: xyz(i.scale) });
    const r = await ctx.bridge.one<Record<string, any>>('createSpline', clean({ name: i.name, parent: i.parent === undefined ? undefined : normRef(i.parent), transform: Object.keys(t).length ? t : undefined, paths: i.paths }));
    return ok({ object: { ...r, id: r.ref?.id ?? r.id }, pathCount: r.pathCount ?? i.paths.length }, `Created spline "${String(r.name)}" with ${r.pathCount ?? i.paths.length} path(s).`);
  },
});

export const makeEditable = defineTool({
  name: 'c3d_make_editable',
  title: 'Make editable (experimental)',
  description: 'EXPERIMENTAL. Converts the object to an editable POLYGONOBJ/SPLINE by selecting it and pressing Objects > Make Editable via the helper (needs Accessibility), then verifies by reading the selection back. The converted object may get a new id: use the returned object. Without the helper this is UNSUPPORTED: rebuild the shape with c3d_create_mesh.',
  group: 'geometry',
  inputSchema: z.strictObject({ ref: ObjectRef }),
  outputSchema: z.looseObject({ object: Descriptor, converted: z.boolean() }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    if (!ctx.helper.available()) throw new BridgeError('UNSUPPORTED', 'Make Editable needs the helper (menu automation).', 'Rebuild the geometry with c3d_create_mesh, or run c3d_doctor.');
    const before = await ctx.bridge.one<Record<string, any>>('getObject', { ref: normRef(i.ref) });
    await ctx.bridge.one('select', { refs: [normRef(i.ref)] });
    await ctx.helper.call('pressMenu', { path: ['Objects', 'Make Editable'], timeoutMs: 8000 });
    const after = await ctx.bridge.one<Record<string, any>>('getObject', { ref: { selected: true } });
    const converted = after.type !== before.type || after.id !== before.id;
    if (!converted && before.type !== 'POLYGONOBJ') throw new BridgeError('UNSUPPORTED', `Make Editable had no effect on ${String(before.type)} "${String(before.name)}".`, 'The menu item may be disabled for this object type; use c3d_create_mesh instead.', { before, after });
    return ok({ object: after, converted }, converted ? `"${String(after.name)}" is now ${String(after.type)} (#${String(after.id)}).` : 'Object was already editable.');
  },
});

export const createPipe = defineTool({
  name: 'c3d_create_pipe',
  title: 'Create pipe / tube',
  description:
    'Sweeps a circular cross-section (radius, segments sides) along a 3D polyline (points [x,y,z], 2..200) and creates it as one editable polygon mesh: cables, pipes, rails, handrails, partial torus arcs (TORUS has no sweep angle). bend_radius rounds every interior corner with a circular arc (arc_steps samples; must fit: <= half the shorter adjacent segment, else INVALID_ARGUMENT); without it corners are mitered. Parallel-transport frames, so no twisting. closed:true makes a loop (needs 3+ points), caps:true closes open ends. Y is up. Optional parent/material/transform like c3d_create_mesh.',
  group: 'geometry',
  inputSchema: z.strictObject({
    name: z.string().min(1).max(255).optional().describe('Object name.'),
    parent: ObjectRef.optional().describe('Parent (default root).'),
    position: Vec3.optional().describe('Local position of the object (points are relative to it).'),
    rotation: Vec3.optional().describe('Degrees.'),
    scale: Vec3.optional().describe('Local scale.'),
    points: z.array(Vec3Mesh).min(2).max(200).describe('Polyline the pipe follows: [[x,y,z],...]. Consecutive points must differ.'),
    radius: z.number().positive().max(100000).describe('Pipe radius (> 0).'),
    segments: z.number().int().min(6).max(48).optional().describe('Sides of the circular cross-section (default 16).'),
    bend_radius: z.number().positive().max(100000).optional().describe('Radius of the circular fillet at every interior corner; omit for sharp mitered corners.'),
    arc_steps: z.number().int().min(1).max(24).optional().describe('Segments per fillet arc (default 6).'),
    closed: z.boolean().optional().describe('Join the last point back to the first (default false).'),
    caps: z.boolean().optional().describe('Close the open ends with flat caps (default true; ignored when closed).'),
    material: MaterialRef.optional().describe('Material to assign to the whole object.'),
  }),
  outputSchema: z.looseObject({ object: Descriptor, vertexCount: z.number().int(), polygonCount: z.number().int(), ringCount: z.number().int(), chunks: z.number().int() }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    const pipe = buildPipe({ points: i.points, radius: i.radius, segments: i.segments, bendRadius: i.bend_radius, arcSteps: i.arc_steps, closed: i.closed, caps: i.caps });
    const t = clean({ position: xyz(i.position), rotation: xyz(i.rotation), scale: xyz(i.scale) });
    const sent = await sendMesh(ctx, { mesh: { vertices: pipe.vertices, polygons: pipe.polygons }, name: i.name ?? 'Pipe', parent: i.parent === undefined ? undefined : normRef(i.parent), transform: t, material: i.material === undefined ? undefined : normMat(i.material) });
    const object: Record<string, any> = { ...sent.res, id: sent.id };
    return ok({ object, vertexCount: pipe.vertices.length, polygonCount: pipe.polygons.length, ringCount: pipe.ringCount, chunks: sent.chunks }, `Created pipe "${String(object.name)}" #${sent.id}: ${pipe.ringCount} rings x ${pipe.segments} sides, ${pipe.vertices.length} vertices, ${pipe.polygons.length} polygons.`);
  },
});

export const geometryTools = [createMesh, getMesh, editMesh, createSpline, makeEditable, createPipe];
