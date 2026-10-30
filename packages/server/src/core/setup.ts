// `c3d-mcp setup`: one guided pass over requirements, bridge + helper install, permissions, client configuration, skills and a smoke test.
// Every OS or process interaction goes through SetupDeps so the whole flow runs in tests without touching the machine.
import { existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { arch as osArch, homedir } from 'node:os';
import { join } from 'node:path';
import { BridgeError } from '../toolkit.js';
import { PACKAGE_ROOT } from './assets.js';
import { CLIENT_LABELS, SETUP_CLIENTS, configureClient, detectClients, type ConfigureResult, type SetupClient } from './clientConfigs.js';
import { doctor, type DoctorReport } from './doctor.js';
import { createHelperInstaller } from './helperInstall.js';
import { install, type HelperInstaller, type InstallMode, type InstallReport } from './install.js';
import type { Runtime } from './runtime.js';
import { openPane, parseMacOSMajor, systemFrontWindowTitle, type OpenPaneDeps, type OpenPaneResult, type PrivacyPane } from './settingsPanes.js';
import { installSkills, type SkillResult, type SkillTarget, type SkillsOptions } from './skillsInstall.js';

export interface SetupOptions {
  yes?: boolean;
  dryRun?: boolean;
  /** `all` = every detected client, `none`, an explicit list, or undefined = ask per detected client (or all detected with `yes`). */
  clients?: 'all' | 'none' | SetupClient[];
  skills?: boolean;
  /** Absolute node binary to pin in client configs (switches to the absolute launch form). */
  nodePath?: string;
  /** Seconds to wait for a permission grant (default 180). */
  permissionTimeoutSec?: number;
  /** How the bridge and helper are installed: auto (default), repair or reinstall (see `c3d-mcp install`). */
  mode?: InstallMode;
}

export interface SmokeResult { status: 'ok' | 'fail' | 'skipped'; detail: string; hint?: string }

export interface SetupDeps {
  rt: Runtime;
  /** Prints human output (a no-op in --json mode). */
  out(text: string): void;
  /** Asks a yes/no question. Never called with `yes`, or when there is no terminal. */
  confirm(question: string, defaultYes: boolean): Promise<boolean>;
  home?: string;
  binPath?: string;
  macosVersion?: () => Promise<string | undefined>;
  arch?: string;
  nodeVersion?: string;
  exists?: (path: string) => boolean;
  installHelper?: HelperInstaller;
  open?: (url: string) => Promise<void>;
  reveal?: (path: string) => Promise<void>;
  frontWindowTitle?: OpenPaneDeps['frontWindowTitle'];
  sleep?: (ms: number) => Promise<void>;
  paneSettleMs?: number;
  pollIntervalMs?: number;
  openPaneFn?: typeof openPane;
  skills?: (opts: SkillsOptions) => SkillResult[];
  smoke?: () => Promise<SmokeResult>;
  now?: () => Date;
}

export type RequirementStatus = 'ok' | 'missing' | 'fix';
export interface Requirement { name: string; status: RequirementStatus; detail: string; fix?: string }
export interface SetupStep { name: string; status: 'done' | 'unchanged' | 'skipped' | 'warn' | 'fail'; detail: string }
export interface SetupClientEntry { client: SetupClient; label: string; detected: boolean; selected: boolean; result?: ConfigureResult }

export interface SetupReport {
  ok: boolean;
  dryRun: boolean;
  requirements: { macos: { version?: string; major?: number; arch: string }; node: { version: string; ok: boolean }; rows: Requirement[] };
  steps: SetupStep[];
  clients: SetupClientEntry[];
  skills: { status: 'installed' | 'skipped'; detail: string; results: SkillResult[] };
  doctor?: DoctorReport;
  smoke: SmokeResult;
  hints: string[];
}

const CHEETAH_APP = '/Applications/Cheetah3D.app';
const EXAMPLE_PROMPTS = [
  'Open Cheetah3D, make a new document and model a simple low-poly rocket, then render it.',
  'List the objects in my current Cheetah3D scene and tell me which ones have no material.',
  'Add a three-point light setup to the scene and render a preview image.',
];

type PermState = 'granted' | 'missing' | 'unknown';

function permState(report: DoctorReport | undefined, check: string): PermState {
  const c = report?.checks.find((x) => x.name === check);
  return !c ? 'unknown' : c.status === 'ok' ? 'granted' : c.status === 'fail' ? 'missing' : 'unknown';
}

async function sysVersion(rt: Runtime): Promise<string | undefined> {
  const r = await rt.exec('sw_vers', ['-productVersion'], { timeoutMs: 5000 });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : undefined;
}

/** Test render through the bridge: new document (helper) then a 64x64 render, deleted again afterwards. */
export async function defaultSmoke(rt: Runtime): Promise<SmokeResult> {
  const file = join(rt.config.workDir, 'renders', `setup-smoke-${Date.now()}.png`);
  try {
    if (rt.helper.available()) await rt.helper.call('newDocument', {}, 20_000);
    await rt.bridge.one('setRenderSettings', { width: 64, height: 64 }, { deadlineMs: 30_000 });
    await mkdir(join(rt.config.workDir, 'renders'), { recursive: true });
    await rt.bridge.one('render', { path: file }, { deadlineMs: 120_000 });
    const size = await stat(file).then((s) => s.size, () => 0);
    if (size === 0) return { status: 'fail', detail: 'the render produced no image file', hint: 'Check c3d-mcp doctor for a modal dialog in Cheetah3D.' };
    return { status: 'ok', detail: `new document and a 64x64 render worked (${size} bytes)` };
  } catch (err) {
    const e = err instanceof BridgeError ? err : undefined;
    return { status: 'fail', detail: err instanceof Error ? err.message : String(err), hint: e?.hint ?? 'See docs/TROUBLESHOOTING.md (error codes) and run `c3d-mcp doctor`.' };
  } finally {
    await rm(file, { force: true }).catch(() => undefined);
  }
}

export async function runSetup(opts: SetupOptions, deps: SetupDeps): Promise<SetupReport> {
  const { rt } = deps;
  const out = (t: string): void => deps.out(t);
  const home = deps.home ?? homedir();
  const exists = deps.exists ?? existsSync;
  const dryRun = opts.dryRun === true;
  const yes = opts.yes === true;
  const sleep = deps.sleep ?? ((ms: number) => rt.clock.sleep(ms));
  const steps: SetupStep[] = [];
  const hints: string[] = [];
  const step = (name: string, status: SetupStep['status'], detail: string): void => {
    steps.push({ name, status, detail });
    out(`  [${status === 'fail' ? 'FAIL' : status === 'warn' ? 'warn' : status === 'done' ? 'done' : status === 'unchanged' ? 'same' : 'skip'}] ${name}: ${detail}\n`);
  };
  const ask = async (q: string, defaultYes: boolean): Promise<boolean> => (yes ? defaultYes : deps.confirm(q, defaultYes));

  // 1. Requirements.
  out('c3d-mcp setup\n\n1. Requirements\n');
  const macVersion = await (deps.macosVersion ?? ((): Promise<string | undefined> => sysVersion(rt)))();
  const major = parseMacOSMajor(macVersion);
  const arch = deps.arch ?? osArch();
  const nodeVersion = deps.nodeVersion ?? process.versions.node;
  const nodeOk = Number.parseInt(nodeVersion.split('.')[0] ?? '0', 10) >= 22;
  const app = await rt.probe.inspect().catch(() => ({ running: false, source: 'pgrep' as const }));
  let cheetahVersion = 'version' in app ? app.version : undefined;
  const appPresent = exists(CHEETAH_APP);
  if (!cheetahVersion && appPresent) {
    const r = await rt.exec('mdls', ['-raw', '-name', 'kMDItemVersion', CHEETAH_APP], { timeoutMs: 5000 });
    if (r.code === 0 && r.stdout.trim() && r.stdout.trim() !== '(null)') cheetahVersion = r.stdout.trim();
  }
  const supportOk = exists(rt.paths.supportDir);
  const helperPath = rt.helper.installedApp?.();
  const before = await doctor(rt).catch(() => undefined);
  const acc = permState(before, 'accessibility');
  const scr = permState(before, 'screen-recording');
  const detections = await detectClients({ home, exec: rt.exec, exists });

  const rows: Requirement[] = [
    { name: 'macOS', status: major !== undefined && major < 14 ? 'fix' : macVersion ? 'ok' : 'missing', detail: `${macVersion ?? 'unknown version'} (${arch})`, ...(major !== undefined && major < 14 ? { fix: 'c3d-mcp supports macOS 14 or newer.' } : {}) },
    { name: 'Node.js', status: nodeOk ? 'ok' : 'fix', detail: nodeVersion, ...(nodeOk ? {} : { fix: 'Install Node.js 22 or newer (brew install node@22).' }) },
    { name: 'Cheetah3D app', status: appPresent ? 'ok' : 'missing', detail: appPresent ? `${CHEETAH_APP}${cheetahVersion ? ` (${cheetahVersion})` : ''}` : `${CHEETAH_APP} not found`, ...(appPresent ? {} : { fix: 'Install Cheetah3D 8.1.3 from https://www.cheetah3d.com.' }) },
    { name: 'Cheetah3D running', status: app.running ? 'ok' : 'fix', detail: app.running ? 'running' : 'not running', ...(app.running ? {} : { fix: 'Start Cheetah3D (needed for the final test).' }) },
    { name: 'Support directory', status: supportOk ? 'ok' : 'fix', detail: rt.paths.supportDir, ...(supportOk ? {} : { fix: 'Launch Cheetah3D once so it creates it.' }) },
    { name: 'Helper app', status: helperPath ? 'ok' : 'missing', detail: helperPath ?? 'not installed yet', ...(helperPath ? {} : { fix: 'Installed in step 2.' }) },
    { name: 'Accessibility', status: acc === 'granted' ? 'ok' : 'fix', detail: acc === 'granted' ? 'granted to the helper' : acc === 'missing' ? 'not granted' : 'unknown until the helper runs', ...(acc === 'granted' ? {} : { fix: 'Granted in step 3.' }) },
    { name: 'Screen Recording', status: scr === 'granted' ? 'ok' : 'fix', detail: scr === 'granted' ? 'granted to the helper' : scr === 'missing' ? 'not granted (optional, viewport capture only)' : 'unknown until the helper runs (optional)' },
    ...detections.map((d): Requirement => ({ name: CLIENT_LABELS[d.client], status: d.detected ? 'ok' : 'missing', detail: d.detail })),
  ];
  for (const r of rows) out(`  [${r.status}]${' '.repeat(Math.max(1, 9 - r.status.length))}${r.name.padEnd(18)} ${r.detail}${r.fix && r.status !== 'ok' ? `  -> ${r.fix}` : ''}\n`);

  const requirements: SetupReport['requirements'] = { macos: { ...(macVersion ? { version: macVersion } : {}), ...(major !== undefined ? { major } : {}), arch }, node: { version: nodeVersion, ok: nodeOk }, rows };
  const finish = (partial: Pick<SetupReport, 'clients' | 'skills' | 'doctor' | 'smoke'>, ok: boolean): SetupReport => ({ ok, dryRun, requirements, steps, hints, ...partial });
  const noSkills: SetupReport['skills'] = { status: 'skipped', detail: 'not reached', results: [] };
  const noSmoke: SmokeResult = { status: 'skipped', detail: 'not reached' };

  if (!nodeOk) {
    step('requirements', 'fail', `Node.js ${nodeVersion} is too old (22+ required)`);
    hints.push('Install Node.js 22 or newer, then rerun `c3d-mcp setup`.');
    return finish({ clients: [], skills: noSkills, smoke: noSmoke }, false);
  }

  // 2. Bridge and helper.
  out('\n2. Bridge and helper\n');
  let installReport: InstallReport | undefined;
  if (dryRun) {
    const preview = await install(rt, { mode: opts.mode ?? 'auto', dryRun: true, installHelper: deps.installHelper ?? createHelperInstaller(rt.exec) });
    if (preview.state) out(`  Detected: ${preview.state.summary}\n`);
    if (!preview.ok) step('install', 'fail', preview.steps.at(-1)?.detail ?? 'install cannot start');
    else if (preview.plan.length === 0) step('install', 'unchanged', 'dry run: nothing to do');
    else for (const line of preview.plan) step('install', 'skipped', `dry run: would ${line}`);
  } else {
    installReport = await install(rt, { mode: opts.mode ?? 'auto', installHelper: deps.installHelper ?? createHelperInstaller(rt.exec) });
    if (installReport.state) out(`  Detected: ${installReport.state.summary}\n`);
    for (const s of installReport.steps) step(s.name, s.status, s.detail);
    if (!installReport.ok) {
      hints.push(...installReport.guidance);
      return finish({ clients: [], skills: noSkills, smoke: noSmoke }, false);
    }
    if (app.running && (installReport.restartNeeded || installReport.changed)) {
      out('  Cheetah3D is running: restart it yourself once so the new C3D-MCP menu appears (setup never quits it).\n');
      hints.push('Restart Cheetah3D once so it picks up the C3D-MCP menu, then run `c3d-mcp doctor`.');
    }
  }

  // 3. Permissions.
  out('\n3. Permissions\n');
  const helperNow = rt.helper.installedApp?.();
  if (dryRun) {
    step('permissions', 'skipped', 'dry run: would open System Settings > Privacy & Security > Accessibility and wait for the grant');
  } else if (!helperNow) {
    step('permissions', 'warn', 'no helper app installed: nothing to grant (degraded mode needs Accessibility for your terminal / MCP client instead)');
  } else {
    const timeoutMs = (opts.permissionTimeoutSec ?? 180) * 1000;
    const interval = deps.pollIntervalMs ?? 2000;
    const openUrl = deps.open ?? (async (url: string): Promise<void> => { await rt.exec('open', [url], { timeoutMs: 10_000 }); });
    const reveal = deps.reveal ?? (async (p: string): Promise<void> => { await rt.exec('open', ['-R', p], { timeoutMs: 10_000 }); });
    const paneOpener = deps.openPaneFn ?? openPane;
    const grant = async (pane: PrivacyPane, check: string, label: string): Promise<PermState> => {
      let state = permState(await doctor(rt).catch(() => undefined), check);
      if (state === 'granted') {
        step(label, 'unchanged', 'already granted');
        return state;
      }
      const res: OpenPaneResult = await paneOpener(pane, {
        open: openUrl,
        frontWindowTitle: deps.frontWindowTitle ?? systemFrontWindowTitle(rt.exec),
        sleep,
        macosMajor: major,
        logger: rt.logger,
        ...(deps.paneSettleMs !== undefined ? { settleMs: deps.paneSettleMs } : {}),
      });
      rt.logger.info('permission pane', { pane, macos: macVersion ?? 'unknown', candidate: res.candidate ?? 'root', ok: res.ok });
      if (res.ok) out(`  Opened ${res.manualPath}${res.verified ? '' : ' (could not verify the page)'}.\n`);
      else out(`  Could not open the ${label} page directly. Open it by hand: ${res.manualPath}\n`);
      await reveal(helperNow).catch(() => undefined);
      out(`  Click + in that list and add (or drag in) the revealed "C3D Bridge Helper", then switch it on. Waiting up to ${Math.round(timeoutMs / 1000)} s...\n`);
      for (let waited = 0; ; waited += interval) {
        state = permState(await doctor(rt).catch(() => undefined), check);
        if (state === 'granted' || waited >= timeoutMs) break;
        await sleep(interval);
      }
      step(label, state === 'granted' ? 'done' : 'warn', state === 'granted' ? 'granted' : `not granted yet; grant it later (${res.manualPath}) and run \`c3d-mcp doctor\``);
      if (state !== 'granted') hints.push(`Grant ${label} to "C3D Bridge Helper": ${res.manualPath}.`);
      return state;
    };
    if (yes || (await ask('Open System Settings now to grant Accessibility to the helper?', true))) {
      await grant('accessibility', 'accessibility', 'Accessibility');
      if (!yes && scr !== 'granted' && (await ask('Also grant Screen Recording (only needed for viewport screenshots)?', false))) await grant('screenRecording', 'screen-recording', 'Screen Recording');
      else if (scr !== 'granted') out('  Screen Recording is optional (c3d_capture_viewport only); skipped.\n');
    } else {
      step('permissions', 'skipped', 'declined; grant Accessibility later (System Settings > Privacy & Security > Accessibility)');
    }
  }

  // 4. Clients.
  out('\n4. MCP clients\n');
  const detectedSet = new Set(detections.filter((d) => d.detected).map((d) => d.client));
  const entries: SetupClientEntry[] = [];
  const launch = opts.nodePath ? { form: 'absolute' as const, nodePath: opts.nodePath, binPath: deps.binPath ?? join(PACKAGE_ROOT, 'bin', 'c3d-mcp.js') } : {};
  for (const client of SETUP_CLIENTS) {
    const detected = detectedSet.has(client);
    let selected: boolean;
    if (opts.clients === 'none') selected = false;
    else if (Array.isArray(opts.clients)) selected = opts.clients.includes(client);
    else if (opts.clients === 'all') selected = detected;
    else selected = detected && (yes || (await ask(`Add the c3d server to ${CLIENT_LABELS[client]}?`, true)));
    const entry: SetupClientEntry = { client, label: CLIENT_LABELS[client], detected, selected };
    if (selected) {
      entry.result = await configureClient(client, {
        home,
        launch,
        dryRun,
        exec: rt.exec,
        ...(deps.now ? { now: deps.now } : {}),
        confirmOverwrite: yes ? undefined : (c, target) => deps.confirm(`${CLIENT_LABELS[c]} already has a different "c3d" entry (${target}). Replace it? (a backup is made)`, false),
      });
      const r = entry.result;
      step(entry.label, r.status === 'failed' || r.status === 'refused' ? 'fail' : r.status === 'added' || r.status === 'replaced' ? 'done' : r.status === 'would-add' ? 'skipped' : 'unchanged', `${r.detail}${r.backup ? ` (backup ${r.backup})` : ''}`);
      if (r.status === 'refused' || r.status === 'failed') hints.push(`${entry.label}: ${r.detail}`);
      if (client === 'claude-desktop' && (r.status === 'added' || r.status === 'replaced')) out('  Restart Claude Desktop to load the server.\n');
    }
    entries.push(entry);
  }
  if (!entries.some((e) => e.selected)) out('  No client configured. `c3d-mcp config <client>` prints a snippet for any client.\n');

  // 5. Skills.
  out('\n5. Agent skills\n');
  let skills: SetupReport['skills'] = { status: 'skipped', detail: 'skipped (--no-skills)', results: [] };
  if (opts.skills !== false) {
    const targets: SkillTarget[] = [];
    if (detectedSet.has('claude-code')) targets.push('claude');
    if (detectedSet.has('codex')) targets.push('codex');
    if (detectedSet.has('antigravity')) targets.push('antigravity');
    if (targets.length === 0) skills = { status: 'skipped', detail: 'no Claude Code, Codex or Antigravity detected', results: [] };
    else if (!dryRun && !(await ask(`Install the Cheetah3D agent skills for ${targets.join(', ')}?`, true))) skills = { status: 'skipped', detail: 'declined', results: [] };
    else {
      try {
        const results = (deps.skills ?? installSkills)({ targets, home, dryRun });
        skills = { status: 'installed', detail: `${results.length} skill folder(s) for ${targets.join(', ')}${dryRun ? ' (dry run)' : ''}`, results };
      } catch (err) {
        skills = { status: 'skipped', detail: err instanceof Error ? err.message : String(err), results: [] };
        hints.push(`Skills: ${skills.detail}`);
      }
    }
  }
  step('skills', skills.status === 'installed' ? (dryRun ? 'skipped' : 'done') : 'skipped', skills.detail);

  // 6. Verify.
  out('\n6. Verify\n');
  let final: DoctorReport | undefined;
  let smoke: SmokeResult = { status: 'skipped', detail: 'dry run' };
  if (!dryRun) {
    final = await doctor(rt).catch(() => undefined);
    if (final) {
      out(`  doctor: ${final.summary}\n`);
      for (const c of final.checks.filter((x) => x.status !== 'ok')) {
        out(`    [${c.status === 'fail' ? 'FAIL' : 'warn'}] ${c.name}: ${c.detail}\n`);
        if (c.status === 'fail' && c.fix) hints.push(`${c.name}: ${c.fix}`);
      }
    }
    const menuOk = final?.checks.find((c) => c.name === 'menu-item')?.status === 'ok';
    if (!(await rt.probe.inspect().then((a) => a.running, () => false))) smoke = { status: 'skipped', detail: 'Cheetah3D is not running' };
    else if (!menuOk) smoke = { status: 'skipped', detail: 'the C3D-MCP menu is not available yet (restart Cheetah3D)' };
    else smoke = await (deps.smoke ?? ((): Promise<SmokeResult> => defaultSmoke(rt)))();
    out(`  test render: ${smoke.status} - ${smoke.detail}\n`);
    if (smoke.status === 'fail' && smoke.hint) hints.push(`Test render failed: ${smoke.hint}`);
  } else {
    out('  dry run: nothing was changed and no test render was made.\n');
  }

  const clientFailed = entries.some((e) => e.result?.status === 'failed' || e.result?.status === 'refused');
  const ok = dryRun ? supportOk && appPresent : !clientFailed && smoke.status !== 'fail' && (final?.ok ?? false);
  if (ok && !dryRun) {
    out('\nAll set. Try these prompts in your AI client:\n');
    for (const p of EXAMPLE_PROMPTS) out(`  - ${p}\n`);
  } else if (!ok) {
    out('\nNot finished yet:\n');
    for (const h of hints.length ? hints : ['Run `c3d-mcp doctor` for details; docs/TROUBLESHOOTING.md lists every error code.']) out(`  - ${h}\n`);
  } else {
    out('\nDry run complete. Run `c3d-mcp setup` without --dry-run to apply.\n');
  }
  return finish({ clients: entries, skills, doctor: final, smoke }, ok);
}
