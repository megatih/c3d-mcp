 
import { describe, expect, it } from 'vitest';
import { planChunks, validateMesh, type Vertex } from '../../../src/lib/mesh.js';

const quad = { vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] as Vertex[], polygons: [[0, 1, 2, 3]] };

describe('validateMesh', () => {
  it('accepts a valid quad', () => expect(() => validateMesh(quad)).not.toThrow());
  it('rejects out-of-range indices with polygon details', () => {
    try { validateMesh({ ...quad, polygons: [[0, 1, 4]] }); expect.unreachable(); } catch (e: any) { expect(e.code).toBe('INVALID_ARGUMENT'); expect(e.details).toMatchObject({ polygon: 0, index: 4 }); }
  });
  it('rejects negative, fractional and duplicate indices', () => {
    expect(() => validateMesh({ ...quad, polygons: [[0, 1, -1]] })).toThrow(/vertex -1/);
    expect(() => validateMesh({ ...quad, polygons: [[0, 1, 1.5]] })).toThrow();
    expect(() => validateMesh({ ...quad, polygons: [[0, 1, 1]] })).toThrow(/repeats/);
  });
  it('rejects NaN coordinates and tiny/huge polygons', () => {
    expect(() => validateMesh({ ...quad, vertices: [[NaN, 0, 0], [1, 0, 0], [1, 1, 0]], polygons: [[0, 1, 2]] })).toThrow(/finite/);
    expect(() => validateMesh({ ...quad, polygons: [[0, 1]] })).toThrow(/3\.\.64/);
    expect(() => validateMesh({ vertices: Array.from({ length: 70 }, (_, i) => [i, 0, 0] as Vertex), polygons: [Array.from({ length: 65 }, (_, i) => i)] })).toThrow(/3\.\.64/);
  });
  it('checks uv shape', () => {
    expect(() => validateMesh({ ...quad, uvs: [[[0, 0], [1, 0]]] })).toThrow(/pairs/);
    expect(() => validateMesh({ ...quad, uvs: [] })).toThrow(/entries/);
  });
});

describe('planChunks', () => {
  const grid = (n: number): { vertices: Vertex[]; polygons: number[][] } => {
    const vertices: Vertex[] = [];
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) vertices.push([x, y, 0]);
    const polygons: number[][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) polygons.push([y * (n + 1) + x, y * (n + 1) + x + 1, (y + 1) * (n + 1) + x + 1, (y + 1) * (n + 1) + x]);
    return { vertices, polygons };
  };
  it('returns one chunk for small meshes', () => expect(planChunks(quad)).toHaveLength(1));
  it('splits big meshes while preserving order and referencing only earlier vertices', () => {
    const m = grid(60);
    const chunks = planChunks(m, 500, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => c.vertices)).toEqual(m.vertices);
    expect(chunks.flatMap((c) => c.polygons)).toEqual(m.polygons);
    let sent = 0;
    for (const c of chunks) {
      expect(c.vertices.length).toBeGreaterThan(0);
      expect(c.polygons.length).toBeGreaterThan(0);
      sent += c.vertices.length;
      for (const p of c.polygons) for (const i of p) expect(i).toBeLessThan(sent);
    }
  });
  it('slices uvs alongside polygons and keeps unreferenced vertices', () => {
    const m = grid(10);
    const uvs = m.polygons.map((p) => p.map(() => [0, 0]));
    const extra = [...m.vertices, [9, 9, 9] as Vertex];
    const chunks = planChunks({ vertices: extra, polygons: m.polygons, uvs }, 20, 15);
    expect(chunks.flatMap((c) => c.uvs ?? [])).toHaveLength(m.polygons.length);
    expect(chunks.flatMap((c) => c.vertices)).toHaveLength(extra.length);
  });
  it('handles polygons that only reuse earlier vertices at the end', () => {
    const vertices: Vertex[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    const chunks = planChunks({ vertices, polygons: [[0, 1, 2], [0, 2, 3], [0, 1, 3], [1, 2, 3]] }, 100, 2);
    expect(chunks.flatMap((c) => c.polygons)).toHaveLength(4);
    for (const c of chunks) expect(c.vertices.length).toBeGreaterThan(0);
  });
});
