/* eslint-disable @typescript-eslint/no-unsafe-call -- loosely typed runtime data; indices are bounds-checked by construction */
import { z } from 'zod';
import { BridgeError, defineTool } from '../toolkit.js';
import { clean, ok } from '../lib/result.js';
import { ObjectRef, normRef } from '../lib/schemas.js';

const Takes = z.array(z.looseObject({ name: z.string() }));

export const setTime = defineTool({
  name: 'c3d_set_time',
  title: 'Set animation time',
  description: 'Moves the animation playhead to a time in seconds (not frames). Animated parameters re-evaluate; use before reading values or rendering a specific moment. frame = seconds * fps.',
  group: 'animation',
  inputSchema: z.strictObject({ time: z.number().min(0).max(100000).describe('Seconds.') }),
  outputSchema: z.looseObject({ time: z.number() }),
  mutating: true,
  idempotent: true,
  profiles: ['full', 'local'],
  localDescription: 'Set the animation playhead (seconds).',
  async handler(i, ctx) {
    const r = await ctx.bridge.one<{ time: number }>('setTime', { time: i.time });
    return ok({ time: r.time }, `Time is now ${r.time} s.`);
  },
});

export const setFps = defineTool({
  name: 'c3d_set_fps',
  title: 'Set frame rate',
  description: 'Sets the document frame rate (default 30). Keyframe times stay in seconds. Set it before keyframing if frame-accurate timing matters.',
  group: 'animation',
  inputSchema: z.strictObject({ fps: z.number().min(1).max(240).describe('Frames per second.') }),
  outputSchema: z.looseObject({ fps: z.number() }),
  mutating: true,
  idempotent: true,
  profiles: ['full'],
  async handler(i, ctx) {
    const r = await ctx.bridge.one<{ fps: number }>('setFps', { fps: i.fps });
    return ok({ fps: r.fps }, `FPS is now ${r.fps}.`);
  },
});

export const takes = defineTool({
  name: 'c3d_takes',
  title: 'Manage takes',
  description: 'Lists, adds, renames, removes or selects animation takes. Keyframes are stored per take; the current take receives c3d_set_keyframes unless take is given.',
  group: 'animation',
  inputSchema: z.strictObject({
    action: z.enum(['list', 'add', 'rename', 'remove', 'select']).describe('Operation to perform.'),
    name: z.string().min(1).max(255).optional().describe('Take name (required for all but list).'),
    new_name: z.string().min(1).max(255).optional().describe('For rename.'),
  }),
  outputSchema: z.looseObject({ takes: Takes, current: z.string().nullable().optional() }),
  mutating: true,
  destructive: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    if (i.action !== 'list' && !i.name) throw new BridgeError('INVALID_ARGUMENT', `action "${i.action}" needs name.`);
    if (i.action === 'rename' && !i.new_name) throw new BridgeError('INVALID_ARGUMENT', 'rename needs new_name.');
    const r = await ctx.bridge.one<Record<string, any>>('takes', clean({ action: i.action, name: i.name, newName: i.new_name }));
    return ok({ takes: r.takes ?? [], current: r.current ?? null }, `${(r.takes ?? []).length} take(s); current: ${String(r.current)}.`);
  },
});

const Interp = z.enum(['linear', 'soft', 'spline', 'flat', 'const']);
const KeyValue = z.union([z.number(), z.array(z.number()).min(3).max(4), z.record(z.string(), z.number())]).describe('number for scalar parameters, [x,y,z] / {x,y,z} for vectors, [r,g,b,a] / {r,g,b,a} for colors.');

function normValue(v: z.infer<typeof KeyValue>): unknown {
  if (!Array.isArray(v)) return v;
  return v.length === 3 ? { x: v[0], y: v[1], z: v[2] } : { x: v[0], y: v[1], z: v[2], w: v[3] };
}

export const setKeyframes = defineTool({
  name: 'c3d_set_keyframes',
  title: 'Set keyframes',
  description: 'Writes keyframes for one animatable parameter (e.g. "position", "rotation", "scale", "intensity") on an object. Times are SECONDS. One F-curve per vector component is created; interpolation per key: linear, soft, spline, flat, const. replace:true (default) clears existing keys of that parameter in the take first. Verify with c3d_get_keyframes or c3d_set_time + c3d_get_parameters.',
  group: 'animation',
  inputSchema: z.strictObject({
    ref: ObjectRef,
    param: z.string().min(1).describe('Animatable parameter name, e.g. "position".'),
    keys: z.array(z.strictObject({ time: z.number().min(0), value: KeyValue, interpolation: Interp.optional() })).min(1).max(5000).describe('Keys: [{time (s), value, interpolation?}] with unique times.'),
    take: z.string().optional().describe('Take name (default: current take).'),
    replace: z.boolean().optional().describe('Clear existing keys first (default true).'),
  }),
  outputSchema: z.looseObject({ param: z.string(), components: z.array(z.looseObject({ index: z.number().int(), keyCount: z.number().int() })), take: z.string().nullable().optional() }),
  mutating: true,
  idempotent: true,
  profiles: ['full', 'local'],
  localDescription: 'Keyframe a parameter (e.g. position) with [{time(s), value}].',
  async handler(i, ctx) {
    const times = i.keys.map((k) => k.time);
    if (new Set(times).size !== times.length) throw new BridgeError('INVALID_ARGUMENT', 'Duplicate key times.', 'Each key needs a unique time.');
    const r = await ctx.bridge.one<Record<string, any>>('setKeyframes', clean({ ref: normRef(i.ref), param: i.param, take: i.take, replace: i.replace ?? true, keys: i.keys.map((k) => ({ ...k, value: normValue(k.value) })) }));
    return ok({ param: r.param ?? i.param, components: r.components ?? [], take: r.take ?? null }, `Set ${i.keys.length} key(s) on ${i.param}.`);
  },
});

export const getKeyframes = defineTool({
  name: 'c3d_get_keyframes',
  title: 'Get keyframes',
  description: 'Reads the keyframes of a parameter per component (index 0=x/r, 1=y/g, 2=z/b, 3=w/a): time in seconds, value, interpolation.',
  group: 'animation',
  inputSchema: z.strictObject({ ref: ObjectRef, param: z.string().min(1).describe('Animatable parameter name, e.g. "position".'), take: z.string().optional().describe('Take name (default: current take).') }),
  outputSchema: z.looseObject({ param: z.string(), components: z.array(z.looseObject({ index: z.number().int(), keys: z.array(z.looseObject({ time: z.number(), value: z.number() })) })) }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'readonly'],
  async handler(i, ctx) {
    const r = await ctx.bridge.one<Record<string, any>>('getKeyframes', clean({ ref: normRef(i.ref), param: i.param, take: i.take }));
    return ok({ param: r.param ?? i.param, take: r.take ?? null, components: r.components ?? [] }, `${(r.components ?? []).map((c: any) => `[${c.index}]: ${c.keys.length} key(s)`).join(', ')}`);
  },
});

export const animationTools = [setTime, setFps, takes, setKeyframes, getKeyframes];
