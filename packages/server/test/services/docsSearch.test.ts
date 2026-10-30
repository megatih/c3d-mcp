 
import { describe, expect, it } from 'vitest';
import { searchDocs, tokenize } from '../../src/services/docsSearch.js';
import { kbLayout } from '../../src/services/kb.js';

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

describe('knowledge sources, trust levels and measured notes', () => {
  it('returns official per-method descriptions, not just signatures', () => {
    const h = searchDocs('mkDir', 3).find((x) => x.title === 'File.mkDir')!;
    expect(h.trust).toBe('official');
    expect(h.snippet).toMatch(/deleted without warning/);
  });
  it('annotates claims that were refuted in 8.1.3', () => {
    const h = searchDocs('Vec4D isEqual', 3).find((x) => x.title === 'Vec4D.isEqual')!;
    expect(h.note).toMatch(/confirmed in Cheetah3D 8\.1\.3.*throws/);
    const sel = searchDocs('selectedObject', 2, ['official']).find((x) => x.title === 'Document.selectedObject')!;
    expect(sel.note).toMatch(/undefined/);
  });
  it('indexes the bundled example scripts', () => {
    const r = searchDocs('RotateObject rotating object images', 3, ['example']);
    expect(r[0]!.trust).toBe('example');
    expect(r[0]!.source).toMatch(/^example\/Macro\/RotateObject/);
  });
  it('indexes the book and labels unreviewed passages', () => {
    const r = searchDocs('soft shadows', 8, ['book']);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((h) => h.trust === 'book' || h.trust === 'book-unreviewed')).toBe(true);
    const all = searchDocs('Falcon renderer samples bounces', 10, ['book']);
    expect(all.some((h) => h.trust === 'book-unreviewed')).toBe(true);
  });
  it('filters by source and keeps the forum for filling or explicit requests', () => {
    expect(searchDocs('addIndexPolygon', 5, ['official']).every((h) => h.trust === 'official')).toBe(true);
    const f = searchDocs('selectedObject never null', 3, ['forum']);
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((h) => h.trust === 'forum')).toBe(true);
    expect(f[0]!.note).toMatch(/NOT verified in Cheetah3D 8\.1\.3/);
    // a well covered query is answered without any forum hit
    expect(searchDocs('addIndexPolygon', 3).some((h) => h.trust === 'forum')).toBe(false);
  });
  it('does not index the generated context packs again (they duplicate gotchas and patterns)', () => {
    expect(searchDocs('retainRedrawLock', 10).some((h) => h.source.startsWith('dist/'))).toBe(false);
  });
  it('has the packaged or vendored book available', () => expect(kbLayout()?.bookRoot).toBeTruthy());
  it('does not attach the "Update Menu" note to ordinary mentions of update()', () => {
    const r = searchDocs('Object update rebuilds caches', 10, ['official']);
    expect(r.length).toBeGreaterThan(0);
    for (const h of r) expect(h.note ?? '').not.toMatch(/Update Menu/);
  });
});
