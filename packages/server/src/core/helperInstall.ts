// Default HelperInstaller for the CLI: copies the helper app bundle shipped with the package (assets/helper), or a dev build
// from the repo, into <mcpDir>/helper. No network access: downloads are a packaging concern (Homebrew cask / GitHub release).
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PACKAGE_ROOT, REPO_ROOT } from './assets.js';
import { HELPER_APP_NAME } from './helperClient.js';
import type { HelperInstaller } from './install.js';
import type { Runtime } from './runtime.js';
import { systemExec, type Executor } from './platform.js';

export function helperSources(root: string = PACKAGE_ROOT, repo: string = REPO_ROOT): { app: string[]; zip: string[] } {
  const env = process.env.C3D_HELPER_APP;
  return {
    app: [...(env ? [env] : []), join(root, 'assets', 'helper', HELPER_APP_NAME), join(repo, 'helper', 'build', HELPER_APP_NAME)],
    zip: [join(root, 'assets', 'helper', 'C3D-Bridge-Helper.zip')],
  };
}

/** `CFBundleShortVersionString` of an .app bundle (XML Info.plist), or undefined when unreadable. */
export function readAppVersion(appPath: string): string | undefined {
  try {
    return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)</.exec(readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8'))?.[1];
  } catch {
    return undefined;
  }
}

/** Version of the helper this package would install: from a bundle on disk, else from the zip shipped in assets/helper. */
export async function bundledHelperVersion(exec: Executor = systemExec, sources = helperSources()): Promise<string | undefined> {
  const app = sources.app.find((p) => existsSync(p));
  if (app) return readAppVersion(app);
  const zip = sources.zip.find((p) => existsSync(p));
  if (!zip) return undefined;
  const res = await exec('unzip', ['-p', zip, `${HELPER_APP_NAME}/Contents/Info.plist`], { timeoutMs: 15_000 });
  return res.code === 0 ? /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)</.exec(res.stdout)?.[1] : undefined;
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
    const version = readAppVersion(dest);
    return { path: dest, installedByUs: true, ...(version ? { version } : {}) };
  };
}

/** The helper app this install manages: the copy in <mcpDir>/helper when there is one, otherwise whatever the client resolves
 *  (a cask, or a C3D_HELPER_APP override, which is a bundle *source* and must not be mistaken for the installed copy). */
export function installedHelperApp(rt: Runtime): string | undefined {
  const managed = join(rt.paths.root, 'helper', HELPER_APP_NAME);
  return existsSync(managed) ? managed : rt.helper.installedApp?.();
}
