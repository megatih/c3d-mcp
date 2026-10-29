/* eslint-disable @typescript-eslint/no-non-null-assertion -- loosely typed runtime data; indices are bounds-checked by construction */
// Applies the look_at math to a live object via the bridge, with a read-back residual check.
import { BridgeError, type ToolContext } from '../toolkit.js';
import { lookAtEuler, parseWorldMatrix, residualAngleDeg, type ForwardAxis, type M3, type V3 } from './lookAt.js';
import { normRef, toXyz, type ObjectRefInput, type Vec3 } from './schemas.js';
import type { z } from 'zod';

export interface LookAtTarget { ref?: ObjectRefInput; point?: z.infer<typeof Vec3> }
export interface LookAtOutcome { rotation: { x: number; y: number; z: number }; residual_deg: number | null; target: V3; position: V3; warning?: string }

async function worldOf(ctx: ToolContext, ref: unknown): Promise<{ rotation: M3; position: V3; desc: Record<string, any> }> {
  const o = await ctx.bridge.one<Record<string, any>>('getObject', { ref, include: ['worldMatrix'] });
  const w = parseWorldMatrix(o.worldMatrix);
  if (!w?.position) throw new BridgeError('INTERNAL', 'Runtime returned no usable worldMatrix for the object.', 'Update the bridge runtime (c3d_doctor).', { object: o });
  return { rotation: w.rotation, position: w.position, desc: o };
}

export async function applyLookAt(ctx: ToolContext, ref: ObjectRefInput, target: LookAtTarget, opts: { up?: V3; forward?: ForwardAxis } = {}): Promise<LookAtOutcome> {
  if ((target.ref === undefined) === (target.point === undefined)) throw new BridgeError('INVALID_ARGUMENT', 'Give exactly one of target_ref or target_point.');
  const me = await worldOf(ctx, normRef(ref));
  const to: V3 = target.point ? (Object.values(toXyz(target.point)) as V3) : (await worldOf(ctx, normRef(target.ref!))).position;
  let parentRotation: M3 | undefined;
  const ip = me.desc.indexPath as number[] | undefined;
  if (ip && ip.length > 1) parentRotation = (await worldOf(ctx, { indexPath: ip.slice(0, -1) })).rotation;
  if (Math.hypot(to[0] - me.position[0], to[1] - me.position[1], to[2] - me.position[2]) < 1e-6)
    throw new BridgeError('INVALID_ARGUMENT', 'The target is at the same position as the object; direction is undefined.', 'Choose a different target point.');
  const forward = opts.forward ?? '-z';
  const sol = lookAtEuler(me.position, to, { ...opts, forward, parentRotation });
  await ctx.bridge.one('setTransform', { ref: normRef(ref), rotation: sol.rotation });
  let residual: number | null = null;
  let warning: string | undefined;
  try {
    const after = await worldOf(ctx, normRef(ref));
    residual = residualAngleDeg(after.rotation, after.position, to, forward);
    if (residual > 1) warning = `Read-back shows the object ${residual.toFixed(1)} deg off target. If it is a light/camera that faces +Z, retry with forward:"+z".`;
  } catch {
    warning = 'Read-back check unavailable.';
  }
  return { rotation: sol.rotation, residual_deg: residual, target: to, position: me.position, ...(warning ? { warning } : {}) };
}
