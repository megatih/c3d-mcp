import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SKILL_MARKER, installSkills, listSkills, targetDir, uninstallSkills } from '../../src/core/skillsInstall.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fixture(): { source: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), 'c3d-skills-'));
  dirs.push(root);
  const source = join(root, 'src');
  for (const n of ['c3d-a', 'c3d-b']) {
    mkdirSync(join(source, n, 'references'), { recursive: true });
    writeFileSync(join(source, n, 'SKILL.md'), `---\nname: ${n}\ndescription: Use when testing.\n---\nbody\n`);
    writeFileSync(join(source, n, 'references', 'x.md'), 'x');
  }
  mkdirSync(join(source, 'not-a-skill'), { recursive: true });
  return { source, home: join(root, 'home') };
}

describe('skills install', () => {
  it('lists only folders with SKILL.md', () => {
    expect(listSkills(fixture().source)).toEqual(['c3d-a', 'c3d-b']);
  });

  it('maps targets to each client directory (user and project level)', () => {
    expect(targetDir('claude', { home: '/h' })).toBe('/h/.claude/skills');
    expect(targetDir('codex', { home: '/h' })).toBe('/h/.agents/skills');
    expect(targetDir('antigravity', { home: '/h' })).toBe('/h/.gemini/config/skills');
    expect(targetDir('antigravity', { project: '/p' })).toBe('/p/.agents/skills');
    expect(targetDir('codex', { project: '/p' })).toBe('/p/.agents/skills');
  });

  it('installs with a marker, updates its own folders and never overwrites foreign ones', () => {
    const { source, home } = fixture();
    const first = installSkills({ source, home, targets: ['codex'] });
    expect(first.map((r) => r.status)).toEqual(['installed', 'installed']);
    expect(existsSync(join(home, '.agents/skills/c3d-a', SKILL_MARKER))).toBe(true);
    expect(existsSync(join(home, '.agents/skills/c3d-a/references/x.md'))).toBe(true);
    expect(installSkills({ source, home, targets: ['codex'] }).map((r) => r.status)).toEqual(['updated', 'updated']);

    mkdirSync(join(home, '.claude/skills/c3d-a'), { recursive: true });
    writeFileSync(join(home, '.claude/skills/c3d-a/SKILL.md'), 'mine');
    const res = installSkills({ source, home, targets: ['claude'] });
    expect(res.find((r) => r.skill === 'c3d-a')?.status).toBe('skipped-foreign');
    expect(readFileSync(join(home, '.claude/skills/c3d-a/SKILL.md'), 'utf8')).toBe('mine');
    expect(res.find((r) => r.skill === 'c3d-b')?.status).toBe('installed');
  });

  it('dry-run changes nothing', () => {
    const { source, home } = fixture();
    expect(installSkills({ source, home, dryRun: true, targets: ['claude'] }).map((r) => r.status)).toEqual(['would-install', 'would-install']);
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  it('uninstall removes only marked folders', () => {
    const { source, home } = fixture();
    installSkills({ source, home, targets: ['claude'] });
    rmSync(join(home, '.claude/skills/c3d-b', SKILL_MARKER));
    const res = uninstallSkills({ source, home, targets: ['claude'] });
    expect(res.find((r) => r.skill === 'c3d-a')?.status).toBe('removed');
    expect(res.find((r) => r.skill === 'c3d-b')?.status).toBe('skipped-foreign');
    expect(existsSync(join(home, '.claude/skills/c3d-a'))).toBe(false);
    expect(existsSync(join(home, '.claude/skills/c3d-b'))).toBe(true);
  });
});
