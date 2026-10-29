// File-based checkpoints (Cheetah3D's undo cannot revert macro changes - P11). saveTo(jas) does not re-point the document (P07).
import fs from 'node:fs';
import path from 'node:path';
import { type ToolContext } from '../toolkit.js';
import { ensureDir } from './files.js';

export interface Checkpoint { id: string; label: string; path: string; createdAt: string; size?: number }
const KEY = 'checkpoints';

const FILE_RE = /^(\d{10,})-(cp(\d+))-(.+)\.jas$/;

/** Checkpoints of this session plus the ones already on disk (the in-memory list is lost when the server restarts, e.g. after a Cheetah3D crash). */
export function listCheckpoints(ctx: ToolContext): Checkpoint[] {
  const mem = (ctx.session.scratch.get(KEY) as Checkpoint[] | undefined) ?? [];
  const dir = path.join(ctx.config.workDir, 'checkpoints');
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return mem; }
  const known = new Set(mem.map((c) => path.basename(c.path)));
  const disk: Checkpoint[] = [];
  for (const n of names) {
    const m = FILE_RE.exec(n);
    if (!m || known.has(n)) continue;
    const full = path.join(dir, n);
    disk.push({ id: m[2] as string, label: (m[4] as string).replace(/_/g, ' '), path: full, createdAt: new Date(Number(m[1])).toISOString(), size: fs.statSync(full).size });
  }
  const all = [...disk, ...mem].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = new Map<string, Checkpoint>(); // legacy duplicate ids: the newest wins
  for (const c of all) latest.set(c.id, c);
  return [...latest.values()];
}

function nextId(list: Checkpoint[]): string {
  return `cp${Math.max(0, ...list.map((c) => Number(c.id.slice(2)) || 0)) + 1}`;
}

export async function createCheckpoint(ctx: ToolContext, label: string): Promise<Checkpoint> {
  const list = listCheckpoints(ctx);
  const id = nextId(list);
  const safe = label.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'checkpoint';
  const dir = path.join(ctx.config.workDir, 'checkpoints');
  ensureDir(dir);
  const file = path.join(dir, `${Date.now()}-${id}-${safe}.jas`);
  const r = await ctx.bridge.one<{ path: string; size?: number }>('saveTo', { path: file, type: 'jas' });
  ctx.session.ownedPaths.add(file);
  const cp: Checkpoint = { id, label, path: r.path, createdAt: new Date().toISOString(), size: r.size };
  ctx.session.scratch.set(KEY, [...((ctx.session.scratch.get(KEY) as Checkpoint[] | undefined) ?? []), cp]);
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
