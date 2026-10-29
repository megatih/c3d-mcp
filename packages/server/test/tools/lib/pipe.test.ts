import { describe, expect, it } from 'vitest';
import { buildPipe } from '../../../src/lib/pipe.js';
import { validateMesh } from '../../../src/lib/mesh.js';

type V3 = [number, number, number];
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('buildPipe: straight', () => {
  const p = buildPipe({ points: [[0, 0, 0], [0, 5, 0]], radius: 0.5, segments: 12 });
  it('counts vertices and polygons (2 rings + 2 cap centers)', () => {
    expect(p.ringCount).toBe(2);
    expect(p.vertices).toHaveLength(2 * 12 + 2);
    expect(p.polygons).toHaveLength(12 + 2 * 12);
    expect(() => validateMesh({ vertices: p.vertices, polygons: p.polygons })).not.toThrow();
  });
  it('every ring vertex lies at the radius from the axis, in the ring plane', () => {
    for (let j = 0; j < 2; j++) for (let k = 0; k < 12; k++) {
      const v = p.vertices[j * 12 + k]!;
      expect(Math.hypot(v[0], v[2])).toBeCloseTo(0.5, 9);
      expect(v[1]).toBeCloseTo(j * 5, 9);
    }
  });
  it('endpoints are the first and last points; no caps option drops the fans', () => {
    expect(p.path[0]).toEqual([0, 0, 0]);
    expect(p.path[1]).toEqual([0, 5, 0]);
    const open = buildPipe({ points: [[0, 0, 0], [0, 5, 0]], radius: 0.5, caps: false });
    expect(open.vertices).toHaveLength(32);
    expect(open.polygons).toHaveLength(16);
  });
  it('winds counter-clockwise seen from outside (side normals point away from the axis, caps outward)', () => {
    const n = (poly: number[]): V3 => {
      const [a, b, c] = poly.map((i) => p.vertices[i]!) as [V3, V3, V3];
      const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w: V3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    };
    for (const poly of p.polygons.slice(0, 12)) {
      const c = poly.reduce<V3>((s, i) => [s[0] + p.vertices[i]![0] / 4, s[1], s[2] + p.vertices[i]![2] / 4], [0, 0, 0]);
      expect(dot(n(poly), [c[0], 0, c[2]])).toBeGreaterThan(0);
    }
    expect(n(p.polygons[12]!)[1]).toBeLessThan(0); // start cap faces -tangent
    expect(n(p.polygons[24]!)[1]).toBeGreaterThan(0); // end cap faces +tangent
  });
});

describe('buildPipe: fillets', () => {
  const pts: V3[] = [[0, 0, 0], [10, 0, 0], [10, 0, 10]];
  const p = buildPipe({ points: pts, radius: 0.4, segments: 8, bendRadius: 2, arcSteps: 6 });
  it('samples the arc: 1 + 7 + 1 rings, tangent points at distance bend from the corner (90 degrees)', () => {
    expect(p.ringCount).toBe(1 + 7 + 1);
    expect(dist(p.path[1]!, [8, 0, 0])).toBeLessThan(1e-9);
    expect(dist(p.path[7]!, [10, 0, 2])).toBeLessThan(1e-9);
  });
  it('arc points keep the bend radius from the fillet center', () => {
    for (let i = 1; i <= 7; i++) expect(dist(p.path[i]!, [8, 0, 2])).toBeCloseTo(2, 9);
  });
  it('tangents are unit length and continuous (no jump larger than the arc step)', () => {
    for (const t of p.tangents) expect(Math.hypot(...t)).toBeCloseTo(1, 9);
    expect(p.tangents[0]).toEqual([1, 0, 0]);
    expect(dot(p.tangents[1]!, [1, 0, 0])).toBeCloseTo(1, 9);
    expect(dot(p.tangents[7]!, [0, 0, 1])).toBeCloseTo(1, 9);
    const step = Math.cos(Math.PI / 2 / 6) - 1e-9;
    for (let i = 1; i < p.tangents.length; i++) expect(dot(p.tangents[i]!, p.tangents[i - 1]!)).toBeGreaterThanOrEqual(step);
  });
  it('ring vertices stay at the pipe radius from their center', () => {
    p.path.forEach((c, j) => { for (let k = 0; k < 8; k++) expect(dist(p.vertices[j * 8 + k]!, c)).toBeCloseTo(0.4, 9); });
  });
  it('rejects a bend radius that does not fit, with a hint', () => {
    try { buildPipe({ points: pts, radius: 0.4, bendRadius: 6 }); expect.unreachable(); } catch (e: any) { expect(e.code).toBe('INVALID_ARGUMENT'); expect(e.hint).toMatch(/bend_radius <=/); }
  });
  it('accepts exactly half of the shorter segment', () => {
    expect(() => buildPipe({ points: pts, radius: 0.4, bendRadius: 5 })).not.toThrow();
  });
});

describe('buildPipe: miter, closed, validation', () => {
  it('mitered corner keeps the ring in the bisector plane', () => {
    const p = buildPipe({ points: [[0, 0, 0], [5, 0, 0], [5, 5, 0]], radius: 0.5, segments: 8 });
    expect(p.ringCount).toBe(3);
    const mid = [...Array(8).keys()].map((k) => p.vertices[8 + k]!);
    const outer = Math.max(...mid.map((v) => dist(v, [5, 0, 0])));
    expect(outer).toBeCloseTo(0.5 / Math.cos(Math.PI / 4), 9);
  });
  it('closed loop wraps: rings*segments quads, no caps', () => {
    const p = buildPipe({ points: [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]], radius: 0.2, segments: 6, bendRadius: 1, arcSteps: 4, closed: true });
    expect(p.polygons).toHaveLength(p.ringCount * 6);
    expect(p.vertices).toHaveLength(p.ringCount * 6);
    expect(() => validateMesh({ vertices: p.vertices, polygons: p.polygons })).not.toThrow();
  });
  it('validates inputs', () => {
    expect(() => buildPipe({ points: [[0, 0, 0]], radius: 1 })).toThrow(/2 points/);
    expect(() => buildPipe({ points: [[0, 0, 0], [0, 0, 0]], radius: 1 })).toThrow(/zero-length/);
    expect(() => buildPipe({ points: [[0, 0, 0], [NaN, 0, 0]], radius: 1 })).toThrow(/finite/);
    expect(() => buildPipe({ points: [[0, 0, 0], [1, 0, 0]], radius: 0 })).toThrow(/radius/);
    expect(() => buildPipe({ points: [[0, 0, 0], [1, 0, 0], [0, 0, 0.0000001]], radius: 1 })).toThrow(/reverses/);
    expect(() => buildPipe({ points: [[0, 0, 0], [1, 0, 0]], radius: 1, closed: true })).toThrow(/3 points/);
  });
  it('stays valid on a 3D helix-like path', () => {
    const pts: V3[] = Array.from({ length: 40 }, (_, i) => [Math.cos(i / 4) * 5, i * 0.3, Math.sin(i / 4) * 5]);
    const p = buildPipe({ points: pts, radius: 0.1, segments: 10, bendRadius: 0.2, arcSteps: 2 });
    expect(() => validateMesh({ vertices: p.vertices, polygons: p.polygons })).not.toThrow();
    expect(p.vertices.every((v) => v.every(Number.isFinite))).toBe(true);
  });
});
