// Locates the vendored knowledge base: packaged `assets/kb` first, then the repo's vendor/ + research/ (dev).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function walkUp(start: string, test: (dir: string) => boolean): string | undefined {
  let dir = start;
  for (;;) {
    if (test(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function isOurPackage(d: string): boolean {
  try {
    return (JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')) as { name?: string }).name === 'c3d-mcp';
  } catch {
    return false;
  }
}

export function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return walkUp(here, (d) => isOurPackage(d)) ?? path.resolve(here, '../..');
}

export interface KbLayout { kbRoot: string; research02?: string }

let cached: KbLayout | null | undefined;
export function kbLayout(): KbLayout | null {
  if (cached !== undefined) return cached;
  const pkg = packageRoot();
  const packaged = path.join(pkg, 'assets', 'kb');
  if (fs.existsSync(path.join(packaged, 'knowledge'))) {
    const r = ['research/02-cheetah3d-js-api.md', 'research-02.md', '02-cheetah3d-js-api.md'].map((f) => path.join(packaged, f)).find((f) => fs.existsSync(f));
    cached = r ? { kbRoot: packaged, research02: r } : { kbRoot: packaged };
    return cached;
  }
  const repo = walkUp(pkg, (d) => fs.existsSync(path.join(d, 'vendor', 'c3d-scripting-kb')));
  if (!repo) return (cached = null);
  const r = path.join(repo, 'research', '02-cheetah3d-js-api.md');
  cached = fs.existsSync(r) ? { kbRoot: path.join(repo, 'vendor', 'c3d-scripting-kb'), research02: r } : { kbRoot: path.join(repo, 'vendor', 'c3d-scripting-kb') };
  return cached;
}

/** Test hook. */
export function resetKbCache(): void {
  cached = undefined;
}

export function readKb(rel: string): string | undefined {
  const l = kbLayout();
  if (!l) return undefined;
  const f = path.join(l.kbRoot, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined;
}
