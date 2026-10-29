// Safe file handling for our own work dirs and user-chosen output paths.
import fs from 'node:fs';
import path from 'node:path';
import { BridgeError, type ToolContext } from '../toolkit.js';

/** Absolute path; relative paths resolve inside `<workDir>/<sub>`. */
export function resolveOut(ctx: ToolContext, p: string, sub: string): string {
  if (p.includes('\0')) throw new BridgeError('INVALID_ARGUMENT', 'Path contains a NUL byte.');
  const abs = path.isAbsolute(p) ? path.normalize(p) : path.join(ctx.config.workDir, sub, p);
  if (!path.isAbsolute(abs)) throw new BridgeError('INVALID_ARGUMENT', `Path "${p}" is not absolute.`);
  return abs;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Never overwrite a file that existed before this session. A file this server wrote (session.ownedPaths) may be replaced only with
 * confirmation. Returns after marking the path as owned.
 */
export async function guardWrite(ctx: ToolContext, abs: string, confirm: boolean | undefined, what: string): Promise<void> {
  if (fs.existsSync(abs)) {
    if (!ctx.session.ownedPaths.has(abs) && !ctx.session.ownedPaths.has(fs.realpathSync(abs)))
      throw new BridgeError('INVALID_ARGUMENT', `${abs} already exists and was not created by this session; ${what} will not overwrite it.`, 'Choose a different path (e.g. add a suffix or timestamp).', { path: abs });
    const yes = await ctx.services.confirm({ message: `Overwrite ${abs}?`, confirmFlag: confirm });
    if (!yes) throw new BridgeError('CONFIRMATION_REQUIRED', `Overwriting ${abs} needs confirmation.`, 'Retry with confirm:true.', { path: abs });
  }
  ensureDir(path.dirname(abs));
  ctx.session.ownedPaths.add(abs);
}

/** A document opened through this server may be saved over (with confirmation); macOS reports /private/var paths, so both spellings count. */
export function markOpened(ctx: ToolContext, abs: string): void {
  ctx.session.ownedPaths.add(abs);
  ctx.session.ownedPaths.add(fs.realpathSync(abs));
}

export function ext(p: string): string {
  return path.extname(p).slice(1).toLowerCase();
}
