import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, type CliIO } from '../../src/cli/index.js';
import { createRuntime } from '../../src/core/runtime.js';
import { createLogger } from '../../src/logging.js';
import { FakeApp, makeTestEnv, type TestEnv } from '../helpers/fakeApp.js';
import { noHelper } from '../helpers/runtime.js';

let env: TestEnv | undefined;
afterEach(() => {
  if (env) rmSync(env.root, { recursive: true, force: true });
  env = undefined;
});

interface Cap { out: string; err: string; served: number; asked: string[]; io: Partial<CliIO> }
function harness(opts: { tty?: boolean; answer?: boolean; envVars?: Record<string, string> } = {}): Cap {
  env = makeTestEnv();
  const app = new FakeApp(env.paths);
  const cap: Cap = { out: '', err: '', served: 0, asked: [], io: {} };
  cap.io = {
    out: (t) => { cap.out += t; },
    err: (t) => { cap.err += t; },
    stdinIsTTY: opts.tty ?? false,
    env: { C3D_MCP_DIR: env.config.mcpDir, C3D_CHEETAH_SUPPORT_DIR: env.config.cheetahSupportDir, C3D_MCP_LOG_DIR: env.config.logDir, ...opts.envVars },
    confirm: (q) => { cap.asked.push(q); return Promise.resolve(opts.answer ?? true); },
    runtime: (config) => createRuntime(config, { trigger: app.trigger, probe: app.probe, helper: noHelper, logger: createLogger({ write: () => undefined }), expectedRuntimeMajor: 1 }),
    serve: () => { cap.served++; },
  };
  return cap;
}

describe('cli', () => {
  it('prints the version (plain and JSON)', async () => {
    const c = harness();
    expect(await main(['version'], c.io)).toBe(0);
    expect(c.out.trim()).toMatch(/^\d+\.\d+\.\d+/);
    const j = harness();
    await main(['version', '--json'], j.io);
    expect(JSON.parse(j.out)).toHaveProperty('version');
  });

  it('serves by default when stdin is not a TTY, shows help on a TTY', async () => {
    const c = harness({ tty: false });
    expect(await main([], c.io)).toBe(0);
    expect(c.served).toBe(1);
    const t = harness({ tty: true });
    expect(await main([], t.io)).toBe(0);
    expect(t.served).toBe(0);
    expect(t.out).toContain('Usage: c3d-mcp');
    expect(await main(['--help'], t.io)).toBe(0);
  });

  it('rejects unknown commands, unknown flags and bad config', async () => {
    const c = harness();
    expect(await main(['frobnicate'], c.io)).toBe(2);
    expect(c.err).toContain('Unknown command');
    expect(await main(['doctor', '--wat'], c.io)).toBe(2);
    const bad = harness({ envVars: { C3D_MCP_PROFILE: 'root' } });
    expect(await main(['doctor'], bad.io)).toBe(2);
    expect(bad.err).toContain('C3D_MCP_PROFILE');
  });

  it('config --raw prints only the snippet (no comment lines) so it can be redirected into a file', async () => {
    const raw = harness();
    expect(await main(['config', 'codex', '--raw'], raw.io)).toBe(0);
    expect(raw.out.startsWith('[mcp_servers.c3d]')).toBe(true);
    expect(raw.out).not.toMatch(/^#/m);
    const plain = harness();
    await main(['config', 'codex'], plain.io);
    expect(plain.out.startsWith('# codex:')).toBe(true);
    expect(plain.out.endsWith(raw.out)).toBe(true);
    const cursor = harness();
    await main(['config', 'cursor', '--raw'], cursor.io);
    expect(JSON.parse(cursor.out)).toHaveProperty('mcpServers.c3d.command');
    const usage = harness();
    await main(['--help'], usage.io);
    expect(usage.out).toContain('--raw');
  });

  it('config prints a snippet and validates the client name and form', async () => {
    const c = harness();
    expect(await main(['config', 'codex'], c.io)).toBe(0);
    expect(c.out).toContain('[mcp_servers.c3d]');
    expect(c.out).toContain('tool_timeout_sec');
    const abs = harness();
    await main(['config', 'cursor', '--form', 'absolute', '--json'], abs.io);
    const snippet = JSON.parse(abs.out) as { text: string };
    expect(JSON.parse(snippet.text).mcpServers.c3d.args[0]).toMatch(/bin\/c3d-mcp\.js$/);
    expect(await main(['config', 'vim'], harness().io)).toBe(2);
    expect(await main(['config'], harness().io)).toBe(2);
    expect(await main(['config', 'cursor', '--form', 'docker'], harness().io)).toBe(2);
    const prof = harness({ envVars: { C3D_MCP_PROFILE: 'local' } });
    await main(['config', 'lm-studio'], prof.io);
    expect(prof.out).toContain('C3D_MCP_PROFILE');
  });

  it('doctor exits 1 when something fails and supports --json', async () => {
    const c = harness();
    expect(await main(['doctor', '--json'], c.io)).toBe(1);
    const report = JSON.parse(c.out) as { ok: boolean; checks: { name: string }[] };
    expect(report.ok).toBe(false);
    expect(report.checks.length).toBeGreaterThan(5);
    const text = harness();
    expect(await main(['doctor'], text.io)).toBe(1);
    expect(text.out).toMatch(/\[FAIL\] bridge-installed/);
    expect(text.out).toMatch(/fix: /);
    const brief = harness();
    expect(await main(['doctor', '--brief'], brief.io)).toBe(1);
    expect(brief.out).toMatch(/\[FAIL\] bridge-installed/);
    expect(brief.out).not.toMatch(/\[ok\]/);
  });

  it('install fails with a clear message when the support dir is missing, and succeeds when it exists', async () => {
    const c = harness();
    rmSync(env?.paths.supportDir ?? '', { recursive: true, force: true });
    expect(await main(['install'], c.io)).toBe(1);
    expect(c.out).toContain('support directory not found');
    expect(await main(['install', '--json'], c.io)).toBe(1);

    // Real bundled assets (bridge/dist) into a temp Cheetah3D support dir, then uninstall again.
    const ok = harness();
    mkdirSync(join(env?.paths.scriptsDir ?? '', 'Macro'), { recursive: true });
    expect(await main(['install', '--json'], ok.io)).toBe(0);
    const report = JSON.parse(ok.out) as { ok: boolean; steps: { name: string; status: string }[] };
    expect(report.steps.find((s) => s.name === 'macro')?.status).toBe('done');
    const again = harness();
    expect(await main(['uninstall', '--yes'], { ...ok.io, out: again.io.out })).toBe(0);
    expect(again.out).toContain('removed');
  });

  it('uninstall needs --yes without a TTY, asks on a TTY, and honours a refusal', async () => {
    const c = harness();
    expect(await main(['uninstall'], c.io)).toBe(2);
    expect(c.err).toContain('--yes');
    expect(await main(['uninstall', '--yes'], c.io)).toBe(0);
    expect(c.out).toContain('No install manifest');

    const tty = harness({ tty: true, answer: false });
    expect(await main(['uninstall'], tty.io)).toBe(1);
    expect(tty.asked).toHaveLength(1);
    expect(tty.out).toContain('Aborted');

    const yes = harness({ tty: true, answer: true });
    expect(await main(['uninstall'], yes.io)).toBe(0);
    const json = harness();
    expect(await main(['uninstall', '--json'], json.io)).toBe(0);
    expect(JSON.parse(json.out)).toHaveProperty('removed');
  });
});
