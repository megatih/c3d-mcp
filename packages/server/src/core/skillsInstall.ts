import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_ROOT, REPO_ROOT, packageVersion } from './assets.js';

export const SKILL_MARKER = '.c3d-mcp-skill';
export const SKILL_TARGETS = ['claude', 'codex', 'antigravity'] as const;
export type SkillTarget = (typeof SKILL_TARGETS)[number];

/** User-level skill directories of the supported clients (and their project-level equivalents). */
const USER_DIRS: Record<SkillTarget, string[]> = { claude: ['.claude', 'skills'], codex: ['.agents', 'skills'], antigravity: ['.gemini', 'config', 'skills'] };
const PROJECT_DIRS: Record<SkillTarget, string[]> = { claude: ['.claude', 'skills'], codex: ['.agents', 'skills'], antigravity: ['.agents', 'skills'] };

export interface SkillsOptions {
  targets?: SkillTarget[];
  /** Install into <project>/<client dir> instead of the home directory. */
  project?: string;
  home?: string;
  dryRun?: boolean;
  /** Skill source directory (default: packaged skills, else the repo's skills/). */
  source?: string;
}

export type SkillStatus = 'installed' | 'updated' | 'would-install' | 'would-update' | 'skipped-foreign' | 'removed' | 'would-remove';
export interface SkillResult { skill: string; target: SkillTarget; dest: string; status: SkillStatus }

export function skillsSourceDir(root: string = PACKAGE_ROOT, repo: string = REPO_ROOT): string | undefined {
  return [join(repo, 'skills'), join(root, 'skills')].find((p) => existsSync(p) && statSync(p).isDirectory());
}

export function listSkills(source: string): string[] {
  return readdirSync(source, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(source, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
}

export function targetDir(target: SkillTarget, opts: SkillsOptions): string {
  const base = opts.project ?? opts.home ?? homedir();
  return join(base, ...(opts.project ? PROJECT_DIRS : USER_DIRS)[target]);
}

function resolveSource(opts: SkillsOptions): string {
  const source = opts.source ?? skillsSourceDir();
  if (!source) throw new Error('No skills found in this installation (expected a skills/ folder next to the package or in the repository).');
  return source;
}

/** Installs every skill into each target. A folder without our marker is never touched. */
export function installSkills(opts: SkillsOptions = {}): SkillResult[] {
  const source = resolveSource(opts);
  const results: SkillResult[] = [];
  for (const target of opts.targets ?? [...SKILL_TARGETS]) {
    const root = targetDir(target, opts);
    for (const skill of listSkills(source)) {
      const dest = join(root, skill);
      const exists = existsSync(dest);
      if (exists && !existsSync(join(dest, SKILL_MARKER))) {
        results.push({ skill, target, dest, status: 'skipped-foreign' });
        continue;
      }
      if (opts.dryRun) {
        results.push({ skill, target, dest, status: exists ? 'would-update' : 'would-install' });
        continue;
      }
      if (exists) rmSync(dest, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      cpSync(join(source, skill), dest, { recursive: true });
      writeFileSync(join(dest, SKILL_MARKER), `${packageVersion()}\n`);
      results.push({ skill, target, dest, status: exists ? 'updated' : 'installed' });
    }
  }
  return results;
}

/** Removes only the skill folders this tool installed (marker present and the name is one of ours). */
export function uninstallSkills(opts: SkillsOptions = {}): SkillResult[] {
  const source = resolveSource(opts);
  const results: SkillResult[] = [];
  for (const target of opts.targets ?? [...SKILL_TARGETS]) {
    const root = targetDir(target, opts);
    for (const skill of listSkills(source)) {
      const dest = join(root, skill);
      if (!existsSync(dest)) continue;
      if (!existsSync(join(dest, SKILL_MARKER))) {
        results.push({ skill, target, dest, status: 'skipped-foreign' });
        continue;
      }
      if (!opts.dryRun) rmSync(dest, { recursive: true, force: true });
      results.push({ skill, target, dest, status: opts.dryRun ? 'would-remove' : 'removed' });
    }
  }
  return results;
}

export function installedSkillVersion(dest: string): string | undefined {
  try {
    return readFileSync(join(dest, SKILL_MARKER), 'utf8').trim();
  } catch {
    return undefined;
  }
}
