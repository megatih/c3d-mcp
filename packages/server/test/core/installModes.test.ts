import { chmodSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { install, readManifest } from '../../src/core/install.js';
import { makeHarness, type Harness } from '../helpers/runtime.js';

let h: Harness;
afterEach(() => rmSync(h.env.root, { recursive: true, force: true }));

const TEMPLATE = '// c3d-mcp bridge loader {{VERSION}}\nvar RUNTIME = "{{RUNTIME_PATH}}";\nvar MCP = "{{MCP_DIR}}";\n';
const runtimeSrc = (v: string): string => `/* c3d-mcp runtime ${v} */\nvar RUNTIME_VERSION = "${v}";\n`;
function sources(root: string, version = '1.0.0'): { runtimeSource: string; templateSource: string } {
  const runtimeSource = join(root, 'bundled-runtime.js');
  const templateSource = join(root, 'macro.template');
  writeFileSync(runtimeSource, runtimeSrc(version));
  writeFileSync(templateSource, TEMPLATE);
  return { runtimeSource, templateSource };
}
const fresh = (): Harness => {
  const hh = makeHarness({}, { seed: false });
  writeFileSync(join(hh.env.paths.scriptsDir, 'MyUserMacro.js'), '// the user script');
  return hh;
};
const base = { skipPing: true, installHelper: false as const };

describe('install modes and detection', () => {
  it('reports what it detected before acting: fresh, then current', async () => {
    h = fresh();
    const first = await install(h.rt, { ...sources(h.env.root), ...base });
    expect(first.state?.kind).toBe('fresh');
    expect(first.mode).toBe('auto');
    const second = await install(h.rt, { ...sources(h.env.root), ...base });
    expect(second.state?.kind).toBe('current');
    expect(second.changed).toBe(false);
  });

  it('auto repairs a partial install (runtime deleted, secret deleted, loose permissions) and keeps what is fine', async () => {
    h = fresh();
    const src = sources(h.env.root);
    await install(h.rt, { ...src, ...base });
    const macroBefore = readFileSync(h.env.paths.macroFile, 'utf8');
    rmSync(h.env.paths.runtimeFile);
    rmSync(h.env.paths.secret);
    chmodSync(h.env.paths.root, 0o755);
    const r = await install(h.rt, { ...src, ...base });
    expect(r.state?.kind).toBe('partial');
    expect(r.ok).toBe(true);
    expect(readFileSync(h.env.paths.runtimeFile, 'utf8')).toBe(runtimeSrc('1.0.0'));
    expect(statSync(h.env.paths.secret).mode & 0o777).toBe(0o600);
    expect(statSync(h.env.paths.root).mode & 0o777).toBe(0o700);
    expect(readFileSync(h.env.paths.macroFile, 'utf8')).toBe(macroBefore);
    expect((await install(h.rt, { ...src, ...base })).state?.kind).toBe('current');
  });

  it('repair fixes broken parts but leaves an outdated runtime at its version', async () => {
    h = fresh();
    await install(h.rt, { ...sources(h.env.root, '1.0.0'), ...base });
    const newer = sources(h.env.root, '1.0.1');
    const r = await install(h.rt, { ...newer, ...base, mode: 'repair' });
    expect(r.state?.kind).toBe('outdated');
    expect(readFileSync(h.env.paths.runtimeFile, 'utf8')).toBe(runtimeSrc('1.0.0')); // not upgraded by repair
    rmSync(h.env.paths.macroFile);
    const r2 = await install(h.rt, { ...newer, ...base, mode: 'repair' });
    expect(r2.steps.find((s) => s.name === 'macro')?.status).toBe('done');
    expect(readFileSync(h.env.paths.macroFile, 'utf8')).toContain('1.0.0');
    rmSync(h.env.paths.runtimeFile);
    await install(h.rt, { ...newer, ...base, mode: 'repair' });
    expect(readFileSync(h.env.paths.runtimeFile, 'utf8')).toBe(runtimeSrc('1.0.1')); // a missing runtime is restored from the bundle
  });

  it('auto updates an outdated install; reinstall rewrites even a newer runtime but keeps secret and backups', async () => {
    h = fresh();
    await install(h.rt, { ...sources(h.env.root, '1.2.0'), ...base });
    const secret = readFileSync(h.env.paths.secret, 'utf8');
    const backups = readdirSync(h.env.paths.backupsDir).length;
    const noDowngrade = await install(h.rt, { ...sources(h.env.root, '1.0.0'), ...base });
    expect(noDowngrade.state?.kind).toBe('newer');
    expect(readFileSync(h.env.paths.runtimeFile, 'utf8')).toBe(runtimeSrc('1.2.0'));
    const re = await install(h.rt, { ...sources(h.env.root, '1.0.0'), ...base, mode: 'reinstall', now: () => new Date(Date.now() + 5000) });
    expect(re.mode).toBe('reinstall');
    expect(re.changed).toBe(true);
    expect(readFileSync(h.env.paths.runtimeFile, 'utf8')).toBe(runtimeSrc('1.0.0'));
    expect(readFileSync(h.env.paths.macroFile, 'utf8')).toContain('1.0.0');
    expect(readFileSync(h.env.paths.secret, 'utf8')).toBe(secret);
    expect(readdirSync(h.env.paths.backupsDir).length).toBeGreaterThanOrEqual(backups);
    expect(readFileSync(join(h.env.paths.scriptsDir, 'MyUserMacro.js'), 'utf8')).toBe('// the user script');
  });

  it('dry run lists the plan and changes nothing (fresh machine)', async () => {
    h = fresh();
    const r = await install(h.rt, { ...sources(h.env.root), ...base, dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.state?.kind).toBe('fresh');
    expect(r.plan.join('\n')).toMatch(/create runtime/);
    expect(r.plan.join('\n')).toMatch(/create (the )?loader macro/);
    expect(existsSync(h.env.paths.root)).toBe(false);
    expect(existsSync(h.env.paths.backupsDir)).toBe(false);
    expect(existsSync(h.env.paths.macroFile)).toBe(false);
  });

  it('dry run on a current install says there is nothing to do; on a partial one names the repair', async () => {
    h = fresh();
    const src = sources(h.env.root);
    await install(h.rt, { ...src, ...base });
    expect((await install(h.rt, { ...src, ...base, dryRun: true })).plan).toEqual([]);
    rmSync(h.env.paths.runtimeFile);
    const r = await install(h.rt, { ...src, ...base, dryRun: true });
    expect(r.plan.join('\n')).toMatch(/runtime/);
    expect(existsSync(h.env.paths.runtimeFile)).toBe(false);
  });

  it('adoption also records the mailbox directories, so uninstall can remove them', async () => {
    h = fresh();
    const src = sources(h.env.root);
    await install(h.rt, { ...src, ...base });
    rmSync(h.env.paths.manifest);
    await install(h.rt, { ...src, ...base });
    const m = await readManifest(h.rt);
    expect(m?.createdDirs).toEqual(expect.arrayContaining([h.env.paths.inbox, h.env.paths.outbox, h.env.paths.runtimeDir]));
    expect(m?.createdDirs).not.toContain(h.env.paths.root); // the root may hold the user's own files: never claimed on adoption
    expect(m?.createdFiles).toContain(h.env.paths.secret); // the secret sits in our mailbox: ours
    expect(m?.createdDirs).toContain(h.env.paths.macroDir); // the loader's own folder, removed only when empty
  });

  it('adopts an install whose manifest was lost: it records our own files so uninstall can remove them', async () => {
    h = fresh();
    const src = sources(h.env.root);
    await install(h.rt, { ...src, ...base });
    rmSync(h.env.paths.manifest);
    const r = await install(h.rt, { ...src, ...base });
    expect(r.state?.kind).toBe('unmanaged');
    const m = await readManifest(h.rt);
    expect(m?.createdFiles).toEqual(expect.arrayContaining([h.env.paths.runtimeFile, h.env.paths.macroFile]));
  });
});
