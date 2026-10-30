import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETUP_CLIENTS, clientConfigPath, configureClient, unconfigureClient } from '../../src/core/clientConfigs.js';
import type { Executor } from '../../src/core/platform.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'c3d-uc-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));
const FILE_CLIENTS = SETUP_CLIENTS.filter((c) => c !== 'claude-code');
const target = (c: (typeof FILE_CLIENTS)[number]): string => clientConfigPath(c, home) as string;
const backups = (path: string): string[] => readdirSync(dirname(path)).filter((n) => n.startsWith(`${path.split('/').pop()}.c3d-backup-`));

describe('unconfigureClient', () => {
  it.each(FILE_CLIENTS)('%s: removes the c3d entry it added, keeps everything else, and backs the file up first', async (client) => {
    const path = target(client);
    mkdirSync(dirname(path), { recursive: true });
    if (client === 'codex') writeFileSync(path, 'model = "x"\n\n[mcp_servers.other]\ncommand = "node"\nargs = ["other.js"]\n');
    else writeFileSync(path, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'node', args: ['other.js'] } } }, null, 2));
    expect((await configureClient(client, { home })).status).toBe('added');
    const r = await unconfigureClient(client, { home });
    expect(r.status).toBe('removed');
    expect(r.backup).toBeDefined();
    const after = readFileSync(path, 'utf8');
    expect(after).not.toMatch(/c3d-mcp/);
    expect(after).toMatch(/other/);
    if (client === 'codex') expect(after).toMatch(/model = "x"/);
    else expect(JSON.parse(after).theme).toBe('dark');
    expect(backups(path).length).toBeGreaterThanOrEqual(2); // one from configure, one from unconfigure
  });

  it.each(FILE_CLIENTS)('%s: nothing to do when there is no c3d entry or no file', async (client) => {
    expect((await unconfigureClient(client, { home })).status).toBe('absent');
    const path = target(client);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, client === 'codex' ? '[mcp_servers.other]\ncommand = "x"\n' : '{"mcpServers":{"other":{"command":"x"}}}');
    expect((await unconfigureClient(client, { home })).status).toBe('absent');
    expect(backups(path)).toEqual([]);
  });

  it.each(FILE_CLIENTS)('%s: a "c3d" entry that does not launch c3d-mcp is not ours and is kept', async (client) => {
    const path = target(client);
    mkdirSync(dirname(path), { recursive: true });
    const text = client === 'codex' ? '[mcp_servers.c3d]\ncommand = "my-own-server"\nargs = []\n' : JSON.stringify({ mcpServers: { c3d: { command: 'my-own-server', args: [] } } });
    writeFileSync(path, text);
    const r = await unconfigureClient(client, { home });
    expect(r.status).toBe('foreign');
    expect(readFileSync(path, 'utf8')).toBe(text);
    expect(backups(path)).toEqual([]);
  });

  it('refuses a config file it cannot parse and leaves it untouched', async () => {
    const path = target('cursor');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ nope');
    const r = await unconfigureClient('cursor', { home });
    expect(r.status).toBe('refused');
    expect(readFileSync(path, 'utf8')).toBe('{ nope');
  });

  it('dry run reports what would be removed and writes nothing', async () => {
    await configureClient('cursor', { home });
    const before = readFileSync(target('cursor'), 'utf8');
    const nBackups = backups(target('cursor')).length;
    const r = await unconfigureClient('cursor', { home, dryRun: true });
    expect(r.status).toBe('would-remove');
    expect(readFileSync(target('cursor'), 'utf8')).toBe(before);
    expect(backups(target('cursor'))).toHaveLength(nBackups);
  });

  describe('claude-code (through its CLI)', () => {
    const exec = (list: string, calls: string[]): Executor => (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (args[0] === 'mcp' && args[1] === 'list') return Promise.resolve({ code: 0, stdout: list, stderr: '' });
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    it('removes a c3d registration that launches c3d-mcp', async () => {
      const calls: string[] = [];
      const r = await unconfigureClient('claude-code', { home, exec: exec('c3d: npx -y c3d-mcp serve - ✔ Connected\nother: node x.js\n', calls) });
      expect(r.status).toBe('removed');
      expect(calls).toContain('claude mcp remove --scope user c3d');
    });
    it('keeps a c3d registration that is not ours, and does nothing when absent or claude is missing', async () => {
      const calls: string[] = [];
      expect((await unconfigureClient('claude-code', { home, exec: exec('c3d: my-own-server\n', calls) })).status).toBe('foreign');
      expect((await unconfigureClient('claude-code', { home, exec: exec('other: node x.js\n', calls) })).status).toBe('absent');
      expect(calls.some((c) => c.includes('remove'))).toBe(false);
      const missing: Executor = () => Promise.resolve({ code: 127, stdout: '', stderr: 'claude: not found' });
      expect((await unconfigureClient('claude-code', { home, exec: missing })).status).toBe('absent');
    });
  });

  it('never touches a file outside the client config paths', async () => {
    await configureClient('cursor', { home });
    await unconfigureClient('cursor', { home });
    expect(existsSync(target('cursor'))).toBe(true);
  });
});
