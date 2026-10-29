// File-based checkpoints (Cheetah3D's undo cannot revert macro changes - P11). saveTo(jas) does not re-point the document (P07).
import path from 'node:path';
import { type ToolContext } from '../toolkit.js';
import { ensureDir } from './files.js';

export interface Checkpoint { id: string; label: string; path: string; createdAt: string; size?: number }
const KEY = 'checkpoints';

export function listCheckpoints(ctx: ToolContext): Checkpoint[] {
  return (ctx.session.scratch.get(KEY) as Checkpoint[] | undefined) ?? [];
}

export async function createCheckpoint(ctx: ToolContext, label: string): Promise<Checkpoint> {
  const list = listCheckpoints(ctx);
  const id = `cp${list.length + 1}`;
  const safe = label.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'checkpoint';
  const dir = path.join(ctx.config.workDir, 'checkpoints');
  ensureDir(dir);
  const file = path.join(dir, `${Date.now()}-${id}-${safe}.jas`);
  const r = await ctx.bridge.one<{ path: string; size?: number }>('saveTo', { path: file, type: 'jas' });
  ctx.session.ownedPaths.add(file);
  const cp: Checkpoint = { id, label, path: r.path, createdAt: new Date().toISOString(), size: r.size };
  ctx.session.scratch.set(KEY, [...list, cp]);
  return cp;
}

/** Best effort: returns the checkpoint or a warning string. */
export async function autoCheckpoint(ctx: ToolContext, label: string): Promise<{ checkpoint?: Checkpoint; warning?: string }> {
  try {
    return { checkpoint: await createCheckpoint(ctx, `auto-${label}`) };
  } catch (e) {
    return { warning: `Automatic checkpoint before ${label} failed (${e instanceof Error ? e.message : String(e)}); this change cannot be undone.` };
  }
}
