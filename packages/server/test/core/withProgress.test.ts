import { describe, expect, it } from 'vitest';
import { scopeProgress, withProgress } from '../../src/core/toolServices.js';
import type { BridgeClient, BridgeOp, RunOpts, ToolServices } from '../../src/toolkit.js';

function recorder(): { bridge: BridgeClient; seen: Array<RunOpts | undefined> } {
  const seen: Array<RunOpts | undefined> = [];
  const bridge: BridgeClient = {
    run: (_ops: BridgeOp[], opts?: RunOpts) => { seen.push(opts); return Promise.resolve({ id: 'x', ok: true, runtimeVersion: '1', results: [], log: [], startedAt: 0, finishedAt: 0 }); },
    one: (_op: string, _args?: Record<string, unknown>, opts?: RunOpts) => { seen.push(opts); return Promise.resolve({} as never); },
  };
  return { bridge, seen };
}

describe('withProgress', () => {
  it('routes the bridge wait heartbeat of run() and one() to the tool progress service', async () => {
    const messages: string[] = [];
    const { bridge, seen } = recorder();
    const wrapped = withProgress(bridge, { progress: (m) => { messages.push(m); } });
    await wrapped.run([{ op: 'ping' }]);
    await wrapped.one('ping');
    expect(seen).toHaveLength(2);
    for (const o of seen) o?.onProgress?.('Waiting for Cheetah3D (4s)');
    expect(messages).toEqual(['Waiting for Cheetah3D (4s)', 'Waiting for Cheetah3D (4s)']);
  });
  it('keeps other options and lets an explicit onProgress win', async () => {
    const own: string[] = [];
    const { bridge, seen } = recorder();
    const wrapped = withProgress(bridge, { progress: () => { throw new Error('must not be used'); } });
    await wrapped.one('ping', {}, { deadlineMs: 5, onProgress: (m) => { own.push(m); } });
    expect(seen[0]?.deadlineMs).toBe(5);
    seen[0]?.onProgress?.('x');
    expect(own).toEqual(['x']);
  });
});

describe('withProgress (explicit undefined)', () => {
  it('still forwards the heartbeat when a caller passes onProgress: undefined', async () => {
    const got: string[] = [];
    const { bridge, seen } = recorder();
    await withProgress(bridge, { progress: (m) => { got.push(m); } }).one('ping', {}, { onProgress: undefined });
    seen[0]?.onProgress?.('beat');
    expect(got).toEqual(['beat']);
  });
});

describe('scopeProgress', () => {
  it('forwards progress while the call is active and drops it afterwards (background jobs outlive their request)', () => {
    const got: string[] = [];
    const base = { progress: (m: string) => { got.push(m); }, confirm: () => Promise.resolve(true) } as unknown as ToolServices;
    const scoped = scopeProgress(base);
    scoped.services.progress('during');
    scoped.end();
    scoped.services.progress('after');
    expect(got).toEqual(['during']);
    expect(typeof scoped.services.confirm).toBe('function');
  });
});
