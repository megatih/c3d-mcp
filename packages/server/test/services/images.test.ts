 
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createImageTools, decodePng, statsOf } from '../../src/services/images.js';
import { FakeHelper, makePng } from '../helpers/fakeBridge.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3d-img-'));

describe('image tools', () => {
  it('decodes PNGs and computes luma stats', () => {
    const r = decodePng(makePng(8, 4, () => [255, 255, 255]));
    expect([r.width, r.height]).toEqual([8, 4]);
    const s = statsOf(r);
    expect(s.meanLuma).toBeCloseTo(1, 3);
    expect(s.blank).toBe(true);
  });
  it('detects non-blank images', () => {
    const s = statsOf(decodePng(makePng(16, 16, (x, y) => [x * 16, y * 16, 0])));
    expect(s.blank).toBe(false);
    expect(s.meanLuma).toBeGreaterThan(0.05);
  });
  it('rejects non-PNG data', () => expect(() => decodePng(Buffer.from('nope'.repeat(20)))).toThrow(/PNG/));
  it('analyzes via the fallback when the helper is unavailable', async () => {
    const h = new FakeHelper(); h.on = false;
    const f = path.join(dir, 'a.png'); fs.writeFileSync(f, makePng(10, 10, (x) => [x * 25, 0, 0]));
    const a = await createImageTools(h).analyze(f);
    expect(a).toMatchObject({ width: 10, height: 10, blank: false });
  });
  it('prefers helper results when available', async () => {
    const h = new FakeHelper();
    h.handlers.set('analyzeImage', () => ({ width: 5, height: 6, blank: true, meanLuma: 0.5 }));
    expect(await createImageTools(h).analyze('/x.png')).toMatchObject({ width: 5, height: 6 });
    const f = path.join(dir, 'b.png'); fs.writeFileSync(f, makePng(4, 4, () => [1, 2, 3]));
    h.handlers.set('downscaleImage', (a: any) => { fs.writeFileSync(a.outPath, makePng(2, 2, () => [1, 2, 3])); return { outPath: a.outPath, width: 2, height: 2, bytes: 10, mime: 'image/png' }; });
    const d = await createImageTools(h).downscale(f, { maxDim: 2, maxBytes: 1e6 });
    expect(d).toMatchObject({ width: 2, height: 2, mime: 'image/png' });
  });
  it.runIf(process.platform === 'darwin')('downscales with sips when the helper is unavailable', async () => {
    const h = new FakeHelper(); h.on = false;
    const f = path.join(dir, 'c.png'); fs.writeFileSync(f, makePng(200, 100, (x, y) => [x, y, 7]));
    const d = await createImageTools(h).downscale(f, { maxDim: 50, maxBytes: 1e6 });
    expect(Math.max(d.width, d.height)).toBeLessThanOrEqual(50);
    const same = await createImageTools(h).downscale(f, { maxDim: 500, maxBytes: 1e6 });
    expect(same.path).toBe(f);
  });
});
