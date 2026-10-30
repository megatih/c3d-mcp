import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { CLIENTS, configSnippet } from '../../src/core/configSnippets.js';
import { toErrorPayload } from '../../src/core/errors.js';
import { createLogger, redactText } from '../../src/logging.js';
import { BridgeError } from '../../src/toolkit.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('loadConfig', () => {
  it('has sensible defaults under the given home', () => {
    const c = loadConfig({}, '/Users/x');
    expect(c).toMatchObject({
      profile: 'full', trigger: 'auto', disableExec: false, disableAssets: false, disableShell: false,
      cheetahSupportDir: '/Users/x/Library/Application Support/Cheetah3D',
      mcpDir: '/Users/x/Library/Application Support/Cheetah3D/MCP',
      logDir: '/Users/x/Library/Logs/c3d-mcp',
      workDir: '/Users/x/Library/Application Support/Cheetah3D/MCP/tmp',
    });
  });

  it('reads every environment variable', () => {
    const c = loadConfig({ C3D_MCP_PROFILE: 'Local', C3D_MCP_DISABLE_EXEC: '1', C3D_MCP_DISABLE_ASSETS: 'true', C3D_MCP_DISABLE_SHELL: 'YES', C3D_MCP_AUTO_CONFIRM: '1', C3D_MCP_DIR: '/m', C3D_CHEETAH_SUPPORT_DIR: '/s', C3D_MCP_WORKDIR: '/w', C3D_MCP_LOG_DIR: '/l', C3D_MCP_TRIGGER: 'osascript' }, '/h');
    expect(c).toEqual({ profile: 'local', disableExec: true, disableAssets: true, disableShell: true, autoConfirm: true, mcpDir: '/m', cheetahSupportDir: '/s', workDir: '/w', logDir: '/l', trigger: 'osascript', autoLaunch: true });
  });

  it('treats other flag values as off and rejects invalid enums', () => {
    expect(loadConfig({ C3D_MCP_DISABLE_EXEC: '0' }, '/h').disableExec).toBe(false);
    expect(loadConfig({}, '/h').autoConfirm).toBe(false); // unattended confirmation is strictly opt-in
    expect(loadConfig({}, '/h').autoLaunch).toBe(true); // launching Cheetah3D is on by default, off with C3D_MCP_NO_AUTOLAUNCH
    expect(loadConfig({ C3D_MCP_NO_AUTOLAUNCH: '1' }, '/h').autoLaunch).toBe(false);
    expect(loadConfig({ C3D_MCP_NO_AUTOLAUNCH: '0' }, '/h').autoLaunch).toBe(true);
    expect(() => loadConfig({ C3D_MCP_PROFILE: 'admin' }, '/h')).toThrow(/C3D_MCP_PROFILE/);
    expect(() => loadConfig({ C3D_MCP_TRIGGER: 'magic' }, '/h')).toThrow(/C3D_MCP_TRIGGER/);
  });
});

describe('config snippets', () => {
  it.each(CLIENTS)('%s produces parseable output for npx and absolute forms', (client) => {
    for (const form of ['npx', 'absolute'] as const) {
      const s = configSnippet(client, { form, home: '/h', nodePath: '/usr/local/bin/node', binPath: '/opt/c3d/bin/c3d-mcp.js', env: { C3D_MCP_PROFILE: 'local' } });
      expect(s.client).toBe(client);
      expect(s.location.length).toBeGreaterThan(0);
      const data = (s.language === 'json' ? JSON.parse(s.text) : parseToml(s.text)) as Record<string, any>;
      const server = (data.mcpServers ?? data.mcp_servers).c3d;
      if (form === 'npx') {
        expect(server.command).toBe('npx');
        expect(server.args).toEqual(['-y', 'c3d-mcp', 'serve']);
      } else {
        expect(server.command).toBe('/usr/local/bin/node');
        expect(server.args).toEqual(['/opt/c3d/bin/c3d-mcp.js', 'serve']);
      }
      expect(server.env).toEqual({ C3D_MCP_PROFILE: 'local' });
    }
  });

  it('codex sets tool_timeout_sec; gemini sets a millisecond timeout; claude-code mentions the CLI form', () => {
    const codex = parseToml(configSnippet('codex', { home: '/h' }).text) as { mcp_servers: { c3d: { tool_timeout_sec: number } } };
    expect(codex.mcp_servers.c3d.tool_timeout_sec).toBeGreaterThanOrEqual(120);
    expect((JSON.parse(configSnippet('gemini-cli').text) as { mcpServers: { c3d: { timeout: number } } }).mcpServers.c3d.timeout).toBeGreaterThanOrEqual(120_000);
    expect(configSnippet('claude-code').note).toContain('claude mcp add c3d -- npx -y c3d-mcp serve');
    expect(configSnippet('claude-desktop', { home: '/h' }).location).toBe('/h/Library/Application Support/Claude/claude_desktop_config.json');
  });
});

describe('toErrorPayload', () => {
  it('passes BridgeError through', () => {
    expect(toErrorPayload(new BridgeError('NOT_FOUND', 'no box', 'list the scene', { id: 3 }))).toEqual({ code: 'NOT_FOUND', message: 'no box', hint: 'list the scene', details: { id: 3 } });
  });
  it('turns ZodError into INVALID_ARGUMENT with field paths', () => {
    const r = z.object({ a: z.object({ b: z.number() }) }).safeParse({ a: { b: 'x' } });
    const payload = toErrorPayload(r.error);
    expect(payload.code).toBe('INVALID_ARGUMENT');
    expect(payload.details).toEqual({ issues: [{ path: 'a.b', message: expect.any(String) }] });
    expect(payload.message).toContain('a.b');
  });
  it('maps aborts and unknown errors without leaking stacks', () => {
    expect(toErrorPayload(Object.assign(new Error('x'), { name: 'AbortError' })).code).toBe('CANCELLED');
    const p = toErrorPayload(new Error('boom\n    at secret.js:1'));
    expect(p.code).toBe('INTERNAL');
    expect(JSON.stringify(p)).not.toMatch(/\n\s+at /);
    expect(toErrorPayload('str').code).toBe('INTERNAL');
  });
});

describe('logging', () => {
  it('redacts secrets in text and in structured fields', () => {
    const secret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    expect(redactText(`x ${secret} y`)).toBe('x [redacted] y');
    expect(redactText('token=hunter22secret', ['hunter22secret'])).toBe('token=[redacted]');
    const lines: string[] = [];
    const log = createLogger({ write: (l) => lines.push(l), redact: () => ['topsecretvalue'], level: 'debug' });
    log.info('call', { secret: 'x', token: 'y', other: 'topsecretvalue', n: 1 });
    expect(lines[0]).toContain('"secret":"[redacted]"');
    expect(lines[0]).not.toContain('topsecretvalue');
    expect(lines[0]).toContain('"n":1');
  });

  it('respects the level and rotates the log file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'c3dlog-'));
    dirs.push(dir);
    const log = createLogger({ dir, stderr: false, maxBytes: 400, keep: 2 });
    for (let i = 0; i < 1000; i++) log.debug('hidden');
    log.info('first');
    expect(readFileSync(join(dir, 'c3d-mcp.log'), 'utf8')).toContain('first');
    expect(readFileSync(join(dir, 'c3d-mcp.log'), 'utf8')).not.toContain('hidden');
    for (let i = 0; i < 600; i++) log.warn(`line ${i} ${'x'.repeat(40)}`);
    const again = createLogger({ dir, stderr: false, maxBytes: 400, keep: 2 });
    again.info('after restart');
    expect(readdirSync(dir).sort()).toEqual(['c3d-mcp.log', 'c3d-mcp.log.1', 'c3d-mcp.log.2']);
  });
});
