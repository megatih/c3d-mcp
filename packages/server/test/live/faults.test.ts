import { copyFileSync, writeFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/toolkit.js';
import { dismissTestDialogs } from './cleanup.js';
import { LIVE, closeWindowsAfterAll, liveRuntime, newScratch } from './live.js';

const osa = (rt: ReturnType<typeof liveRuntime>, script: string) => rt.exec('osascript', ['-e', script]);

describe.skipIf(!LIVE)('live fault tests', () => {
  const rt = liveRuntime();
  closeWindowsAfterAll();
  const runtimeFile = rt.paths.runtimeFile;
  const backup = `${runtimeFile}.faultbak`;

  afterAll(async () => {
    try { copyFileSync(backup, runtimeFile); } catch { /* nothing to restore */ }
    await dismissTestDialogs();
  });
  afterEach(async () => { await dismissTestDialogs(); });

  it('(2) an op that throws gives a per-op error; later ops and requests still work', async () => {
    await newScratch(rt);
    const res = await rt.bridge.run([
      { op: 'setParameters', args: { ref: { path: '/Camera' }, params: { doesNotExist: 1 } } },
      { op: 'ping', args: { counter: 7 } },
    ]);
    expect(res.results[0]?.ok).toBe(false);
    expect(res.results[1]?.ok).toBe(true);
    const again = await rt.bridge.one<{ counter: number }>('ping', { counter: 8 });
    expect(again.counter).toBe(8);
  });

  it('(1) syntax error in runtime.js is surfaced with a hint, and recovers after reinstall', async () => {
    copyFileSync(runtimeFile, backup);
    try {
      writeFileSync(runtimeFile, 'this is ((( not javascript');
      const err = await rt.bridge.one('ping', { counter: 1 }, { deadlineMs: 10_000 }).then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(BridgeError);
      expect(['SCRIPT_ERROR', 'TRIGGER_FAILED']).toContain((err as BridgeError).code);
      expect((err as BridgeError).hint).toBeTruthy();
    } finally {
      copyFileSync(backup, runtimeFile);
    }
    const ok = await rt.bridge.one<{ counter: number }>('ping', { counter: 2 });
    expect(ok.counter).toBe(2);
  });

  it('(3) a real Cheetah dialog gives BLOCKED_BY_MODAL; recovers once dismissed', async () => {
    // BAKETAG on a non-polygon object makes Cheetah raise "Texture baking error!" inside the running macro (P24).
    const box = await rt.bridge.one<{ ref: { id: number } }>('createObject', { type: 'BOX', name: 'ModalBox' });
    const first = await rt.bridge.one('addTag', { ref: { id: box.ref.id }, type: 'BAKETAG' }, { deadlineMs: 5000 }).then(() => undefined, (e: unknown) => e);
    expect(first).toBeInstanceOf(BridgeError); // the macro is blocked behind the dialog
    try {
      const err = await rt.bridge.one('ping', { counter: 3 }, { deadlineMs: 6000 }).then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).code).toBe('BLOCKED_BY_MODAL');
      expect(JSON.stringify((err as BridgeError).details ?? '') + (err as BridgeError).message).toContain('Texture baking');
    } finally {
      // Dismiss only the dialog this test caused (by Accessibility, independent of which app is frontmost).
      await dismissTestDialogs();
      await new Promise((r) => setTimeout(r, 1500));
    }
    const ok = await rt.bridge.one<{ counter: number }>('ping', { counter: 4 });
    expect(ok.counter).toBe(4);
  });

  it('(3b) a non-modal panel that disables the menu gives TRIGGER_FAILED with a hint', async () => {
    await osa(rt, 'tell application "System Events" to tell process "Cheetah3D" to click menu item "Open..." of menu 1 of menu bar item "File" of menu bar 1');
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const err = await rt.bridge.one('ping', { counter: 9 }, { deadlineMs: 6000 }).then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(BridgeError);
      expect(['TRIGGER_FAILED', 'BLOCKED_BY_MODAL']).toContain((err as BridgeError).code);
    } finally {
      await dismissTestDialogs(); // cancels the Open panel through its Cancel button (Escape would go to the frontmost app)
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect((await rt.bridge.one<{ counter: number }>('ping', { counter: 10 })).counter).toBe(10);
  });

  it('(5) stale request after TIMEOUT never executes', async () => {
    const before = await rt.bridge.one<{ total: number }>('listScene', { depth: 0 });
    const err = await rt.bridge.one('createObject', { type: 'BOX', name: 'ShouldNotExist' }, { deadlineMs: 1 }).then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    await rt.bridge.one('ping', { counter: 5 });
    const after = await rt.bridge.one<{ total: number }>('listScene', { depth: 0 });
    expect(after.total).toBe(before.total);
  });
});

