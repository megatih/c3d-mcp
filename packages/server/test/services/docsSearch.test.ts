 
import { describe, expect, it } from 'vitest';
import { searchDocs, tokenize } from '../../src/services/docsSearch.js';

describe('BM25 docs search', () => {
  it('tokenizes camelCase', () => expect(tokenize('retainRedrawLock')).toEqual(expect.arrayContaining(['retainredrawlock', 'retain', 'redraw', 'lock'])));
  it('finds retainRedrawLock', () => {
    const r = searchDocs('retainRedrawLock', 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((h) => /retainRedrawLock/.test(h.snippet) || /retainRedrawLock/.test(h.title))).toBe(true);
  });
  it('finds addIndexPolygon with a signature', () => {
    const r = searchDocs('addIndexPolygon', 5);
    expect(r[0]!.title).toMatch(/addIndexPolygon/);
    expect(r[0]!.snippet).toMatch(/addIndexPolygon/);
  });
  it('finds FCurve keyframe material', () => {
    const r = searchDocs('FCurve keyframe', 5);
    expect(r.some((h) => /FCurve/i.test(h.title + h.snippet))).toBe(true);
    for (const h of r) expect(h).toMatchObject({ id: expect.any(String), title: expect.any(String), snippet: expect.any(String), source: expect.any(String) });
  });
  it('respects limit and returns nothing for gibberish', () => {
    expect(searchDocs('object', 3).length).toBeLessThanOrEqual(3);
    expect(searchDocs('zzzqqqxxyy', 5)).toEqual([]);
    expect(searchDocs('', 5)).toEqual([]);
  });
});
