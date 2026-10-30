import { describe, expect, it } from 'vitest';
import { createLauncher } from '../../src/core/launcher.js';
import { newSession } from '../../src/core/runtime.js';
import { BridgeError, type HelperClient } from '../../src/toolkit.js';

type Call = { cmd: string; args?: Record<string, unknown> };

function helper(handlers: Record<string, unknown | (() => unknown)>, available = true): HelperClient & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    available: () => available,
    call: (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      const h = handlers[cmd];
      if (h === undefined) return Promise.reject(new Error(`unexpected ${cmd}`));
      const v = typeof h === 'function' ? (h as () => unknown)() : h;
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v as never);
    },
  };
}
const doc = (title: string) => ({ title, role: 'AXWindow', subrole: 'AXStandardWindow' });

describe('launcher', () => {
  it('launches the app and does not create a document when Cheetah3D opened one itself', async () => {
    const h = helper({ launchApp: { pid: 5 }, windows: [doc('Untitled')] });
    await createLauncher(h, newSession(), { pollMs: 1, windowWaitMs: 20 }).ensureRunning();
    expect(h.calls.map((c) => c.cmd)).toEqual(['launchApp', 'windows']);
  });

  it('creates a document when no document window shows up (panels do not count)', async () => {
    const h = helper({ launchApp: { pid: 5 }, windows: [{ title: 'Render Manager', role: 'AXWindow', subrole: 'AXFloatingWindow' }, doc('Render Manager')], newDocument: { title: 'Untitled' } });
    await createLauncher(h, newSession(), { pollMs: 1, windowWaitMs: 20 }).ensureRunning();
    const cmds = h.calls.map((c) => c.cmd);
    expect(cmds[0]).toBe('launchApp');
    expect(cmds.at(-1)).toBe('newDocument');
  });

  it('forgets the bound document and window title: they belonged to the previous process', async () => {
    const s = newSession();
    s.expectDocument = { marker: '__c3d_mcp_session_x' };
    s.scratch.set('windowTitle', 'Old');
    await createLauncher(helper({ launchApp: {}, windows: [doc('Untitled')] }), s, { pollMs: 1, windowWaitMs: 20 }).ensureRunning();
    expect(s.expectDocument).toBeUndefined();
    expect(s.scratch.has('windowTitle')).toBe(false);
  });

  it('fails clearly without the helper app', async () => {
    const h = helper({}, false);
    await expect(createLauncher(h, newSession()).ensureRunning()).rejects.toMatchObject({ code: 'APP_NOT_RUNNING', message: expect.stringMatching(/helper/i) });
    expect(h.calls).toEqual([]);
  });

  it('propagates a launch failure', async () => {
    const h = helper({ launchApp: new BridgeError('PERMISSION_MISSING', 'no accessibility') });
    await expect(createLauncher(h, newSession()).ensureRunning()).rejects.toMatchObject({ code: 'PERMISSION_MISSING' });
  });
});
