// Installs, updates or repairs the C3D Bridge Helper app. Safe by construction: the new bundle is staged next to the old one and
// verified BEFORE the running helper is stopped; the old app is backed up; the swap is two renames; the new helper must answer
// `ping` with the expected version, otherwise the old one is put back and restarted.
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { compareSemver } from './assets.js';
import { HELPER_APP_NAME } from './helperClient.js';
import { bundledHelperVersion, helperSources, installedHelperApp, readAppVersion } from './helperInstall.js';
import type { Runtime } from './runtime.js';

export type HelperAction = 'installed' | 'updated' | 'repaired' | 'unchanged' | 'rolled-back' | 'failed' | 'skipped';
/** kept: the new app has the same signing identity, so macOS keeps the grants. regrant: Accessibility/Screen Recording must be granted again. n/a: nothing was replaced. */
export type HelperPermissions = 'kept' | 'regrant' | 'n/a';

export interface HelperUpdateResult {
  action: HelperAction;
  from?: string;
  to?: string;
  path?: string;
  /** Where the previous app was copied before it was replaced. */
  backup?: string;
  permissions: HelperPermissions;
  detail: string;
}

export interface HelperUpdateOptions {
  /** Replace even when the installed helper is current. */
  force?: boolean;
  sources?: { app: string[]; zip: string[] };
  /** The helper app to update (default: the installed one if it lives inside the mailbox directory; otherwise <mcpDir>/helper). */
  destApp?: string;
  backupsDir?: string;
  now?: () => Date;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  /** Pause between polls (tests use 1). */
  settleMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const inside = (p: string, root: string): boolean => resolve(p) === resolve(root) || resolve(p).startsWith(resolve(root) + sep);

interface Identity { adhoc: boolean; authority?: string; team?: string }
async function identityOf(rt: Runtime, app: string): Promise<Identity | undefined> {
  const r = await rt.exec('codesign', ['-dvv', app], { timeoutMs: 20_000 }).catch(() => undefined);
  if (!r) return undefined;
  const text = `${r.stderr}\n${r.stdout}`;
  return { adhoc: /Signature=adhoc/.test(text), authority: /^Authority=(.+)$/m.exec(text)?.[1], team: /^TeamIdentifier=(.+)$/m.exec(text)?.[1] };
}
function permissionsFor(before: Identity | undefined, after: Identity | undefined): HelperPermissions {
  if (!before || !after || before.adhoc || after.adhoc || !before.authority || !after.authority) return 'regrant';
  return before.authority === after.authority && before.team === after.team ? 'kept' : 'regrant';
}

/** PIDs of running helper processes launched from this app bundle (never matches Cheetah3D or other apps). */
export async function helperPids(rt: Runtime, app: string): Promise<string[]> {
  const r = await rt.exec('pgrep', ['-f', `${app}/Contents/MacOS/C3DBridgeHelper`], { timeoutMs: 5000 }).catch(() => undefined);
  return r && r.code === 0 ? r.stdout.split(/\s+/).filter((x) => /^\d+$/.test(x)) : [];
}

/** Stops the helper process of this app bundle: TERM, then KILL after the timeout. True when none is left. */
export async function stopHelper(rt: Runtime, app: string, o: { timeoutMs?: number; settleMs?: number } = {}): Promise<boolean> {
  const timeout = o.timeoutMs ?? 5000;
  const settle = o.settleMs ?? 100;
  for (const signal of ['-TERM', '-KILL']) {
    const list = await helperPids(rt, app);
    if (list.length === 0) return true;
    await rt.exec('kill', [signal, ...list], { timeoutMs: 5000 }).catch(() => undefined);
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if ((await helperPids(rt, app)).length === 0) return true;
      await sleep(settle);
    }
  }
  return (await helperPids(rt, app)).length === 0;
}

const REGRANT = 'macOS will ask for Accessibility and Screen Recording again: the new helper has a different code signature.';

export async function updateHelper(rt: Runtime, o: HelperUpdateOptions = {}): Promise<HelperUpdateResult> {
  const sources = o.sources ?? helperSources();
  const now = o.now ?? ((): Date => new Date());
  const settleMs = o.settleMs ?? 100;
  const installed = installedHelperApp(rt);
  const dest = o.destApp ?? (installed && inside(installed, rt.paths.root) ? installed : installed ? undefined : join(rt.paths.root, 'helper', HELPER_APP_NAME));
  if (!dest) {
    return { action: 'skipped', ...(installed ? { path: installed } : {}), permissions: 'n/a', detail: `The helper at ${installed ?? '?'} is not managed by c3d-mcp (for example a Homebrew cask): update it there (brew upgrade --cask c3d-bridge-helper).` };
  }
  const srcApp = sources.app.find((p) => existsSync(p));
  const srcZip = sources.zip.find((p) => existsSync(p));
  if (!srcApp && !srcZip) return { action: 'skipped', permissions: 'n/a', detail: 'No helper app is bundled with this package.' };
  const to = srcApp ? readAppVersion(srcApp) : await bundledHelperVersion(rt.exec, sources);
  const present = existsSync(dest);
  const from = present ? readAppVersion(dest) : undefined;

  // Decide.
  let reason: 'install' | 'update' | 'repair' | 'force' | undefined;
  if (!present) reason = 'install';
  else {
    const valid = await rt.exec('codesign', ['--verify', '--deep', '--strict', dest], { timeoutMs: 20_000 }).then((r) => r.code === 0, () => false);
    if (o.force) reason = 'force';
    else if (from === undefined || (to !== undefined && compareSemver(from, to) < 0)) reason = 'update';
    else if (!valid) reason = 'repair';
  }
  if (!reason) return { action: 'unchanged', from, ...(to ? { to } : {}), path: dest, permissions: 'n/a', detail: `The helper app is current (${from ?? '?'}).` };

  // Stage and verify the new bundle first: nothing has been touched yet.
  const helperDir = dirname(dest);
  const stageDir = join(helperDir, `.staging-${process.pid}`);
  const staged = join(stageDir, HELPER_APP_NAME);
  await mkdir(helperDir, { recursive: true, mode: 0o700 });
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true, mode: 0o700 });
  const cleanStage = (): Promise<void> => rm(stageDir, { recursive: true, force: true });
  const copy = srcApp ? await rt.exec('ditto', [srcApp, staged]) : await rt.exec('ditto', ['-x', '-k', srcZip as string, stageDir]);
  if (copy.code !== 0 || !existsSync(staged)) {
    await cleanStage();
    return { action: 'failed', ...(from ? { from } : {}), ...(to ? { to } : {}), path: dest, permissions: 'n/a', detail: `Could not unpack the bundled helper (${copy.stderr.trim() || 'ditto failed'}); nothing was changed.` };
  }
  const stagedOk = await rt.exec('codesign', ['--verify', '--deep', '--strict', staged], { timeoutMs: 20_000 }).then((r) => r.code === 0, () => false);
  const stagedVersion = readAppVersion(staged);
  if (!stagedOk || (to !== undefined && stagedVersion !== to)) {
    await cleanStage();
    return { action: 'failed', ...(from ? { from } : {}), ...(to ? { to } : {}), path: dest, permissions: 'n/a', detail: `The bundled helper failed verification (${!stagedOk ? 'code signature check' : `version ${stagedVersion ?? '?'} instead of ${to ?? '?'}`}); the installed helper was not touched.` };
  }
  const before = present ? await identityOf(rt, dest) : undefined;
  const after = await identityOf(rt, staged);

  // Fresh install: nothing to stop or back up.
  if (!present) {
    await rename(staged, dest);
    await cleanStage();
    return { action: 'installed', ...(to ? { to } : {}), path: dest, permissions: 'regrant', detail: `Helper app ${to ?? ''} installed. Grant it Accessibility (and Screen Recording for screenshots) in System Settings > Privacy & Security.` };
  }

  // Back up the current app.
  const backupRoot = join(o.backupsDir ?? rt.paths.backupsDir, `helper-${stamp(now())}`);
  const backup = join(backupRoot, HELPER_APP_NAME);
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const bk = await rt.exec('ditto', [dest, backup]);
  if (bk.code !== 0) {
    await cleanStage();
    return { action: 'failed', ...(from ? { from } : {}), ...(to ? { to } : {}), path: dest, permissions: 'n/a', detail: `Could not back up the current helper (${bk.stderr.trim() || 'ditto failed'}); nothing was changed.` };
  }

  const start = async (app: string, expected: string | undefined, timeoutMs: number): Promise<boolean> => {
    await rt.exec('open', ['-g', '-a', app, '--args', '--socket', rt.paths.helperSock], { timeoutMs: 10_000 }).catch(() => undefined);
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const r = await rt.helper.call<{ version?: string }>('ping', {}, 2000).catch(() => undefined);
      if (r && (expected === undefined || r.version === expected)) return true;
      await sleep(Math.max(settleMs, 1));
    }
    return false;
  };

  if (!(await stopHelper(rt, dest, { timeoutMs: o.stopTimeoutMs, settleMs }))) {
    await cleanStage();
    return { action: 'failed', ...(from ? { from } : {}), ...(to ? { to } : {}), path: dest, backup, permissions: 'n/a', detail: 'Could not stop the running helper (it ignored TERM and KILL); nothing was replaced. Quit "C3D Bridge Helper" in Activity Monitor and try again.' };
  }
  await rm(rt.paths.helperSock, { force: true });

  // Swap: two renames; the old app stays next to the new one until the new one has proven itself.
  const old = `${dest}.old`;
  await rm(old, { recursive: true, force: true });
  await rename(dest, old);
  await rename(staged, dest);
  await cleanStage();

  if (await start(dest, to, o.startTimeoutMs ?? 10_000)) {
    await rm(old, { recursive: true, force: true });
    const perms = permissionsFor(before, after);
    return {
      action: reason === 'repair' ? 'repaired' : reason === 'install' ? 'installed' : 'updated',
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      path: dest,
      backup,
      permissions: perms,
      detail: `Helper app ${reason === 'repair' ? 'repaired' : 'updated'}${from && to ? ` ${from} -> ${to}` : ''}; the previous app is kept in ${backupRoot}. ${perms === 'kept' ? 'It has the same signing identity, so macOS keeps the Accessibility and Screen Recording grants.' : REGRANT}`,
    };
  }

  // The new helper did not come up as expected: put the old one back.
  const dying = await helperPids(rt, dest);
  if (dying.length > 0) await rt.exec('kill', ['-KILL', ...dying]).catch(() => undefined);
  await rm(dest, { recursive: true, force: true });
  await rename(old, dest);
  await rm(rt.paths.helperSock, { force: true });
  const restarted = await start(dest, from, o.startTimeoutMs ?? 10_000);
  return {
    action: 'rolled-back',
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    path: dest,
    backup,
    permissions: 'n/a',
    detail: `The new helper (${to ?? '?'}) did not start correctly, so ${from ?? 'the previous helper'} was restored${restarted ? ' and restarted' : ' (it will start on demand)'}. Run \`c3d-mcp doctor\` and report this.`,
  };
}
