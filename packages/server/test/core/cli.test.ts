import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, type CliIO } from '../../src/cli/index.js';
import { createRuntime } from '../../src/core/runtime.js';
import { createLogger } from '../../src/logging.js';
import { FakeApp, makeTestEnv, type TestEnv } from '../helpers/fakeApp.js';
import { noHelper, safeExec } from '../helpers/runtime.js';

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
    env: { HOME: join(env.root, 'home'), C3D_MCP_DIR: env.config.mcpDir, C3D_CHEETAH_SUPPORT_DIR: env.config.cheetahSupportDir, C3D_MCP_LOG_DIR: env.config.logDir, ...opts.envVars },
    confirm: (q) => { cap.asked.push(q); return Promise.resolve(opts.answer ?? true); },
    runtime: (config) => createRuntime(config, { exec: safeExec, trigger: app.trigger, probe: app.probe, helper: noHelper, logger: createLogger({ write: () => undefined }), expectedRuntimeMajor: 1 }),
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

  it('has no setup wizard any more; help lists the app-driven commands', async () => {
    const c = harness();
    expect(await main(['setup'], c.io)).toBe(2);
    const help = harness();
    await main(['--help'], help.io);
    for (const word of ['clients', 'legacy', 'permissions', 'status', 'doctor']) expect(help.out).toContain(word);
    expect(help.out).not.toContain('Guided setup');
  });
});

describe('cli lifecycle: status, install modes, uninstall scopes', () => {
  const home = (): string => join(env?.root ?? '', 'home');
  const prepare = (extra: { tty?: boolean; answer?: boolean } = {}): Cap => {
    const c = harness({ ...extra, envVars: {} });
    mkdirSync(join(env?.paths.scriptsDir ?? '', 'Macro'), { recursive: true });
    mkdirSync(home(), { recursive: true });
    c.io.env = { ...c.io.env, HOME: home() };
    return c;
  };
  const run = async (c: Cap, args: string[]): Promise<{ code: number; out: string }> => {
    c.out = '';
    const code = await main(args, c.io);
    return { code, out: c.out };
  };

  it('status: fresh, then current after install; --json carries the state and the recommendation', async () => {
    const c = prepare();
    const fresh = await run(c, ['status']);
    expect(fresh.code).toBe(0);
    expect(fresh.out).toMatch(/Detected: fresh install/);
    expect(fresh.out).toMatch(/c3d-mcp install/);
    expect(await main(['install'], c.io)).toBe(0);
    const json = await run(c, ['status', '--json']);
    const state = JSON.parse(json.out) as { kind: string; recommended: string; components: { name: string; status: string }[] };
    expect(state.kind).toBe('current');
    expect(state.recommended).toBe('none');
    expect(state.components.find((x) => x.name === 'runtime')?.status).toBe('ok');
    expect((await run(c, ['status'])).out).toMatch(/Detected: current/);
  });

  it('install --dry-run prints what it found and what it would do, and changes nothing', async () => {
    const c = prepare();
    const r = await run(c, ['install', '--dry-run']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Detected: fresh install/);
    expect(r.out).toMatch(/create runtime/);
    expect(r.out).toMatch(/dry run/i);
    expect((await run(c, ['status', '--json'])).out).toMatch(/"kind": "fresh"/);
  });

  it('install --repair and --reinstall: repair fixes a broken install, reinstall rewrites it; both say what they detected', async () => {
    const c = prepare();
    await main(['install'], c.io);
    rmSync(env?.paths.runtimeFile ?? '');
    expect((await run(c, ['status'])).out).toMatch(/Detected: partial install/);
    const repair = await run(c, ['install', '--repair']);
    expect(repair.code).toBe(0);
    expect(repair.out).toMatch(/Detected: partial/);
    expect((await run(c, ['status', '--json'])).out).toMatch(/"kind": "current"/);
    const re = await run(c, ['install', '--reinstall', '--json']);
    expect(JSON.parse(re.out)).toMatchObject({ ok: true, mode: 'reinstall' });
  });

  it('install --skip-ping never pings the bridge (needed for sandboxed installs that must not touch the running app)', async () => {
    const c = prepare();
    const r = await run(c, ['install', '--skip-ping', '--json']);
    expect(r.code).toBe(0);
    const ping = (JSON.parse(r.out) as { steps: { name: string; status: string }[] }).steps.find((x) => x.name === 'ping');
    expect(ping?.status).toBe('skipped');
  });

  it('install rejects --repair together with --reinstall', async () => {
    const c = prepare();
    expect(await main(['install', '--repair', '--reinstall'], c.io)).toBe(2);
    expect(c.err).toMatch(/repair.*reinstall|reinstall.*repair/);
  });

  it('uninstall --dry-run lists what would be removed and removes nothing; --all names skills and client configs', async () => {
    const c = prepare();
    await main(['install'], c.io);
    const dry = await run(c, ['uninstall', '--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(/would remove/i);
    expect(dry.out).toContain(env?.paths.macroFile ?? '?');
    expect((await run(c, ['status', '--json'])).out).toMatch(/"kind": "current"/);
    const all = await run(c, ['uninstall', '--all', '--dry-run', '--json']);
    const report = JSON.parse(all.out) as { dryRun: boolean; clients: unknown[]; skills: unknown[] };
    expect(report.dryRun).toBe(true);
    expect(Array.isArray(report.clients)).toBe(true);
    expect(Array.isArray(report.skills)).toBe(true);
  });

  it('uninstall on a TTY lists the plan and asks once; --yes needs no question; refusing changes nothing', async () => {
    const no = prepare({ tty: true, answer: false });
    await main(['install'], no.io);
    const refused = await run(no, ['uninstall']);
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/Aborted/);
    expect(refused.out).toContain(env?.paths.macroFile ?? '?');
    expect(no.asked).toHaveLength(1);
    expect((await run(no, ['status', '--json'])).out).toMatch(/"kind": "current"/);
    const yes = await run(no, ['uninstall', '--yes']);
    expect(yes.code).toBe(0);
    expect(no.asked).toHaveLength(1);
    expect((await run(no, ['status', '--json'])).out).toMatch(/"kind": "fresh"/);
  });

  it('help documents the lifecycle commands and flags', async () => {
    const c = prepare();
    const help = await run(c, ['--help']);
    for (const word of ['status', '--repair', '--reinstall', '--all', '--dry-run']) expect(help.out).toContain(word);
  });

  it('legacy scan / remove: JSON output, --ids selection, confirmation required, files go to the Trash', async () => {
    const c = harness({ envVars: { C3D_MCP_SYSTEM_ROOT: '' } });
    const home = join(env!.root, 'home');
    const sysRoot = join(env!.root, 'sys');
    mkdirSync(sysRoot, { recursive: true });
    c.io.env = { ...c.io.env, C3D_MCP_SYSTEM_ROOT: sysRoot };
    mkdirSync(join(home, '.c3d-mcp', 'app', 'node_modules', 'c3d-mcp'), { recursive: true });
    writeFileSync(join(home, '.c3d-mcp', 'app', 'node_modules', 'c3d-mcp', 'package.json'), '{"name":"c3d-mcp"}');
    expect(await main(['legacy', 'scan', '--json'], c.io)).toBe(0);
    const found = JSON.parse(c.out) as { id: string; kind: string }[];
    const mine = found.find((f) => f.kind === 'install-sh');
    expect(mine).toBeDefined();

    const n = harness();
    n.io.env = c.io.env;
    expect(await main(['legacy', 'remove', '--ids', mine?.id ?? '', '--json'], n.io)).toBe(2); // not confirmed
    expect(existsSync(join(home, '.c3d-mcp'))).toBe(true);

    const y = harness();
    y.io.env = c.io.env;
    expect(await main(['legacy', 'remove', '--ids', mine?.id ?? '', '--yes', '--json'], y.io)).toBe(0);
    const out = JSON.parse(y.out) as { results: { status: string }[]; report: string };
    expect(out.results.map((r) => r.status)).toEqual(['removed']);
    expect(existsSync(join(home, '.c3d-mcp'))).toBe(false);
    expect(existsSync(join(home, '.Trash', 'app'))).toBe(true);
    expect(existsSync(out.report)).toBe(true);
  });

  it('clients add / list / remove drive the client configs with the absolute launch form', async () => {
    const c = harness();
    const home = join(env!.root, 'home');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    c.io.env = { ...c.io.env, PATH: '/nonexistent' };
    const run = async (...args: string[]): Promise<{ code: number; out: string }> => {
      const h = harness();
      h.io.env = c.io.env;
      const code = await main(['clients', ...args, '--json'], h.io);
      return { code, out: h.out };
    };
    expect((await run('add', 'cursor', '--node-path', '/N/node', '--bin-path', '/A/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js', '--yes')).code).toBe(0);
    const cfg = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')) as { mcpServers: { c3d: { command: string; args: string[] } } };
    expect(cfg.mcpServers.c3d).toEqual({ command: '/N/node', args: ['/A/C3D MCP.app/Contents/Resources/server/bin/c3d-mcp.js', 'serve'] });
    const listed = JSON.parse((await run('list', '--keep-path', '/A/C3D MCP.app')).out) as { client: string; state: string }[];
    expect(listed.find((r) => r.client === 'cursor')?.state).toBe('current');
    const legacy = JSON.parse((await run('list')).out) as { client: string; state: string }[];
    expect(legacy.find((r) => r.client === 'cursor')?.state).toBe('legacy');
    expect((await run('remove', 'cursor')).code).toBe(0);
    expect(JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')).mcpServers).toEqual({});
    expect((await run('add', 'nope')).code).toBe(2);
  });
});
