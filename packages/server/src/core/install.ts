import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { assetLocations, compareSemver, firstExisting, packageVersion, parseRuntimeVersion, readRuntimeVersionFile, renderMacroTemplate } from './assets.js';
import { HELPER_APP_NAME } from './helperClient.js';
import { ensureMcpDirs } from './paths.js';
import type { MenuState } from './trigger.js';
import type { Runtime } from './runtime.js';

export interface InstallManifest {
  schema: 1;
  version: string;
  installedAt: string;
  mcpDir: string;
  macroFile: string;
  runtimeVersion?: string;
  /** Directories install created (deepest last), files install created, and backups it wrote (never removed by uninstall). */
  createdDirs: string[];
  createdFiles: string[];
  backups: string[];
  helper?: { path: string; installedByUs: boolean };
}

export interface HelperInstallResult { path: string; installedByUs: boolean; version?: string }
/** Obtains the helper app (copy from the package or download with SHA-256 verification). Injected so tests and offline installs never hit the network. */
export type HelperInstaller = (ctx: { mcpDir: string; helperDir: string }) => Promise<HelperInstallResult | undefined>;

export interface InstallOptions {
  runtimeSource?: string;
  templateSource?: string;
  installHelper?: HelperInstaller | false;
  skipPing?: boolean;
  now?: () => Date;
}

export interface InstallStep { name: string; status: 'done' | 'unchanged' | 'skipped' | 'warn' | 'fail'; detail: string }
export interface InstallReport {
  ok: boolean;
  steps: InstallStep[];
  changed: boolean;
  restartNeeded: boolean;
  menu: MenuState;
  helper: 'installed' | 'present' | 'missing';
  degraded: boolean;
  ping?: { ok: boolean; detail: string };
  guidance: string[];
  manifestPath: string;
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

async function readText(p: string): Promise<string | undefined> {
  return readFile(p, 'utf8').catch(() => undefined);
}

async function writeAtomic(path: string, data: string | Buffer, mode: number): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, data, { mode });
  await rename(tmp, path);
}

export async function readManifest(rt: Pick<Runtime, 'paths'>): Promise<InstallManifest | undefined> {
  const text = await readText(rt.paths.manifest);
  if (!text) return undefined;
  try {
    const m = JSON.parse(text) as InstallManifest;
    return (m.schema as number) === 1 ? m : undefined;
  } catch {
    return undefined;
  }
}

function timestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/** Directories from `from` (exclusive of existing ones) down to `target`, outermost first, that do not exist yet. */
async function missingDirs(target: string, stopAt: string): Promise<string[]> {
  const out: string[] = [];
  for (let d = target; d !== stopAt && d !== dirname(d); d = dirname(d)) {
    if (!(await exists(d))) out.unshift(d);
  }
  return out;
}

export async function install(rt: Runtime, opts: InstallOptions = {}): Promise<InstallReport> {
  const { paths } = rt;
  const steps: InstallStep[] = [];
  const guidance: string[] = [];
  const now = opts.now ?? ((): Date => new Date());
  const step = (name: string, status: InstallStep['status'], detail: string): void => {
    steps.push({ name, status, detail });
  };
  const fail = (detail: string): InstallReport => {
    step('abort', 'fail', detail);
    return { ok: false, steps, changed: false, restartNeeded: false, menu: 'unknown', helper: 'missing', degraded: true, guidance, manifestPath: paths.manifest };
  };

  if (!(await exists(paths.supportDir))) {
    return fail(`Cheetah3D support directory not found: ${paths.supportDir}. Launch Cheetah3D once so it creates it (or set C3D_CHEETAH_SUPPORT_DIR).`);
  }
  const loc = assetLocations();
  const runtimeSource = opts.runtimeSource ?? firstExisting(loc.runtime);
  const templateSource = opts.templateSource ?? firstExisting(loc.macroTemplate);
  if (!runtimeSource || !templateSource || !existsSync(runtimeSource) || !existsSync(templateSource)) {
    return fail(`Bundled bridge assets are missing (${!runtimeSource || !existsSync(runtimeSource) ? 'runtime.js' : 'macro template'}). Reinstall the c3d-mcp package or build the bridge (bridge/dist/runtime.js).`);
  }
  const runtimeText = await readFile(runtimeSource, 'utf8');
  const bundledVersion = parseRuntimeVersion(runtimeText) ?? readRuntimeVersionFile(runtimeSource) ?? packageVersion();

  // Decide runtime action without touching anything yet.
  const installedText = await readText(paths.runtimeFile);
  const installedVersion = installedText ? parseRuntimeVersion(installedText) : undefined;
  const installedIsNewer = installedVersion !== undefined && compareSemver(installedVersion, bundledVersion) > 0;
  const runtimeChanges = !installedIsNewer && installedText !== runtimeText;
  const effectiveVersion = installedIsNewer ? installedVersion : bundledVersion;

  const template = await readFile(templateSource, 'utf8');
  const macroText = renderMacroTemplate(template, { RUNTIME_PATH: paths.runtimeFile, MCP_DIR: paths.root, VERSION: effectiveVersion });
  const macroChanges = (await readText(paths.macroFile)) !== macroText;

  const previous = await readManifest(rt);
  const createdDirs = new Set(previous?.createdDirs ?? []);
  const createdFiles = new Set(previous?.createdFiles ?? []);
  const backups = [...(previous?.backups ?? [])];

  // Backup of Scripts/ before the first modification (PRD section 0).
  if (macroChanges && (await exists(paths.scriptsDir))) {
    if (!(await exists(paths.backupsDir))) await mkdir(paths.backupsDir, { recursive: true, mode: 0o700 });
    const target = join(paths.backupsDir, `scripts-${timestamp(now())}.tar.gz`);
    const res = await rt.exec('tar', ['-czf', target, '-C', paths.supportDir, 'Scripts'], { timeoutMs: 120_000 });
    if (res.code !== 0 || !(await exists(target))) return fail(`Backup of Scripts/ failed (${res.stderr.trim() || `tar exit ${String(res.code)}`}); nothing was modified.`);
    backups.push(target);
    step('backup', 'done', target);
  } else {
    step('backup', macroChanges ? 'skipped' : 'unchanged', macroChanges ? 'No Scripts/ directory to back up' : 'Macro already current');
  }

  // Mailbox tree and secret.
  for (const d of await ensureMcpDirs(paths)) createdDirs.add(d);
  const { created: secretCreated } = await rt.mailbox.ensureSecret();
  if (secretCreated) createdFiles.add(paths.secret);
  step('mailbox', 'done', `${paths.root} (0700), secret ${secretCreated ? 'created' : 'kept'} (0600)`);

  // Runtime.
  if (installedIsNewer) {
    step('runtime', 'skipped', `Installed runtime ${installedVersion} is newer than bundled ${bundledVersion}; kept`);
  } else if (runtimeChanges) {
    if (installedText === undefined) createdFiles.add(paths.runtimeFile);
    await writeAtomic(paths.runtimeFile, runtimeText, 0o600);
    step('runtime', 'done', `${paths.runtimeFile} (${bundledVersion})`);
  } else {
    step('runtime', 'unchanged', `${bundledVersion} already installed`);
  }

  // Loader macro.
  if (macroChanges) {
    const newDirs = await missingDirs(paths.macroDir, paths.supportDir);
    await mkdir(paths.macroDir, { recursive: true });
    for (const d of newDirs) createdDirs.add(d);
    if (!(await exists(paths.macroFile))) createdFiles.add(paths.macroFile);
    await writeAtomic(paths.macroFile, macroText, 0o644);
    step('macro', 'done', paths.macroFile);
  } else {
    step('macro', 'unchanged', paths.macroFile);
  }

  // Helper (optional).
  let helper: InstallReport['helper'] = rt.helper.installedApp?.() ? 'present' : 'missing';
  let helperEntry = previous?.helper;
  if (helper === 'missing' && opts.installHelper) {
    try {
      const got = await opts.installHelper({ mcpDir: paths.root, helperDir: join(paths.root, 'helper') });
      if (got) {
        helper = 'installed';
        helperEntry = { path: got.path, installedByUs: got.installedByUs };
        step('helper', 'done', `${got.path}${got.version ? ` (${got.version})` : ''}`);
      }
    } catch (err) {
      step('helper', 'warn', `Helper install failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (helper === 'missing') step('helper', 'warn', 'C3D Bridge Helper app not installed: degraded mode (osascript trigger; needs Accessibility for your terminal/MCP client; no Screen Recording features; image tools fall back to sips)');
  else if (helper === 'present') step('helper', 'unchanged', rt.helper.installedApp?.() ?? '');

  const manifest: InstallManifest = {
    schema: 1,
    version: packageVersion(),
    installedAt: now().toISOString(),
    mcpDir: paths.root,
    macroFile: paths.macroFile,
    runtimeVersion: effectiveVersion,
    createdDirs: [...createdDirs],
    createdFiles: [...createdFiles],
    backups,
    ...(helperEntry ? { helper: helperEntry } : {}),
  };
  await writeAtomic(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
  step('manifest', 'done', paths.manifest);

  // Menu detection, restart guidance, ping.
  const app = await rt.probe.inspect();
  const menu: MenuState = app.running ? await rt.trigger.menuState().catch((): MenuState => 'unknown') : 'unknown';
  const changed = runtimeChanges || macroChanges;
  const restartNeeded = menu === 'absent' || (menu === 'unknown' && macroChanges && app.running);
  if (!app.running) guidance.push('Cheetah3D is not running. Start it (macros are discovered at launch), then run `c3d-mcp doctor`.');
  else if (menu === 'absent') guidance.push('Restart Cheetah3D: the new Tools > Script > Macro Script > C3D-MCP menu only appears after a restart (there is no "Update Menu" command).');
  else if (menu === 'unknown' && macroChanges) guidance.push('Could not read the Cheetah3D menu (Accessibility permission?). If Tools > Script > Macro Script > C3D-MCP is missing, restart Cheetah3D.');
  if (helper === 'missing') guidance.push('Optional: install the C3D Bridge Helper app for reliable window handling and screenshots, then grant it Accessibility and Screen Recording.');
  if (menu === 'present' && changed) guidance.push('The macro file changed but the menu already exists: Cheetah3D picks up edits to listed macros on the next run, no restart needed.');

  let ping: InstallReport['ping'];
  if (!opts.skipPing && app.running && menu === 'present') {
    try {
      const r = await rt.bridge.one<{ runtimeVersion?: string }>('ping', { counter: 1, echo: 'install' }, { deadlineMs: 15_000 });
      ping = { ok: true, detail: `round trip ok (runtime ${r.runtimeVersion ?? '?'})` };
    } catch (err) {
      ping = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    step('ping', ping.ok ? 'done' : 'warn', ping.detail);
  } else {
    step('ping', 'skipped', !app.running ? 'Cheetah3D is not running' : menu !== 'present' ? 'bridge menu not available yet' : 'skipped by option');
  }

  return { ok: true, steps, changed, restartNeeded, menu, helper, degraded: helper === 'missing', ping, guidance, manifestPath: paths.manifest };
}

export interface UninstallReport { ok: boolean; removed: string[]; kept: string[]; notes: string[] }

function isSafeRoot(rt: Pick<Runtime, 'paths'>, target: string): boolean {
  const t = resolve(target);
  const forbidden = [resolve(homedir()), resolve(rt.paths.supportDir), resolve(rt.paths.scriptsDir), resolve(rt.paths.backupsDir), '/', dirname(resolve(rt.paths.supportDir))];
  return !forbidden.includes(t) && t.split(sep).length > 3;
}

/** Removes only what the manifest says install created. MCP-backups and user scripts are never touched. */
export async function uninstall(rt: Runtime): Promise<UninstallReport> {
  const { paths } = rt;
  const report: UninstallReport = { ok: true, removed: [], kept: [], notes: [] };
  const manifest = await readManifest(rt);
  if (!manifest) {
    report.notes.push(`No install manifest at ${paths.manifest}; nothing was removed.`);
    return report;
  }
  const inside = (p: string, root: string): boolean => resolve(p) === resolve(root) || resolve(p).startsWith(resolve(root) + sep);
  const protectedPaths = [paths.backupsDir];
  if (resolve(manifest.mcpDir) !== resolve(paths.root)) {
    report.ok = false;
    report.notes.push(`Manifest belongs to ${manifest.mcpDir}, not ${paths.root}; refusing to remove anything.`);
    return report;
  }

  // Files first (macro file is always ours when listed or when its recorded path matches).
  for (const file of new Set([...manifest.createdFiles, manifest.macroFile])) {
    if (protectedPaths.some((p) => inside(file, p))) continue;
    if (!inside(file, paths.root) && !inside(file, paths.macroDir)) {
      report.kept.push(file);
      report.notes.push(`Skipped ${file}: outside the directories install manages.`);
      continue;
    }
    if (await exists(file)) {
      await rm(file, { force: true });
      report.removed.push(file);
    }
  }

  if (manifest.helper?.installedByUs && basename(manifest.helper.path) === HELPER_APP_NAME && inside(manifest.helper.path, paths.root)) {
    await rm(manifest.helper.path, { recursive: true, force: true });
    report.removed.push(manifest.helper.path);
  }

  // Directories we created, deepest first. Mailbox dirs get runtime-written leftovers, so they are removed recursively.
  const dirs = [...manifest.createdDirs].sort((a, b) => b.split(sep).length - a.split(sep).length);
  for (const dir of dirs) {
    if (protectedPaths.some((p) => inside(dir, p))) continue;
    if (!(await exists(dir))) continue;
    if (inside(dir, paths.root)) {
      if (dir === paths.root && !isSafeRoot(rt, dir)) {
        report.kept.push(dir);
        report.notes.push(`Refused to remove ${dir}: it looks like a system or user directory.`);
        continue;
      }
      await rm(dir, { recursive: true, force: true });
      report.removed.push(dir);
    } else if (inside(dir, paths.scriptsDir)) {
      const left = await readdir(dir).catch(() => ['?']);
      if (left.length === 0) {
        await rmdir(dir);
        report.removed.push(dir);
      } else {
        report.kept.push(dir);
        report.notes.push(`Kept ${dir}: it contains other files.`);
      }
    }
  }
  if (existsSync(paths.manifest) && !dirs.includes(paths.root)) await rm(paths.manifest, { force: true });
  if (manifest.backups.length > 0) report.notes.push(`Backups kept in ${paths.backupsDir}`);
  report.notes.push('Restart Cheetah3D to drop the C3D-MCP menu.');
  return report;
}
