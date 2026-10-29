import { describe, expect, it } from 'vitest';
import { adler32, asciiJson } from '../../src/core/json.js';

describe('asciiJson', () => {
  it('escapes every non-ASCII code unit and round-trips through JSON.parse', () => {
    const value = { name: '名前', emoji: '😀', del: '\u007f', plain: 'abc', nested: ['é'] };
    const text = asciiJson(value);
    expect(/^[\x00-\x7e]*$/.test(text)).toBe(true);
    expect(text).toContain('\\u540d\\u524d');
    expect(JSON.parse(text)).toEqual(value);
  });

  it('rejects values JSON cannot represent', () => {
    expect(() => asciiJson(undefined)).toThrow(TypeError);
  });
});

describe('adler32', () => {
  it('matches the reference vector', () => {
    expect(adler32('Wikipedia')).toBe('11e60398');
    expect(adler32('')).toBe('00000001');
  });
  it('hashes bytes, not characters', () => {
    expect(adler32(Buffer.from('名前'))).toBe(adler32('名前'));
  });
});
