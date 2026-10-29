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

function present(p: string): boolean {
  try {
    fs.lstatSync(p); // lstat: a dangling symlink still counts as "exists"
    return true;
  } catch {
    return false;
  }
}

function insideDir(p: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Never overwrite a file that existed before this session. A file this server wrote (session.ownedPaths) may be replaced only with
 * confirmation. `siblings` are companion files the writer also produces (e.g. the .mtl next to an .obj) and get the same treatment.
 * Missing parent directories are created only inside the work directory; anywhere else the directory must already exist.
 * Returns after marking the path as owned.
 */
export async function guardWrite(ctx: ToolContext, abs: string, confirm: boolean | undefined, what: string, siblings: string[] = []): Promise<void> {
  const owned = (p: string): boolean => {
    if (ctx.session.ownedPaths.has(p)) return true;
    try {
      return ctx.session.ownedPaths.has(fs.realpathSync(p));
    } catch {
      return false; // dangling symlink
    }
  };
  const existing = [abs, ...siblings].filter(present);
  for (const p of existing) {
    if (!owned(p)) throw new BridgeError('INVALID_ARGUMENT', `${p} already exists and was not created by this session; ${what} will not overwrite it.`, 'Choose a different path (e.g. add a suffix or timestamp).', { path: p });
  }
  if (existing.length) {
    const yes = await ctx.services.confirm({ message: `Overwrite ${existing.join(', ')}?`, confirmFlag: confirm });
    if (!yes) throw new BridgeError('CONFIRMATION_REQUIRED', `Overwriting ${existing.join(', ')} needs confirmation.`, 'Retry with confirm:true.', { path: abs });
  }
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) {
    if (!insideDir(dir, ctx.config.workDir) && path.resolve(dir) !== path.resolve(ctx.config.workDir))
      throw new BridgeError('INVALID_ARGUMENT', `Directory ${dir} does not exist.`, `Create it first, or write inside the work directory (${ctx.config.workDir}).`, { path: abs });
    ensureDir(dir);
  }
  ctx.session.ownedPaths.add(abs);
  for (const p of siblings) ctx.session.ownedPaths.add(p);
}

/** Writes a new file with exclusive creation (O_EXCL): never replaces anything, including through a symlink. */
export function writeNewFile(ctx: ToolContext, abs: string, data: Buffer | string): void {
  ensureDir(path.dirname(abs));
  const fd = fs.openSync(abs, 'wx', 0o644);
  try {
    fs.writeFileSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
  ctx.session.ownedPaths.add(abs);
}

/** First `<dir>/<stem>_<n><ext>` (n from 1) that does not exist yet. */
export function uniquePath(dir: string, stem: string, extWithDot: string, start = 1): string {
  for (let n = start; ; n++) {
    const p = path.join(dir, `${stem}_${n}${extWithDot}`);
    if (!present(p)) return p;
  }
}

/** A document opened through this server may be saved over (with confirmation); macOS reports /private/var paths, so both spellings count. */
export function markOpened(ctx: ToolContext, abs: string): void {
  ctx.session.ownedPaths.add(abs);
  ctx.session.ownedPaths.add(fs.realpathSync(abs));
}

export function ext(p: string): string {
  return path.extname(p).slice(1).toLowerCase();
}
