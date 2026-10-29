// Default HelperInstaller for the CLI: copies the helper app bundle shipped with the package (assets/helper), or a dev build
// from the repo, into <mcpDir>/helper. No network access: downloads are a packaging concern (Homebrew cask / GitHub release).
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT, REPO_ROOT } from './assets.js';
import { HELPER_APP_NAME } from './helperClient.js';
import type { HelperInstaller } from './install.js';
import { systemExec, type Executor } from './platform.js';

export function helperSources(root: string = PACKAGE_ROOT, repo: string = REPO_ROOT): { app: string[]; zip: string[] } {
  const env = process.env.C3D_HELPER_APP;
  return {
    app: [...(env ? [env] : []), join(root, 'assets', 'helper', HELPER_APP_NAME), join(repo, 'helper', 'build', HELPER_APP_NAME)],
    zip: [join(root, 'assets', 'helper', 'C3D-Bridge-Helper.zip')],
  };
}

export function createHelperInstaller(exec: Executor = systemExec, sources = helperSources()): HelperInstaller {
  return async ({ helperDir }) => {
    const dest = join(helperDir, HELPER_APP_NAME);
    await mkdir(helperDir, { recursive: true, mode: 0o700 });
    const app = sources.app.find((p) => existsSync(p));
    const zip = sources.zip.find((p) => existsSync(p));
    if (!app && !zip) return undefined;
    await rm(dest, { recursive: true, force: true });
    // ditto preserves the code signature, extended attributes and symlinks that `cp -R` can mangle.
    const res = app ? await exec('ditto', [app, dest]) : await exec('ditto', ['-x', '-k', zip as string, helperDir]);
    if (res.code !== 0 || !existsSync(dest)) throw new Error(`could not install the helper app: ${res.stderr.trim() || 'ditto failed'}`);
    let version: string | undefined;
    try {
      version = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)</.exec(readFileSync(join(dest, 'Contents', 'Info.plist'), 'utf8'))?.[1];
    } catch {
      version = undefined;
    }
    return { path: dest, installedByUs: true, ...(version ? { version } : {}) };
  };
}
