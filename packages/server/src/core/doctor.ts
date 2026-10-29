import { stat } from 'node:fs/promises';
import { BridgeError } from '../toolkit.js';
import { compareSemver, packageVersion, readRuntimeVersionFile } from './assets.js';
import { readManifest } from './install.js';
import type { Runtime } from './runtime.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';
export interface DoctorCheck { name: string; status: CheckStatus; detail: string; fix: string }
export interface DoctorReport { ok: boolean; summary: string; checks: DoctorCheck[] }

let pingCounter = 0;

const ok = (name: string, detail: string): DoctorCheck => ({ name, status: 'ok', detail, fix: '' });
const warn = (name: string, detail: string, fix: string): DoctorCheck => ({ name, status: 'warn', detail, fix });
const bad = (name: string, detail: string, fix: string): DoctorCheck => ({ name, status: 'fail', detail, fix });

async function mode(path: string): Promise<number | undefined> {
  return stat(path).then((s) => s.mode & 0o777, () => undefined);
}

interface HelperPermissions { accessibility?: boolean; screenRecording?: boolean }
interface HelperWindow { title?: string; role?: string; subrole?: string; main?: boolean }

export async function doctor(rt: Runtime): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const { paths } = rt;
  const guarded = async (name: string, fn: () => DoctorCheck | DoctorCheck[] | Promise<DoctorCheck | DoctorCheck[]>): Promise<void> => {
    try {
      const r = await fn();
      checks.push(...(Array.isArray(r) ? r : [r]));
    } catch (err) {
      checks.push(bad(name, err instanceof Error ? err.message : String(err), 'Run `c3d-mcp doctor --json` and check ~/Library/Logs/c3d-mcp/.'));
    }
  };

  await guarded('node', () => {
    const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
    return major >= 22 ? ok('node', `Node ${process.versions.node}, c3d-mcp ${packageVersion()}, platform ${process.platform}/${process.arch}`) : bad('node', `Node ${process.versions.node} is too old`, 'Install Node 22 or newer.');
  });
  await guarded('platform', () => (process.platform === 'darwin' ? ok('platform', 'macOS') : bad('platform', `Unsupported platform ${process.platform}`, 'c3d-mcp only works on macOS.')));
  await guarded('profile', () => ok('profile', `profile=${rt.config.profile}, trigger=${rt.config.trigger}, exec ${rt.config.disableExec ? 'disabled' : 'enabled'}, assets ${rt.config.disableAssets ? 'disabled' : 'enabled'}`));

  // Installation files.
  let installed = false;
  await guarded('bridge-installed', async () => {
    const [macro, runtimeFile, secret] = await Promise.all([mode(paths.macroFile), mode(paths.runtimeFile), mode(paths.secret)]);
    const missing = [macro === undefined && 'loader macro', runtimeFile === undefined && 'runtime.js', secret === undefined && 'secret'].filter(Boolean);
    if (missing.length > 0) return bad('bridge-installed', `Missing: ${missing.join(', ')}`, 'Run `c3d-mcp install` (or call c3d_install_bridge), then restart Cheetah3D.');
    installed = true;
    const rootMode = await mode(paths.root);
    if (rootMode !== 0o700 || secret !== 0o600) return warn('bridge-installed', `Loose permissions (dir ${rootMode?.toString(8)}, secret ${secret?.toString(8)})`, `chmod 700 "${paths.root}" && chmod 600 "${paths.secret}"`);
    const manifest = await readManifest(rt);
    return ok('bridge-installed', `${paths.macroFile}${manifest ? ` (manifest ${manifest.version})` : ' (no install manifest)'}`);
  });

  await guarded('runtime-version', () => {
    if (!installed) return warn('runtime-version', 'Not installed', 'Run `c3d-mcp install`.');
    const have = readRuntimeVersionFile(paths.runtimeFile);
    const want = rt.bundledRuntimeVersion;
    if (!have) return warn('runtime-version', 'Installed runtime.js has no recognisable version', 'Run `c3d-mcp install`.');
    if (!want) return ok('runtime-version', `runtime ${have}, protocol 1 (no bundled runtime to compare)`);
    const cmp = compareSemver(have, want);
    if (have.split('.')[0] !== want.split('.')[0]) return bad('runtime-version', `Installed ${have} vs bundled ${want}: major mismatch (VERSION_SKEW)`, 'Run `c3d-mcp install` and restart Cheetah3D.');
    if (cmp < 0) return warn('runtime-version', `Installed ${have} is older than bundled ${want}`, 'Run `c3d-mcp install`.');
    return ok('runtime-version', `runtime ${have}${cmp > 0 ? ` (newer than bundled ${want})` : ''}, protocol 1`);
  });

  // Cheetah3D process.
  const app = await rt.probe.inspect().catch(() => ({ running: false, source: 'pgrep' as const }));
  checks.push(app.running ? ok('cheetah-running', `Cheetah3D is running${'pid' in app && app.pid ? ` (pid ${app.pid})` : ''} [via ${app.source}]`) : bad('cheetah-running', 'Cheetah3D is not running', 'Start Cheetah3D.'));
  await guarded('cheetah-version', async () => {
    let version = 'version' in app ? app.version : undefined;
    if (!version) {
      const r = await rt.exec('mdls', ['-raw', '-name', 'kMDItemVersion', '/Applications/Cheetah3D.app'], { timeoutMs: 5000 });
      if (r.code === 0 && r.stdout.trim() && r.stdout.trim() !== '(null)') version = r.stdout.trim();
    }
    if (!version) return warn('cheetah-version', 'Could not determine the Cheetah3D version', 'Make sure Cheetah3D 8.1.3 is installed in /Applications.');
    return version.startsWith('8.1') ? ok('cheetah-version', `Cheetah3D ${version}`) : warn('cheetah-version', `Cheetah3D ${version}; c3d-mcp targets 8.1.3`, 'Some operations may behave differently.');
  });
  if ('frontmost' in app && app.frontmost !== undefined) checks.push(ok('cheetah-frontmost', app.frontmost ? 'Cheetah3D is the frontmost app' : 'Cheetah3D is in the background (the server activates it only while pressing the bridge menu)'));

  // Helper, permissions, windows, menu.
  const helperUp = rt.helper.available();
  let permissions: HelperPermissions | undefined;
  await guarded('helper', async () => {
    if (!helperUp) return warn('helper', 'C3D Bridge Helper not available: degraded mode (osascript trigger)', 'Install the helper app (`c3d-mcp install`), then grant it Accessibility and Screen Recording.');
    try {
      const r = await rt.helper.call<{ version?: string; pid?: number }>('ping', {}, 5000);
      permissions = await rt.helper.call<HelperPermissions>('permissions', {}, 5000).catch(() => undefined);
      return ok('helper', `Helper reachable (version ${r.version ?? '?'}, pid ${r.pid ?? '?'})`);
    } catch (err) {
      return warn('helper', `Helper installed but unreachable: ${err instanceof Error ? err.message : String(err)}`, 'Open "C3D Bridge Helper" once, or reinstall it. Falling back to osascript.');
    }
  });
  checks.push(
    permissions
      ? permissions.accessibility
        ? ok('accessibility', 'Accessibility granted to the helper')
        : bad('accessibility', 'Accessibility NOT granted to the helper', 'System Settings > Privacy & Security > Accessibility: enable "C3D Bridge Helper".')
      : warn('accessibility', 'Unknown without the helper (the osascript fallback needs Accessibility for the app that launched c3d-mcp)', 'Install the helper, or grant Accessibility to your terminal / MCP client.'),
    permissions
      ? permissions.screenRecording
        ? ok('screen-recording', 'Screen Recording granted to the helper')
        : warn('screen-recording', 'Screen Recording NOT granted (only c3d_capture_viewport needs it)', 'System Settings > Privacy & Security > Screen Recording: enable "C3D Bridge Helper".')
      : warn('screen-recording', 'Unknown without the helper', 'Install the helper to enable viewport capture.'),
  );

  await guarded('document-windows', async () => {
    if (!app.running) return warn('document-windows', 'Cheetah3D is not running', 'Start Cheetah3D and open or create a document.');
    if (helperUp) {
      try {
        const wins = await rt.helper.call<HelperWindow[]>('windows', {}, 5000);
        const docs = wins.filter((w) => w.subrole === 'AXStandardWindow');
        return docs.length > 0 ? ok('document-windows', `${docs.length} document window(s): ${docs.map((w) => w.title ?? '?').join(', ')}`) : bad('document-windows', 'No document window is open', 'Create or open a document in Cheetah3D (c3d_new_document).');
      } catch {
        // fall through to osascript
      }
    }
    const r = await rt.exec('osascript', ['-e', 'tell application "System Events" to tell process "Cheetah3D" to get name of (windows whose subrole is "AXStandardWindow")'], { timeoutMs: 10_000 });
    if (r.code !== 0) return warn('document-windows', `Could not list windows: ${r.stderr.trim().slice(0, 160)}`, 'Grant Accessibility to the process running c3d-mcp.');
    return r.stdout.trim() ? ok('document-windows', r.stdout.trim()) : bad('document-windows', 'No document window is open', 'Create or open a document in Cheetah3D.');
  });

  let menu: Awaited<ReturnType<Runtime['trigger']['menuState']>> = 'unknown';
  await guarded('menu-item', async () => {
    if (!app.running) return warn('menu-item', 'Cheetah3D is not running', 'Start Cheetah3D.');
    menu = await rt.trigger.menuState();
    if (menu === 'present') return ok('menu-item', 'Tools > Script > Macro Script > C3D-MCP > C3D-MCP Bridge.js is present');
    if (menu === 'absent') return bad('menu-item', 'The C3D-MCP menu item does not exist', 'Restart Cheetah3D (macros are discovered only at launch). If it is still missing run `c3d-mcp install`.');
    return warn('menu-item', 'Could not read the Cheetah3D menu', 'Grant Accessibility (helper or terminal) and retry.');
  });

  // Live round trip.
  await guarded('ping', async () => {
    if (!installed) return warn('ping', 'Skipped: bridge not installed', 'Run `c3d-mcp install`.');
    if (!app.running) return warn('ping', 'Skipped: Cheetah3D is not running', 'Start Cheetah3D.');
    const counter = ++pingCounter;
    const started = rt.clock.now();
    try {
      const r = await rt.bridge.one<{ counter?: number; echo?: string; runtimeVersion?: string }>('ping', { counter, echo: `doctor-${counter}` }, { deadlineMs: 15_000 });
      if (r.counter !== counter) return bad('ping', `Ping echoed counter ${String(r.counter)}, expected ${counter}`, 'Another client may be using the bridge, or the runtime is stale: run `c3d-mcp install`.');
      return ok('ping', `Round trip ${rt.clock.now() - started} ms, runtime ${r.runtimeVersion ?? '?'}, counter ${counter}`);
    } catch (err) {
      if (err instanceof BridgeError) {
        const fix = err.hint ?? 'See the error code in docs/troubleshooting.';
        if (err.code === 'BLOCKED_BY_MODAL') return bad('modal', err.message, fix);
        return bad('ping', `${err.code}: ${err.message}`, fix);
      }
      throw err;
    }
  });
  await guarded('modal', async () => {
    if (checks.some((c) => c.name === 'modal')) return [];
    if (helperUp && app.running) {
      const m = await rt.helper.call<{ open?: boolean; dialogs?: { title?: string; text?: string }[] }>('modalState', {}, 5000).catch(() => undefined);
      if (m?.open) return bad('modal', `A dialog is open: ${m.dialogs?.map((d) => d.text ?? d.title ?? '?').join(' | ') ?? ''}`, 'Dismiss the dialog in Cheetah3D.');
      if (m) return ok('modal', 'No dialog is open');
    }
    return checks.find((c) => c.name === 'ping')?.status === 'ok' ? ok('modal', 'No dialog blocked the ping') : warn('modal', 'Unknown (needs the helper or a successful ping)', 'Install the helper for modal detection.');
  });

  const failures = checks.filter((c) => c.status === 'fail').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  return { ok: failures === 0, summary: failures === 0 ? (warnings === 0 ? 'All checks passed' : `${warnings} warning(s), no failures`) : `${failures} failure(s), ${warnings} warning(s)`, checks };
}
