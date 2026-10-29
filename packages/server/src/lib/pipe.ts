/* eslint-disable @typescript-eslint/no-non-null-assertion -- indices are bounds-checked by construction */
// Pipe / tube generator: sweeps a circular cross-section along a 3D polyline with parallel-transport frames.
// Optional circular-arc fillets round the interior corners; unfilleted corners are mitered. Output is plain mesh data
// (vertices + polygons, counter-clockwise seen from outside) for the createMesh path.
import { BridgeError } from '../toolkit.js';
import type { Vertex } from './mesh.js';

type V3 = [number, number, number];

export interface PipeOptions {
  points: V3[];
  radius: number;
  segments?: number;
  bendRadius?: number;
  arcSteps?: number;
  closed?: boolean;
  caps?: boolean;
}

export interface PipeMesh {
  vertices: Vertex[];
  polygons: number[][];
  /** Number of cross-section rings. */
  ringCount: number;
  segments: number;
  /** Path samples (ring centers) and their unit tangents, in ring order. */
  path: V3[];
  tangents: V3[];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

const EPS = 1e-9;
const MAX_VERTICES = 200_000;

interface PathPoint { p: V3; t: V3; /** miter scale for the cross-section (1 = none) */ miter: number; m: V3 }

export function buildPipe(o: PipeOptions): PipeMesh {
  const segments = o.segments ?? 16;
  const arcSteps = o.arcSteps ?? 6;
  const closed = o.closed ?? false;
  const caps = (o.caps ?? true) && !closed;
  const pts = o.points;
  const n = pts.length;
  if (!(o.radius > 0) || !Number.isFinite(o.radius)) throw new BridgeError('INVALID_ARGUMENT', 'radius must be a positive finite number.');
  pts.forEach((p, i) => {
    if (!p.every(Number.isFinite)) throw new BridgeError('INVALID_ARGUMENT', `Point ${i} must be three finite numbers.`, 'Remove NaN/Infinity values.', { point: i });
  });
  if (n < 2) throw new BridgeError('INVALID_ARGUMENT', 'A pipe needs at least 2 points.');
  if (closed && n < 3) throw new BridgeError('INVALID_ARGUMENT', 'A closed pipe needs at least 3 points.');
  const segCount = closed ? n : n - 1;
  const dirs: V3[] = [];
  const lens: number[] = [];
  for (let i = 0; i < segCount; i++) {
    const d = sub(pts[(i + 1) % n]!, pts[i]!);
    const l = len(d);
    if (l < EPS) throw new BridgeError('INVALID_ARGUMENT', `Points ${i} and ${(i + 1) % n} coincide (zero-length segment).`, 'Remove duplicate consecutive points.', { segment: i });
    dirs.push(mul(d, 1 / l));
    lens.push(l);
  }
  const bend = o.bendRadius;
  if (bend !== undefined && !(bend > 0)) throw new BridgeError('INVALID_ARGUMENT', 'bend_radius must be positive.');

  const out: PathPoint[] = [];
  const push = (pp: PathPoint): void => {
    const last = out[out.length - 1];
    if (last && len(sub(last.p, pp.p)) < EPS) return;
    out.push(pp);
  };
  const cornerAt = (i: number): void => {
    const din = dirs[(i - 1 + segCount) % segCount]!;
    const dout = dirs[i % segCount]!;
    const cosT = Math.max(-1, Math.min(1, dot(din, dout)));
    const theta = Math.acos(cosT);
    const p = pts[i]!;
    if (theta < 1e-6) {
      push({ p, t: din, miter: 1, m: [0, 0, 0] });
      return;
    }
    if (cosT < -0.9999) throw new BridgeError('INVALID_ARGUMENT', `The path reverses direction at point ${i}.`, 'Add an intermediate point so the pipe turns by less than 180 degrees.', { point: i });
    if (bend === undefined) {
      if (theta > (150 * Math.PI) / 180) throw new BridgeError('INVALID_ARGUMENT', `The corner at point ${i} turns by ${((theta * 180) / Math.PI).toFixed(0)} degrees, too sharp to miter.`, 'Set bend_radius to round it, or split the corner into two gentler ones.', { point: i });
      push({ p, t: unit(add(din, dout)), miter: 1 / Math.cos(theta / 2), m: unit(sub(dout, din)) });
      return;
    }
    const tl = bend * Math.tan(theta / 2);
    const shorter = Math.min(lens[(i - 1 + segCount) % segCount]!, lens[i % segCount]!);
    if (bend > shorter / 2 + 1e-9 || tl > shorter / 2 + 1e-9)
      throw new BridgeError('INVALID_ARGUMENT', `bend_radius ${bend} does not fit at point ${i}: it must be <= half the shorter adjacent segment (${(shorter / 2).toFixed(4)}) and its tangent length ${tl.toFixed(4)} must not exceed that either.`, `Use bend_radius <= ${Math.min(shorter / 2, shorter / 2 / Math.tan(theta / 2)).toFixed(4)} or lengthen the neighbouring segments.`, { point: i, maxBendRadius: Math.min(shorter / 2, shorter / 2 / Math.tan(theta / 2)) });
    const a = sub(p, mul(din, tl));
    const nrm = unit(sub(dout, mul(din, cosT)));
    const c = add(a, mul(nrm, bend));
    for (let s = 0; s <= arcSteps; s++) {
      const phi = (theta * s) / arcSteps;
      const q = add(c, add(mul(nrm, -bend * Math.cos(phi)), mul(din, bend * Math.sin(phi))));
      push({ p: q, t: unit(add(mul(nrm, Math.sin(phi)), mul(din, Math.cos(phi)))), miter: 1, m: [0, 0, 0] });
    }
  };

  if (!closed) push({ p: pts[0]!, t: dirs[0]!, miter: 1, m: [0, 0, 0] });
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) cornerAt(i);
  if (!closed) push({ p: pts[n - 1]!, t: dirs[segCount - 1]!, miter: 1, m: [0, 0, 0] });

  const rings = out.length;
  if (rings * segments + 2 > MAX_VERTICES) throw new BridgeError('INVALID_ARGUMENT', `The pipe would need ${rings * segments} vertices (max ${MAX_VERTICES}).`, 'Reduce segments, arc_steps or the number of points.');

  // Parallel-transport (rotation-minimizing) frames: u, v with u x v = t.
  let u: V3 = Math.abs(out[0]!.t[1]) < 0.9 ? unit(cross(out[0]!.t, [0, 1, 0])) : unit(cross(out[0]!.t, [1, 0, 0]));
  const frames: Array<{ u: V3; v: V3 }> = [];
  for (const pp of out) {
    u = sub(u, mul(pp.t, dot(u, pp.t)));
    u = unit(u);
    frames.push({ u, v: cross(pp.t, u) });
  }
  // Closed loops: spread the residual twist evenly so the last ring meets the first.
  let twist = 0;
  if (closed) {
    const f0 = frames[0]!;
    let ul = sub(u, mul(out[0]!.t, dot(u, out[0]!.t)));
    ul = unit(ul);
    twist = Math.atan2(dot(ul, f0.v), dot(ul, f0.u));
  }

  const vertices: Vertex[] = [];
  const total = out.length;
  out.forEach((pp, j) => {
    const base = frames[j]!;
    const ang = closed ? (-twist * j) / total : 0;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const fu = add(mul(base.u, ca), mul(base.v, sa));
    const fv = add(mul(base.v, ca), mul(base.u, -sa));
    for (let k = 0; k < segments; k++) {
      const al = (2 * Math.PI * k) / segments;
      let off = mul(add(mul(fu, Math.cos(al)), mul(fv, Math.sin(al))), o.radius);
      if (pp.miter !== 1) off = add(off, mul(pp.m, (pp.miter - 1) * dot(off, pp.m)));
      vertices.push(add(pp.p, off));
    }
  });

  const polygons: number[][] = [];
  const ringIdx = (j: number, k: number): number => (j % rings) * segments + (k % segments);
  const spans = closed ? rings : rings - 1;
  for (let j = 0; j < spans; j++) for (let k = 0; k < segments; k++) polygons.push([ringIdx(j, k), ringIdx(j, k + 1), ringIdx(j + 1, k + 1), ringIdx(j + 1, k)]);
  if (caps) {
    for (const end of [0, rings - 1]) {
      const c = out[end]!.p;
      const ci = vertices.length;
      vertices.push([c[0], c[1], c[2]]);
      for (let k = 0; k < segments; k++) polygons.push(end === 0 ? [ci, ringIdx(0, k + 1), ringIdx(0, k)] : [ci, ringIdx(end, k), ringIdx(end, k + 1)]);
    }
  }
  return { vertices, polygons, ringCount: rings, segments, path: out.map((p) => p.p), tangents: out.map((p) => p.t) };
}
