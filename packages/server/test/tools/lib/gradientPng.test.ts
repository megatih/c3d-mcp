import { describe, expect, it } from 'vitest';
import { encodePng, renderGradient } from '../../../src/lib/gradientPng.js';
import { decodePng } from '../../../src/services/images.js';

const red = { r: 1, g: 0, b: 0, a: 1 };
const blue = { r: 0, g: 0, b: 1, a: 1 };

describe('gradient raster', () => {
  it('90 degrees runs top to bottom, 0 left to right', () => {
    const v = renderGradient({ stops: [{ pos: 0, color: red }, { pos: 1, color: blue }], angleDeg: 90, width: 4, height: 64, dither: false });
    expect(v[0]).toBeGreaterThan(240);
    expect(v[(63 * 4) * 4 + 2]).toBeGreaterThan(240);
    expect(v[(32 * 4 + 1) * 4]).toBeGreaterThan(100);
    const h = renderGradient({ stops: [{ pos: 0, color: red }, { pos: 1, color: blue }], angleDeg: 0, width: 64, height: 2, dither: false });
    expect(h[0]).toBeGreaterThan(240);
    expect(h[63 * 4 + 2]).toBeGreaterThan(240);
  });
  it('honours stop positions (clamped before the first and after the last) and is monotonic', () => {
    const px = renderGradient({ stops: [{ pos: 0.25, color: red }, { pos: 0.75, color: blue }], angleDeg: 0, width: 100, height: 1, dither: false });
    expect(px[0]).toBe(255);
    expect(px[99 * 4 + 2]).toBe(255);
    let prev = 256;
    for (let x = 0; x < 100; x++) { expect(px[x * 4]!).toBeLessThanOrEqual(prev); prev = px[x * 4]!; }
  });
  it('dither perturbs by at most one level and is deterministic', () => {
    const o = { stops: [{ pos: 0, color: red }, { pos: 1, color: blue }], angleDeg: 90, width: 16, height: 16 };
    const a = renderGradient({ ...o, dither: true });
    const b = renderGradient({ ...o, dither: true });
    const c = renderGradient({ ...o, dither: false });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - c[i]!)).toBeLessThanOrEqual(1);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });
});

describe('encodePng', () => {
  it('produces a PNG the decoder reads back', () => {
    const rgba = renderGradient({ stops: [{ pos: 0, color: red }, { pos: 1, color: blue }], angleDeg: 90, width: 8, height: 6, dither: false });
    const png = encodePng(8, 6, rgba);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const r = decodePng(png);
    expect(r).toMatchObject({ width: 8, height: 6 });
    expect(r.luma.length).toBe(48);
  });
  it('rejects a wrong buffer size', () => expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow());
});
