import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBinary, fetchJson, readCapped } from '../../src/lib/net.js';

afterEach(() => vi.unstubAllGlobals());

function streaming(chunks: number, size: number, headers: Record<string, string> = {}): { res: Response; pulled: () => number; cancelled: () => boolean } {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) { if (pulled >= chunks) { c.close(); return; } pulled++; c.enqueue(new Uint8Array(size)); },
    cancel() { cancelled = true; },
  });
  return { res: new Response(body, { headers }), pulled: () => pulled, cancelled: () => cancelled };
}

describe('capped downloads', () => {
  it('aborts a streaming body without content-length as soon as the cap is exceeded', async () => {
    const s = streaming(1000, 1024);
    await expect(readCapped(s.res, 4096, 'Download')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(s.pulled()).toBeLessThan(20); // nowhere near the 1000 chunks that were on offer
    expect(s.cancelled()).toBe(true);
  });
  it('rejects a declared oversize without reading the body', async () => {
    const s = streaming(10, 10, { 'content-length': '999999' });
    await expect(readCapped(s.res, 100, 'Download')).rejects.toThrow(/cap/);
    expect(s.pulled()).toBe(0);
  });
  it('fetchBinary returns data and hashes within the cap', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(streaming(3, 10).res)));
    const d = await fetchBinary('https://dl.polyhaven.org/x.bin', ['polyhaven.org'], 1000);
    expect(d.data.length).toBe(30);
    expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('fetchBinary aborts a lying server that omits content-length', async () => {
    const s = streaming(10_000, 1024);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(s.res)));
    await expect(fetchBinary('https://dl.polyhaven.org/x.bin', ['polyhaven.org'], 10_000)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(s.pulled()).toBeLessThan(20);
  });
  it('fetchJson caps the response size (default 8 MB) and parses normal JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ a: 1 }))));
    expect(await fetchJson('https://api.polyhaven.com/x', ['polyhaven.com'])).toEqual({ a: 1 });
    const big = streaming(20, 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(big.res)));
    await expect(fetchJson('https://api.polyhaven.com/x', ['polyhaven.com'])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(big.pulled()).toBeLessThan(12);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not json'))));
    await expect(fetchJson('https://api.polyhaven.com/x', ['polyhaven.com'])).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });
});
