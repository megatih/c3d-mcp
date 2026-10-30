import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../src/toolkit.js';

const errorsJson = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'contracts', 'errors.json');

describe('error codes', () => {
  it('toolkit ERROR_CODES match contracts/errors.json (shared with the in-app runtime)', () => {
    const contract = Object.keys((JSON.parse(readFileSync(join(errorsJson), 'utf8')) as { codes: Record<string, string> }).codes);
    expect([...ERROR_CODES].sort()).toEqual(contract.sort());
  });
});
