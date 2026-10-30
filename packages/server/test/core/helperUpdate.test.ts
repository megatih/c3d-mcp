import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateHelper } from '../../src/core/helperUpdate.js';
import { readAppVersion } from '../../src/core/helperInstall.js';
import type { Executor } from '../../src/core/platform.js';
import { makeHarness, safeExec, type Harness } from '../helpers/runtime.js';

let h: Harness;
let dir: string;
let appDir: string; // the installed helper
let source: string; // the bundled helper
let running: { version: string; pid: number } | undefined;
const log: string[] = [];
let signed: (path: string) => boolean;
let identity: (path: string) => string; // text printed by `codesign -dvv`
let stopWorks = true;
let startedVersionOverride: string | undefined;

const plist = (v: string): string => `<?xml version="1.0"?><plist><dict><key>CFBundleShortVersionString</key><string>${v}</string></dict></plist>`;
function makeApp(path: string, version: string, tag: string): void {
  mkdirSync(join(path, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(path, 'Contents', 'Info.plist'), plist(version));
  writeFileSync(join(path, 'Contents', 'MacOS', 'C3DBridgeHelper'), tag);
}

const exec: Executor = (cmd, args, o) => {
  log.push(`${cmd} ${args.join(' ')}`.slice(0, 160));
  if (cmd === 'codesign') {
    const path = args[args.length - 1] as string;
    if (args[0] === '--verify') return Promise.resolve({ code: signed(path) ? 0 : 1, stdout: '', stderr: '' });
    return Promise.resolve({ code: 0, stdout: '', stderr: identity(path) });
  }
  if (cmd === 'pgrep') return Promise.resolve(running ? { code: 0, stdout: `${running.pid}\n`, stderr: '' } : { code: 1, stdout: '', stderr: '' });
  if (cmd === 'kill') { if (stopWorks) running = undefined; return Promise.resolve({ code: 0, stdout: '', stderr: '' }); }
  if (cmd === 'open') {
    const app = args[args.indexOf('-a') + 1] as string;
    const isNew = readFileSync(join(app, 'Contents', 'MacOS', 'C3DBridgeHelper'), 'utf8') === 'new';
    running = { version: (isNew ? startedVersionOverride : undefined) ?? readAppVersion(app) ?? '?', pid: 5000 + log.length };
    return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  }
  return safeExec(cmd, args, o);
};

function setup(installedVersion: string | undefined, bundledVersion: string): void {
  dir = mkdtempSync(join(tmpdir(), 'c3d-hu-'));
  appDir = join(dir, 'mcp', 'helper', 'C3D Bridge Helper.app');
  source = join(dir, 'bundle', 'C3D Bridge Helper.app');
  makeApp(source, bundledVersion, 'new');
  if (installedVersion) { makeApp(appDir, installedVersion, 'old'); running = { version: installedVersion, pid: 4242 }; }
  h = makeHarness({
    exec,
    helper: {
      available: () => true,
      installedApp: () => (existsSync(appDir) ? appDir : undefined),
      call: (cmd: string) => (cmd === 'ping' && running ? Promise.resolve({ version: running.version, pid: running.pid } as never) : Promise.reject(new Error('helper not running'))),
    },
  }, { seed: false });
  mkdirSync(h.env.paths.root, { recursive: true });
  writeFileSync(h.env.paths.helperSock, '');
}

beforeEach(() => { log.length = 0; running = undefined; signed = () => true; identity = () => 'Signature=adhoc\n'; stopWorks = true; startedVersionOverride = undefined; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(h.env.root, { recursive: true, force: true }); });
const opts = (): Parameters<typeof updateHelper>[1] => ({ sources: { app: [source], zip: [] }, destApp: appDir, backupsDir: join(dir, 'backups'), settleMs: 1, now: () => new Date('2026-10-30T10:00:00Z') });

describe('updateHelper', () => {
  it('replaces an older helper: stage, back up, stop the old process, swap, start and verify the new one', async () => {
    setup('0.3.1', '0.3.2');
    const r = await updateHelper(h.rt, opts());
    expect(r.action).toBe('updated');
    expect(r.from).toBe('0.3.1');
    expect(r.to).toBe('0.3.2');
    expect(readAppVersion(appDir)).toBe('0.3.2');
    expect(running?.version).toBe('0.3.2');
    // the previous version is kept as a backup outside the mailbox
    const backups = readdirSync(join(dir, 'backups'));
    expect(backups).toHaveLength(1);
    expect(readAppVersion(join(dir, 'backups', backups[0] as string, 'C3D Bridge Helper.app'))).toBe('0.3.1');
    // nothing left behind next to the helper
    expect(readdirSync(join(dir, 'mcp', 'helper'))).toEqual(['C3D Bridge Helper.app']);
    expect(existsSync(h.env.paths.helperSock)).toBe(false);
    // staging was verified before the old process was stopped
    const verifyAt = log.findIndex((l) => l.startsWith('codesign --verify') && l.includes('.staging'));
    const killAt = log.findIndex((l) => l.startsWith('kill'));
    expect(verifyAt).toBeGreaterThanOrEqual(0);
    expect(killAt).toBeGreaterThan(verifyAt);
  });

  it('leaves a current helper alone unless forced', async () => {
    setup('0.3.2', '0.3.2');
    expect((await updateHelper(h.rt, opts())).action).toBe('unchanged');
    expect(log.some((l) => l.startsWith('kill'))).toBe(false);
    const forced = await updateHelper(h.rt, { ...opts(), force: true });
    expect(forced.action).toBe('updated');
    expect(readFileSync(join(appDir, 'Contents', 'MacOS', 'C3DBridgeHelper'), 'utf8')).toBe('new');
  });

  it('repairs a helper that fails the signature check even when the version matches', async () => {
    setup('0.3.2', '0.3.2');
    signed = (p) => !p.startsWith(appDir);
    const r = await updateHelper(h.rt, opts());
    expect(r.action).toBe('repaired');
    expect(readFileSync(join(appDir, 'Contents', 'MacOS', 'C3DBridgeHelper'), 'utf8')).toBe('new');
  });

  it('refuses a bundled helper that fails verification and touches nothing (old helper keeps running)', async () => {
    setup('0.3.1', '0.3.2');
    signed = (p) => !p.includes('.staging');
    const r = await updateHelper(h.rt, opts());
    expect(r.action).toBe('failed');
    expect(r.detail).toMatch(/signature|verif/i);
    expect(readAppVersion(appDir)).toBe('0.3.1');
    expect(running?.version).toBe('0.3.1');
    expect(log.some((l) => l.startsWith('kill'))).toBe(false);
    expect(readdirSync(join(dir, 'mcp', 'helper'))).toEqual(['C3D Bridge Helper.app']);
  });

  it('rolls back when the new helper does not come up with the expected version', async () => {
    setup('0.3.1', '0.3.2');
    startedVersionOverride = '0.0.9';
    const r = await updateHelper(h.rt, { ...opts(), startTimeoutMs: 50 });
    expect(r.action).toBe('rolled-back');
    expect(readAppVersion(appDir)).toBe('0.3.1');
    expect(readFileSync(join(appDir, 'Contents', 'MacOS', 'C3DBridgeHelper'), 'utf8')).toBe('old');
    expect(running?.version).toBe('0.3.1');
    expect(readdirSync(join(dir, 'mcp', 'helper'))).toEqual(['C3D Bridge Helper.app']);
  });

  it('does not swap anything when the old helper cannot be stopped', async () => {
    setup('0.3.1', '0.3.2');
    stopWorks = false;
    const r = await updateHelper(h.rt, { ...opts(), stopTimeoutMs: 30 });
    expect(r.action).toBe('failed');
    expect(r.detail).toMatch(/stop/i);
    expect(readAppVersion(appDir)).toBe('0.3.1');
  });

  it('says permissions are kept when old and new are signed by the same identity, and must be granted again otherwise', async () => {
    setup('0.3.1', '0.3.2');
    identity = () => 'Authority=Apple Development: Someone (ABC123)\nTeamIdentifier=TEAM1\n';
    expect((await updateHelper(h.rt, opts())).permissions).toBe('kept');
    rmSync(dir, { recursive: true, force: true });
    rmSync(h.env.root, { recursive: true, force: true });
    setup('0.3.1', '0.3.2');
    identity = () => 'Signature=adhoc\n';
    const r = await updateHelper(h.rt, opts());
    expect(r.permissions).toBe('regrant');
    expect(r.detail).toMatch(/Accessibility/);
  });

  it('installs a missing helper without stopping anything', async () => {
    setup(undefined, '0.3.2');
    const r = await updateHelper(h.rt, opts());
    expect(r.action).toBe('installed');
    expect(readAppVersion(appDir)).toBe('0.3.2');
    expect(log.some((l) => l.startsWith('kill'))).toBe(false);
    expect(r.permissions).toBe('regrant');
  });

  it('updates the managed helper in the mailbox directory even when another app (a C3D_HELPER_APP override) is listed first', async () => {
    setup('0.3.1', '0.3.2');
    const managed = join(h.env.paths.root, 'helper', 'C3D Bridge Helper.app');
    makeApp(managed, '0.3.1', 'old');
    rmSync(join(dir, 'mcp'), { recursive: true, force: true });
    const override = join(dir, 'override', 'C3D Bridge Helper.app');
    makeApp(override, '0.3.2', 'override');
    const rt = { ...h.rt, helper: { ...h.rt.helper, installedApp: () => override } };
    const r = await updateHelper(rt, { sources: { app: [source], zip: [] }, backupsDir: join(dir, 'backups'), settleMs: 1, now: () => new Date('2026-10-30T10:00:00Z') });
    expect(r.action).toBe('updated');
    expect(r.path).toBe(managed);
    expect(readAppVersion(managed)).toBe('0.3.2');
    expect(readFileSync(join(override, 'Contents', 'MacOS', 'C3DBridgeHelper'), 'utf8')).toBe('override'); // the override is never touched
  });

  it('skips a helper that lives elsewhere (cask) when there is no managed one', async () => {
    setup(undefined, '0.3.2');
    const cask = join(dir, 'Applications', 'C3D Bridge Helper.app');
    makeApp(cask, '0.3.1', 'cask');
    const rt = { ...h.rt, helper: { ...h.rt.helper, installedApp: () => cask } };
    const r = await updateHelper(rt, { sources: { app: [source], zip: [] }, backupsDir: join(dir, 'backups'), settleMs: 1 });
    expect(r.action).toBe('skipped');
    expect(r.detail).toMatch(/brew upgrade/);
    expect(readAppVersion(cask)).toBe('0.3.1');
  });

  it('reports when no helper is bundled', async () => {
    setup('0.3.1', '0.3.2');
    const r = await updateHelper(h.rt, { ...opts(), sources: { app: [], zip: [] } });
    expect(r.action).toBe('skipped');
    expect(readAppVersion(appDir)).toBe('0.3.1');
  });
});
