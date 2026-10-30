import { describe, expect, it } from 'vitest';
import { LIVE, closeWindowsAfterAll, liveRuntime, newScratch } from './live.js';

describe.skipIf(!LIVE)('live soak', () => {
  const rt = liveRuntime();
  closeWindowsAfterAll();

  it('100 sequential pings: zero lost, zero duplicate', async () => {
    await newScratch(rt);
    const seen: number[] = [];
    for (let i = 1; i <= 100; i++) {
      const r = await rt.bridge.one<{ counter: number }>('ping', { counter: i });
      seen.push(r.counter);
    }
    expect(seen).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('20 concurrent queued pings: all answered exactly once, in order', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => rt.bridge.one<{ counter: number }>('ping', { counter: 1000 + i })));
    expect(results.map((r) => r.counter)).toEqual(Array.from({ length: 20 }, (_, i) => 1000 + i));
  });

  it('mutating op executes exactly once even with an extra press', async () => {
    const before = await rt.bridge.one<{ items: unknown[]; total: number }>('listScene', { depth: 0 });
    const created = rt.bridge.one<{ ref: { id: number } }>('createObject', { type: 'BOX', name: 'IdemBox' });
    // extra manual press while the request is queued/processing
    await rt.trigger.press({}).catch(() => undefined);
    await created;
    await rt.trigger.press({}).catch(() => undefined);
    const after = await rt.bridge.one<{ total: number }>('listScene', { depth: 0 });
    expect(after.total).toBe(before.total + 1);
  });
});
