import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { compareSemver, packageVersion, parseRuntimeVersion, renderMacroTemplate } from './assets.js';
import { HELPER_APP_NAME } from './helperClient.js';
import { installedHelperApp } from './helperInstall.js';
import { stopHelper, updateHelper, type HelperUpdateOptions, type HelperUpdateResult } from './helperUpdate.js';
import { MACRO_MARKER, RUNTIME_MARKER, detectInstall, loadBundle, type InstallState } from './installState.js';
import { SETUP_CLIENTS, unconfigureClient, type UnconfigureResult } from './clientConfigs.js';
import { uninstallSkills, type SkillResult } from './skillsInstall.js';
import { ensureMcpDirs, mcpSubdirs } from './paths.js';
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

/** auto: do whatever the detected state needs; repair: fix what is broken but leave versions alone; reinstall: rewrite every managed file. */
export type InstallMode = 'auto' | 'repair' | 'reinstall';

export interface InstallOptions {
  mode?: InstallMode;
  /** Report what would change (the plan) without touching anything. */
  dryRun?: boolean;
  runtimeSource?: string;
  templateSource?: string;
  /** Obtains the helper when none is installed; `false` = leave the helper alone entirely (no install, no update). */
  installHelper?: HelperInstaller | false;
  /** Replaces an installed helper that is outdated or damaged (default: the real updater). Injected by tests. */
  updateHelper?: (rt: Runtime, o?: HelperUpdateOptions) => Promise<HelperUpdateResult>;
  skipPing?: boolean;
  now?: () => Date;
}

export interface InstallStep { name: string; status: 'done' | 'unchanged' | 'skipped' | 'warn' | 'fail'; detail: string }
export interface InstallReport {
  ok: boolean;
  mode: InstallMode;
  dryRun: boolean;
  /** What was found before acting (undefined only when the install could not start). */
  state?: InstallState;
  /** Dry run: what would be done. */
  plan: string[];
  steps: InstallStep[];
  changed: boolean;
  restartNeeded: boolean;
  menu: MenuState;
  helper: 'installed' | 'present' | 'missing';
  degraded: boolean;
  ping?: { ok: boolean; detail: string };
  /** What happened to an installed helper app (update, repair, rollback), when something was attempted. */
  helperUpdate?: HelperUpdateResult;
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
    return { ok: false, mode: opts.mode ?? 'auto', dryRun: opts.dryRun === true, plan: [], steps, changed: false, restartNeeded: false, menu: 'unknown', helper: 'missing', degraded: true, guidance, manifestPath: paths.manifest };
  };

  if (!(await exists(paths.supportDir))) {
    return fail(`Cheetah3D support directory not found: ${paths.supportDir}. Launch Cheetah3D once so it creates it (or set C3D_CHEETAH_SUPPORT_DIR).`);
  }
  const loaded = await loadBundle(rt, { runtimeSource: opts.runtimeSource, templateSource: opts.templateSource });
  if ('error' in loaded) return fail(loaded.error);
  const { bundle } = loaded;
  const runtimeText = bundle.runtimeText;
  const bundledVersion = bundle.runtimeVersion;

  // Decide what to do without touching anything yet.
  const mode: InstallMode = opts.mode ?? 'auto';
  const state = await detectInstall(rt, bundle);
  const runtimeStatus = state.components.find((c) => c.name === 'runtime')?.status;
  const installedText = await readText(paths.runtimeFile);
  const installedVersion = installedText ? parseRuntimeVersion(installedText) : undefined;
  const installedIsNewer = installedVersion !== undefined && compareSemver(installedVersion, bundledVersion) > 0;
  // A newer runtime is never downgraded (except by an explicit reinstall); repair leaves an older-but-intact runtime alone.
  const keepRuntime = installedVersion !== undefined && ((installedIsNewer && mode !== 'reinstall') || (mode === 'repair' && runtimeStatus === 'outdated'));
  const runtimeChanges = !keepRuntime && installedText !== runtimeText;
  const effectiveVersion = keepRuntime ? installedVersion : bundledVersion;

  const template = bundle.templateText;
  const macroText = renderMacroTemplate(template, { RUNTIME_PATH: paths.runtimeFile, MCP_DIR: paths.root, VERSION: effectiveVersion });
  const macroChanges = (await readText(paths.macroFile)) !== macroText;

  const plan = planFor(state, mode, { runtimeChanges, macroChanges, keepRuntime });
  const helperStatus = state.components.find((c) => c.name === 'helper')?.status;
  const helperApp = installedHelperApp(rt);
  const helperNeeds = opts.installHelper !== false && helperApp !== undefined && (mode === 'reinstall' || helperStatus === 'corrupt' || (helperStatus === 'outdated' && mode !== 'repair'));
  if (helperNeeds) {
    plan.push(helperStatus === 'outdated' ? `update the helper app ${state.installed.helper ?? '?'} -> ${state.bundled.helper ?? '?'} (stops the running helper; macOS asks for Accessibility and Screen Recording again when the signature changes)` : helperStatus === 'corrupt' ? 'replace the damaged helper app' : 'reinstall the helper app');
  } else if (opts.installHelper && helperApp === undefined) plan.push('install the helper app');
  if (opts.dryRun) {
    for (const line of plan) step('plan', 'skipped', line);
    if (plan.length === 0) step('plan', 'unchanged', 'nothing to do');
    return { ok: true, mode, dryRun: true, state, plan, steps, changed: false, restartNeeded: false, menu: 'unknown', helper: installedHelperApp(rt) ? 'present' : 'missing', degraded: !installedHelperApp(rt), guidance, manifestPath: paths.manifest };
  }

  const previous = await readManifest(rt);
  const createdDirs = new Set(previous?.createdDirs ?? []);
  const createdFiles = new Set(previous?.createdFiles ?? []);
  const backups = [...(previous?.backups ?? [])];
  if (!previous) {
    // Installed by hand or the manifest was lost: files that carry our markers are ours, so uninstall may remove them later.
    if (installedText !== undefined && RUNTIME_MARKER.test(installedText)) createdFiles.add(paths.runtimeFile);
    const existingMacro = await readText(paths.macroFile);
    if (existingMacro !== undefined && (MACRO_MARKER.test(existingMacro) || existingMacro === macroText)) createdFiles.add(paths.macroFile);
    // The mailbox subdirectories are ours too (the root may hold the user's own files, so it is never claimed here).
    for (const d of mcpSubdirs(paths)) if (d !== paths.root && (await exists(d))) createdDirs.add(d);
    if (await exists(paths.secret)) createdFiles.add(paths.secret);
    if (createdFiles.has(paths.macroFile) && (await exists(paths.macroDir))) createdDirs.add(paths.macroDir);
  }

  // Backup of Scripts/ before the first modification (requirements section 0).
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
  else await chmod(paths.secret, 0o600);
  step('mailbox', 'done', `${paths.root} (0700), secret ${secretCreated ? 'created' : 'kept'} (0600)`);

  // Runtime.
  if (keepRuntime) {
    step('runtime', 'skipped', installedIsNewer ? `Installed runtime ${installedVersion} is newer than bundled ${bundledVersion}; kept` : `Installed runtime ${installedVersion} is older than bundled ${bundledVersion}; repair leaves it (run install to update)`);
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

  // Helper (optional): install when missing, update or repair when outdated or damaged.
  let helper: InstallReport['helper'] = installedHelperApp(rt) ? 'present' : 'missing';
  let helperEntry = previous?.helper;
  let helperUpdate: HelperUpdateResult | undefined;
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
  } else if (helper === 'present' && helperNeeds) {
    try {
      helperUpdate = await (opts.updateHelper ?? updateHelper)(rt, { force: mode === 'reinstall' });
      const ok = helperUpdate.action !== 'failed' && helperUpdate.action !== 'rolled-back';
      step('helper', ok ? (helperUpdate.action === 'unchanged' || helperUpdate.action === 'skipped' ? 'unchanged' : 'done') : 'warn', helperUpdate.detail);
      if (helperUpdate.permissions === 'regrant') guidance.push('The helper app was replaced, so macOS will ask for Accessibility (and Screen Recording for screenshots) again: grant "C3D Bridge Helper" in System Settings > Privacy & Security, or run `c3d-mcp setup`.');
      if (ok && helperUpdate.path && (helperUpdate.action === 'updated' || helperUpdate.action === 'repaired' || helperUpdate.action === 'installed')) helperEntry = { path: helperUpdate.path, installedByUs: true };
    } catch (err) {
      step('helper', 'warn', `Helper update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (helper === 'missing') step('helper', 'warn', 'C3D Bridge Helper app not installed: degraded mode (osascript trigger; needs Accessibility for your terminal/MCP client; no Screen Recording features; image tools use a fallback).');
  else if (helper === 'present' && !helperUpdate && !steps.some((s) => s.name === 'helper')) step('helper', 'unchanged', installedHelperApp(rt) ?? '');

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

  return { ok: true, mode, dryRun: false, state, plan, steps, changed, restartNeeded, menu, helper, degraded: helper === 'missing', ping, ...(helperUpdate ? { helperUpdate } : {}), guidance, manifestPath: paths.manifest };
}

/** What `install` will do (or would, in a dry run) for the detected state. Helper steps are added by the helper updater. */
function planFor(state: InstallState, mode: InstallMode, d: { runtimeChanges: boolean; macroChanges: boolean; keepRuntime: boolean }): string[] {
  const plan: string[] = [];
  const get = (n: string): InstallState['components'][number] | undefined => state.components.find((c) => c.name === n);
  const mail = get('mailbox');
  if (mail?.status === 'missing') plan.push('create the mailbox directories (0700)');
  else if (mail?.status === 'modified') plan.push('tighten the mailbox permissions to 0700');
  const secret = get('secret');
  if (secret?.status === 'missing' || secret?.status === 'corrupt') plan.push('create the secret (0600)');
  else if (secret?.status === 'modified') plan.push('fix the secret permissions (0600)');
  const rtState = get('runtime');
  if (d.runtimeChanges && rtState) {
    if (rtState.status === 'missing') plan.push(`create runtime ${state.bundled.runtime}`);
    else if (rtState.status === 'outdated') plan.push(`update runtime ${state.installed.runtime ?? '?'} -> ${state.bundled.runtime}`);
    else plan.push(`rewrite runtime ${state.bundled.runtime}${mode === 'reinstall' && rtState.status === 'newer' ? ' (replacing a newer one: reinstall)' : ''}`);
  }
  const macro = get('macro');
  if (d.macroChanges && macro) plan.push(macro.status === 'missing' ? 'create the loader macro (needs a Cheetah3D restart to appear in the menu)' : macro.status === 'outdated' ? 'update the loader macro' : 'rewrite the loader macro');
  if ((d.runtimeChanges || d.macroChanges) && get('macro')?.status !== undefined && state.kind !== 'fresh') plan.push('back up Scripts/ first');
  if (state.kind === 'fresh') plan.splice(plan.length - 0, 0, 'back up Scripts/ first (if it exists)');
  const manifest = get('manifest');
  if (manifest && manifest.status !== 'ok') plan.push('write the install manifest');
  return plan;
}

export interface UninstallOptions {
  /** List what would be removed and change nothing. */
  dryRun?: boolean;
  /** Also remove the agent skills and the c3d entry in MCP client configs (never the backups or user scripts). */
  all?: boolean;
  /** Home directory for LaunchAgents, skills and client configs (default: the real one). */
  home?: string;
  skillsSource?: string;
  stopTimeoutMs?: number;
  settleMs?: number;
}

export interface UninstallReport {
  ok: boolean;
  dryRun: boolean;
  /** managed: an install manifest drove the removal; unmanaged: no manifest, only files with c3d-mcp markers were removed; nothing: nothing of ours was found. */
  kind: 'managed' | 'unmanaged' | 'nothing';
  /** Paths removed (or, in a dry run, that would be removed). */
  removed: string[];
  kept: string[];
  notes: string[];
  helperStopped?: boolean;
  launchAgent?: 'removed' | 'would-remove' | 'absent' | 'foreign';
  skills?: SkillResult[];
  clients?: UnconfigureResult[];
}

function isSafeRoot(rt: Pick<Runtime, 'paths'>, target: string): boolean {
  const t = resolve(target);
  const forbidden = [resolve(homedir()), resolve(rt.paths.supportDir), resolve(rt.paths.scriptsDir), resolve(rt.paths.backupsDir), '/', dirname(resolve(rt.paths.supportDir))];
  return !forbidden.includes(t) && t.split(sep).length > 3;
}

/** Entries of the mailbox directory that c3d-mcp itself creates; anything else in there is the user's. */
const MAILBOX_ENTRIES = ['inbox', 'outbox', 'cancel', 'runtime', 'log', 'tmp', 'state.json', 'secret', 'helper.sock', 'lock', 'install-manifest.json', 'helper'];
const LAUNCH_AGENT = 'dev.c3dmcp.helper.plist';

/**
 * Removes what c3d-mcp installed: the loader macro, runtime, mailbox, helper app (its process and LaunchAgent first), and with
 * `all` the agent skills and MCP client entries. Driven by the install manifest; without one, only files that carry c3d-mcp's own
 * markers are removed. Never touches `MCP-backups` or the user's scripts.
 */
export async function uninstall(rt: Runtime, opts: UninstallOptions = {}): Promise<UninstallReport> {
  const { paths } = rt;
  const dryRun = opts.dryRun === true;
  const home = opts.home ?? homedir();
  const report: UninstallReport = { ok: true, dryRun, kind: 'nothing', removed: [], kept: [], notes: [] };
  const manifest = await readManifest(rt);
  const inside = (p: string, root: string): boolean => resolve(p) === resolve(root) || resolve(p).startsWith(resolve(root) + sep);
  const protectedPaths = [paths.backupsDir];
  if (manifest && resolve(manifest.mcpDir) !== resolve(paths.root)) {
    report.ok = false;
    report.notes.push(`Manifest belongs to ${manifest.mcpDir}, not ${paths.root}; refusing to remove anything.`);
    return report;
  }
  const remove = async (p: string, recursive = false): Promise<void> => {
    if (!dryRun) await rm(p, { recursive, force: true });
    report.removed.push(p);
  };

  // 1. The helper: stop its process and drop its LaunchAgent before its files go.
  const helperApps = [...new Set([manifest?.helper?.path, join(paths.root, 'helper', HELPER_APP_NAME), installedHelperApp(rt)].filter((p): p is string => p !== undefined && inside(p, paths.root)))];
  const ourHelper = (await Promise.all(helperApps.map(async (a) => (await exists(a)) && (!manifest?.helper || resolve(manifest.helper.path) === resolve(a) || (await readText(join(a, 'Contents', 'Info.plist')))?.includes('dev.c3dmcp.helper') === true)))).some(Boolean);
  if (!dryRun) {
    let stopped = true;
    for (const a of helperApps) stopped = (await stopHelper(rt, a, { timeoutMs: opts.stopTimeoutMs, settleMs: opts.settleMs })) && stopped;
    report.helperStopped = stopped;
    if (!stopped) report.notes.push('The helper process could not be stopped; quit "C3D Bridge Helper" in Activity Monitor.');
  }
  if (ourHelper && (await exists(paths.helperSock))) await remove(paths.helperSock); // runtime artifact of the helper process stopped above
  const plist = join(home, 'Library', 'LaunchAgents', LAUNCH_AGENT);
  const plistText = await readText(plist);
  if (plistText === undefined) report.launchAgent = 'absent';
  else if (plistText.includes('dev.c3dmcp.helper') && helperApps.some((a) => plistText.includes(a))) {
    if (!dryRun) await rt.exec('launchctl', ['bootout', `gui/${String(process.getuid?.() ?? 501)}`, plist], { timeoutMs: 15_000 }).catch(() => undefined);
    await remove(plist);
    report.launchAgent = dryRun ? 'would-remove' : 'removed';
  } else {
    report.launchAgent = 'foreign';
    report.kept.push(plist);
    report.notes.push(`Kept ${plist}: it does not start the helper that c3d-mcp installed.`);
  }

  if (manifest) {
    report.kind = 'managed';
    // Files first. Only files install itself created are removed: a macro file that existed before install is never deleted.
    if (!manifest.createdFiles.includes(manifest.macroFile) && (await exists(manifest.macroFile))) {
      report.kept.push(manifest.macroFile);
      report.notes.push(`Kept ${manifest.macroFile}: it existed before install (the install manifest does not list it as created).`);
    }
    for (const file of new Set(manifest.createdFiles)) {
      if (protectedPaths.some((p) => inside(file, p))) continue;
      if (!inside(file, paths.root) && !inside(file, paths.macroDir)) {
        report.kept.push(file);
        report.notes.push(`Skipped ${file}: outside the directories install manages.`);
        continue;
      }
      if (await exists(file)) await remove(file);
    }
    if (manifest.helper?.installedByUs && basename(manifest.helper.path) === HELPER_APP_NAME && inside(manifest.helper.path, paths.root) && (await exists(manifest.helper.path))) {
      await remove(manifest.helper.path, true);
    }
    // A managed helper copy the manifest does not list (lost or older manifest) still carries our bundle id: it goes too.
    const managedApp = join(paths.root, 'helper', HELPER_APP_NAME);
    if (!manifest.helper && ourHelper && (await exists(managedApp)) && !report.removed.includes(managedApp)) await remove(managedApp, true);

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
        await remove(dir, true);
      } else if (inside(dir, paths.scriptsDir)) {
        const left = await readdir(dir).catch(() => ['?']);
        const wouldRemove = left.length === 0 || (dryRun && left.every((n) => report.removed.includes(join(dir, n))));
        if (wouldRemove) await remove(dir, true); // empty, or only holds files this run removes
        else {
          report.kept.push(dir);
          report.notes.push(`Kept ${dir}: it contains other files.`);
        }
      }
    }
    if (existsSync(paths.manifest) && !dirs.includes(paths.root)) await remove(paths.manifest);
    const helperDir = join(paths.root, 'helper');
    if (!dirs.includes(helperDir) && (await exists(helperDir))) {
      const inHelper = await readdir(helperDir).catch(() => ['?']);
      if (inHelper.every((n) => report.removed.includes(join(helperDir, n)))) await remove(helperDir, true);
    }
    // A mailbox root that existed before install is not in createdDirs; once nothing is left in it, it goes as well.
    if (!dirs.includes(paths.root) && isSafeRoot(rt, paths.root) && (await exists(paths.root))) {
      const left = await readdir(paths.root).catch(() => ['?']);
      if (left.every((n) => report.removed.includes(join(paths.root, n)))) await remove(paths.root, true);
    }
  } else {
    // No manifest: remove only what carries our own markers.
    const macroText = await readText(paths.macroFile);
    const runtimeText = await readText(paths.runtimeFile);
    const macroOurs = macroText !== undefined && MACRO_MARKER.test(macroText);
    const runtimeOurs = runtimeText !== undefined && RUNTIME_MARKER.test(runtimeText);
    if (macroOurs || runtimeOurs || ourHelper) report.kind = 'unmanaged';
    if (macroOurs) {
      await remove(paths.macroFile);
      const left = await readdir(paths.macroDir).catch(() => ['?']);
      if (left.length === 0 || (dryRun && left.every((n) => report.removed.includes(join(paths.macroDir, n))))) await remove(paths.macroDir, true);
    } else if (macroText !== undefined) {
      report.kept.push(paths.macroFile);
      report.notes.push(`Kept ${paths.macroFile}: it is not a c3d-mcp loader macro.`);
    }
    if (runtimeOurs) await remove(paths.runtimeFile);
    else if (runtimeText !== undefined) {
      report.kept.push(paths.runtimeFile);
      report.notes.push(`Kept ${paths.runtimeFile}: it is not a c3d-mcp runtime.`);
    }
    if (report.kind === 'unmanaged' || (await exists(paths.secret))) {
      if (ourHelper) for (const a of helperApps) if (await exists(a)) await remove(a, true);
      const present = (await readdir(paths.root).catch(() => [] as string[]));
      const looksOurs = present.some((n) => ['inbox', 'outbox', 'secret', 'state.json', 'runtime'].includes(n));
      if (looksOurs && isSafeRoot(rt, paths.root)) {
        for (const n of present.filter((x) => MAILBOX_ENTRIES.includes(x))) await remove(join(paths.root, n), true);
        const rest = present.filter((x) => !MAILBOX_ENTRIES.includes(x));
        if (rest.length === 0) await remove(paths.root, true);
        else {
          report.kept.push(paths.root);
          report.notes.push(`Kept ${paths.root}: it contains files that are not c3d-mcp's (${rest.slice(0, 3).join(', ')}).`);
        }
        if (report.kind === 'nothing') report.kind = 'unmanaged';
      }
    }
    report.notes.push(report.kind === 'nothing' ? `No install manifest at ${paths.manifest}; nothing installed by c3d-mcp was found.` : `No install manifest at ${paths.manifest}: removed only files that carry c3d-mcp markers.`);
  }

  // 2. --all: agent skills and MCP client entries.
  if (opts.all) {
    try {
      report.skills = uninstallSkills({ dryRun, home, ...(opts.skillsSource ? { source: opts.skillsSource } : {}) });
    } catch (err) {
      report.skills = [];
      report.notes.push(`Skills: ${err instanceof Error ? err.message : String(err)}`);
    }
    report.clients = [];
    for (const client of SETUP_CLIENTS) report.clients.push(await unconfigureClient(client, { home, dryRun, exec: rt.exec }));
  }
  if (manifest && manifest.backups.length > 0) report.notes.push(`Backups kept in ${paths.backupsDir}`);
  report.notes.push(dryRun ? 'Dry run: nothing was changed.' : 'Restart Cheetah3D to drop the C3D-MCP menu.');
  return report;
}
