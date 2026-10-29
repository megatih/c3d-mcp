import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('agent skills', () => {
  it('pass the format and content validator (frontmatter, links, tool names, syntax)', () => {
    expect(existsSync(join(repo, 'skills'))).toBe(true);
    const out = execFileSync(process.execPath, [join(repo, 'scripts', 'build-skills.mjs'), '--check'], { encoding: 'utf8' });
    expect(out).toMatch(/skills valid/);
    for (const n of ['c3d-setup', 'c3d-scene-building', 'c3d-look-dev', 'c3d-scripting', 'c3d-reference-recreation', 'c3d-animation-export']) expect(out).toContain(n);
  });
});
