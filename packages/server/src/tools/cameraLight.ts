 
import { z } from 'zod';
import { BridgeError, defineTool, type ToolContext } from '../toolkit.js';
import { applyLookAt, type LookAtOutcome } from '../lib/lookAtOp.js';
import { runApply } from '../lib/ops.js';
import { clean, ok } from '../lib/result.js';
import { Color, Descriptor, ObjectRef, ParamMap, Vec3, normRef, toColor, toXyz } from '../lib/schemas.js';

type Obj = Record<string, any>;

async function ensureObject(ctx: ToolContext, type: 'CAMERA' | 'LIGHT', ref: z.infer<typeof ObjectRef> | undefined, name: string | undefined, extra: Record<string, unknown>): Promise<Obj> {
  if (ref !== undefined) {
    const o = await ctx.bridge.one<Obj>('getObject', { ref: normRef(ref) });
    if (o.type !== type) throw new BridgeError('INVALID_ARGUMENT', `Object #${String(o.id)} is a ${String(o.type)}, expected ${type}.`, `Omit ref to create a new ${type.toLowerCase()}.`);
    return o;
  }
  const o = await ctx.bridge.one<Obj>('createObject', clean({ type, name, ...extra }));
  return { ...o, id: o.ref?.id ?? o.id };
}

const LookTarget = {
  look_at_ref: ObjectRef.optional().describe('Aim at this object (needs the object to exist).'),
  look_at_point: Vec3.optional().describe('Aim at this world point.'),
};

async function aim(ctx: ToolContext, id: number, i: { look_at_ref?: z.infer<typeof ObjectRef>; look_at_point?: z.infer<typeof Vec3> }): Promise<LookAtOutcome | undefined> {
  if (i.look_at_ref === undefined && i.look_at_point === undefined) return undefined;
  return applyLookAt(ctx, id, clean({ ref: i.look_at_ref, point: i.look_at_point }));
}

export const setCamera = defineTool({
  name: 'c3d_set_camera',
  title: 'Create/configure camera',
  description: 'Creates a camera (omit ref) or reconfigures an existing one: name, position, aim (look_at_ref / look_at_point, verified by read-back), field of view in degrees, clip planes, focal distance, extra params, and active:true to make it the render camera (a newly created camera becomes active automatically). Cheetah cameras look down -Z.',
  group: 'camera-light',
  inputSchema: z.strictObject({
    ref: ObjectRef.optional().describe('Existing camera; omit to create one.'),
    name: z.string().min(1).max(255).optional().describe('Camera name.'),
    position: Vec3.optional().describe('World/local position.'),
    ...LookTarget,
    fov: z.number().min(1).max(170).optional().describe('Field of view in degrees (fieldOfView).'),
    near: z.number().positive().optional().describe('Near clip (clipNear).'),
    far: z.number().positive().optional().describe('Far clip (clipFar).'),
    focal_distance: z.number().positive().optional().describe('Focal distance for depth of field.'),
    active: z.boolean().optional().describe('Make this the active (render) camera.'),
    params: ParamMap.optional().describe('Other camera parameters (see c3d_get_parameters).'),
  }),
  outputSchema: z.looseObject({ object: Descriptor, look_at: z.any().optional(), active: z.boolean().optional() }),
  mutating: true,
  idempotent: false,
  profiles: ['full', 'local'],
  localDescription: 'Create or adjust a camera: position, aim, fov, active.',
  async handler(i, ctx) {
    const cam = await ensureObject(ctx, 'CAMERA', i.ref, i.name, clean({ transform: i.position ? { position: toXyz(i.position) } : undefined }));
    const ref = { id: cam.id as number };
    if (i.ref !== undefined) {
      if (i.name) await ctx.bridge.one('rename', { ref, name: i.name });
      if (i.position) await ctx.bridge.one('setTransform', { ref, position: toXyz(i.position) });
    }
    const params = { ...i.params, ...clean({ fieldOfView: i.fov, clipNear: i.near, clipFar: i.far, focalDistance: i.focal_distance }) };
    if (Object.keys(params).length) await runApply(ctx, 'setParameters', { ref, params });
    const look = await aim(ctx, ref.id, i);
    let active: boolean | undefined;
    if (i.active) {
      await ctx.bridge.one('setActiveCamera', { ref });
      active = true;
    }
    const object = await ctx.bridge.one<Obj>('getObject', { ref });
    return ok({ object, ...(look ? { look_at: look } : {}), ...(active ? { active } : {}) }, `Camera "${String(object.name)}" #${ref.id} configured${look ? `, aim residual ${look.residual_deg?.toFixed(2) ?? '?'} deg` : ''}${active ? ', active' : ''}.`);
  },
});

export const setLight = defineTool({
  name: 'c3d_set_light',
  title: 'Create/configure light',
  description: 'Creates a LIGHT (omit ref) or reconfigures one: name, position, aim (look_at_*), color, intensity and light_type. light_type is an integer 0..4 or a name from c3d_capabilities lightTypes; there are no SPOTLIGHT/POINTLIGHT object types. Light types: 0 ambient, 1 area, 2 distant, 3 point (default), 4 spot. New lights use inverse-square attenuation (params.attenuation=2): renders look dark unless intensity is raised (about distance squared) or attenuation is set to 0 (none). Direction-dependent lights face -Z by default; the aim read-back reports the residual angle.',
  group: 'camera-light',
  inputSchema: z.strictObject({
    ref: ObjectRef.optional().describe('Existing light; omit to create one.'),
    name: z.string().min(1).max(255).optional().describe('Light name.'),
    position: Vec3.optional().describe('Position.'),
    ...LookTarget,
    light_type: z.union([z.number().int().min(0).max(4), z.string().min(2).max(30)]).optional().describe('0..4 or a lightTypes name from c3d_capabilities.'),
    color: Color.optional(),
    intensity: z.number().min(0).max(100000).optional().describe('Light intensity (1 = default).'),
    params: ParamMap.optional().describe('Other light parameters (shadowType, radius, ...).'),
  }),
  outputSchema: z.looseObject({ object: Descriptor, look_at: z.any().optional() }),
  mutating: true,
  idempotent: false,
  profiles: ['full', 'local'],
  localDescription: 'Create or adjust a light: type 0..4, color, intensity, position, aim.',
  async handler(i, ctx) {
    let lightType: number | undefined;
    if (typeof i.light_type === 'string') {
      const caps = await ctx.services.capabilities();
      const map = (caps.lightTypes ?? {}) as Record<string, number>;
      const hit = map[i.light_type] ?? map[i.light_type.toLowerCase()];
      if (hit === undefined) throw new BridgeError('INVALID_ARGUMENT', `Unknown light type "${i.light_type}".`, `Use an integer 0..4 or one of: ${Object.keys(map).join(', ') || '(capabilities unavailable)'}.`);
      lightType = hit;
    } else lightType = i.light_type;
    const light = await ensureObject(ctx, 'LIGHT', i.ref, i.name, clean({ lightType, transform: i.position ? { position: toXyz(i.position) } : undefined }));
    const ref = { id: light.id as number };
    if (i.ref !== undefined) {
      if (i.name) await ctx.bridge.one('rename', { ref, name: i.name });
      if (i.position) await ctx.bridge.one('setTransform', { ref, position: toXyz(i.position) });
    }
    const params = { ...i.params, ...clean({ color: i.color === undefined ? undefined : toColor(i.color), intensity: i.intensity, lightType: i.ref !== undefined ? lightType : undefined }) };
    if (Object.keys(params).length) await runApply(ctx, 'setParameters', { ref, params });
    const look = await aim(ctx, ref.id, i);
    const object = await ctx.bridge.one<Obj>('getObject', { ref });
    return ok({ object, ...(look ? { look_at: look } : {}) }, `Light "${String(object.name)}" #${ref.id} configured${look ? `, aim residual ${look.residual_deg?.toFixed(2) ?? '?'} deg` : ''}.`);
  },
});

export const cameraLightTools = [setCamera, setLight];
