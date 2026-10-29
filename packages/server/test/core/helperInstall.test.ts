import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHelperInstaller } from '../../src/core/helperInstall.js';
import { systemExec, type Executor } from '../../src/core/platform.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'c3dh-')); roots.push(d); return d; };

function fakeApp(dir: string): string {
  const app = join(dir, 'C3D Bridge Helper.app');
  mkdirSync(join(app, 'Contents'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'Info.plist'), '<dict><key>CFBundleShortVersionString</key><string>0.1.0</string></dict>');
  return app;
}

describe('createHelperInstaller', () => {
  it('copies the bundle with ditto and reports its version', async () => {
    const src = tmp();
    const app = fakeApp(src);
    const dest = tmp();
    const r = await createHelperInstaller(systemExec, { app: [app], zip: [] })({ mcpDir: dest, helperDir: join(dest, 'helper') });
    expect(r).toMatchObject({ installedByUs: true, version: '0.1.0' });
    expect(readFileSync(join(dest, 'helper', 'C3D Bridge Helper.app', 'Contents', 'Info.plist'), 'utf8')).toContain('0.1.0');
  });

  it('returns undefined when no source exists, and replaces a previous copy', async () => {
    const dest = tmp();
    expect(await createHelperInstaller(systemExec, { app: [join(dest, 'nope')], zip: [] })({ mcpDir: dest, helperDir: join(dest, 'helper') })).toBeUndefined();
    const app = fakeApp(tmp());
    const inst = createHelperInstaller(systemExec, { app: [app], zip: [] });
    await inst({ mcpDir: dest, helperDir: join(dest, 'helper') });
    writeFileSync(join(dest, 'helper', 'C3D Bridge Helper.app', 'stale'), 'x');
    await inst({ mcpDir: dest, helperDir: join(dest, 'helper') });
    expect(existsSync(join(dest, 'helper', 'C3D Bridge Helper.app', 'stale'))).toBe(false);
  });

  it('surfaces ditto failures', async () => {
    const app = fakeApp(tmp());
    const dest = tmp();
    const bad: Executor = () => Promise.resolve({ code: 1, stdout: '', stderr: 'boom' });
    await expect(createHelperInstaller(bad, { app: [app], zip: [] })({ mcpDir: dest, helperDir: join(dest, 'helper') })).rejects.toThrow(/boom/);
  });
});
