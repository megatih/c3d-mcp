import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Executor } from '../../src/core/platform.js';
import { runSetup, type SetupDeps, type SetupOptions } from '../../src/core/setup.js';
import type { OpenPaneResult } from '../../src/core/settingsPanes.js';
import type { SkillsOptions } from '../../src/core/skillsInstall.js';
import { makeHarness, type Harness } from '../helpers/runtime.js';

let h: Harness | undefined;
let home: string | undefined;
afterEach(() => {
  if (h) rmSync(h.env.root, { recursive: true, force: true });
  if (home) rmSync(home, { recursive: true, force: true });
  h = undefined;
  home = undefined;
});

interface Rig { deps: SetupDeps; out: string[]; asked: string[]; opened: string[]; revealed: string[]; sleeps: number[]; skillCalls: SkillsOptions[]; smokeCalls: number; permCalls: number; home: string; h: Harness }

/** Everything injected: fake helper (permissions granted after `grantAfter` polls), fake exec, fake panes. */
function rig(o: { grantAfter?: number; helper?: boolean; detect?: string[]; answer?: boolean } = {}): Rig {
  home = mkdtempSync(join(tmpdir(), 'c3d-setup-home-'));
  const r = { out: [] as string[], asked: [] as string[], opened: [] as string[], revealed: [] as string[], sleeps: [] as number[], skillCalls: [] as SkillsOptions[], smokeCalls: 0, permCalls: 0 };
  const hasHelper = o.helper ?? true;
  const helper = {
    available: () => hasHelper,
    installedApp: () => (hasHelper ? '/tmp/C3D Bridge Helper.app' : undefined),
    call: <T,>(cmd: string): Promise<T> => {
      if (cmd === 'permissions') {
        r.permCalls++;
        const granted = o.grantAfter !== undefined && r.permCalls > o.grantAfter;
        return Promise.resolve({ accessibility: granted, screenRecording: false } as T);
      }
      return Promise.resolve({ version: '1.0.0', pid: 1 } as T);
    },
  };
  h = makeHarness({ helper }, { seed: false });
  const detect = new Set(o.detect ?? []);
  const exec: Executor = (cmd, args) => {
    if (cmd === '/bin/sh') {
      const bin = /command -v (\w+)/.exec(args[1] ?? '')?.[1] ?? '';
      return Promise.resolve(detect.has(bin) ? { code: 0, stdout: `/bin/${bin}\n`, stderr: '' } : { code: 1, stdout: '', stderr: '' });
    }
    if (cmd === 'claude') return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    // Only the install's Scripts/ backup runs for real (tar on temp dirs); everything else is answered here.
    return cmd === 'tar' ? h!.rt.exec(cmd, args) : Promise.resolve({ code: 1, stdout: '', stderr: '' });
  };
  const rt = { ...h.rt, exec };
  const deps: SetupDeps = {
    rt,
    out: (t) => r.out.push(t),
    confirm: (q, d) => { r.asked.push(q); return Promise.resolve(o.answer ?? d); },
    home,
    macosVersion: () => Promise.resolve('27.2'),
    arch: 'arm64',
    nodeVersion: '22.5.0',
    exists: (p) => p.startsWith('/Applications') || existsSync(p),
    installHelper: () => Promise.resolve(undefined),
    open: (u) => { r.opened.push(u); return Promise.resolve(); },
    reveal: (p) => { r.revealed.push(p); return Promise.resolve(); },
    frontWindowTitle: () => Promise.resolve('Accessibility'),
    sleep: (ms) => { r.sleeps.push(ms); return Promise.resolve(); },
    paneSettleMs: 0,
    skills: (s) => { r.skillCalls.push(s); return []; },
    smoke: () => { r.smokeCalls++; return Promise.resolve({ status: 'ok', detail: 'fake render' }); },
    now: () => new Date('2026-01-02T03:04:05Z'),
  };
  return Object.assign(r, { deps, home, h });
}

const run = (r: Rig, opts: SetupOptions) => runSetup(opts, r.deps);

describe('runSetup', () => {
  it('dry run changes nothing and skips the smoke test', async () => {
    const r = rig({ detect: ['claude', 'codex'] });
    mkdirSync(join(r.home, '.cursor'));
    const rep = await run(r, { yes: true, dryRun: true, clients: 'all', skills: true });
    expect(rep.dryRun).toBe(true);
    expect(existsSync(r.h.env.paths.root)).toBe(false);
    expect(existsSync(join(r.home, '.cursor', 'mcp.json'))).toBe(false);
    expect(rep.clients.filter((c) => c.selected).map((c) => c.result?.status)).toEqual(['would-add', 'would-add', 'would-add']);
    expect(r.smokeCalls).toBe(0);
    expect(r.opened).toHaveLength(0);
    expect(rep.smoke.status).toBe('skipped');
    expect(r.skillCalls[0]).toMatchObject({ dryRun: true, targets: ['claude', 'codex'] });
    expect(rep.ok).toBe(true);
  });

  it('says what it detected and lists the dry-run plan from the installer', async () => {
    const r = rig({});
    const rep = await run(r, { yes: true, dryRun: true, clients: 'none', skills: false });
    expect(r.out.join('')).toMatch(/Detected: fresh install/);
    expect(rep.steps.some((s) => s.name === 'install' && /would create runtime/.test(s.detail))).toBe(true);
    expect(existsSync(r.h.env.paths.root)).toBe(false);
  });

  it('passes the install mode through and reports the detected state before installing', async () => {
    const r = rig({ grantAfter: 0 });
    await run(r, { yes: true, clients: 'none', skills: false, mode: 'auto' });
    expect(r.out.join('')).toMatch(/Detected: fresh install/);
    r.out.length = 0;
    const rep = await run(r, { yes: true, clients: 'none', skills: false, mode: 'repair' });
    // everything is installed now; the rig's fake helper app cannot pass the code-signature check, so that is the only finding
    expect(r.out.join('')).toMatch(/Detected: partial install \(helper corrupt\)/);
    expect(rep.steps.filter((x) => x.status === 'fail')).toEqual([]);
    expect(rep.ok).toBe(true);
  });

  it('reports requirements with detected clients', async () => {
    const r = rig({ detect: ['agy'] });
    mkdirSync(join(r.home, 'Library', 'Application Support', 'Claude'), { recursive: true });
    const rep = await run(r, { yes: true, dryRun: true, clients: 'none', skills: false });
    expect(rep.requirements.macos).toEqual({ version: '27.2', major: 27, arch: 'arm64' });
    const row = (n: string) => rep.requirements.rows.find((x) => x.name === n);
    expect(row('Claude Desktop')?.status).toBe('ok');
    expect(row('Antigravity CLI')?.status).toBe('ok');
    expect(row('Cursor')?.status).toBe('missing');
    expect(row('Node.js')?.status).toBe('ok');
    expect(rep.skills.detail).toContain('--no-skills');
  });

  it('fails early on an old Node.js', async () => {
    const r = rig();
    r.deps.nodeVersion = '20.1.0';
    const rep = await run(r, { yes: true });
    expect(rep.ok).toBe(false);
    expect(rep.requirements.node.ok).toBe(false);
    expect(existsSync(r.h.env.paths.root)).toBe(false);
  });

  it('--yes installs, grants, configures detected clients, installs skills and smoke-tests', async () => {
    const r = rig({ detect: ['codex'], grantAfter: 0 });
    mkdirSync(join(r.home, '.cursor'));
    writeFileSync(join(r.home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { c3d: { command: 'mine' } } }));
    const rep = await run(r, { yes: true, clients: undefined, skills: true });
    expect(existsSync(r.h.env.paths.macroFile)).toBe(true);
    expect(rep.clients.find((c) => c.client === 'codex')?.result?.status).toBe('added');
    expect(readFileSync(join(r.home, '.codex', 'config.toml'), 'utf8')).toContain('[mcp_servers.c3d]');
    expect(rep.clients.find((c) => c.client === 'cursor')?.result?.status).toBe('exists');
    expect(JSON.parse(readFileSync(join(r.home, '.cursor', 'mcp.json'), 'utf8')).mcpServers.c3d.command).toBe('mine');
    expect(r.skillCalls[0]?.targets).toEqual(['codex']);
    expect(r.asked).toHaveLength(0);
    expect(r.smokeCalls).toBe(1);
    expect(rep.steps.find((s) => s.name === 'Accessibility')?.status).toBe('unchanged');
    expect(rep.doctor).toBeDefined();
    expect(rep.smoke.status).toBe('ok');
  });

  it('opens the pane, reveals the helper and polls until Accessibility is granted', async () => {
    const r = rig({ grantAfter: 5 });
    const rep = await run(r, { yes: true, clients: 'none', skills: false });
    expect(r.opened[0]).toContain('x-apple.systempreferences:');
    expect(r.revealed).toEqual(['/tmp/C3D Bridge Helper.app']);
    expect(r.sleeps.filter((s) => s === 2000).length).toBeGreaterThanOrEqual(2);
    expect(rep.steps.find((s) => s.name === 'Accessibility')?.status).toBe('done');
  });

  it('gives up after the timeout with a manual path hint and never kills anything', async () => {
    const r = rig({});
    r.deps.openPaneFn = () => Promise.resolve<OpenPaneResult>({ ok: false, pane: 'accessibility', verified: false, manualPath: 'System Settings > Privacy & Security > Accessibility', tried: [] });
    const rep = await run(r, { yes: true, clients: 'none', skills: false, permissionTimeoutSec: 4 });
    expect(rep.steps.find((s) => s.name === 'Accessibility')?.status).toBe('warn');
    expect(rep.hints.join('\n')).toContain('System Settings > Privacy & Security > Accessibility');
    expect(rep.ok).toBe(false);
  });

  it('skips the permission step without a helper', async () => {
    const r = rig({ helper: false });
    const rep = await run(r, { yes: true, clients: 'none', skills: false });
    expect(rep.steps.find((s) => s.name === 'permissions')?.status).toBe('warn');
    expect(r.opened).toHaveLength(0);
  });

  it('interactive mode asks per detected client and honours refusals', async () => {
    const r = rig({ detect: ['claude'], grantAfter: 0, answer: false });
    mkdirSync(join(r.home, '.cursor'));
    const rep = await run(r, { clients: undefined, skills: true });
    expect(r.asked.some((q) => q.includes('Cursor'))).toBe(true);
    expect(rep.clients.every((c) => !c.selected)).toBe(true);
    expect(existsSync(join(r.home, '.cursor', 'mcp.json'))).toBe(false);
    expect(r.skillCalls).toHaveLength(0);
  });

  it('pins the node path in client configs', async () => {
    const r = rig({ grantAfter: 0 });
    mkdirSync(join(r.home, '.cursor'));
    r.deps.binPath = '/pkg/bin/c3d-mcp.js';
    await run(r, { yes: true, clients: ['cursor'], skills: false, nodePath: '/opt/node/bin/node' });
    expect(JSON.parse(readFileSync(join(r.home, '.cursor', 'mcp.json'), 'utf8')).mcpServers.c3d).toMatchObject({ command: '/opt/node/bin/node', args: ['/pkg/bin/c3d-mcp.js', 'serve'] });
  });

  it('a failing smoke test makes the run fail and surfaces the hint', async () => {
    const r = rig({ grantAfter: 0 });
    r.deps.smoke = () => Promise.resolve({ status: 'fail', detail: 'boom', hint: 'Restart Cheetah3D.' });
    const rep = await run(r, { yes: true, clients: 'none', skills: false });
    expect(rep.ok).toBe(false);
    expect(rep.hints.join('\n')).toContain('Restart Cheetah3D.');
  });
});
