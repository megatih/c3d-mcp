import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { doctor } from '../../src/core/doctor.js';
import type { Executor } from '../../src/core/platform.js';
import { BridgeError, type HelperClient } from '../../src/toolkit.js';
import { makeHarness, type Harness } from '../helpers/runtime.js';

let h: Harness;
afterEach(() => rmSync(h.env.root, { recursive: true, force: true }));

const exec: Executor = (cmd, args) => {
  if (cmd === 'mdls') return Promise.resolve({ code: 0, stdout: '8.1.3\n', stderr: '' });
  if (cmd === 'osascript' && args[1]?.includes('windows whose subrole')) return Promise.resolve({ code: 0, stdout: 'Untitled\n', stderr: '' });
  return Promise.resolve({ code: 1, stdout: '', stderr: '' });
};
const status = (r: Awaited<ReturnType<typeof doctor>>, name: string): string | undefined => r.checks.find((c) => c.name === name)?.status;

function helperWith(handlers: Record<string, unknown>): HelperClient & { installedApp(): string } {
  return {
    available: () => true,
    installedApp: () => '/x/C3D Bridge Helper.app',
    call: ((cmd: string) => {
      const v = handlers[cmd];
      if (v instanceof Error) return Promise.reject(v);
      if (v === undefined) return Promise.reject(new BridgeError('UNSUPPORTED', cmd));
      return Promise.resolve(v);
    }) as HelperClient['call'],
  };
}

describe('doctor', () => {
  it('returns structured checks, all with name/status/detail/fix', async () => {
    h = makeHarness({ exec });
    chmodSync(h.env.paths.root, 0o700);
    const r = await doctor(h.rt);
    expect(r.checks.length).toBeGreaterThanOrEqual(12);
    for (const c of r.checks) {
      expect(typeof c.name).toBe('string');
      expect(['ok', 'warn', 'fail']).toContain(c.status);
      expect(typeof c.detail).toBe('string');
      expect(typeof c.fix).toBe('string');
      if (c.status !== 'ok') expect(c.fix.length).toBeGreaterThan(0);
    }
    expect(new Set(r.checks.map((c) => c.name)).size).toBe(r.checks.length);
    for (const name of ['node', 'cheetah-running', 'cheetah-version', 'bridge-installed', 'runtime-version', 'menu-item', 'accessibility', 'screen-recording', 'helper', 'ping', 'modal', 'document-windows']) {
      expect(status(r, name), name).toBeDefined();
    }
  });

  it('is green-ish with a working fake bridge: ping round trip with counter, no failures', async () => {
    h = makeHarness({ exec });
    h.app.trigger.press = () => h.app.runMacro();
    const r = await doctor(h.rt);
    expect(r.ok).toBe(true);
    expect(status(r, 'ping')).toBe('ok');
    expect(r.checks.find((c) => c.name === 'ping')?.detail).toMatch(/counter \d+/);
    expect(status(r, 'bridge-installed')).toBe('ok');
    expect(status(r, 'menu-item')).toBe('ok');
    expect(status(r, 'helper')).toBe('warn');
    expect(h.app.contractViolations).toEqual([]);
  });

  it('fails when the bridge is not installed and does not try to ping', async () => {
    h = makeHarness({ exec }, { seed: false });
    const r = await doctor(h.rt);
    expect(r.ok).toBe(false);
    expect(status(r, 'bridge-installed')).toBe('fail');
    expect(status(r, 'ping')).toBe('warn');
    expect(h.app.opLog).toHaveLength(0);
  });

  it('fails when Cheetah3D is not running and when the menu item is missing', async () => {
    h = makeHarness({ exec });
    h.app.running = false;
    const r = await doctor(h.rt);
    expect(status(r, 'cheetah-running')).toBe('fail');
    h.app.running = true;
    h.app.menu = 'absent';
    const r2 = await doctor(h.rt);
    expect(status(r2, 'menu-item')).toBe('fail');
    expect(r2.checks.find((c) => c.name === 'menu-item')?.fix).toMatch(/Restart Cheetah3D/);
  });

  it('flags loose permissions and a mismatching runtime major version', async () => {
    h = makeHarness({ exec });
    chmodSync(h.env.paths.secret, 0o644);
    expect(status(await doctor(h.rt), 'bridge-installed')).toBe('warn');
    writeFileSync(h.env.paths.runtimeFile, 'var RUNTIME_VERSION = "9.0.0";');
    h.rt.bundledRuntimeVersion = '1.0.0';
    expect(status(await doctor(h.rt), 'runtime-version')).toBe('fail');
    writeFileSync(h.env.paths.runtimeFile, 'var RUNTIME_VERSION = "1.0.0";');
    h.rt.bundledRuntimeVersion = '1.2.0';
    expect(status(await doctor(h.rt), 'runtime-version')).toBe('warn');
  });

  it('reports the ping failure code when the bridge cannot be triggered', async () => {
    h = makeHarness({ exec });
    h.app.trigger.press = () => Promise.reject(new BridgeError('BLOCKED_BY_MODAL', 'A dialog is open'));
    const r = await doctor(h.rt);
    expect(r.ok).toBe(false);
    expect(status(r, 'modal')).toBe('fail');
  });

  it('uses the helper for permissions, windows and modal state', async () => {
    const helper = helperWith({
      ping: { version: '0.1.0', pid: 7 },
      permissions: { accessibility: true, screenRecording: false },
      windows: [{ title: 'Doc A', subrole: 'AXStandardWindow' }, { title: 'Panel', subrole: 'AXFloatingWindow' }],
      modalState: { open: false, dialogs: [] },
      status: { cheetah: { running: true, pid: 5, frontmost: true, version: '8.1.3', responsive: true } },
    });
    h = makeHarness({ exec, helper });
    h.app.trigger.press = () => h.app.runMacro();
    h.rt.probe.inspect = () => Promise.resolve({ running: true, version: '8.1.3', frontmost: true, source: 'helper' });
    const r = await doctor(h.rt);
    expect(status(r, 'helper')).toBe('ok');
    expect(status(r, 'accessibility')).toBe('ok');
    expect(status(r, 'screen-recording')).toBe('warn');
    expect(r.checks.find((c) => c.name === 'document-windows')?.detail).toContain('Doc A');
    expect(status(r, 'modal')).toBe('ok');
    expect(status(r, 'cheetah-frontmost')).toBe('ok');
  });

  it('fails accessibility when the helper lacks it and reports an open modal', async () => {
    const helper = helperWith({
      ping: { version: '0.1.0', pid: 7 },
      permissions: { accessibility: false, screenRecording: true },
      windows: [],
      modalState: { open: true, dialogs: [{ text: 'Texture baking error!' }] },
    });
    h = makeHarness({ exec, helper });
    h.app.trigger.press = () => Promise.reject(new BridgeError('TRIGGER_FAILED', 'disabled'));
    const r = await doctor(h.rt);
    expect(status(r, 'accessibility')).toBe('fail');
    expect(status(r, 'document-windows')).toBe('fail');
    expect(r.checks.find((c) => c.name === 'modal')?.detail).toContain('Texture baking error!');
  });
});
