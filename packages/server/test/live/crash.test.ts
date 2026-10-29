import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/toolkit.js';
import { liveRuntime, newScratch } from './live.js';

// Destructive: kills the running Cheetah3D mid-request. Opt-in only (C3D_LIVE_KILL=1).
describe.skipIf(process.env['C3D_LIVE_KILL'] !== '1')('live fault (4): Cheetah3D killed mid-request', () => {
  const rt = liveRuntime();
  it('returns APP_CRASHED within 2 x deadline and recovers after relaunch', async () => {
    await newScratch(rt);
    const deadlineMs = 10_000;
    const t0 = Date.now();
    const pending = rt.bridge.one('run', { code: 'var t = Date.now(); while (Date.now() - t < 25000) { }' }, { deadlineMs }).then(() => undefined, (e: unknown) => e);
    await new Promise((r) => setTimeout(r, 2500));
    execFileSync('pkill', ['-9', '-x', 'Cheetah3D']);
    const err = await pending;
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe('APP_CRASHED');
    expect(Date.now() - t0).toBeLessThan(2 * deadlineMs + 3000);
    execFileSync('open', ['-a', 'Cheetah3D']);
    await new Promise((r) => setTimeout(r, 9000));
    rt.session.expectDocument = undefined;
    await newScratch(rt);
    expect((await rt.bridge.one<{ counter: number }>('ping', { counter: 1 })).counter).toBe(1);
  });
});
