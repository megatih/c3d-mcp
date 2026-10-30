import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HelperUpdateResult } from '../../src/core/helperUpdate.js';
import { install, readManifest } from '../../src/core/install.js';
import type { Executor } from '../../src/core/platform.js';
import { makeHarness, safeExec, type Harness } from '../helpers/runtime.js';

let h: Harness;
let dir: string;
afterEach(() => { rmSync(h.env.root, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });

const TEMPLATE = '// c3d-mcp bridge loader {{VERSION}}\nvar RUNTIME = "{{RUNTIME_PATH}}";\nvar MCP = "{{MCP_DIR}}";\n';
const plist = (v: string): string => `<key>CFBundleShortVersionString</key><string>${v}</string>`;

/** A harness with an installed helper app of the given version; codesign verification is controlled by `valid`. */
function withHelper(version: string, valid = (): boolean => true): Harness {
  dir = mkdtempSync(join(tmpdir(), 'c3d-ih-'));
  const app = join(dir, 'C3D Bridge Helper.app');
  mkdirSync(join(app, 'Contents'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'Info.plist'), plist(version));
  const exec: Executor = (cmd, args, o) => (cmd === 'codesign' ? Promise.resolve({ code: valid() ? 0 : 1, stdout: '', stderr: '' }) : cmd === 'unzip' ? Promise.resolve({ code: 0, stdout: plist('0.3.2'), stderr: '' }) : safeExec(cmd, args, o));
  const hh = makeHarness({ exec, helper: { available: () => true, call: () => Promise.reject(new Error('x')), installedApp: () => app } }, { seed: false });
  writeFileSync(join(hh.env.paths.scriptsDir, 'MyUserMacro.js'), '// user');
  const zip = join(dir, 'C3D-Bridge-Helper.zip');
  writeFileSync(zip, 'zip');
  process.env.C3D_HELPER_APP = join(dir, 'bundled', 'C3D Bridge Helper.app');
  mkdirSync(join(process.env.C3D_HELPER_APP, 'Contents'), { recursive: true });
  writeFileSync(join(process.env.C3D_HELPER_APP, 'Contents', 'Info.plist'), plist('0.3.2'));
  return hh;
}
afterEach(() => { delete process.env.C3D_HELPER_APP; });

function srcs(root: string): { runtimeSource: string; templateSource: string } {
  const runtimeSource = join(root, 'bundled-runtime.js');
  const templateSource = join(root, 'macro.template');
  writeFileSync(runtimeSource, '/* c3d-mcp runtime 1.0.1 */\nvar RUNTIME_VERSION = "1.0.1";\n');
  writeFileSync(templateSource, TEMPLATE);
  return { runtimeSource, templateSource };
}
const result = (over: Partial<HelperUpdateResult> = {}): HelperUpdateResult => ({ action: 'updated', from: '0.3.1', to: '0.3.2', path: '/x/C3D Bridge Helper.app', permissions: 'regrant', detail: 'updated', ...over });
const base = { skipPing: true } as const;

describe('install and the helper app', () => {
  it('auto: updates an outdated helper, records it, and tells the user to grant permissions again', async () => {
    h = withHelper('0.3.1');
    const calls: Array<{ force?: boolean }> = [];
    const r = await install(h.rt, { ...srcs(h.env.root), ...base, updateHelper: (_rt, o) => { calls.push({ force: o?.force }); return Promise.resolve(result()); } });
    expect(calls).toEqual([{ force: false }]);
    expect(r.helperUpdate?.action).toBe('updated');
    expect(r.steps.find((s) => s.name === 'helper')?.status).toBe('done');
    expect(r.guidance.join('\n')).toMatch(/Accessibility/);
    expect(r.state?.components.find((c) => c.name === 'helper')?.status).toBe('outdated');
    expect((await readManifest(h.rt))?.helper?.installedByUs).toBe(true);
  });

  it('auto: does not touch a current helper', async () => {
    h = withHelper('0.3.2');
    let called = false;
    const r = await install(h.rt, { ...srcs(h.env.root), ...base, updateHelper: () => { called = true; return Promise.resolve(result()); } });
    expect(called).toBe(false);
    expect(r.steps.find((s) => s.name === 'helper')?.status).toBe('unchanged');
  });

  it('repair: fixes a damaged helper but does not upgrade an outdated one; reinstall forces it', async () => {
    let valid = true;
    h = withHelper('0.3.1', () => valid);
    let calls = 0;
    const upd = (): Promise<HelperUpdateResult> => { calls++; return Promise.resolve(result()); };
    await install(h.rt, { ...srcs(h.env.root), ...base, mode: 'repair', updateHelper: upd });
    expect(calls).toBe(0);
    valid = false;
    await install(h.rt, { ...srcs(h.env.root), ...base, mode: 'repair', updateHelper: upd });
    expect(calls).toBe(1);
    valid = true;
    let forced: boolean | undefined;
    await install(h.rt, { ...srcs(h.env.root), ...base, mode: 'reinstall', updateHelper: (_rt, o) => { forced = o?.force; return upd(); } });
    expect(forced).toBe(true);
  });

  it('installHelper:false never touches the helper', async () => {
    h = withHelper('0.3.1');
    let called = false;
    await install(h.rt, { ...srcs(h.env.root), ...base, installHelper: false, updateHelper: () => { called = true; return Promise.resolve(result()); } });
    expect(called).toBe(false);
  });

  it('a failed or rolled-back helper update only warns: the rest of the install still succeeds', async () => {
    h = withHelper('0.3.1');
    const r = await install(h.rt, { ...srcs(h.env.root), ...base, updateHelper: () => Promise.resolve(result({ action: 'rolled-back', permissions: 'n/a', detail: 'restored 0.3.1' })) });
    expect(r.ok).toBe(true);
    expect(r.steps.find((s) => s.name === 'helper')?.status).toBe('warn');
    expect(r.guidance.join('\n')).not.toMatch(/grant/i);
  });

  it('a kept signing identity says nothing about re-granting', async () => {
    h = withHelper('0.3.1');
    const r = await install(h.rt, { ...srcs(h.env.root), ...base, updateHelper: () => Promise.resolve(result({ permissions: 'kept' })) });
    expect(r.guidance.join('\n')).not.toMatch(/ask|again|grant/i);
  });

  it('dry run names the helper step and does not call the updater', async () => {
    h = withHelper('0.3.1');
    let called = false;
    const r = await install(h.rt, { ...srcs(h.env.root), ...base, dryRun: true, updateHelper: () => { called = true; return Promise.resolve(result()); } });
    expect(called).toBe(false);
    expect(r.plan.join('\n')).toMatch(/update the helper app 0\.3\.1 -> 0\.3\.2/);
  });
});
