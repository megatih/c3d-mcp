import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientConfigPath, configureClient, detectClients } from '../../src/core/clientConfigs.js';
import type { Executor } from '../../src/core/platform.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'c3d-cc-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const now = (): Date => new Date('2026-01-02T03:04:05.678Z');
const put = (p: string, text: string): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const backups = (p: string): string[] => readdirSync(dirname(p)).filter((f) => f.includes('.c3d-backup-'));
const noExec: Executor = () => Promise.resolve({ code: 1, stdout: '', stderr: '' });

describe('detectClients', () => {
  it('detects from directories and PATH lookups', async () => {
    mkdirSync(join(home, '.cursor'));
    mkdirSync(join(home, '.codex'));
    const exec: Executor = (_c, a) => Promise.resolve(/command -v (claude|agy)$/.test(a[1] ?? '') ? { code: 0, stdout: '/usr/local/bin/x\n', stderr: '' } : { code: 1, stdout: '', stderr: '' });
    const found = Object.fromEntries((await detectClients({ home, exec })).map((d) => [d.client, d.detected]));
    expect(found).toEqual({ 'claude-desktop': false, 'claude-code': true, codex: true, antigravity: true, 'gemini-cli': false, cursor: true });
  });
});

describe('configureClient (JSON)', () => {
  const file = (): string => clientConfigPath('cursor', home) as string;

  it('creates a missing file (and parent dirs) without a backup', async () => {
    const r = await configureClient('cursor', { home, now });
    expect(r.status).toBe('added');
    expect(r.backup).toBeUndefined();
    expect(JSON.parse(readFileSync(file(), 'utf8')).mcpServers.c3d).toEqual({ command: 'npx', args: ['-y', 'c3d-mcp', 'serve'] });
  });

  it('treats an empty file as an empty object', async () => {
    put(file(), '  \n');
    expect((await configureClient('cursor', { home, now })).status).toBe('added');
  });

  it('preserves other servers and keys, and writes a timestamped backup', async () => {
    put(file(), JSON.stringify({ theme: 'x', mcpServers: { other: { command: 'o' } } }));
    const r = await configureClient('cursor', { home, now });
    expect(r.backup).toMatch(/mcp\.json\.c3d-backup-20260102T030405Z$/);
    expect(readFileSync(r.backup as string, 'utf8')).toContain('"other"');
    const doc = JSON.parse(readFileSync(file(), 'utf8'));
    expect(doc.theme).toBe('x');
    expect(Object.keys(doc.mcpServers)).toEqual(['other', 'c3d']);
  });

  it('is idempotent', async () => {
    await configureClient('cursor', { home, now });
    const before = readFileSync(file(), 'utf8');
    const r = await configureClient('cursor', { home, now });
    expect(r.status).toBe('unchanged');
    expect(readFileSync(file(), 'utf8')).toBe(before);
    expect(backups(file())).toHaveLength(0);
  });

  it('keeps a different existing c3d entry unless overwrite is confirmed', async () => {
    put(file(), JSON.stringify({ mcpServers: { c3d: { command: 'custom' } } }));
    expect((await configureClient('cursor', { home, now })).status).toBe('exists');
    expect((await configureClient('cursor', { home, now, confirmOverwrite: () => Promise.resolve(false) })).status).toBe('exists');
    expect(JSON.parse(readFileSync(file(), 'utf8')).mcpServers.c3d.command).toBe('custom');
    const r = await configureClient('cursor', { home, now, confirmOverwrite: () => Promise.resolve(true) });
    expect(r.status).toBe('replaced');
    expect(r.backup).toBeDefined();
    expect(JSON.parse(readFileSync(file(), 'utf8')).mcpServers.c3d.command).toBe('npx');
  });

  it('refuses invalid JSON and non-object roots without touching them', async () => {
    put(file(), '{ "mcpServers": // comment\n }');
    const r = await configureClient('cursor', { home, now });
    expect(r.status).toBe('refused');
    expect(readFileSync(file(), 'utf8')).toContain('// comment');
    expect(backups(file())).toHaveLength(0);
    put(file(), '[1]');
    expect((await configureClient('cursor', { home, now })).status).toBe('refused');
    put(file(), '{"mcpServers": 3}');
    expect((await configureClient('cursor', { home, now })).status).toBe('refused');
  });

  it('dry run writes nothing; absolute form pins node and the bin', async () => {
    const r = await configureClient('claude-desktop', { home, now, dryRun: true });
    expect(r.status).toBe('would-add');
    expect(existsSync(r.target)).toBe(false);
    await configureClient('gemini-cli', { home, now, launch: { form: 'absolute', nodePath: '/opt/node', binPath: '/opt/c3d/bin/c3d-mcp.js' } });
    const entry = JSON.parse(readFileSync(clientConfigPath('gemini-cli', home) as string, 'utf8')).mcpServers.c3d;
    expect(entry).toMatchObject({ command: '/opt/node', args: ['/opt/c3d/bin/c3d-mcp.js', 'serve'], timeout: 600000 });
    expect((await configureClient('antigravity', { home, now })).target).toBe(join(home, '.gemini', 'config', 'mcp_config.json'));
  });
});

describe('configureClient (Codex TOML)', () => {
  const file = (): string => clientConfigPath('codex', home) as string;

  it('creates and appends the section, keeping existing content', async () => {
    expect((await configureClient('codex', { home, now })).status).toBe('added');
    expect(readFileSync(file(), 'utf8')).toContain('[mcp_servers.c3d]');
    expect(readFileSync(file(), 'utf8')).toContain('tool_timeout_sec = 600');
    rmSync(file());
    put(file(), 'model = "x"\n\n[mcp_servers.other]\ncommand = "o"\n');
    const r = await configureClient('codex', { home, now });
    expect(r.backup).toBeDefined();
    const text = readFileSync(file(), 'utf8');
    expect(text.startsWith('model = "x"')).toBe(true);
    expect(text).toContain('[mcp_servers.other]');
    expect(text).toContain('[mcp_servers.c3d]');
  });

  it('skips when the section exists, is idempotent, and replaces only on confirmation', async () => {
    await configureClient('codex', { home, now });
    const before = readFileSync(file(), 'utf8');
    expect((await configureClient('codex', { home, now })).status).toBe('exists');
    expect(readFileSync(file(), 'utf8')).toBe(before);
    put(file(), `[mcp_servers.c3d]\ncommand = "old"\n\n[other]\nx = 1\n`);
    const r = await configureClient('codex', { home, now, confirmOverwrite: () => Promise.resolve(true), launch: { form: 'absolute', nodePath: '/n', binPath: '/b.js' } });
    expect(r.status).toBe('replaced');
    const text = readFileSync(file(), 'utf8');
    expect(text).not.toContain('"old"');
    expect(text).toContain('[other]');
    expect(text).toContain('command = "/n"');
  });

  it('refuses a file that looks like JSON', async () => {
    put(file(), '{"a":1}');
    expect((await configureClient('codex', { home, now })).status).toBe('refused');
  });
});

describe('configureClient (Claude Code)', () => {
  const recorder = (listOut: string, listCode = 0) => {
    const calls: string[][] = [];
    const exec: Executor = (_c, a) => { calls.push(a); return Promise.resolve(a[1] === 'list' ? { code: listCode, stdout: listOut, stderr: '' } : { code: 0, stdout: '', stderr: '' }); };
    return { calls, exec };
  };

  it('runs claude mcp add when c3d is not listed', async () => {
    const r = recorder('other: npx x - Connected\n');
    const res = await configureClient('claude-code', { home, exec: r.exec });
    expect(res.status).toBe('added');
    expect(r.calls[1]).toEqual(['mcp', 'add', '--scope', 'user', 'c3d', '--', 'npx', '-y', 'c3d-mcp', 'serve']);
  });

  it('skips when listed, and does nothing in a dry run', async () => {
    const r = recorder('c3d: npx -y c3d-mcp serve - Connected\n');
    expect((await configureClient('claude-code', { home, exec: r.exec })).status).toBe('exists');
    expect(r.calls).toHaveLength(1);
    const d = recorder('');
    expect((await configureClient('claude-code', { home, exec: d.exec, dryRun: true })).status).toBe('would-add');
    expect(d.calls).toHaveLength(1);
  });

  it('reports failure when the CLI fails', async () => {
    expect((await configureClient('claude-code', { home, exec: noExec })).status).toBe('failed');
  });
});
