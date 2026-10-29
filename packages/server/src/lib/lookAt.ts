/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unnecessary-type-assertion -- loosely typed runtime data; indices are bounds-checked by construction */
// Rotation math for c3d_look_at.
// Convention (derived from probe P15): rotation vector (x,y,z) = (H,P,B) degrees, rotorder 6 (HPB) and
//   R = Ry(H) * Rx(P) * Rz(B)   (column vectors; columns of R are the object's local axes in parent space)
// which reproduces obj2WorldMatrix rows [0.7392,-0.5732,0.3536 | 0.6124,0.3536,-0.7071 | 0.2803,0.7392,0.6124] for (30,45,60).
// Cameras (verified against the camera dump: pos (2.5,2.34,4.34), rot (30,-25,0) looks at the origin) look along local -Z.
export type V3 = [number, number, number];
export type M3 = [V3, V3, V3];
export type ForwardAxis = '-z' | '+z';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export function norm(a: V3): V3 {
  const l = len(a);
  return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

export function matMul(a: M3, b: M3): M3 {
  const r = (i: number, j: number): number => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!;
  return [[r(0, 0), r(0, 1), r(0, 2)], [r(1, 0), r(1, 1), r(1, 2)], [r(2, 0), r(2, 1), r(2, 2)]];
}
export const transpose = (m: M3): M3 => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
export const apply = (m: M3, v: V3): V3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

export function eulerToMatrix(h: number, p: number, b: number): M3 {
  const [ch, sh, cp, sp, cb, sb] = [Math.cos(h * D2R), Math.sin(h * D2R), Math.cos(p * D2R), Math.sin(p * D2R), Math.cos(b * D2R), Math.sin(b * D2R)] as const;
  const ry: M3 = [[ch, 0, sh], [0, 1, 0], [-sh, 0, ch]];
  const rx: M3 = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
  const rz: M3 = [[cb, -sb, 0], [sb, cb, 0], [0, 0, 1]];
  return matMul(matMul(ry, rx), rz);
}

export function matrixToEuler(m: M3): { h: number; p: number; b: number } {
  const sp = Math.max(-1, Math.min(1, -m[1][2]));
  const p = Math.asin(sp);
  if (Math.abs(sp) > 0.999999) {
    // gimbal lock: fold bank into heading
    return { h: Math.atan2(-m[2][0], m[0][0]) * R2D, p: p * R2D, b: 0 };
  }
  return { h: Math.atan2(m[0][2], m[2][2]) * R2D, p: p * R2D, b: Math.atan2(m[1][0], m[1][1]) * R2D };
}

/** World rotation whose forward axis points along (target - from), with the local Y axis as close to `up` as possible. */
export function lookAtMatrix(from: V3, target: V3, up: V3 = [0, 1, 0], forward: ForwardAxis = '-z'): M3 {
  const f = norm(sub(target, from));
  if (len(f) === 0) throw new RangeError('target coincides with the object position');
  const z = forward === '-z' ? ([-f[0], -f[1], -f[2]] as V3) : f; // image of local +Z
  let x = cross(up, z);
  if (len(x) < 1e-6) x = cross(Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1], z);
  x = norm(x);
  const y = cross(z, x);
  return [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
}

export interface LookAtResult { rotation: { x: number; y: number; z: number }; direction: V3 }
/** Local HPB rotation (degrees) that makes the object look at `target`. `parentRotation` is the parent's world rotation. */
export function lookAtEuler(from: V3, target: V3, opts: { up?: V3; forward?: ForwardAxis; parentRotation?: M3 } = {}): LookAtResult {
  const world = lookAtMatrix(from, target, opts.up, opts.forward);
  const local = opts.parentRotation ? matMul(transpose(opts.parentRotation), world) : world;
  const e = matrixToEuler(local);
  return { rotation: { x: e.h, y: e.p, z: e.b }, direction: norm(sub(target, from)) };
}

/** Angle in degrees between the object's forward axis (from its world rotation) and the direction to target. */
export function residualAngleDeg(worldRotation: M3, from: V3, target: V3, forward: ForwardAxis = '-z'): number {
  const axis: V3 = forward === '-z' ? [0, 0, -1] : [0, 0, 1];
  const f = apply(worldRotation, axis);
  const d = norm(sub(target, from));
  return Math.acos(Math.max(-1, Math.min(1, dot(norm(f), d)))) * R2D;
}

export interface WorldXform { rotation: M3; position?: V3 }
const isNums = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'number');

/** Accepts {rows|rotation:[[3x3]], position:{x,y,z}|[x,y,z]}, nested 3x3/4x4 or flat 9/16 arrays (row-major, translation in the 4th column). */
export function parseWorldMatrix(raw: unknown): WorldXform | undefined {
  if (!raw) return undefined;
  const pos = (p: unknown): V3 | undefined => {
    if (isNums(p, 3)) return [p[0]!, p[1]!, p[2]!];
    const o = p as { x?: number; y?: number; z?: number } | undefined;
    return o && typeof o.x === 'number' ? [o.x, o.y ?? 0, o.z ?? 0] : undefined;
  };
  if (!Array.isArray(raw) && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const inner = parseWorldMatrix(o.rotation ?? o.rows ?? o.m);
    if (!inner) return undefined;
    const p = pos(o.position) ?? inner.position;
    return p ? { rotation: inner.rotation, position: p } : { rotation: inner.rotation };
  }
  const a = raw as unknown[];
  let rows: number[][] | undefined;
  if (a.length === 9 || a.length === 16) {
    const n = a.length === 9 ? 3 : 4;
    rows = Array.from({ length: n }, (_, i) => a.slice(i * n, i * n + n) as number[]);
  } else if (a.length === 3 || a.length === 4) rows = a as number[][];
  if (!rows || !rows.every((r) => Array.isArray(r) && r.length >= 3 && r.every((v) => typeof v === 'number'))) return undefined;
  const r = rows.slice(0, 3).map((row) => [row[0]!, row[1]!, row[2]!] as V3) as M3;
  const t = rows[0]!.length === 4 ? ([rows[0]![3]!, rows[1]![3]!, rows[2]![3]!] as V3) : undefined;
  return t ? { rotation: r, position: t } : { rotation: r };
}
