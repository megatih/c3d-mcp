import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeSettingsPath, setClaudeCodeAllow } from '../../src/core/permissions.js';

let home: string;
const yes = (): Promise<boolean> => Promise.resolve(true);
const no = (): Promise<boolean> => Promise.resolve(false);
const settings = (): Record<string, any> => JSON.parse(readFileSync(claudeSettingsPath(home), 'utf8'));
const seed = (text: string): void => { mkdirSync(join(home, '.claude'), { recursive: true }); writeFileSync(claudeSettingsPath(home), text); };

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'c3d-perm-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe('setClaudeCodeAllow', () => {
  it('creates the settings file when there is none', async () => {
    const r = await setClaudeCodeAllow('allow', { home, confirm: yes });
    expect(r.status).toBe('added');
    expect(settings().permissions.allow).toEqual(['mcp__c3d', 'mcp__plugin_c3d-mcp_c3d']);
  });
  it('keeps other settings and rules, backs up, and is idempotent', async () => {
    seed(JSON.stringify({ model: 'x', permissions: { allow: ['Bash(ls)'], deny: ['Read(.env)'] } }));
    const r = await setClaudeCodeAllow('allow', { home, confirm: yes });
    expect(r.backup).toBeTruthy();
    expect(settings()).toEqual({ model: 'x', permissions: { allow: ['Bash(ls)', 'mcp__c3d', 'mcp__plugin_c3d-mcp_c3d'], deny: ['Read(.env)'] } });
    expect((await setClaudeCodeAllow('allow', { home, confirm: yes })).status).toBe('unchanged');
    expect(readdirSync(join(home, '.claude')).filter((f) => f.includes('c3d-backup'))).toHaveLength(1);
  });
  it('writes nothing without confirmation, and nothing in a dry run', async () => {
    seed('{}');
    expect((await setClaudeCodeAllow('allow', { home, confirm: no })).status).toBe('declined');
    expect((await setClaudeCodeAllow('allow', { home })).status).toBe('declined');
    expect((await setClaudeCodeAllow('allow', { home, dryRun: true, confirm: yes })).status).toBe('would-add');
    expect(settings()).toEqual({});
  });
  it('refuses a file it cannot parse or whose shape is unexpected', async () => {
    seed('{ not json');
    expect((await setClaudeCodeAllow('allow', { home, confirm: yes })).status).toBe('refused');
    expect(readFileSync(claudeSettingsPath(home), 'utf8')).toBe('{ not json');
    seed(JSON.stringify({ permissions: { allow: 'Bash' } }));
    expect((await setClaudeCodeAllow('allow', { home, confirm: yes })).status).toBe('refused');
  });
  it('revoke removes only the c3d rules', async () => {
    seed(JSON.stringify({ permissions: { allow: ['Bash(ls)', 'mcp__c3d', 'mcp__plugin_c3d-mcp_c3d'] } }));
    expect((await setClaudeCodeAllow('revoke', { home, confirm: yes })).status).toBe('removed');
    expect(settings().permissions.allow).toEqual(['Bash(ls)']);
    expect((await setClaudeCodeAllow('revoke', { home, confirm: yes })).status).toBe('unchanged');
  });
});
