import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { distFile } from '../helpers/childScripts.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** PATH shims so the server never touches the real machine: pgrep/osascript/mdls all report "nothing". */
function sandbox(): { env: Record<string, string>; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'c3de-'));
  roots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const name of ['pgrep', 'osascript', 'mdls', 'open']) {
    writeFileSync(join(bin, name), '#!/bin/sh\nexit 1\n');
    chmodSync(join(bin, name), 0o755);
  }
  const support = join(root, 'support');
  mkdirSync(join(support, 'Scripts'), { recursive: true });
  return {
    root,
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, C3D_CHEETAH_SUPPORT_DIR: support, C3D_MCP_DIR: join(support, 'MCP'), C3D_MCP_LOG_DIR: join(root, 'logs'), C3D_MCP_TRIGGER: 'osascript' },
  };
}

describe('serve over real stdio', () => {
  it('speaks only protocol on stdout: lists tools, answers capabilities (fallback) and doctor, logs to stderr/file', async () => {
    const sb = sandbox();
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dirname, '..', 'helpers', 'serveChild.mjs'), distFile('cli/index.js')], env: sb.env, stderr: 'pipe' });
    let stderr = '';
    transport.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    const client = new Client({ name: 'e2e', version: '1' });
    await client.connect(transport);
    try {
      const tools = (await client.listTools()).tools;
      const names = tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['c3d_doctor', 'c3d_install_bridge', 'c3d_capabilities']));
      for (const t of tools) expect(t.outputSchema, t.name).toBeDefined();

      const caps = await client.callTool({ name: 'c3d_capabilities', arguments: {} });
      expect(caps.isError).toBeFalsy();
      expect(caps.structuredContent).toMatchObject({ source: 'fallback', profile: 'full' });

      const doc = await client.callTool({ name: 'c3d_doctor', arguments: {} });
      const report = doc.structuredContent as { ok: boolean; checks: { name: string; status: string }[] };
      expect(report.ok).toBe(false);
      expect(report.checks.find((c) => c.name === 'bridge-installed')?.status).toBe('fail');
      expect(report.checks.find((c) => c.name === 'cheetah-running')?.status).toBe('fail');

      const err = await client.callTool({ name: 'c3d_does_not_exist', arguments: {} }).then((r) => r, (e: unknown) => e);
      expect(err).toBeDefined();
    } finally {
      await client.close();
    }
    expect(stderr).toContain('c3d-mcp serving on stdio');
    expect(stderr).not.toMatch(/[0-9a-f]{48}/);
    const logFile = join(sb.root, 'logs', 'c3d-mcp.log');
    expect(existsSync(logFile)).toBe(true);
    expect(readFileSync(logFile, 'utf8')).toContain('serving on stdio');
  });

  it('honours the profile from the environment', async () => {
    const sb = sandbox();
    const transport = new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dirname, '..', 'helpers', 'serveChild.mjs'), distFile('cli/index.js')], env: { ...sb.env, C3D_MCP_PROFILE: 'readonly' }, stderr: 'ignore' });
    const client = new Client({ name: 'e2e', version: '1' });
    await client.connect(transport);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
      expect(tools.map((t) => t.name)).not.toContain('c3d_install_bridge');
    } finally {
      await client.close();
    }
  });
});

describe('bin', () => {
  it('delegates to the CLI main', () => {
    const src = readFileSync(join(import.meta.dirname, '..', '..', 'bin', 'c3d-mcp.js'), 'utf8');
    expect(src.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(src).toContain("from '../dist/cli/index.js'");
  });
});
