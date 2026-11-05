import { lstatSync, readdirSync, readFileSync, readlinkSync, rmdirSync, rmSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { backup, lmStudioConfigPath, unconfigureClient, unconfigureLmStudio, type SetupClient } from './clientConfigs.js';
import { MACRO_DIR_NAME } from './paths.js';
import { systemExec, type Executor } from './platform.js';
import { SKILL_MARKER, SKILL_TARGETS, targetDir } from './skillsInstall.js';

/**
 * Finds and removes every earlier c3d-mcp installation, whatever installed it (install.sh, npm, npx, Homebrew cask, the Claude Desktop extension,
 * the Claude Code plugin, a hand copy). Works on files directly: no Homebrew, npm or Node needed. Removed files go to the Trash, except the bridge
 * secret, which is deleted. Nothing outside what is positively identified as c3d-mcp is touched; git checkouts of the source are never scanned.
 */

export const OLD_HELPER_BUNDLE_ID = 'dev.c3dmcp.helper';
export const OLD_LAUNCHAGENT_LABEL = 'dev.c3dmcp.helper';
const LOADER_MARKER = '// c3d-mcp bridge loader';

export type LegacyKind =
  | 'install-sh' | 'shell-path' | 'npm-global' | 'npx-cache' | 'helper-app' | 'cask' | 'launchagent'
  | 'bridge' | 'client' | 'claude-plugin' | 'desktop-extension' | 'skills' | 'unmarked-skills' | 'logs' | 'permissions';

export type QuitApp = 'Cheetah3D' | 'Claude Desktop' | 'Claude Code';

export interface LegacyFinding {
  id: string;
  kind: LegacyKind;
  label: string;
  /** How it most likely got there. */
  installedBy: string;
  /** Files or folders that would be moved to the Trash (or, for config edits, the files that would be edited). */
  paths: string[];
  evidence: string;
  /** false = listed for information only; the user decides by hand. */
  removable: boolean;
  needsQuit?: QuitApp;
  /** Extra data a remover needs (client name, plugin id, ...). */
  data?: Record<string, string>;
}

export interface ScanOptions {
  home?: string;
  /** Cheetah3D support dir (default ~/Library/Application Support/Cheetah3D). */
  supportDir?: string;
  /** Config entries / folders that contain one of these strings belong to the CURRENT app and are never reported. */
  keepPaths?: string[];
  exec?: Executor;
  /** Is the named app running? Default: pgrep. */
  running?: (app: QuitApp) => Promise<boolean>;
  /** Extra folders to look for helper copies in (tests; Spotlight is used otherwise). */
  extraHelperLocations?: string[];
  /** Root that the system locations (/opt/homebrew, /usr/local, /Applications) are resolved under. Default `/`; tests use a temp dir. */
  systemRoot?: string;
}

const PROCESS_NAME: Record<QuitApp, string> = { Cheetah3D: 'Cheetah3D', 'Claude Desktop': 'Claude', 'Claude Code': 'claude' };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exists = (p: string): boolean => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
const readText = (p: string): string | undefined => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
};
const readJson = (p: string): unknown => {
  const t = readText(p);
  if (t === undefined) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
};
const ls = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
const isRepoCheckout = (dir: string): boolean => exists(join(dir, '.git'));
/** True when `p` sits anywhere inside a git working copy (a developer's build output, never an install). */
const insideGitCheckout = (p: string): boolean => {
  let d = dirname(p);
  for (let i = 0; i < 25 && d !== dirname(d); i++, d = dirname(d)) if (exists(join(d, '.git'))) return true;
  return false;
};
/** Copies the installer itself keeps for rollback; user data, never reported. */
const insideBackups = (p: string): boolean => p.split('/').includes('MCP-backups');

async function defaultRunning(exec: Executor, app: QuitApp): Promise<boolean> {
  const r = await exec('/usr/bin/pgrep', ['-x', PROCESS_NAME[app]], { timeoutMs: 5000 }).catch(() => undefined);
  return r?.code === 0;
}

const paths = (o: ScanOptions): { home: string; support: string } => {
  const home = o.home ?? homedir();
  return { home, support: o.supportDir ?? join(home, 'Library', 'Application Support', 'Cheetah3D') };
};
const keeps = (o: ScanOptions, text: string): boolean => (o.keepPaths ?? []).some((k) => k !== '' && text.includes(k));

// ---------------------------------------------------------------- scanning

function scanInstallSh(home: string): LegacyFinding[] {
  const prefix = join(home, '.c3d-mcp');
  if (!exists(prefix)) return [];
  const parts = ['app', 'node', join('bin', 'c3d-mcp')].map((p) => join(prefix, p)).filter(exists);
  if (parts.length === 0) return [];
  return [{ id: `install-sh:${prefix}`, kind: 'install-sh', label: 'install.sh install (private Node + server + launcher)', installedBy: 'install.sh / Install-c3d-mcp.command', paths: parts, evidence: parts.map((p) => p.replace(home, '~')).join(', '), removable: true, data: { prefix } }];
}

const SHELL_RC = ['.zprofile', '.zshrc', '.bash_profile', '.profile', '.bashrc'];
export const pathLine = (home: string): string => `export PATH="${join(home, '.c3d-mcp', 'bin')}:$PATH"`;

function scanShellPath(home: string): LegacyFinding[] {
  const out: LegacyFinding[] = [];
  for (const rc of SHELL_RC) {
    const file = join(home, rc);
    const text = readText(file);
    if (text === undefined || !text.includes(join(home, '.c3d-mcp', 'bin'))) continue;
    const exact = text.split('\n').includes(pathLine(home));
    out.push({
      id: `shell-path:${file}`, kind: 'shell-path', label: `PATH line in ~/${rc}`, installedBy: 'install.sh (offered PATH line)', paths: [file],
      evidence: exact ? 'exact line added by install.sh' : 'mentions ~/.c3d-mcp/bin on a line that was edited by hand; left for you to remove', removable: exact,
    });
  }
  return out;
}

function nodeModuleRoots(home: string, sys: (p: string) => string): string[] {
  const roots = [sys('/opt/homebrew/lib/node_modules'), sys('/usr/local/lib/node_modules'), join(home, '.npm-global', 'lib', 'node_modules'), join(home, '.local', 'lib', 'node_modules')];
  const versioned = (base: string, tail: string[]): void => {
    for (const v of ls(base)) roots.push(join(base, v, ...tail));
  };
  versioned(join(home, '.nvm', 'versions', 'node'), ['lib', 'node_modules']);
  versioned(join(home, '.volta', 'tools', 'image', 'node'), ['lib', 'node_modules']);
  versioned(join(home, '.fnm', 'node-versions'), ['installation', 'lib', 'node_modules']);
  versioned(join(home, 'Library', 'Application Support', 'fnm', 'node-versions'), ['installation', 'lib', 'node_modules']);
  versioned(join(home, '.local', 'share', 'fnm', 'node-versions'), ['installation', 'lib', 'node_modules']);
  return roots;
}

const isC3dPackage = (dir: string): boolean => {
  const pkg = readJson(join(dir, 'package.json'));
  return isRecord(pkg) && pkg.name === 'c3d-mcp';
};

async function scanNpmGlobal(home: string, sys: (p: string) => string, exec: Executor): Promise<LegacyFinding[]> {
  const roots = new Set(nodeModuleRoots(home, sys));
  const r = await exec('/bin/sh', ['-c', 'command -v npm >/dev/null 2>&1 && npm root -g'], { timeoutMs: 15_000 }).catch(() => undefined);
  const reported = r?.code === 0 ? r.stdout.trim() : '';
  if (reported) roots.add(reported);
  const out: LegacyFinding[] = [];
  for (const root of roots) {
    const mod = join(root, 'c3d-mcp');
    if (!exists(mod) || isRepoCheckout(mod) || !isC3dPackage(mod)) continue;
    const bin = join(dirname(dirname(root)), 'bin', 'c3d-mcp');
    const link = exists(bin) && lstatSync(bin).isSymbolicLink() && readlinkSync(bin).includes('c3d-mcp') ? [bin] : [];
    out.push({ id: `npm-global:${mod}`, kind: 'npm-global', label: 'Global npm install (npm i -g c3d-mcp)', installedBy: 'npm install -g', paths: [mod, ...link], evidence: mod.replace(home, '~'), removable: true });
  }
  return out;
}

function scanNpxCache(home: string): LegacyFinding[] {
  const base = join(home, '.npm', '_npx');
  const out: LegacyFinding[] = [];
  for (const hash of ls(base)) {
    const dir = join(base, hash);
    const mod = join(dir, 'node_modules', 'c3d-mcp');
    if (!exists(mod) || !isC3dPackage(mod)) continue;
    const pkg = readJson(join(dir, 'package.json'));
    const deps = isRecord(pkg) && isRecord(pkg.dependencies) ? Object.keys(pkg.dependencies) : [];
    const onlyUs = deps.every((d) => d === 'c3d-mcp');
    out.push({ id: `npx-cache:${dir}`, kind: 'npx-cache', label: 'npx cache of c3d-mcp', installedBy: 'npx -y c3d-mcp', paths: [onlyUs ? dir : mod], evidence: `~/.npm/_npx/${hash}`, removable: true });
  }
  return out;
}

async function bundleId(exec: Executor, app: string): Promise<string | undefined> {
  const r = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(app, 'Contents', 'Info.plist')], { timeoutMs: 5000 }).catch(() => undefined);
  if (r?.code === 0 && r.stdout.trim()) return r.stdout.trim();
  const text = readText(join(app, 'Contents', 'Info.plist'));
  return text?.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
}

async function scanHelperApps(home: string, support: string, sys: (p: string) => string, o: ScanOptions, exec: Executor): Promise<LegacyFinding[]> {
  const name = 'C3D Bridge Helper.app';
  const candidates = new Set<string>([join(support, 'MCP', 'helper', name), join(home, 'Applications', name), sys(join('/Applications', name)), ...(o.extraHelperLocations ?? []).map((d) => join(d, name))]);
  const md = await exec('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${OLD_HELPER_BUNDLE_ID}'`], { timeoutMs: 15_000 }).catch(() => undefined);
  for (const line of (md?.stdout ?? '').split('\n')) if (line.trim().endsWith('.app')) candidates.add(line.trim());
  const out: LegacyFinding[] = [];
  for (const app of candidates) {
    if (!exists(app) || keeps(o, app) || insideGitCheckout(app) || insideBackups(app)) continue;
    const id = await bundleId(exec, app);
    if (id !== OLD_HELPER_BUNDLE_ID) continue;
    const caskroom = caskrooms(sys).some(exists);
    out.push({ id: `helper-app:${app}`, kind: 'helper-app', label: 'C3D Bridge Helper app (old, separate helper)', installedBy: app.startsWith(join(support, 'MCP')) ? 'c3d-mcp install' : caskroom ? 'Homebrew cask or manual copy' : 'manual copy', paths: [app], evidence: `${app.replace(home, '~')} (${id})`, removable: true, data: { app } });
  }
  return out;
}

const caskrooms = (sys: (p: string) => string): string[] => [sys('/opt/homebrew/Caskroom/c3d-bridge-helper'), sys('/usr/local/Caskroom/c3d-bridge-helper')];

function scanCask(sys: (p: string) => string): LegacyFinding[] {
  return caskrooms(sys)
    .filter(exists)
    .map((p) => ({ id: `cask:${p}`, kind: 'cask' as const, label: 'Homebrew cask record (c3d-bridge-helper)', installedBy: 'brew install --cask', paths: [p], evidence: p, removable: true }));
}

function scanLaunchAgent(home: string): LegacyFinding[] {
  const plist = join(home, 'Library', 'LaunchAgents', `${OLD_LAUNCHAGENT_LABEL}.plist`);
  if (!exists(plist)) return [];
  return [{ id: `launchagent:${plist}`, kind: 'launchagent', label: 'Helper LaunchAgent', installedBy: 'helper/install-launchagent.sh', paths: [plist], evidence: plist.replace(home, '~'), removable: true, data: { label: OLD_LAUNCHAGENT_LABEL } }];
}

const MCP_FILES = ['state.json', 'secret', 'helper.sock', 'lock', 'install-manifest.json'];
const MCP_DIRS = ['inbox', 'outbox', 'cancel', 'runtime', 'log', 'tmp'];

function scanBridge(support: string): LegacyFinding[] {
  const out: LegacyFinding[] = [];
  const root = join(support, 'MCP');
  const macroRoot = join(support, 'Scripts', 'Macro');
  const macros: string[] = [];
  const macroDir = join(macroRoot, MACRO_DIR_NAME);
  if (exists(macroDir) && ls(macroDir).some((f) => f.endsWith('.js') && readText(join(macroDir, f))?.startsWith(LOADER_MARKER))) macros.push(macroDir);
  // A loader copied somewhere else under Scripts/ by hand: found by its first line, never by name.
  for (const folder of ls(macroRoot)) {
    const dir = join(macroRoot, folder);
    if (dir === macroDir) continue;
    for (const f of ls(dir)) if (f.endsWith('.js') && readText(join(dir, f))?.startsWith(LOADER_MARKER)) macros.push(join(dir, f));
  }
  const rootParts = [...MCP_DIRS.map((d) => join(root, d)), ...MCP_FILES.map((f) => join(root, f))].filter(exists);
  if (macros.length > 0 || rootParts.length > 0) {
    out.push({ id: `bridge:${support}`, kind: 'bridge', label: 'Cheetah3D bridge (loader macro + MCP mailbox folder)', installedBy: 'c3d-mcp install / c3d_install_bridge / hand copy', paths: [...macros, ...rootParts], evidence: [...macros, ...rootParts].map((p) => p.replace(support, '…')).join(', '), removable: true, needsQuit: 'Cheetah3D', data: { root } });
  }
  return out;
}

export const CLIENT_NAMES: readonly (SetupClient | 'lm-studio')[] = ['claude-desktop', 'claude-code', 'codex', 'antigravity', 'gemini-cli', 'cursor', 'lm-studio'];

function clientFile(client: SetupClient | 'lm-studio', home: string): string | undefined {
  switch (client) {
    case 'claude-desktop': return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'codex': return join(home, '.codex', 'config.toml');
    case 'gemini-cli': return join(home, '.gemini', 'settings.json');
    case 'antigravity': return join(home, '.gemini', 'config', 'mcp_config.json');
    case 'cursor': return join(home, '.cursor', 'mcp.json');
    case 'lm-studio': return lmStudioConfigPath(home);
    default: return undefined;
  }
}

/** Text of the client's `c3d` entry, or undefined when there is none. */
export async function clientEntry(client: SetupClient | 'lm-studio', home: string, exec: Executor): Promise<{ text: string; where: string } | undefined> {
  if (client === 'claude-code') {
    const claudeJson = readJson(join(home, '.claude.json'));
    const entry = isRecord(claudeJson) && isRecord(claudeJson.mcpServers) ? claudeJson.mcpServers.c3d : undefined;
    if (entry !== undefined) return { text: JSON.stringify(entry), where: '~/.claude.json' };
    const list = await exec('claude', ['mcp', 'list'], { timeoutMs: 30_000 }).catch(() => undefined);
    const line = list?.code === 0 ? list.stdout.split('\n').find((l) => /^\s*c3d\s*:/.test(l)) : undefined;
    return line ? { text: line, where: 'claude mcp list' } : undefined;
  }
  const file = clientFile(client, home);
  const text = file ? readText(file) : undefined;
  if (file === undefined || text === undefined) return undefined;
  if (client === 'codex') return /^\s*\[\s*mcp_servers\s*\.\s*(?:c3d|"c3d")\s*\]/m.test(text) ? { text: text.slice(text.search(/\[\s*mcp_servers\s*\.\s*(?:c3d|"c3d")/)).split(/\n\[(?!\s*mcp_servers\s*\.\s*(?:c3d|"c3d"))/)[0] ?? '', where: file } : undefined;
  const doc = readJson(file);
  const entry = isRecord(doc) && isRecord(doc.mcpServers) ? doc.mcpServers.c3d : undefined;
  return entry === undefined ? undefined : { text: JSON.stringify(entry), where: file };
}

async function scanClients(home: string, o: ScanOptions, exec: Executor): Promise<LegacyFinding[]> {
  const out: LegacyFinding[] = [];
  for (const client of CLIENT_NAMES) {
    const e = await clientEntry(client, home, exec);
    if (!e || !/c3d-mcp/.test(e.text) || keeps(o, e.text)) continue;
    out.push({
      id: `client:${client}`, kind: 'client', label: `"c3d" entry in ${client}`, installedBy: 'an older c3d-mcp setup / hand-edited config', paths: [clientFile(client, home) ?? e.where],
      evidence: `${e.where}: ${e.text.replace(/\s+/g, ' ').slice(0, 120)}`, removable: true, data: { client },
      ...(client === 'claude-desktop' ? { needsQuit: 'Claude Desktop' as const } : {}),
    });
  }
  return out;
}

function scanClaudePlugin(home: string): LegacyFinding[] {
  const settings = join(home, '.claude', 'settings.json');
  const plugins = join(home, '.claude', 'plugins');
  const doc = readJson(settings);
  const enabled = isRecord(doc) && isRecord(doc.enabledPlugins) ? Object.keys(doc.enabledPlugins).filter((k) => /^c3d-mcp(@|$)/.test(k)) : [];
  const markets = isRecord(doc) && isRecord(doc.extraKnownMarketplaces) ? Object.keys(doc.extraKnownMarketplaces).filter((k) => /c3d-mcp/.test(k)) : [];
  const installed = readJson(join(plugins, 'installed_plugins.json'));
  const installedKeys = isRecord(installed) && isRecord(installed.plugins) ? Object.keys(installed.plugins).filter((k) => /^c3d-mcp(@|$)/.test(k)) : [];
  const known = readJson(join(plugins, 'known_marketplaces.json'));
  const knownKeys = isRecord(known) ? Object.keys(known).filter((k) => /c3d-mcp/.test(k)) : [];
  const dirs = ['cache', 'marketplaces'].flatMap((sub) => ls(join(plugins, sub)).filter((d) => /c3d-mcp/.test(d)).map((d) => join(plugins, sub, d)));
  if (!enabled.length && !markets.length && !installedKeys.length && !knownKeys.length && !dirs.length) return [];
  const files = [settings, join(plugins, 'installed_plugins.json'), join(plugins, 'known_marketplaces.json')].filter((f) => exists(f));
  return [{ id: 'claude-plugin:user', kind: 'claude-plugin', label: 'Claude Code plugin / marketplace c3d-mcp', installedBy: 'claude plugin install', paths: [...dirs, ...files], evidence: [...enabled, ...installedKeys, ...markets, ...knownKeys, ...dirs.map((d) => basename(d))].join(', '), removable: true, needsQuit: 'Claude Code', data: { plugin: [...enabled, ...installedKeys][0] ?? 'c3d-mcp' } }];
}

function scanDesktopExtension(home: string): LegacyFinding[] {
  const base = join(home, 'Library', 'Application Support', 'Claude');
  const dirs = ls(join(base, 'Claude Extensions')).filter((d) => /c3d-mcp/.test(d)).map((d) => join(base, 'Claude Extensions', d));
  const settingsFiles = ls(join(base, 'Claude Extensions Settings')).filter((d) => /c3d-mcp/.test(d)).map((d) => join(base, 'Claude Extensions Settings', d));
  const reg = join(base, 'extensions-installations.json');
  const doc = readJson(reg);
  const ids = isRecord(doc) && isRecord(doc.extensions) ? Object.keys(doc.extensions).filter((k) => /c3d-mcp/.test(k)) : [];
  if (!dirs.length && !settingsFiles.length && !ids.length) return [];
  return [{ id: 'desktop-extension:user', kind: 'desktop-extension', label: 'Claude Desktop extension (c3d-mcp .mcpb)', installedBy: 'c3d-mcp.mcpb', paths: [...dirs, ...settingsFiles, ...(ids.length ? [reg] : [])], evidence: [...ids, ...dirs.map((d) => basename(d))].join(', '), removable: true, needsQuit: 'Claude Desktop', data: { ids: ids.join(',') } }];
}

function scanSkills(home: string): LegacyFinding[] {
  const marked: string[] = [];
  const unmarked: string[] = [];
  for (const target of SKILL_TARGETS) {
    const root = targetDir(target, { home });
    for (const d of ls(root)) {
      const dir = join(root, d);
      if (exists(join(dir, SKILL_MARKER))) marked.push(dir);
      else if (/^c3d-/.test(d) && /c3d_|Cheetah3D/.test(readText(join(dir, 'SKILL.md')) ?? '')) unmarked.push(dir);
    }
  }
  const out: LegacyFinding[] = [];
  if (marked.length) out.push({ id: 'skills:marked', kind: 'skills', label: `Agent skills installed by c3d-mcp (${marked.length})`, installedBy: 'c3d-mcp skills install', paths: marked, evidence: marked.map((p) => p.replace(home, '~')).join(', '), removable: true });
  if (unmarked.length) out.push({ id: 'skills:unmarked', kind: 'unmarked-skills', label: `c3d-* skill folders without our marker (${unmarked.length})`, installedBy: 'copied by hand', paths: unmarked, evidence: unmarked.map((p) => p.replace(home, '~')).join(', '), removable: false });
  return out;
}

function scanLogs(home: string): LegacyFinding[] {
  const dir = join(home, 'Library', 'Logs', 'c3d-mcp');
  const files = ls(dir).filter((f) => !f.startsWith('cleanup-')).map((f) => join(dir, f));
  return files.length ? [{ id: `logs:${dir}`, kind: 'logs', label: 'Old c3d-mcp logs', installedBy: 'c3d-mcp', paths: files, evidence: dir.replace(home, '~'), removable: true }] : [];
}

/** Lists everything left behind by earlier installs. Read-only. */
export async function scanLegacy(o: ScanOptions = {}): Promise<LegacyFinding[]> {
  const { home, support } = paths(o);
  const exec = o.exec ?? systemExec;
  const sys = (p: string): string => join(o.systemRoot ?? '/', p);
  const findings = [
    ...scanInstallSh(home),
    ...scanShellPath(home),
    ...(await scanNpmGlobal(home, sys, exec)),
    ...scanNpxCache(home),
    ...(await scanHelperApps(home, support, sys, o, exec)),
    ...scanCask(sys),
    ...scanLaunchAgent(home),
    ...scanBridge(support),
    ...(await scanClients(home, o, exec)),
    ...scanClaudePlugin(home),
    ...scanDesktopExtension(home),
    ...scanSkills(home),
    ...scanLogs(home),
  ];
  if (findings.some((f) => f.kind === 'helper-app' || f.kind === 'cask' || f.kind === 'launchagent')) {
    findings.push({ id: `permissions:${OLD_HELPER_BUNDLE_ID}`, kind: 'permissions', label: 'Old Accessibility / Screen Recording grants of the previous helper', installedBy: 'macOS (System Settings › Privacy & Security)', paths: [], evidence: `grants for ${OLD_HELPER_BUNDLE_ID}`, removable: true, data: { bundle: OLD_HELPER_BUNDLE_ID } });
  }
  return findings;
}

// ---------------------------------------------------------------- removal

export type RemoveStatus = 'removed' | 'would-remove' | 'blocked' | 'skipped' | 'failed';
export interface RemoveResult { id: string; kind: LegacyKind; status: RemoveStatus; detail: string; backups?: string[]; trashed?: string[] }

export interface RemoveOptions extends ScanOptions {
  dryRun?: boolean;
  /** Quit Cheetah3D / Claude when a finding needs it (otherwise such findings are reported as blocked). */
  quitApps?: boolean;
  /** Moves a path to the Trash (default: into ~/.Trash with a unique name). */
  trash?: (path: string) => Promise<string>;
  now?: () => Date;
}

/** Moves `path` into ~/.Trash (unique name; copies across volumes). Returns the new location. */
export function trashInto(home: string): (path: string) => Promise<string> {
  return async (path) => {
    const trash = join(home, '.Trash');
    await mkdir(trash, { recursive: true });
    const base = basename(path);
    let dest = join(trash, base);
    for (let n = 2; exists(dest); n++) dest = join(trash, `${base} ${String(n)}`);
    try {
      await rename(path, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await cp(path, dest, { recursive: true, verbatimSymlinks: true });
      await rm(path, { recursive: true, force: true });
    }
    return dest;
  };
}

async function quitApp(exec: Executor, app: QuitApp, running: (a: QuitApp) => Promise<boolean>): Promise<boolean> {
  if (app === 'Claude Code') return false; // a terminal session cannot be quit politely; the user closes it
  await exec('/usr/bin/osascript', ['-e', `tell application "${app === 'Claude Desktop' ? 'Claude' : app}" to quit`], { timeoutMs: 20_000 }).catch(() => undefined);
  for (let i = 0; i < 30; i++) {
    if (!(await running(app))) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return !(await running(app));
}

/** Removes the given findings. Never throws: each result says what happened. */
export async function removeLegacy(findings: LegacyFinding[], o: RemoveOptions = {}): Promise<RemoveResult[]> {
  const { home } = paths(o);
  const exec = o.exec ?? systemExec;
  const running = o.running ?? ((a: QuitApp): Promise<boolean> => defaultRunning(exec, a));
  const trash = o.trash ?? trashInto(home);
  const now = o.now ?? ((): Date => new Date());
  const results: RemoveResult[] = [];

  const trashAll = async (ps: string[]): Promise<string[]> => {
    const moved: string[] = [];
    for (const p of ps) if (exists(p)) moved.push(await trash(p));
    return moved;
  };

  for (const f of findings) {
    const base = { id: f.id, kind: f.kind };
    if (!f.removable) {
      results.push({ ...base, status: 'skipped', detail: 'listed for information only; remove it by hand if you want' });
      continue;
    }
    try {
      if (f.needsQuit && !o.dryRun && (await running(f.needsQuit))) {
        const ok = o.quitApps ? await quitApp(exec, f.needsQuit, running) : false;
        if (!ok) {
          results.push({ ...base, status: 'blocked', detail: `${f.needsQuit} is running; quit it first${o.quitApps ? ' (it did not quit)' : ''}` });
          continue;
        }
      }
      if (o.dryRun) {
        results.push({ ...base, status: 'would-remove', detail: f.evidence });
        continue;
      }
      results.push({ ...base, ...(await removeOne(f, { home, exec, trashAll, now, o })) });
    } catch (err) {
      results.push({ ...base, status: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

interface Ctx { home: string; exec: Executor; trashAll: (ps: string[]) => Promise<string[]>; now: () => Date; o: RemoveOptions }
type Outcome = Pick<RemoveResult, 'status' | 'detail' | 'backups' | 'trashed'>;

async function removeOne(f: LegacyFinding, c: Ctx): Promise<Outcome> {
  const done = (trashed: string[], detail?: string, backups?: string[]): Outcome => ({ status: 'removed', detail: detail ?? `moved ${String(trashed.length)} item(s) to the Trash`, trashed, ...(backups?.length ? { backups } : {}) });
  switch (f.kind) {
    case 'install-sh':
    case 'npm-global':
    case 'npx-cache':
    case 'cask':
    case 'logs':
    case 'unmarked-skills':
    case 'skills': {
      const trashed = await c.trashAll(f.paths);
      if (f.kind === 'install-sh') {
        const prefix = f.data?.prefix ?? '';
        if (prefix !== '' && prefix !== c.home) for (const d of [join(prefix, 'bin'), prefix]) if (exists(d) && ls(d).length === 0) rmdirSync(d);
      }
      if (f.kind === 'logs') {
        const dir = dirname(f.paths[0] ?? '');
        if (dir && exists(dir) && ls(dir).length === 0) rmdirSync(dir);
      }
      return done(trashed);
    }
    case 'shell-path': {
      const file = f.paths[0] ?? '';
      const text = await readFile(file, 'utf8');
      const exact = pathLine(c.home);
      if (!text.split('\n').includes(exact)) return { status: 'skipped', detail: 'the line was edited since the scan; left alone' };
      const bak = await backup(file, c.now());
      const lines = text.split('\n');
      const out: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (line === exact) continue;
        if (line === '# c3d-mcp' && lines[i + 1] === exact) continue;
        out.push(line);
      }
      await writeFile(file, out.join('\n'));
      return done([], `removed the PATH line from ${file}`, [bak]);
    }
    case 'helper-app': {
      const app = f.data?.app ?? f.paths[0] ?? '';
      await c.exec('/usr/bin/pkill', ['-f', join(app, 'Contents', 'MacOS')], { timeoutMs: 10_000 }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 300));
      return done(await c.trashAll([app]));
    }
    case 'launchagent': {
      await c.exec('/bin/launchctl', ['bootout', `gui/${String(process.getuid?.() ?? 501)}/${f.data?.label ?? OLD_LAUNCHAGENT_LABEL}`], { timeoutMs: 15_000 }).catch(() => undefined);
      return done(await c.trashAll(f.paths));
    }
    case 'bridge': {
      const root = f.data?.root ?? '';
      const trashed: string[] = [];
      for (const p of f.paths) {
        if (basename(p) === 'secret') {
          rmSync(p, { force: true }); // never leave the bridge secret in the Trash
          continue;
        }
        trashed.push(...(await c.trashAll([p])));
      }
      const helperDir = join(root, 'helper');
      if (root && exists(helperDir) && ls(helperDir).length === 0) rmdirSync(helperDir); // left behind once the old helper app is gone
      if (root && exists(root) && ls(root).length === 0) rmdirSync(root);
      return done(trashed);
    }
    case 'client': {
      const client = (f.data?.client ?? '') as SetupClient | 'lm-studio';
      const current = await clientEntry(client, c.home, c.exec);
      if (!current || keeps(c.o, current.text)) return { status: 'skipped', detail: 'the entry changed or now belongs to the new app; left alone' };
      const o = { home: c.home, exec: c.exec, now: c.now };
      const r = client === 'lm-studio' ? await unconfigureLmStudio(o) : client === 'claude-code' ? await removeClaudeCodeEntry(c) : await unconfigureClient(client, o);
      if (r.status === 'removed') return { status: 'removed', detail: r.detail, ...(r.backup ? { backups: [r.backup] } : {}) };
      return { status: r.status === 'failed' || r.status === 'refused' ? 'failed' : 'skipped', detail: r.detail };
    }
    case 'claude-plugin': return removeClaudePlugin(f, c);
    case 'desktop-extension': return removeDesktopExtension(f, c);
    case 'permissions': {
      const bundle = f.data?.bundle ?? OLD_HELPER_BUNDLE_ID;
      const notes: string[] = [];
      for (const svc of ['Accessibility', 'ScreenCapture']) {
        const r = await c.exec('/usr/bin/tccutil', ['reset', svc, bundle], { timeoutMs: 15_000 }).catch(() => undefined);
        notes.push(r?.code === 0 ? `${svc} reset` : `${svc}: could not reset`);
      }
      const failed = notes.some((n) => n.includes('could not'));
      return { status: failed ? 'failed' : 'removed', detail: failed ? `${notes.join('; ')}. Remove "C3D Bridge Helper" by hand in System Settings › Privacy & Security.` : notes.join('; ') };
    }
  }
}

async function removeClaudeCodeEntry(c: Ctx): Promise<{ status: 'removed' | 'failed'; detail: string; backup?: string }> {
  const viaCli = await c.exec('claude', ['mcp', 'remove', '--scope', 'user', 'c3d'], { timeoutMs: 60_000 }).catch(() => undefined);
  const still = readJson(join(c.home, '.claude.json'));
  const gone = !(isRecord(still) && isRecord(still.mcpServers) && still.mcpServers.c3d !== undefined);
  if (viaCli?.code === 0 && gone) return { status: 'removed', detail: 'unregistered with `claude mcp remove`' };
  const file = join(c.home, '.claude.json');
  const doc = readJson(file);
  if (!isRecord(doc) || !isRecord(doc.mcpServers) || doc.mcpServers.c3d === undefined) return gone ? { status: 'removed', detail: 'already gone' } : { status: 'failed', detail: `${file} could not be read` };
  const bak = await backup(file, c.now());
  const rest = Object.fromEntries(Object.entries(doc.mcpServers).filter(([k]) => k !== 'c3d'));
  await writeFile(file, `${JSON.stringify({ ...doc, mcpServers: rest }, null, 2)}\n`);
  return { status: 'removed', detail: `removed "c3d" from ${file} (the claude CLI was not usable)`, backup: bak };
}

async function editJson(file: string, c: Ctx, edit: (doc: Record<string, unknown>) => boolean, backups: string[]): Promise<void> {
  const doc = readJson(file);
  if (!isRecord(doc)) return;
  const copy = structuredClone(doc);
  if (!edit(copy)) return;
  backups.push(await backup(file, c.now()));
  await writeFile(file, `${JSON.stringify(copy, null, 2)}\n`);
}

const dropKeys = (obj: unknown, match: (k: string) => boolean): boolean => {
  if (!isRecord(obj)) return false;
  let changed = false;
  for (const k of Object.keys(obj)) if (match(k)) { Reflect.deleteProperty(obj, k); changed = true; }
  return changed;
};

async function removeClaudePlugin(f: LegacyFinding, c: Ctx): Promise<Outcome> {
  const plugins = join(c.home, '.claude', 'plugins');
  const backups: string[] = [];
  const notes: string[] = [];
  const cli = await c.exec('claude', ['plugin', 'uninstall', f.data?.plugin ?? 'c3d-mcp'], { timeoutMs: 60_000 }).catch(() => undefined);
  notes.push(cli?.code === 0 ? 'claude plugin uninstall ran' : 'claude CLI not usable; edited the files directly');
  const isPlugin = (k: string): boolean => /^c3d-mcp(@|$)/.test(k);
  const isMarket = (k: string): boolean => /c3d-mcp/.test(k);
  await editJson(join(c.home, '.claude', 'settings.json'), c, (d) => [dropKeys(d.enabledPlugins, isPlugin), dropKeys(d.extraKnownMarketplaces, isMarket)].includes(true), backups);
  await editJson(join(plugins, 'installed_plugins.json'), c, (d) => dropKeys(d.plugins, isPlugin), backups);
  await editJson(join(plugins, 'known_marketplaces.json'), c, (d) => dropKeys(d, isMarket), backups);
  const dirs = f.paths.filter((p) => !p.endsWith('.json'));
  const trashed = await c.trashAll(dirs);
  return { status: 'removed', detail: notes.join('; '), trashed, ...(backups.length ? { backups } : {}) };
}

async function removeDesktopExtension(f: LegacyFinding, c: Ctx): Promise<Outcome> {
  const backups: string[] = [];
  const reg = f.paths.find((p) => basename(p) === 'extensions-installations.json');
  if (reg) await editJson(reg, c, (d) => dropKeys(d.extensions, (k) => /c3d-mcp/.test(k)), backups);
  const trashed = await c.trashAll(f.paths.filter((p) => p !== reg));
  return { status: 'removed', detail: `removed the extension (restart Claude Desktop)`, trashed, ...(backups.length ? { backups } : {}) };
}

/** Writes a plain-text report of a cleanup next to the logs. */
export async function writeCleanupReport(home: string, results: RemoveResult[], findings: LegacyFinding[], now: Date = new Date()): Promise<string> {
  const dir = join(home, 'Library', 'Logs', 'c3d-mcp');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `cleanup-${now.toISOString().replace(/[:.]/g, '-')}.txt`);
  const byId = new Map(findings.map((f) => [f.id, f]));
  const lines = [`c3d-mcp cleanup of earlier installs, ${now.toISOString()}`, ''];
  for (const r of results) {
    lines.push(`[${r.status}] ${byId.get(r.id)?.label ?? r.id}`, `    ${r.detail}`);
    for (const t of r.trashed ?? []) lines.push(`    trashed: ${t}`);
    for (const b of r.backups ?? []) lines.push(`    backup:  ${b}`);
  }
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
}
