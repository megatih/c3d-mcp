/* eslint-disable @typescript-eslint/no-non-null-assertion -- chunks always has >=1 entry (planChunks) */
// Sends a validated mesh to the bridge in chunks (first = createMesh, rest = append); deletes the half-built object on failure.
import type { ToolContext } from '../toolkit.js';
import { clean } from './result.js';
import { planChunks, validateMesh, type MeshData } from './mesh.js';

export interface MeshSend {
  mesh: MeshData;
  name?: string;
  parent?: unknown;
  transform?: Record<string, unknown>;
  material?: unknown;
}

export async function sendMesh(ctx: ToolContext, m: MeshSend): Promise<{ id: number; res: Record<string, any>; chunks: number }> {
  validateMesh(m.mesh);
  const chunks = planChunks(m.mesh);
  const first = chunks[0]!;
  let res = await ctx.bridge.one<Record<string, any>>('createMesh', clean({ name: m.name, parent: m.parent, transform: m.transform && Object.keys(m.transform).length ? m.transform : undefined, vertices: first.vertices, polygons: first.polygons, uvs: first.uvs, material: m.material }));
  const ref = { id: res.ref?.id ?? res.id };
  try {
    for (let n = 1; n < chunks.length; n++) {
      ctx.services.progress(`mesh chunk ${n + 1}/${chunks.length}`, (n + 1) / chunks.length);
      const c = chunks[n]!;
      res = await ctx.bridge.one<Record<string, any>>('createMesh', clean({ append: { ref }, vertices: c.vertices, polygons: c.polygons, uvs: c.uvs }));
    }
  } catch (e) {
    try {
      await ctx.bridge.one('deleteObjects', { refs: [{ id: ref.id }] });
    } catch {
      /* best effort cleanup */
    }
    throw e;
  }
  return { id: ref.id as number, res, chunks: chunks.length };
}
