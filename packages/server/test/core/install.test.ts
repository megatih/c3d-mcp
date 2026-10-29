import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { install, readManifest, uninstall } from '../../src/core/install.js';
import { makeHarness, type Harness } from '../helpers/runtime.js';

let h: Harness;
afterEach(() => rmSync(h.env.root, { recursive: true, force: true }));

const TEMPLATE = '// C3D-MCP Bridge {{VERSION}}\nvar RUNTIME = "{{RUNTIME_PATH}}";\nvar MCP = "{{MCP_DIR}}";\n';
const runtimeSrc = (v: string): string => `// c3d-mcp runtime v${v}\nvar RUNTIME_VERSION = "${v}";\n`;

function sources(root: string, version = '1.0.0'): { runtimeSource: string; templateSource: string } {
  const runtimeSource = join(root, 'bundled-runtime.js');
  const templateSource = join(root, 'macro.template');
  writeFileSync(runtimeSource, runtimeSrc(version));
  writeFileSync(templateSource, TEMPLATE);
  return { runtimeSource, templateSource };
}

function fresh(): Harness {
  const hh = makeHarness({}, { seed: false });
  writeFileSync(join(hh.env.paths.scriptsDir, 'MyUserMacro.js'), '// the user script');
  return hh;
}

describe('install', () => {
  it('creates the tree, secret, runtime, macro, manifest and a Scripts backup', async () => {
    h = fresh();
    const report = await install(h.rt, { ...sources(h.env.root), skipPing: true });
    expect(report.ok).toBe(true);
    expect(report.changed).toBe(true);
    const p = h.env.paths;
    expect(statSync(p.root).mode & 0o777).toBe(0o700);
    expect(statSync(p.secret).mode & 0o777).toBe(0o600);
    expect(readFileSync(p.runtimeFile, 'utf8')).toBe(runtimeSrc('1.0.0'));
    const macro = readFileSync(p.macroFile, 'utf8');
    expect(macro).toContain(p.runtimeFile);
    expect(macro).toContain(p.root);
    expect(macro).toContain('1.0.0');
    const manifest = await readManifest(h.rt);
    expect(manifest?.createdFiles).toEqual(expect.arrayContaining([p.secret, p.runtimeFile, p.macroFile]));
    expect(manifest?.createdDirs).toEqual(expect.arrayContaining([p.root, p.inbox, p.macroDir]));
    // backup is a real tar of Scripts/ containing the user's script, kept outside the mailbox
    expect(manifest?.backups).toHaveLength(1);
    const listing = execFileSync('tar', ['-tzf', manifest?.backups[0] ?? ''], { encoding: 'utf8' });
    expect(listing).toContain('Scripts/MyUserMacro.js');
    expect(manifest?.backups[0]?.startsWith(p.backupsDir)).toBe(true);
  });

  it('is idempotent: a second run changes nothing and makes no new backup', async () => {
    h = fresh();
    const src = sources(h.env.root);
    await install(h.rt, { ...src, skipPing: true });
    const before = readFileSync(h.env.paths.secret, 'utf8');
    const second = await install(h.rt, { ...src, skipPing: true });
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.steps.find((s) => s.name === 'runtime')?.status).toBe('unchanged');
    expect(second.steps.find((s) => s.name === 'macro')?.status).toBe('unchanged');
    expect(readFileSync(h.env.paths.secret, 'utf8')).toBe(before);
    expect(readdirSync(h.env.paths.backupsDir)).toHaveLength(1);
    expect((await readManifest(h.rt))?.createdFiles).toContain(h.env.paths.macroFile);
  });

  it('upgrades an older runtime (with a new backup) and never clobbers a newer one', async () => {
    h = fresh();
    await install(h.rt, { ...sources(h.env.root, '1.0.0'), skipPing: true });
    const up = await install(h.rt, { ...sources(h.env.root, '1.2.0'), skipPing: true, now: () => new Date(Date.now() + 5000) });
    expect(up.changed).toBe(true);
    expect(readFileSync(h.env.paths.runtimeFile, 'utf8')).toBe(runtimeSrc('1.2.0'));
    expect(readdirSync(h.env.paths.backupsDir)).toHaveLength(2);

    const down = await install(h.rt, { ...sources(h.env.root, '1.1.0'), skipPing: true });
    expect(down.steps.find((s) => s.name === 'runtime')?.status).toBe('skipped');
    expect(readFileSync(h.env.paths.runtimeFile, 'utf8')).toBe(runtimeSrc('1.2.0'));
    expect(readFileSync(h.env.paths.macroFile, 'utf8')).toContain('1.2.0');
  });

  it('fails cleanly (nothing modified) when the Cheetah3D support dir is missing', async () => {
    h = fresh();
    rmSync(h.env.paths.supportDir, { recursive: true, force: true });
    const report = await install(h.rt, sources(h.env.root));
    expect(report.ok).toBe(false);
    expect(existsSync(h.env.paths.root)).toBe(false);
  });

  it('fails when assets are missing', async () => {
    h = fresh();
    const report = await install(h.rt, { runtimeSource: join(h.env.root, 'nope.js'), templateSource: join(h.env.root, 'nope.tpl') });
    expect(report.ok).toBe(false);
    expect(report.steps.at(-1)?.detail).toMatch(/assets are missing/);
    expect(existsSync(h.env.paths.root)).toBe(false);
  });

  it('aborts before modifying anything when the backup fails', async () => {
    h = fresh();
    h.rt.exec = () => Promise.resolve({ code: 2, stdout: '', stderr: 'tar: disk full' });
    const report = await install(h.rt, sources(h.env.root));
    expect(report.ok).toBe(false);
    expect(report.steps.at(-1)?.detail).toMatch(/disk full/);
    expect(existsSync(h.env.paths.macroFile)).toBe(false);
    expect(existsSync(h.env.paths.root)).toBe(false);
  });

  it('says a restart is needed when the menu item is absent, and not when it is present', async () => {
    h = fresh();
    h.app.menu = 'absent';
    const absent = await install(h.rt, { ...sources(h.env.root), skipPing: true });
    expect(absent.restartNeeded).toBe(true);
    expect(absent.guidance.join(' ')).toMatch(/Restart Cheetah3D/);
    h.app.menu = 'present';
    const present = await install(h.rt, { ...sources(h.env.root), skipPing: true });
    expect(present.restartNeeded).toBe(false);
  });

  it('pings through the bridge when the app runs and the menu exists', async () => {
    h = fresh();
    const report = await install(h.rt, sources(h.env.root));
    expect(report.ping).toMatchObject({ ok: true });
    expect(h.app.opLog.map((o) => o.op)).toEqual(['ping']);
  });

  it('skips the ping when Cheetah3D is not running and says so', async () => {
    h = fresh();
    h.app.running = false;
    const report = await install(h.rt, sources(h.env.root));
    expect(report.ping).toBeUndefined();
    expect(report.guidance.join(' ')).toMatch(/not running/);
    expect(report.steps.find((s) => s.name === 'ping')?.status).toBe('skipped');
  });

  it('works in degraded mode without a helper and reports it', async () => {
    h = fresh();
    const report = await install(h.rt, { ...sources(h.env.root), skipPing: true });
    expect(report.helper).toBe('missing');
    expect(report.degraded).toBe(true);
    expect(report.steps.find((s) => s.name === 'helper')?.detail).toMatch(/degraded/);
  });

  it('uses the injected helper installer and records it in the manifest', async () => {
    h = fresh();
    const helperApp = join(h.env.paths.root, 'helper', 'C3D Bridge Helper.app');
    const report = await install(h.rt, {
      ...sources(h.env.root),
      skipPing: true,
      installHelper: (ctx) => {
        mkdirSync(join(ctx.helperDir, 'C3D Bridge Helper.app'), { recursive: true });
        return Promise.resolve({ path: helperApp, installedByUs: true, version: '0.1.0' });
      },
    });
    expect(report.helper).toBe('installed');
    expect((await readManifest(h.rt))?.helper).toEqual({ path: helperApp, installedByUs: true });
  });

  it('a failing helper installer only degrades', async () => {
    h = fresh();
    const report = await install(h.rt, { ...sources(h.env.root), skipPing: true, installHelper: () => Promise.reject(new Error('offline')) });
    expect(report.ok).toBe(true);
    expect(report.steps.some((s) => s.name === 'helper' && s.status === 'warn' && /offline/.test(s.detail))).toBe(true);
  });
});

describe('uninstall', () => {
  it('removes exactly what install created and nothing else', async () => {
    h = fresh();
    const p = h.env.paths;
    writeFileSync(join(p.macroDir.replace('C3D-MCP', ''), 'Other.js'), '// user macro');
    await install(h.rt, { ...sources(h.env.root), skipPing: true });
    writeFileSync(join(p.log, 'runtime.log'), 'runtime-produced leftovers');
    const report = await uninstall(h.rt);
    expect(report.ok).toBe(true);
    expect(existsSync(p.root)).toBe(false);
    expect(existsSync(p.macroFile)).toBe(false);
    expect(existsSync(p.macroDir)).toBe(false);
    expect(existsSync(join(p.scriptsDir, 'MyUserMacro.js'))).toBe(true);
    expect(existsSync(join(p.macroDir.replace('C3D-MCP', ''), 'Other.js'))).toBe(true);
    expect(readdirSync(p.backupsDir)).toHaveLength(1);
    expect(report.notes.join(' ')).toMatch(/Backups kept/);
  });

  it('keeps a macro directory that has other files in it, and a pre-existing MCP dir', async () => {
    h = fresh();
    const p = h.env.paths;
    mkdirSync(p.root, { recursive: true });
    writeFileSync(join(p.root, 'user-notes.txt'), 'mine');
    await install(h.rt, { ...sources(h.env.root), skipPing: true });
    writeFileSync(join(p.macroDir, 'Extra.js'), '// not ours');
    await uninstall(h.rt);
    expect(existsSync(join(p.macroDir, 'Extra.js'))).toBe(true);
    expect(existsSync(p.macroFile)).toBe(false);
    expect(existsSync(join(p.root, 'user-notes.txt'))).toBe(true);
    expect(existsSync(p.secret)).toBe(false);
    expect(existsSync(p.inbox)).toBe(false);
  });

  it('does nothing without a manifest', async () => {
    h = fresh();
    mkdirSync(h.env.paths.macroDir, { recursive: true });
    writeFileSync(h.env.paths.macroFile, '// somebody else');
    const report = await uninstall(h.rt);
    expect(report.removed).toEqual([]);
    expect(existsSync(h.env.paths.macroFile)).toBe(true);
  });

  it('never removes a loader macro that existed before install (manifest does not list it as created)', async () => {
    h = fresh();
    mkdirSync(h.env.paths.macroDir, { recursive: true });
    writeFileSync(h.env.paths.macroFile, '// the user\'s own macro');
    await install(h.rt, { ...sources(h.env.root), skipPing: true });
    expect((await readManifest(h.rt))?.createdFiles).not.toContain(h.env.paths.macroFile);
    const report = await uninstall(h.rt);
    expect(existsSync(h.env.paths.macroFile)).toBe(true);
    expect(report.kept).toContain(h.env.paths.macroFile);
    expect(report.removed).not.toContain(h.env.paths.macroFile);
  });

  it('refuses a manifest that belongs to a different mailbox directory', async () => {
    h = fresh();
    await install(h.rt, { ...sources(h.env.root), skipPing: true });
    const m = JSON.parse(readFileSync(h.env.paths.manifest, 'utf8')) as { mcpDir: string };
    m.mcpDir = '/somewhere/else';
    writeFileSync(h.env.paths.manifest, JSON.stringify(m));
    const report = await uninstall(h.rt);
    expect(report.ok).toBe(false);
    expect(existsSync(h.env.paths.macroFile)).toBe(true);
  });

  it('never deletes manifest entries outside the managed directories', async () => {
    h = fresh();
    await install(h.rt, { ...sources(h.env.root), skipPing: true });
    const victim = join(h.env.root, 'victim.txt');
    writeFileSync(victim, 'keep me');
    const m = JSON.parse(readFileSync(h.env.paths.manifest, 'utf8')) as { createdFiles: string[]; createdDirs: string[] };
    m.createdFiles.push(victim);
    m.createdDirs.push(h.env.paths.backupsDir, h.env.paths.supportDir);
    writeFileSync(h.env.paths.manifest, JSON.stringify(m));
    const report = await uninstall(h.rt);
    expect(existsSync(victim)).toBe(true);
    expect(report.kept).toContain(victim);
    expect(existsSync(h.env.paths.backupsDir)).toBe(true);
    expect(existsSync(h.env.paths.supportDir)).toBe(true);
    expect(existsSync(join(h.env.paths.scriptsDir, 'MyUserMacro.js'))).toBe(true);
  });

  it('removes a helper app only if install put it inside the MCP dir', async () => {
    h = fresh();
    const app = join(h.env.paths.root, 'helper', 'C3D Bridge Helper.app');
    await install(h.rt, {
      ...sources(h.env.root),
      skipPing: true,
      installHelper: () => {
        mkdirSync(app, { recursive: true });
        return Promise.resolve({ path: app, installedByUs: true });
      },
    });
    const report = await uninstall(h.rt);
    expect(existsSync(app)).toBe(false);
    expect(report.removed.some((r) => r.includes('C3D Bridge Helper.app'))).toBe(true);
  });
});
