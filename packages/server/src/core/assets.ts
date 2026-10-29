import { existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** packages/server (same depth from src/core and dist/core). */
export const PACKAGE_ROOT = resolve(here, '..', '..');
export const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');

export function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface AssetLocations { runtime: string[]; macroTemplate: string[] }

/** Packaged assets first (scripts/sync-assets.mjs), then the monorepo build output for development. */
export function assetLocations(root: string = PACKAGE_ROOT, repo: string = REPO_ROOT): AssetLocations {
  return {
    runtime: [join(root, 'assets', 'runtime.js'), join(repo, 'bridge', 'dist', 'runtime.js')],
    macroTemplate: [join(root, 'assets', 'macro', 'C3D-MCP Bridge.js.template'), join(root, 'assets', 'C3D-MCP Bridge.js.template'), join(repo, 'bridge', 'macro', 'C3D-MCP Bridge.js.template')],
  };
}

export function firstExisting(paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p));
}

/**
 * The most recently modified existing candidate. In a monorepo checkout `packages/server/assets/` is a build copy that goes stale after the
 * bridge is rebuilt, so "first existing" would silently install an old runtime; the packaged npm tarball has a single candidate anyway.
 */
export function newestExisting(paths: string[]): string | undefined {
  let best: string | undefined;
  let bestTime = -1;
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const t = statSync(p).mtimeMs;
    if (t > bestTime) { best = p; bestTime = t; }
  }
  return best;
}

/** Extracts the runtime's semver from its source: a `runtimeVersion`/`RUNTIME_VERSION`/`VERSION` assignment or a "runtime vX.Y.Z" header. */
export function parseRuntimeVersion(source: string): string | undefined {
  const head = source.slice(0, 20_000);
  const m =
    /(?:RUNTIME_VERSION|runtimeVersion|VERSION)\s*[:=]\s*["'](\d+\.\d+\.\d+)["']/.exec(head) ??
    /runtime\s+v?(\d+\.\d+\.\d+)/i.exec(head) ??
    /(?:RUNTIME_VERSION|runtimeVersion)\s*[:=]\s*["'](\d+\.\d+\.\d+)["']/.exec(source);
  return m?.[1];
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10));
  const pb = b.split('.').map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function readRuntimeVersionFile(path: string): string | undefined {
  try {
    return parseRuntimeVersion(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Placeholder substitution of bridge/macro/*.template: {{RUNTIME_PATH}} {{MCP_DIR}} {{VERSION}}. Values are embedded inside single- or double-quoted JS literals, so quotes and backslashes are escaped. */
export function renderMacroTemplate(template: string, vars: { RUNTIME_PATH: string; MCP_DIR: string; VERSION: string }): string {
  const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return template.replace(/\{\{(RUNTIME_PATH|MCP_DIR|VERSION)\}\}/g, (_, k: keyof typeof vars) => esc(vars[k]));
}
