 
import { describe, expect, it } from 'vitest';
import { apply, eulerToMatrix, lookAtEuler, lookAtMatrix, matrixToEuler, norm, parseWorldMatrix, residualAngleDeg, sub, type V3 } from '../../../src/lib/lookAt.js';

const MEASURED = [[0.7392, -0.5732, 0.3536], [0.6124, 0.3536, -0.7071], [0.2803, 0.7392, 0.6124]];

describe('lookAt math', () => {
  it('reproduces the measured obj2WorldMatrix for rotation (30,45,60) HPB (probe P15)', () => {
    const m = eulerToMatrix(30, 45, 60);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(m[r]![c]).toBeCloseTo(MEASURED[r]![c]!, 4);
  });

  it('round-trips euler angles', () => {
    for (const [h, p, b] of [[30, 45, 60], [-120, 20, 10], [170, -80, -45], [0, 0, 0]] as const) {
      const e = matrixToEuler(eulerToMatrix(h, p, b));
      const m2 = eulerToMatrix(e.h, e.p, e.b);
      const m1 = eulerToMatrix(h, p, b);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(m2[r]![c]).toBeCloseTo(m1[r]![c]!, 6);
    }
  });

  it('handles gimbal lock', () => {
    const m = eulerToMatrix(40, 90, 0);
    const e = matrixToEuler(m);
    const m2 = eulerToMatrix(e.h, e.p, e.b);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(m2[r]![c]).toBeCloseTo(m[r]![c]!, 5);
  });

  it('reproduces the recorded default camera (pos 2.5,2.34,4.34 -> origin gives rot ~ (30,-25,0))', () => {
    const r = lookAtEuler([2.5, 2.34, 4.34], [0, 0, 0]).rotation;
    expect(r.x).toBeCloseTo(30, 0);
    expect(r.y).toBeCloseTo(-25, 0);
    expect(r.z).toBeCloseTo(0, 5);
  });

  it('points the -Z axis at the target for random configurations', () => {
    const cases: Array<[V3, V3]> = [[[1, 2, 3], [-4, 0.5, 2]], [[0, 5, 0.001], [0, 0, 0]], [[-3, -2, 8], [7, 9, -1]], [[0, 0, 5], [0, 0, 0]]];
    for (const [from, to] of cases) {
      const m = lookAtMatrix(from, to);
      expect(residualAngleDeg(m, from, to)).toBeLessThan(1e-6);
      const r = lookAtEuler(from, to).rotation;
      expect(residualAngleDeg(eulerToMatrix(r.x, r.y, r.z), from, to)).toBeLessThan(1e-3);
    }
  });

  it('supports +Z facing objects', () => {
    const r = lookAtEuler([0, 0, 0], [1, 1, 1], { forward: '+z' }).rotation;
    expect(residualAngleDeg(eulerToMatrix(r.x, r.y, r.z), [0, 0, 0], [1, 1, 1], '+z')).toBeLessThan(1e-6);
    expect(apply(eulerToMatrix(r.x, r.y, r.z), [0, 0, 1])[0]).toBeGreaterThan(0.5);
  });

  it('compensates a parent rotation', () => {
    const parent = eulerToMatrix(33, -12, 70);
    const from: V3 = [1, 1, 1];
    const to: V3 = [-2, 3, 0];
    const local = lookAtEuler(from, to, { parentRotation: parent }).rotation;
    const world = matMulLocal(parent, eulerToMatrix(local.x, local.y, local.z));
    expect(residualAngleDeg(world, from, to)).toBeLessThan(1e-6);
  });

  it('keeps the up vector roughly up (no bank for level looks)', () => {
    expect(lookAtEuler([0, 1, 5], [0, 1, 0]).rotation.z).toBeCloseTo(0, 6);
    expect(norm(sub([0, 0, 0], [0, 0, 0]))).toEqual([0, 0, 0]);
  });

  it('survives looking straight down', () => {
    const r = lookAtEuler([0, 5, 0], [0, 0, 0]).rotation;
    expect(residualAngleDeg(eulerToMatrix(r.x, r.y, r.z), [0, 5, 0], [0, 0, 0])).toBeLessThan(1e-6);
  });

  it('parses world matrices in several layouts', () => {
    expect(parseWorldMatrix({ rows: MEASURED, position: { x: 1, y: 2, z: 3 } })?.position).toEqual([1, 2, 3]);
    expect(parseWorldMatrix([[1, 0, 0, 5], [0, 1, 0, 6], [0, 0, 1, 7], [0, 0, 0, 1]])?.position).toEqual([5, 6, 7]);
    expect(parseWorldMatrix([1, 0, 0, 0, 1, 0, 0, 0, 1])?.rotation[1]).toEqual([0, 1, 0]);
    expect(parseWorldMatrix('x')).toBeUndefined();
    expect(parseWorldMatrix(undefined)).toBeUndefined();
  });
});

function matMulLocal(a: ReturnType<typeof eulerToMatrix>, b: ReturnType<typeof eulerToMatrix>): ReturnType<typeof eulerToMatrix> {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i]![0] * b[0][j]! + a[i]![1] * b[1][j]! + a[i]![2] * b[2][j]!)) as ReturnType<typeof eulerToMatrix>;
}
