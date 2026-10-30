import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectInstall, type Bundle } from '../../src/core/installState.js';
import { install } from '../../src/core/install.js';
import type { Executor } from '../../src/core/platform.js';
import { makeHarness, safeExec, type Harness } from '../helpers/runtime.js';

let h: Harness;
afterEach(() => rmSync(h.env.root, { recursive: true, force: true }));

const TEMPLATE = '// c3d-mcp bridge loader {{VERSION}}\nvar RUNTIME = "{{RUNTIME_PATH}}";\nvar MCP = "{{MCP_DIR}}";\n';
const runtimeSrc = (v: string): string => `/* c3d-mcp runtime ${v} */\nvar RUNTIME_VERSION = "${v}";\n`;
function bundle(v = '1.0.1', helper?: string): Bundle {
  return { runtimeText: runtimeSrc(v), runtimeVersion: v, templateText: TEMPLATE, helperVersion: helper, packageVersion: '0.3.2' };
}

async function installed(v = '1.0.1', over: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const hh = makeHarness(over, { seed: false });
  writeFileSync(`${hh.env.root}/rt.js`, runtimeSrc(v));
  writeFileSync(`${hh.env.root}/m.tpl`, TEMPLATE);
  await install(hh.rt, { runtimeSource: `${hh.env.root}/rt.js`, templateSource: `${hh.env.root}/m.tpl`, installHelper: false, skipPing: true });
  return hh;
}
const names = (s: { components: Array<{ name: string; status: string }> }, status: string): string[] => s.components.filter((c) => c.status === status).map((c) => c.name);

describe('detectInstall', () => {
  it('fresh: nothing installed', async () => {
    h = makeHarness({}, { seed: false });
    const s = await detectInstall(h.rt, bundle());
    expect(s.kind).toBe('fresh');
    expect(s.recommended).toBe('install');
    expect(s.summary).toMatch(/fresh/i);
  });

  it('current: everything present and equal to the bundle', async () => {
    h = await installed('1.0.1');
    const s = await detectInstall(h.rt, bundle('1.0.1'));
    expect(s.kind).toBe('current');
    expect(s.recommended).toBe('none');
    expect(names(s, 'ok')).toEqual(expect.arrayContaining(['mailbox', 'secret', 'runtime', 'macro', 'manifest']));
    expect(s.installed.runtime).toBe('1.0.1');
  });

  it('outdated: the installed runtime is older than the bundled one', async () => {
    h = await installed('1.0.0');
    const s = await detectInstall(h.rt, bundle('1.0.1'));
    expect(s.kind).toBe('outdated');
    expect(s.recommended).toBe('update');
    expect(names(s, 'outdated')).toContain('runtime');
    expect(s.summary).toMatch(/1\.0\.0.*1\.0\.1/);
  });

  it('newer: the installed runtime is newer than the bundled one (never downgraded)', async () => {
    h = await installed('1.2.0');
    const s = await detectInstall(h.rt, bundle('1.0.1'));
    expect(s.kind).toBe('newer');
    expect(s.recommended).toBe('none');
  });

  it('partial: runtime missing while the macro exists', async () => {
    h = await installed('1.0.1');
    rmSync(h.rt.paths.runtimeFile);
    const s = await detectInstall(h.rt, bundle());
    expect(s.kind).toBe('partial');
    expect(s.recommended).toBe('repair');
    expect(names(s, 'missing')).toContain('runtime');
  });

  it('partial: macro missing, secret missing, runtime modified', async () => {
    h = await installed('1.0.1');
    rmSync(h.rt.paths.macroFile);
    rmSync(h.rt.paths.secret);
    writeFileSync(h.rt.paths.runtimeFile, `${runtimeSrc('1.0.1')}// hand edit\n`);
    const s = await detectInstall(h.rt, bundle());
    expect(s.kind).toBe('partial');
    expect(names(s, 'missing')).toEqual(expect.arrayContaining(['macro', 'secret']));
    expect(names(s, 'modified')).toContain('runtime');
  });

  it('partial: mailbox directory with loose permissions or a missing subdirectory', async () => {
    h = await installed('1.0.1');
    chmodSync(h.rt.paths.root, 0o755);
    rmSync(h.rt.paths.inbox, { recursive: true });
    const s = await detectInstall(h.rt, bundle());
    expect(s.kind).toBe('partial');
    expect(names(s, 'modified').concat(names(s, 'missing'))).toContain('mailbox');
  });

  it('outdated: the loader macro was written by an older version', async () => {
    h = await installed('1.0.1');
    writeFileSync(h.rt.paths.macroFile, '// c3d-mcp bridge loader 0.0.1\n');
    const s = await detectInstall(h.rt, bundle());
    expect(s.kind).toBe('outdated');
    expect(names(s, 'outdated')).toContain('macro');
  });

  it('partial: the loader macro was edited by hand, or is not ours at all', async () => {
    h = await installed('1.0.1');
    writeFileSync(h.rt.paths.macroFile, `${TEMPLATE.replace('{{VERSION}}', '1.0.1')}// edited\n`);
    expect(names(await detectInstall(h.rt, bundle()), 'modified')).toContain('macro');
    writeFileSync(h.rt.paths.macroFile, 'function main() {}\n');
    const s = await detectInstall(h.rt, bundle());
    expect(s.kind).toBe('partial');
    expect(names(s, 'modified')).toContain('macro');
  });

  it('unmanaged: bridge files exist but there is no install manifest', async () => {
    h = await installed('1.0.1');
    rmSync(h.rt.paths.manifest);
    const s = await detectInstall(h.rt, bundle());
    expect(s.kind).toBe('unmanaged');
    expect(s.recommended).toBe('install');
    expect(names(s, 'missing')).toContain('manifest');
  });

  it('partial: a corrupt manifest', async () => {
    h = await installed('1.0.1');
    writeFileSync(h.rt.paths.manifest, '{ not json');
    const s = await detectInstall(h.rt, bundle());
    expect(s.kind).toBe('partial');
    expect(names(s, 'corrupt')).toContain('manifest');
  });

  it('helper: the managed copy in the mailbox directory is judged, not an override listed first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'c3d-helper-'));
    const override = join(dir, 'override', 'C3D Bridge Helper.app');
    mkdirSync(join(override, 'Contents'), { recursive: true });
    writeFileSync(join(override, 'Contents', 'Info.plist'), '<key>CFBundleShortVersionString</key><string>9.9.9</string>');
    const exec: Executor = (cmd, args, o) => (cmd === 'codesign' ? Promise.resolve({ code: 0, stdout: '', stderr: '' }) : safeExec(cmd, args, o));
    h = await installed('1.0.1', { exec, helper: { available: () => true, call: () => Promise.reject(new Error('x')), installedApp: () => override } });
    try {
      const managed = join(h.rt.paths.root, 'helper', 'C3D Bridge Helper.app');
      mkdirSync(join(managed, 'Contents'), { recursive: true });
      writeFileSync(join(managed, 'Contents', 'Info.plist'), '<key>CFBundleShortVersionString</key><string>0.3.1</string>');
      const s = await detectInstall(h.rt, bundle('1.0.1', '0.3.2'));
      expect(s.installed.helper).toBe('0.3.1');
      expect(names(s, 'outdated')).toContain('helper');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a helper app that is already there does not make an empty machine a partial install', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'c3d-helper-'));
    const app = join(dir, 'C3D Bridge Helper.app');
    mkdirSync(join(app, 'Contents'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<key>CFBundleShortVersionString</key><string>0.3.1</string>');
    const exec: Executor = (cmd, args, o) => (cmd === 'codesign' ? Promise.resolve({ code: 1, stdout: '', stderr: '' }) : safeExec(cmd, args, o));
    h = makeHarness({ exec, helper: { available: () => true, call: () => Promise.reject(new Error('x')), installedApp: () => app } }, { seed: false });
    try {
      const s = await detectInstall(h.rt, bundle('1.0.1', '0.3.2'));
      expect(s.kind).toBe('fresh');
      expect(s.summary).toMatch(/fresh install.*helper/);
      expect(names(s, 'corrupt')).toContain('helper'); // still reported, and install will replace it
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('helper: missing is optional (current stays current); an older one is outdated; an unsigned one is corrupt', async () => {
    h = await installed('1.0.1');
    expect((await detectInstall(h.rt, bundle('1.0.1', '0.3.2'))).kind).toBe('current');
    rmSync(h.env.root, { recursive: true, force: true });

    const dir = mkdtempSync(join(tmpdir(), 'c3d-helper-'));
    const app = join(dir, 'C3D Bridge Helper.app');
    mkdirSync(join(app, 'Contents'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<key>CFBundleShortVersionString</key><string>0.3.1</string>');
    let signed = true;
    const exec: Executor = (cmd, args, o) => (cmd === 'codesign' ? Promise.resolve({ code: signed ? 0 : 1, stdout: '', stderr: '' }) : safeExec(cmd, args, o));
    h = await installed('1.0.1', { helper: { available: () => true, call: () => Promise.reject(new Error('x')), installedApp: () => app }, exec });
    try {
      const s = await detectInstall(h.rt, bundle('1.0.1', '0.3.2'));
      expect(s.kind).toBe('outdated');
      expect(s.recommended).toBe('update');
      expect(names(s, 'outdated')).toContain('helper');
      expect(s.installed.helper).toBe('0.3.1');
      expect((await detectInstall(h.rt, bundle('1.0.1', '0.3.1'))).kind).toBe('current');
      signed = false;
      const bad = await detectInstall(h.rt, bundle('1.0.1', '0.3.1'));
      expect(bad.kind).toBe('partial');
      expect(names(bad, 'corrupt')).toContain('helper');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
