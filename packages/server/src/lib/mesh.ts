/* eslint-disable @typescript-eslint/no-non-null-assertion -- loosely typed runtime data; indices are bounds-checked by construction */
// Client-side mesh validation (mirrors the runtime rules in PROTOCOL §5) and chunk planning for big meshes.
import { BridgeError } from '../toolkit.js';

export type Vertex = [number, number, number];
export type Uvs = number[][][];

export interface MeshData { vertices: Vertex[]; polygons: number[][]; uvs?: Uvs }

/**
 * Cheetah3D (8.1.3, measured with core.normal(): native BOX 6/6 outward vs 6/6 inward for counter-clockwise polygons) treats CLOCKWISE
 * (seen from outside) as the front face. Callers describe meshes counter-clockwise seen from outside, so every polygon (and its
 * per-corner uvs) is reversed before sending; the first corner stays first.
 */
export function toCheetahWinding(m: MeshData): MeshData {
  const rev = <T>(a: T[]): T[] => [a[0]!, ...a.slice(1).reverse()];
  return { vertices: m.vertices, polygons: m.polygons.map(rev), ...(m.uvs ? { uvs: m.uvs.map(rev) } : {}) };
}

export function validateMesh(m: MeshData): void {
  const n = m.vertices.length;
  m.vertices.forEach((v, i) => {
    if (!(v as readonly number[]).every(Number.isFinite)) throw new BridgeError('INVALID_ARGUMENT', `Vertex ${i} must be three finite numbers.`, 'Remove NaN/Infinity values.', { vertex: i });
  });
  m.polygons.forEach((poly, pi) => {
    if (poly.length < 3 || poly.length > 64) throw new BridgeError('INVALID_ARGUMENT', `Polygon ${pi} has ${poly.length} corners; allowed 3..64.`, 'Split larger faces.', { polygon: pi });
    const seen = new Set<number>();
    for (const idx of poly) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= n)
        throw new BridgeError('INVALID_ARGUMENT', `Polygon ${pi} references vertex ${idx}, but only ${n} vertices exist (valid 0..${n - 1}).`, 'Bad polygon indices crash Cheetah3D, so the mesh was not sent.', { polygon: pi, index: idx });
      if (seen.has(idx)) throw new BridgeError('INVALID_ARGUMENT', `Polygon ${pi} repeats vertex ${idx}.`, 'Remove duplicate indices within a polygon.', { polygon: pi, index: idx });
      seen.add(idx);
    }
  });
  if (m.uvs) {
    if (m.uvs.length !== m.polygons.length) throw new BridgeError('INVALID_ARGUMENT', `uvs has ${m.uvs.length} entries but there are ${m.polygons.length} polygons.`, 'Provide one [[u,v],...] list per polygon, one pair per corner.');
    m.uvs.forEach((p, pi) => {
      if (p.length !== m.polygons[pi]!.length) throw new BridgeError('INVALID_ARGUMENT', `uvs[${pi}] has ${p.length} pairs for a ${m.polygons[pi]!.length}-corner polygon.`, undefined, { polygon: pi });
    });
  }
}

export interface MeshChunk { vertices: Vertex[]; polygons: number[][]; uvs?: Uvs }

/**
 * Splits a mesh into sequential chunks (first = create, rest = append). Polygon order is preserved; each chunk only
 * references vertices sent in it or earlier chunks (vertex indices are global). Every chunk has >=1 vertex and >=1 polygon.
 */
export function planChunks(m: MeshData, maxVerts = 4000, maxPolys = 4000): MeshChunk[] {
  const chunks: MeshChunk[] = [];
  let sentV = 0;
  let curP: number[][] = [];
  let curU: number[][][] = [];
  let need = 0;
  const flush = (): void => {
    const end = Math.max(need, sentV + 1);
    const chunk: MeshChunk = { vertices: m.vertices.slice(sentV, Math.min(end, m.vertices.length)), polygons: curP };
    if (m.uvs) chunk.uvs = curU;
    sentV += chunk.vertices.length;
    chunks.push(chunk);
    curP = [];
    curU = [];
  };
  m.polygons.forEach((poly, i) => {
    need = Math.max(need, ...poly.map((x) => x + 1));
    curP.push(poly);
    if (m.uvs) curU.push(m.uvs[i]!);
    if (need > sentV && (curP.length >= maxPolys || need - sentV >= maxVerts)) flush();
  });
  if (curP.length) {
    if (need > sentV || sentV < m.vertices.length) flush();
    else if (chunks.length) {
      const last = chunks[chunks.length - 1]!;
      last.polygons.push(...curP);
      if (last.uvs) last.uvs.push(...curU);
    }
  }
  // any vertices not yet referenced ride along with the last chunk
  if (sentV < m.vertices.length && chunks.length) chunks[chunks.length - 1]!.vertices.push(...m.vertices.slice(sentV));
  return chunks;
}
