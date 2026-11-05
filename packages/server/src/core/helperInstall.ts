// Locating and reading the helper app. Since 0.4.0 the helper is part of C3D MCP.app and c3d-mcp no longer installs a separate one;
// this file only finds an older standalone helper (for status, update and uninstall).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT, REPO_ROOT } from './assets.js';
import { HELPER_APP_NAME } from './helperClient.js';
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

/** The helper app this install manages: the copy in <mcpDir>/helper when there is one, otherwise whatever the client resolves
 *  (a copy placed by hand, or a C3D_HELPER_APP override, which is a bundle *source* and must not be mistaken for the installed copy). */
export function installedHelperApp(rt: Runtime): string | undefined {
  const managed = join(rt.paths.root, 'helper', HELPER_APP_NAME);
  return existsSync(managed) ? managed : rt.helper.installedApp?.();
}
