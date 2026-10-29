import { describe, expect, it } from 'vitest';
import { createAppProbe } from '../../src/core/appProbe.js';
import { systemClock, systemExec, type Executor } from '../../src/core/platform.js';
import { BridgeError, type HelperClient } from '../../src/toolkit.js';

describe('systemExec', () => {
  it('captures stdout and exit code, feeds stdin, and never rejects', async () => {
    expect(await systemExec('/bin/echo', ['hi'])).toEqual({ code: 0, stdout: 'hi\n', stderr: '' });
    expect((await systemExec('/bin/cat', [], { input: 'piped' })).stdout).toBe('piped');
    const failing = await systemExec('/bin/sh', ['-c', 'echo oops >&2; exit 3']);
    expect(failing.code).toBe(3);
    expect(failing.stderr).toContain('oops');
    const missing = await systemExec('/no/such/binary', []);
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toMatch(/ENOENT/);
    const slow = await systemExec('/bin/sleep', ['5'], { timeoutMs: 50 });
    expect(slow.code).not.toBe(0);
  });
});

describe('systemClock.sleep', () => {
  it('resolves early on abort and immediately when already aborted', async () => {
    const ac = new AbortController();
    const t0 = Date.now();
    setTimeout(() => ac.abort(), 20);
    await systemClock.sleep(5000, ac.signal);
    expect(Date.now() - t0).toBeLessThan(1000);
    await systemClock.sleep(5000, ac.signal);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('createAppProbe', () => {
  const helper = (over: Partial<HelperClient>): HelperClient => ({ available: () => true, call: () => Promise.reject(new Error('x')), ...over });
  const exec = (code: number, stdout = ''): Executor => () => Promise.resolve({ code, stdout, stderr: '' });

  it('prefers the helper status', async () => {
    const probe = createAppProbe(helper({ call: (() => Promise.resolve({ cheetah: { running: true, pid: 9, responsive: false, frontmost: true, version: '8.1.3' } })) as HelperClient['call'] }), exec(1));
    expect(await probe.inspect()).toEqual({ running: true, responsive: false, frontmost: true, version: '8.1.3', pid: 9, source: 'helper' });
  });

  it('falls back to pgrep when the helper is missing or fails', async () => {
    expect(await createAppProbe(helper({ available: () => false }), exec(0, '123\n')).inspect()).toMatchObject({ running: true, pid: 123, source: 'pgrep' });
    expect(await createAppProbe(helper({}), exec(1)).inspect()).toMatchObject({ running: false, source: 'pgrep' });
    const noCheetah = helper({ call: (() => Promise.resolve({})) as HelperClient['call'] });
    expect(await createAppProbe(noCheetah, exec(0, '77')).inspect()).toMatchObject({ running: true, pid: 77 });
    const failing = helper({ call: (() => Promise.reject(new BridgeError('TIMEOUT', 't'))) });
    expect((await createAppProbe(failing, exec(1)).inspect()).source).toBe('pgrep');
  });

  it('reports the process start time and open dialogs', async () => {
    const run: Executor = (cmd) => Promise.resolve(
      cmd === 'ps' ? { code: 0, stdout: 'Thu Oct 29 13:55:30 2026\n', stderr: '' }
        : cmd === 'pgrep' ? { code: 0, stdout: '4242\n', stderr: '' }
          : { code: 0, stdout: 'Texture baking error! x \n', stderr: '' },
    );
    const probe = createAppProbe(helper({ available: () => false }), run);
    const st = await probe.inspect();
    expect(st.startedAtMs).toBe(Date.parse('Thu Oct 29 13:55:30 2026'));
    expect(await probe.modals?.()).toEqual([{ title: '', text: 'Texture baking error! x', buttons: [] }]);
    const viaHelper = createAppProbe(helper({ call: (() => Promise.resolve({ dialogs: [{ text: 'a', buttons: ['OK'], own: false }, { text: 'mine', own: true }] })) as HelperClient['call'] }), run);
    expect(await viaHelper.modals?.()).toEqual([{ title: '', text: 'a', buttons: ['OK'] }]);
  });
});
