import { readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/toolkit.js';
import { REQUEST_FILE_RE } from '../../src/core/mailbox.js';
import { makeHarness, type Harness } from '../helpers/runtime.js';

let h: Harness;
afterEach(() => rmSync(h.env.root, { recursive: true, force: true }));

const writeState = (hh: Harness, s: Record<string, unknown>): void =>
  writeFileSync(hh.env.paths.state, JSON.stringify({ busy: false, runtimeVersion: '1.0.0', protocol: 1, lastSeq: '0', updatedAt: Date.now(), ...s }));
const files = (dir: string): string[] => readdirSync(dir).filter((n) => !n.startsWith('.'));
const fail = (e: unknown): BridgeError => {
  expect(e).toBeInstanceOf(BridgeError);
  return e as BridgeError;
};
const catchErr = async (p: Promise<unknown>): Promise<BridgeError> => p.then(() => { throw new Error('expected rejection'); }, fail);

describe('happy path', () => {
  it('runs a ping through the real mailbox and cleans up', async () => {
    h = makeHarness();
    const r = await h.rt.bridge.one<{ counter: number; echo: string }>('ping', { counter: 7, echo: 'hi' });
    expect(r).toMatchObject({ counter: 7, echo: 'hi' });
    expect(h.app.macroRuns).toBe(1);
    expect(files(h.env.paths.inbox)).toEqual([]);
    expect(files(h.env.paths.outbox)).toEqual([]);
    expect(files(h.env.paths.cancel)).toEqual([]);
    expect(h.rt.bridge.lastRuntimeVersion).toBe('1.0.0');
    expect(h.app.contractViolations).toEqual([]);
  });

  it('injects the session expectDocument, and per-call options override it', async () => {
    h = makeHarness();
    h.app.fileName = 'a.jas';
    h.rt.session.expectDocument = { fileName: 'a.jas' };
    await h.rt.bridge.one('ping');
    await expect(h.rt.bridge.one('ping', {}, { expectDocument: { fileName: 'b.jas' } })).rejects.toMatchObject({ code: 'WRONG_DOCUMENT' });
    h.app.marker = '__c3d_mcp_session_123e4567-e89b-12d3-a456-426614174000';
    await h.rt.bridge.one('ping', {}, { expectDocument: { marker: h.app.marker } });
    expect(h.app.contractViolations).toEqual([]);
  });

  it('keeps unicode (名前) intact end to end', async () => {
    h = makeHarness();
    expect(await h.rt.bridge.one('echoName', { name: '名前' })).toEqual({ name: '名前' });
  });

  it('returns per-op failures in results and throws from one() with the op error', async () => {
    h = makeHarness();
    const res = await h.rt.bridge.run([{ op: 'ping' }, { op: 'boom' }]);
    expect(res.ok).toBe(false);
    expect(res.results.map((r) => r.ok)).toEqual([true, false]);
    const err = await catchErr(h.rt.bridge.one('boom'));
    expect(err.code).toBe('SCRIPT_ERROR');
    expect(err.details).toEqual({ line: 1 });
  });

  it('maps runtime error codes outside the contract to INTERNAL and keeps the original', async () => {
    h = makeHarness();
    h.app.ops.set('weird', () => { throw Object.assign(new Error('odd'), { code: 'WEIRD_CODE' }); });
    const err = await catchErr(h.rt.bridge.one('weird'));
    expect(err.code).toBe('INTERNAL');
    expect(err.details).toMatchObject({ runtimeCode: 'WEIRD_CODE' });
    expect((await catchErr(h.rt.bridge.one('nonexistentOp'))).code).toBe('UNSUPPORTED');
  });

  it('rejects empty requests', async () => {
    h = makeHarness();
    await expect(h.rt.bridge.run([])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('reports progress while waiting for a slow op', async () => {
    h = makeHarness();
    h.app.opDelayMs = 400;
    // The press returns as soon as it is dispatched (AX kAXErrorCannotComplete), the macro keeps running.
    h.app.trigger.press = () => { void h.app.runMacro(); return Promise.resolve(); };
    const msgs: string[] = [];
    await h.rt.bridge.one('ping', {}, { onProgress: (m) => msgs.push(m) });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0]).toMatch(/Waiting for Cheetah3D/);
  });
});

describe('request-level errors', () => {
  it('BRIDGE_NOT_INSTALLED when files are missing', async () => {
    h = makeHarness({}, { seed: false });
    const err = await catchErr(h.rt.bridge.one('ping'));
    expect(err.code).toBe('BRIDGE_NOT_INSTALLED');
    expect(err.hint).toMatch(/c3d-mcp install/);
  });

  it('VERSION_SKEW when the runtime major differs', async () => {
    h = makeHarness();
    h.app.runtimeVersion = '2.0.0';
    const err = await catchErr(h.rt.bridge.one('ping'));
    expect(err.code).toBe('VERSION_SKEW');
    expect(err.hint).toMatch(/install/);
  });

  it('VERSION_SKEW reported by the runtime itself (protocol mismatch)', async () => {
    h = makeHarness();
    const orig = h.rt.mailbox.writeRequest.bind(h.rt.mailbox);
    h.rt.mailbox.writeRequest = (req) => orig({ ...req, protocol: 2 as unknown as 1 });
    const err = await catchErr(h.rt.bridge.one('ping'));
    expect(err.code).toBe('VERSION_SKEW');
  });

  it('maps a bad secret to an actionable INTERNAL error', async () => {
    h = makeHarness();
    h.app.secretOverride = 'different-secret-different-secret';
    const err = await catchErr(h.rt.bridge.one('ping'));
    expect(err.code).toBe('INTERNAL');
    expect(err.hint).toMatch(/c3d-mcp install/);
    expect(JSON.stringify(err)).not.toContain('sssssssss');
  });

  it('WRONG_DOCUMENT carries a remediation hint', async () => {
    h = makeHarness();
    h.app.fileName = 'other.jas';
    const err = await catchErr(h.rt.bridge.one('ping', {}, { expectDocument: { fileName: 'mine.jas' } }));
    expect(err.code).toBe('WRONG_DOCUMENT');
    expect(err.hint).toBeTruthy();
  });

  it('surfaces a bootstrap error from the loader macro as SCRIPT_ERROR', async () => {
    h = makeHarness();
    h.app.behavior = 'noRun';
    const orig = h.app.trigger.press;
    h.app.trigger.press = async () => {
      writeFileSync(join(h.env.paths.outbox, '_bootstrap-error.json'), JSON.stringify({ message: 'SyntaxError: Unexpected token' }));
      await orig();
    };
    const err = await catchErr(h.rt.bridge.one('ping'));
    expect(err.code).toBe('SCRIPT_ERROR');
    expect(err.message).toMatch(/SyntaxError/);
    expect(files(h.env.paths.inbox)).toEqual([]);
  });
});

describe('response integrity', () => {
  it('survives a torn .done marker', async () => {
    h = makeHarness();
    h.app.behavior = 'tornDone';
    expect(await h.rt.bridge.one('ping', { counter: 1 })).toMatchObject({ counter: 1 });
  });

  it('PARSE_ERROR when the response never becomes valid', async () => {
    h = makeHarness();
    h.app.behavior = 'junkResponse';
    const err = await catchErr(h.rt.bridge.one('ping'));
    expect(err.code).toBe('PARSE_ERROR');
  }, 10_000);
});

describe('idempotency and staleness', () => {
  it('runs a mutating op exactly once even if the macro is pressed twice', async () => {
    h = makeHarness();
    h.app.trigger.press = async () => { await h.app.runMacro(); await h.app.runMacro(); };
    const created = await h.rt.bridge.one<{ ref: { id: number } }>('createObject', { name: 'X' });
    const ping = await h.rt.bridge.one('ping', { counter: 5 });
    expect(created.ref.id).toBe(1);
    expect(ping).toMatchObject({ counter: 5 });
    expect(h.app.objects).toBe(1);
    expect(h.app.duplicates()).toBe(0);
    expect(h.app.macroRuns).toBe(4);
  });

  it('a request whose deadline already passed is answered TIMEOUT and never executed', async () => {
    h = makeHarness();
    const seq = h.rt.mailbox.nextSeq();
    const id = '123e4567-e89b-12d3-a456-426614174111';
    await h.rt.mailbox.writeRequest({ protocol: 1, id, seq, secret: h.rt.mailbox.readSecret() ?? '', deadlineAt: Date.now() - 5, ops: [{ op: 'createObject' }] });
    await h.app.runMacro();
    expect(h.app.objects).toBe(0);
    expect(h.app.executions.has(id)).toBe(false);
    const resp = JSON.parse(readFileSync(join(h.env.paths.outbox, `${id}.json`), 'utf8')) as { error: { code: string } };
    expect(resp.error.code).toBe('TIMEOUT');
  });

  it('a timed-out request is cancelled, so a late press cannot execute it', async () => {
    h = makeHarness();
    // The macro "ran" (state changed) but never drained our request, e.g. it was busy elsewhere.
    h.app.trigger.press = () => { writeState(h, { updatedAt: Date.now() }); return Promise.resolve(); };
    const err = await catchErr(h.rt.bridge.one('createObject', {}, { deadlineMs: 300 }));
    expect(err.code).toBe('TIMEOUT');
    const [name] = files(h.env.paths.inbox);
    expect(name).toMatch(REQUEST_FILE_RE);
    expect(files(h.env.paths.cancel)).toHaveLength(1);
    await h.app.runMacro();
    expect(h.app.objects).toBe(0);
    // the next request sweeps the answered orphan
    h.app.trigger.press = () => h.app.runMacro();
    await h.rt.bridge.one('ping');
    expect(files(h.env.paths.inbox)).toEqual([]);
    expect(files(h.env.paths.outbox)).toEqual([]);
    expect(files(h.env.paths.cancel)).toEqual([]);
  });

  it('AbortSignal writes a cancel marker and rejects with CANCELLED', async () => {
    h = makeHarness();
    h.app.trigger.press = () => { writeState(h, { updatedAt: Date.now() }); return Promise.resolve(); };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    const err = await catchErr(h.rt.bridge.one('createObject', {}, { signal: ac.signal, deadlineMs: 5000 }));
    expect(err.code).toBe('CANCELLED');
    expect(files(h.env.paths.cancel)).toHaveLength(1);
    await h.app.runMacro();
    expect(h.app.objects).toBe(0);
  });

  it('a request cancelled while still queued never reaches the mailbox', async () => {
    h = makeHarness();
    h.app.opDelayMs = 200;
    const first = h.rt.bridge.one('ping');
    const ac = new AbortController();
    const second = h.rt.bridge.one('ping', {}, { signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    await expect(second).rejects.toMatchObject({ code: 'CANCELLED' });
    await first;
    expect(h.app.opLog).toHaveLength(1);
  });
});

describe('fault classification', () => {
  it('TRIGGER_FAILED after exactly one retry, and the request is withdrawn', async () => {
    h = makeHarness();
    h.app.behavior = 'noRun';
    let presses = 0;
    const orig = h.app.trigger.press;
    h.app.trigger.press = async () => { presses++; await orig(); };
    const err = await catchErr(h.rt.bridge.one('ping'));
    expect(err.code).toBe('TRIGGER_FAILED');
    expect(err.hint).toMatch(/menu|document|restart/i);
    expect(presses).toBe(2);
    expect(files(h.env.paths.inbox)).toEqual([]);
  });

  it('a TRIGGER_FAILED from the trigger itself is retried once, then surfaced', async () => {
    h = makeHarness();
    let presses = 0;
    h.app.trigger.press = () => { presses++; return Promise.reject(new BridgeError('TRIGGER_FAILED', 'menu disabled')); };
    const err = await catchErr(h.rt.bridge.one('ping'));
    expect(err.code).toBe('TRIGGER_FAILED');
    expect(presses).toBe(2);
    expect(files(h.env.paths.inbox)).toEqual([]);
  });

  it('BLOCKED_BY_MODAL from the trigger fails immediately without retry', async () => {
    h = makeHarness();
    let presses = 0;
    h.app.trigger.press = () => { presses++; return Promise.reject(new BridgeError('BLOCKED_BY_MODAL', 'dialog')); };
    await expect(h.rt.bridge.one('ping')).rejects.toMatchObject({ code: 'BLOCKED_BY_MODAL' });
    expect(presses).toBe(1);
    expect(files(h.env.paths.inbox)).toEqual([]);
  });

  it('APP_NOT_RUNNING on the first press is passed through', async () => {
    h = makeHarness();
    h.app.trigger.press = () => Promise.reject(new BridgeError('APP_NOT_RUNNING', 'not running'));
    await expect(h.rt.bridge.one('ping')).rejects.toMatchObject({ code: 'APP_NOT_RUNNING' });
  });

  describe('auto-launch', () => {
    const timing = { pressGraceMs: 300, pollMinMs: 5, pollMaxMs: 20, progressIntervalMs: 50, defaultDeadlineMs: 3000 };
    const notRunning = (): BridgeError => new BridgeError('APP_NOT_RUNNING', 'Cheetah3D is not running');

    it('launches Cheetah3D once, withdraws the unexecuted request and runs it again', async () => {
      let launches = 0;
      let running = false;
      h = makeHarness({ bridge: { ...timing, launcher: { ensureRunning: () => { launches++; running = true; return Promise.resolve(); } } } });
      const press = h.app.trigger.press.bind(h.app.trigger);
      h.app.trigger.press = (o) => (running ? press(o) : Promise.reject(notRunning()));
      expect(await h.rt.bridge.one('ping', { echo: 'up' })).toMatchObject({ echo: 'up' });
      expect(launches).toBe(1);
      expect(h.app.macroRuns).toBe(1); // the first request was never executed
      expect(files(h.env.paths.inbox)).toEqual([]);
    });

    it('reports the original APP_NOT_RUNNING (with the launch error) when launching fails', async () => {
      h = makeHarness({ bridge: { ...timing, launcher: { ensureRunning: () => Promise.reject(new BridgeError('PERMISSION_MISSING', 'no accessibility')) } } });
      h.app.trigger.press = () => Promise.reject(notRunning());
      const err = await catchErr(h.rt.bridge.one('ping'));
      expect(err.code).toBe('APP_NOT_RUNNING');
      expect(JSON.stringify(err.details)).toContain('no accessibility');
      expect(files(h.env.paths.inbox)).toEqual([]);
    });

    it('tries to launch only once per request even if the app still is not running', async () => {
      let launches = 0;
      h = makeHarness({ bridge: { ...timing, launcher: { ensureRunning: () => { launches++; return Promise.resolve(); } } } });
      h.app.trigger.press = () => Promise.reject(notRunning());
      await expect(h.rt.bridge.one('ping')).rejects.toMatchObject({ code: 'APP_NOT_RUNNING' });
      expect(launches).toBe(1);
    });

    it('is wired from the runtime: the helper launches the app unless auto-launch is off', async () => {
      const calls: string[] = [];
      const fakeHelper = { available: () => true, installedApp: () => undefined, call: (cmd: string) => { calls.push(cmd); return Promise.resolve(cmd === 'windows' ? [{ title: 'Untitled', subrole: 'AXStandardWindow' }] : {}) as never; } };
      for (const autoLaunch of [true, false]) {
        calls.length = 0;
        h = makeHarness({ helper: fakeHelper }, { config: { autoLaunch } });
        let running = false;
        const press = h.app.trigger.press.bind(h.app.trigger);
        h.app.trigger.press = (o) => (running ? press(o) : Promise.reject(notRunning()));
        if (autoLaunch) {
          // the launcher only runs after a launchApp call; simulate the app starting when the helper is asked to
          const call = fakeHelper.call;
          fakeHelper.call = (cmd: string) => { if (cmd === 'launchApp') running = true; return call(cmd); };
          await h.rt.bridge.one('ping');
          fakeHelper.call = call;
          expect(calls).toContain('launchApp');
        } else {
          await expect(h.rt.bridge.one('ping')).rejects.toMatchObject({ code: 'APP_NOT_RUNNING' });
          expect(calls).not.toContain('launchApp');
        }
        rmSync(h.env.root, { recursive: true, force: true });
      }
    });

    it('never relaunches after the app died mid-request (APP_CRASHED stays)', async () => {
      let launches = 0;
      h = makeHarness({ bridge: { ...timing, launcher: { ensureRunning: () => { launches++; return Promise.resolve(); } } } });
      let pressed = 0;
      h.app.trigger.press = () => { pressed++; return pressed === 1 ? Promise.resolve() : Promise.reject(notRunning()); };
      const err = await catchErr(h.rt.bridge.one('ping', {}, { deadlineMs: 1500 }));
      expect(err.code).toBe('APP_CRASHED');
      expect(launches).toBe(0);
    });
  });

  it('APP_CRASHED when the process disappears after a successful press', async () => {
    h = makeHarness();
    h.app.behavior = 'crash';
    const t0 = Date.now();
    const err = await catchErr(h.rt.bridge.one('ping', {}, { deadlineMs: 1500 }));
    expect(err.code).toBe('APP_CRASHED');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(files(h.env.paths.inbox)).toHaveLength(1); // kept for diagnosis
  });

  it('APP_CRASHED from timeout classification when the helper says the process is gone', async () => {
    h = makeHarness();
    h.app.trigger.press = () => { writeState(h, { busy: true, op: 'render', startedAt: Date.now() }); h.app.running = false; return Promise.resolve(); };
    const err = await catchErr(h.rt.bridge.one('ping', {}, { deadlineMs: 400 }));
    expect(err.code).toBe('APP_CRASHED');
  });

  it('APP_BUSY while the runtime is busy within thresholds', async () => {
    h = makeHarness();
    h.app.trigger.press = () => { writeState(h, { busy: true, op: 'render', startedAt: Date.now() }); return Promise.resolve(); };
    const err = await catchErr(h.rt.bridge.one('ping', {}, { deadlineMs: 400 }));
    expect(err.code).toBe('APP_BUSY');
    expect(err.details).toMatchObject({ op: 'render' });
  });

  it('APP_BUSY when the app does not respond to accessibility', async () => {
    h = makeHarness();
    h.app.responsive = false;
    h.app.trigger.press = () => { writeState(h, { busy: false }); return Promise.resolve(); };
    const err = await catchErr(h.rt.bridge.one('ping', {}, { deadlineMs: 400 }));
    expect(err.code).toBe('APP_BUSY');
  });

  it('BLOCKED_BY_MODAL (not RUNTIME_STUCK) when a dialog is open while the runtime is busy', async () => {
    h = makeHarness({ probe: { inspect: () => Promise.resolve({ running: true, responsive: true, source: 'helper' }), modals: () => Promise.resolve([{ title: '', text: 'Texture baking error!', buttons: ['OK'] }]) } });
    h.app.trigger.press = () => { writeState(h, { busy: true, op: 'addTag', startedAt: Date.now() - 60_000 }); return Promise.resolve(); };
    const err = await catchErr(h.rt.bridge.one('ping', {}, { deadlineMs: 400 }));
    expect(err.code).toBe('BLOCKED_BY_MODAL');
    expect(err.message).toContain('Texture baking error!');
  });

  it('busy state left by a previous Cheetah3D process is ignored and orphaned requests are swept', async () => {
    const started = Date.now();
    h = makeHarness({ probe: { inspect: () => Promise.resolve({ running: true, responsive: true, source: 'helper', startedAtMs: started }) } });
    writeState(h, { busy: true, op: 'export', startedAt: started - 60_000, updatedAt: started - 60_000 });
    const stale = join(h.env.paths.inbox, `${String((started - 30_000) * 1000).padStart(16, '0')}-97f1323b-f7a1-49a6-a92c-df39bf3d945b.json`);
    writeFileSync(stale, '{}');
    const r = await h.rt.bridge.one<{ counter: number }>('ping', { counter: 3 });
    expect(r.counter).toBe(3);
    expect(existsSync(stale)).toBe(false);
  });

  it('RUNTIME_STUCK when busy far beyond max(deadline, 16 s) while the app responds', async () => {
    h = makeHarness();
    h.app.trigger.press = () => { writeState(h, { busy: true, op: 'run', startedAt: Date.now() - 60_000 }); return Promise.resolve(); };
    const err = await catchErr(h.rt.bridge.one('ping', {}, { deadlineMs: 400 }));
    expect(err.code).toBe('RUNTIME_STUCK');
    expect(err.hint).toBeTruthy();
  });

  it('answers within 2x the deadline', async () => {
    h = makeHarness();
    h.app.trigger.press = () => { writeState(h, { updatedAt: Date.now() }); return Promise.resolve(); };
    const t0 = Date.now();
    await expect(h.rt.bridge.one('ping', {}, { deadlineMs: 1000 })).rejects.toBeInstanceOf(BridgeError);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('soak', () => {
  it('100 sequential + 20 concurrent-queued pings: zero lost, zero duplicated', async () => {
    h = makeHarness();
    const seen: number[] = [];
    for (let i = 1; i <= 100; i++) {
      const r = await h.rt.bridge.one<{ counter: number }>('ping', { counter: i });
      seen.push(r.counter);
    }
    const concurrent = await Promise.all(Array.from({ length: 20 }, (_, i) => h.rt.bridge.one<{ counter: number }>('ping', { counter: 1000 + i })));
    seen.push(...concurrent.map((r) => r.counter));
    expect(seen).toEqual([...Array.from({ length: 100 }, (_, i) => i + 1), ...Array.from({ length: 20 }, (_, i) => 1000 + i)]);
    expect(h.app.opLog.filter((o) => o.op === 'ping')).toHaveLength(120);
    expect(h.app.duplicates()).toBe(0);
    expect(h.app.executions.size).toBe(120);
    expect(h.app.contractViolations).toEqual([]);
    expect(existsSync(h.env.paths.lock)).toBe(false);
    expect(files(h.env.paths.inbox)).toEqual([]);
    expect(files(h.env.paths.outbox)).toEqual([]);
  }, 60_000);
});
