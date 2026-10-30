import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETUP_CLIENTS, clientConfigPath, configureClient } from '../../src/core/clientConfigs.js';
import { install, uninstall } from '../../src/core/install.js';
import { SKILL_MARKER } from '../../src/core/skillsInstall.js';
import type { Executor } from '../../src/core/platform.js';
import { makeHarness, safeExec, type Harness } from '../helpers/runtime.js';

let h: Harness;
let home: string;
const log: string[] = [];
let helperRunning = false;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'c3d-un-')); log.length = 0; helperRunning = false; });
afterEach(() => { rmSync(h.env.root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });

const TEMPLATE = '// c3d-mcp bridge loader {{VERSION}}\nvar RUNTIME = "{{RUNTIME_PATH}}";\nvar MCP = "{{MCP_DIR}}";\n';
const runtimeSrc = '/* c3d-mcp runtime 1.0.1 */\nvar RUNTIME_VERSION = "1.0.1";\n';
const exec: Executor = (cmd, args, o) => {
  log.push(`${cmd} ${args.join(' ')}`);
  if (cmd === 'pgrep') return Promise.resolve(helperRunning ? { code: 0, stdout: '4242\n', stderr: '' } : { code: 1, stdout: '', stderr: '' });
  if (cmd === 'kill') { helperRunning = false; return Promise.resolve({ code: 0, stdout: '', stderr: '' }); }
  if (cmd === 'launchctl') return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  // NEVER reach the real claude CLI from a test: it would read and change the developer's real MCP registrations.
  if (cmd === 'claude') return Promise.resolve({ code: 127, stdout: '', stderr: 'claude: faked out in tests' });
  return safeExec(cmd, args, o);
};

function fresh(over: Parameters<typeof makeHarness>[0] = {}): Harness {
  const hh = makeHarness({ exec, ...over }, { seed: false });
  writeFileSync(join(hh.env.paths.scriptsDir, 'MyUserMacro.js'), '// the user script');
  writeFileSync(join(hh.env.root, 'rt.js'), runtimeSrc);
  writeFileSync(join(hh.env.root, 'm.tpl'), TEMPLATE);
  return hh;
}
const doInstall = (hh: Harness): ReturnType<typeof install> => install(hh.rt, { runtimeSource: join(hh.env.root, 'rt.js'), templateSource: join(hh.env.root, 'm.tpl'), installHelper: false, skipPing: true });
const app = (hh: Harness): string => join(hh.env.paths.root, 'helper', 'C3D Bridge Helper.app');
const plant = (hh: Harness): void => {
  mkdirSync(join(app(hh), 'Contents'), { recursive: true });
  writeFileSync(join(app(hh), 'Contents', 'Info.plist'), '<key>CFBundleIdentifier</key><string>dev.c3dmcp.helper</string>');
};
const agent = (): string => join(home, 'Library', 'LaunchAgents', 'dev.c3dmcp.helper.plist');

describe('uninstall: dry run, helper process, LaunchAgent', () => {
  it('dry run lists what would be removed and changes nothing', async () => {
    h = fresh();
    await doInstall(h);
    const r = await uninstall(h.rt, { dryRun: true, home });
    expect(r.dryRun).toBe(true);
    expect(r.removed).toEqual(expect.arrayContaining([h.env.paths.macroFile, h.env.paths.runtimeFile]));
    expect(existsSync(h.env.paths.macroFile)).toBe(true);
    expect(existsSync(h.env.paths.runtimeFile)).toBe(true);
    expect(existsSync(h.env.paths.manifest)).toBe(true);
  });

  it('stops the running helper before removing its app, and removes the socket', async () => {
    h = makeHarness({ exec, helper: { available: () => true, call: () => Promise.reject(new Error('x')), installedApp: () => app(h) } }, { seed: false });
    writeFileSync(join(h.env.paths.scriptsDir, 'MyUserMacro.js'), '// u');
    writeFileSync(join(h.env.root, 'rt.js'), runtimeSrc);
    writeFileSync(join(h.env.root, 'm.tpl'), TEMPLATE);
    plant(h);
    await install(h.rt, { runtimeSource: join(h.env.root, 'rt.js'), templateSource: join(h.env.root, 'm.tpl'), installHelper: false, skipPing: true });
    // record the helper in the manifest the way a real install that put it there does
    const manifest = JSON.parse(readFileSync(h.env.paths.manifest, 'utf8'));
    writeFileSync(h.env.paths.manifest, JSON.stringify({ ...manifest, helper: { path: app(h), installedByUs: true } }));
    writeFileSync(h.env.paths.helperSock, '');
    helperRunning = true;
    const r = await uninstall(h.rt, { home, settleMs: 1 });
    expect(r.helperStopped).toBe(true);
    expect(log.findIndex((l) => l.startsWith('kill'))).toBeGreaterThanOrEqual(0);
    expect(existsSync(app(h))).toBe(false);
    expect(existsSync(h.env.paths.helperSock)).toBe(false);
    expect(existsSync(h.env.paths.macroFile)).toBe(false);
  });

  it('unloads and removes our LaunchAgent, and leaves a foreign one with the same name alone', async () => {
    h = fresh();
    await doInstall(h);
    mkdirSync(dirname(agent()), { recursive: true });
    writeFileSync(agent(), `<plist><key>Label</key><string>dev.c3dmcp.helper</string><string>${app(h)}/Contents/MacOS/C3DBridgeHelper</string></plist>`);
    const r = await uninstall(h.rt, { home });
    expect(r.launchAgent).toBe('removed');
    expect(existsSync(agent())).toBe(false);
    expect(log.some((l) => l.startsWith('launchctl bootout'))).toBe(true);

    rmSync(h.env.root, { recursive: true, force: true });
    h = fresh();
    await doInstall(h);
    mkdirSync(dirname(agent()), { recursive: true });
    writeFileSync(agent(), '<plist><key>Label</key><string>dev.c3dmcp.helper</string><string>/Applications/SomethingElse.app/x</string></plist>');
    const r2 = await uninstall(h.rt, { home });
    expect(r2.launchAgent).toBe('foreign');
    expect(existsSync(agent())).toBe(true);
  });

  it('backups and the user\'s scripts are never touched', async () => {
    h = fresh();
    await doInstall(h);
    await uninstall(h.rt, { home, all: true });
    expect(readFileSync(join(h.env.paths.scriptsDir, 'MyUserMacro.js'), 'utf8')).toBe('// the user script');
    expect(readdirSync(h.env.paths.backupsDir).length).toBeGreaterThan(0);
  });
});

describe('uninstall of an adopted or hand-made install', () => {
  it('removes the managed helper app (it carries our bundle id) even when the manifest does not list it, and then the empty mailbox root', async () => {
    h = fresh();
    mkdirSync(h.env.paths.root, { recursive: true }); // pre-existing root: not in the manifest's createdDirs
    await doInstall(h);
    plant(h);
    const m = JSON.parse(readFileSync(h.env.paths.manifest, 'utf8'));
    writeFileSync(h.env.paths.manifest, JSON.stringify({ ...m, helper: undefined }));
    const r = await uninstall(h.rt, { home, settleMs: 1 });
    expect(existsSync(app(h))).toBe(false);
    expect(r.removed).toContain(app(h));
    expect(existsSync(h.env.paths.root)).toBe(false);
  });

  it('keeps the mailbox root when it still holds files that are not ours', async () => {
    h = fresh();
    mkdirSync(h.env.paths.root, { recursive: true });
    writeFileSync(join(h.env.paths.root, 'user-notes.txt'), 'mine');
    await doInstall(h);
    await uninstall(h.rt, { home });
    expect(existsSync(join(h.env.paths.root, 'user-notes.txt'))).toBe(true);
  });
});

describe('uninstall without a manifest (hand-installed or manifest lost)', () => {
  it('removes only files that carry the c3d-mcp markers and keeps everything else', async () => {
    h = fresh();
    await doInstall(h);
    rmSync(h.env.paths.manifest);
    writeFileSync(join(h.env.paths.root, 'user-notes.txt'), 'mine');
    writeFileSync(join(h.env.paths.macroDir, 'Extra.js'), '// not ours');
    const r = await uninstall(h.rt, { home });
    expect(r.kind).toBe('unmanaged');
    expect(existsSync(h.env.paths.macroFile)).toBe(false);
    expect(existsSync(h.env.paths.runtimeFile)).toBe(false);
    expect(existsSync(h.env.paths.secret)).toBe(false);
    expect(existsSync(join(h.env.paths.macroDir, 'Extra.js'))).toBe(true);
    expect(existsSync(join(h.env.paths.root, 'user-notes.txt'))).toBe(true);
    expect(existsSync(join(h.env.paths.scriptsDir, 'MyUserMacro.js'))).toBe(true);
  });

  it('a macro and runtime without our markers are left alone', async () => {
    h = fresh();
    mkdirSync(h.env.paths.macroDir, { recursive: true });
    writeFileSync(h.env.paths.macroFile, '// somebody else');
    mkdirSync(h.env.paths.runtimeDir, { recursive: true });
    writeFileSync(h.env.paths.runtimeFile, '// not a c3d runtime');
    const r = await uninstall(h.rt, { home });
    expect(r.removed).toEqual([]);
    expect(existsSync(h.env.paths.macroFile)).toBe(true);
    expect(existsSync(h.env.paths.runtimeFile)).toBe(true);
  });

  it('removes our whole mailbox directory when nothing but known c3d-mcp entries is in it', async () => {
    h = fresh();
    await doInstall(h);
    rmSync(h.env.paths.manifest);
    await uninstall(h.rt, { home });
    expect(existsSync(h.env.paths.root)).toBe(false);
  });
});

describe('uninstall of a partial install', () => {
  it('removes what exists without failing on what is missing', async () => {
    h = fresh();
    await doInstall(h);
    rmSync(h.env.paths.runtimeFile);
    rmSync(h.env.paths.secret);
    const r = await uninstall(h.rt, { home });
    expect(r.ok).toBe(true);
    expect(existsSync(h.env.paths.macroFile)).toBe(false);
    expect(existsSync(h.env.paths.root)).toBe(false);
  });
});

describe('uninstall --all', () => {
  it('also removes agent skills and the c3d entries in MCP client configs, and dry run changes neither', async () => {
    h = fresh();
    await doInstall(h);
    const skills = join(home, 'skills-src');
    mkdirSync(join(skills, 'c3d-demo'), { recursive: true });
    writeFileSync(join(skills, 'c3d-demo', 'SKILL.md'), '---\nname: c3d-demo\n---\n');
    const installedSkill = join(home, '.claude', 'skills', 'c3d-demo');
    mkdirSync(installedSkill, { recursive: true });
    writeFileSync(join(installedSkill, SKILL_MARKER), '0.3.2');
    for (const c of SETUP_CLIENTS.filter((x) => x !== 'claude-code')) await configureClient(c, { home });

    const dry = await uninstall(h.rt, { home, all: true, dryRun: true, skillsSource: skills });
    expect(dry.skills?.some((s) => s.status === 'would-remove')).toBe(true);
    expect(dry.clients?.filter((c) => c.status === 'would-remove').length).toBeGreaterThanOrEqual(5);
    expect(existsSync(installedSkill)).toBe(true);
    expect(readFileSync(clientConfigPath('cursor', home) as string, 'utf8')).toMatch(/c3d-mcp/);

    const real = await uninstall(h.rt, { home, all: true, skillsSource: skills });
    expect(real.skills?.some((s) => s.status === 'removed')).toBe(true);
    expect(existsSync(installedSkill)).toBe(false);
    for (const c of SETUP_CLIENTS.filter((x) => x !== 'claude-code')) expect(readFileSync(clientConfigPath(c, home) as string, 'utf8')).not.toMatch(/c3d-mcp/);
    expect(real.clients?.every((c) => c.status !== 'failed')).toBe(true);
  });

  it('without --all neither skills nor client configs are touched', async () => {
    h = fresh();
    await doInstall(h);
    await configureClient('cursor', { home });
    const r = await uninstall(h.rt, { home });
    expect(r.skills).toBeUndefined();
    expect(r.clients).toBeUndefined();
    expect(readFileSync(clientConfigPath('cursor', home) as string, 'utf8')).toMatch(/c3d-mcp/);
  });
});
