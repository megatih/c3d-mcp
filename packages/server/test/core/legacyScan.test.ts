import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathLine, removeLegacy, scanLegacy, writeCleanupReport, type LegacyFinding, type QuitApp } from '../../src/core/legacyScan.js';
import type { Executor } from '../../src/core/platform.js';

let root: string;
let home: string;
let sys: string;
let support: string;
const calls: string[] = [];
const runningApps = new Set<QuitApp>();

const put = (p: string, text = 'x'): void => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const exec: Executor = (cmd, args) => {
  calls.push([cmd, ...args].join(' '));
  // pkill, launchctl and tccutil succeed; everything else (claude, npm, mdfind, PlistBuddy) is "not available"
  const ok = ['/usr/bin/pkill', '/bin/launchctl', '/usr/bin/tccutil'].includes(cmd);
  return Promise.resolve({ code: ok ? 0 : 1, stdout: '', stderr: '' });
};
const opts = (extra = {}): Parameters<typeof scanLegacy>[0] => ({ home, supportDir: support, systemRoot: sys, exec, running: (a: QuitApp) => Promise.resolve(runningApps.has(a)), ...extra });
const infoPlist = (id: string): string => `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>`;
const kinds = (f: LegacyFinding[]): string[] => f.map((x) => x.kind);

/** Every way an older version could have been installed. */
function seedEverything(): void {
  put(join(home, '.c3d-mcp', 'app', 'node_modules', 'c3d-mcp', 'package.json'), '{"name":"c3d-mcp","version":"0.3.2"}');
  put(join(home, '.c3d-mcp', 'node', 'bin', 'node'));
  put(join(home, '.c3d-mcp', 'bin', 'c3d-mcp'));
  put(join(home, '.zprofile'), `export A=1\n# c3d-mcp\n${pathLine(home)}\nalias x=1\n`);
  put(join(home, '.npm-global', 'lib', 'node_modules', 'c3d-mcp', 'package.json'), '{"name":"c3d-mcp"}');
  mkdirSync(join(home, '.npm-global', 'bin'), { recursive: true });
  symlinkSync('../lib/node_modules/c3d-mcp/bin/c3d-mcp.js', join(home, '.npm-global', 'bin', 'c3d-mcp'));
  put(join(home, '.npm', '_npx', 'aaa', 'node_modules', 'c3d-mcp', 'package.json'), '{"name":"c3d-mcp"}');
  put(join(home, '.npm', '_npx', 'aaa', 'package.json'), '{"dependencies":{"c3d-mcp":"x"}}');
  put(join(home, '.npm', '_npx', 'bbb', 'node_modules', 'c3d-mcp', 'package.json'), '{"name":"c3d-mcp"}');
  put(join(home, '.npm', '_npx', 'bbb', 'package.json'), '{"dependencies":{"c3d-mcp":"x","other":"1"}}');
  put(join(support, 'MCP', 'helper', 'C3D Bridge Helper.app', 'Contents', 'Info.plist'), infoPlist('dev.c3dmcp.helper'));
  put(join(sys, 'Applications', 'C3D Bridge Helper.app', 'Contents', 'Info.plist'), infoPlist('dev.c3dmcp.helper'));
  put(join(sys, 'Applications', 'Other.app', 'Contents', 'Info.plist'), infoPlist('com.example.other'));
  put(join(sys, 'opt', 'homebrew', 'Caskroom', 'c3d-bridge-helper', '0.3.2', 'x'));
  put(join(home, 'Library', 'LaunchAgents', 'dev.c3dmcp.helper.plist'));
  put(join(support, 'Scripts', 'Macro', 'C3D-MCP', 'C3D-MCP Bridge.js'), '// c3d-mcp bridge loader 0.3.2\nfunction main(doc){}');
  put(join(support, 'Scripts', 'Macro', 'Mine', 'copy.js'), '// c3d-mcp bridge loader 0.3.2 (copied by hand)');
  put(join(support, 'Scripts', 'Macro', 'Mine', 'mine.js'), '// my own macro');
  for (const f of ['state.json', 'secret', 'install-manifest.json']) put(join(support, 'MCP', f), '{}');
  mkdirSync(join(support, 'MCP', 'inbox'), { recursive: true });
  put(join(support, 'MCP-backups', 'scripts-1', 'keep.js'), 'precious');
  put(join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), JSON.stringify({ theme: 'x', mcpServers: { c3d: { command: 'npx', args: ['-y', 'c3d-mcp', 'serve'] }, other: { command: 'o' } } }));
  put(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { c3d: { command: '/Applications/C3D MCP.app/Contents/Resources/bin/c3d-mcp', args: ['serve'] } } }));
  put(join(home, '.lmstudio', 'mcp.json'), JSON.stringify({ mcpServers: { c3d: { command: 'npx', args: ['-y', 'c3d-mcp', 'serve'] } } }));
  put(join(home, '.codex', 'config.toml'), 'model = "x"\n\n[mcp_servers.c3d]\ncommand = "npx"\nargs = ["-y", "c3d-mcp", "serve"]\n\n[other]\na = 1\n');
  put(join(home, '.claude.json'), JSON.stringify({ projects: {}, mcpServers: { c3d: { command: 'npx', args: ['-y', 'c3d-mcp', 'serve'] } } }));
  put(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'x', enabledPlugins: { 'c3d-mcp@c3d-mcp': true, 'keep@m': true }, extraKnownMarketplaces: { 'c3d-mcp': { source: 'x' } } }));
  put(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'c3d-mcp@c3d-mcp': [{}], 'keep@m': [{}] } }));
  put(join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'c3d-mcp': {}, other: {} }));
  put(join(home, '.claude', 'plugins', 'cache', 'c3d-mcp', 'c3d-mcp', '0.3.2', 'x'));
  put(join(home, '.claude', 'plugins', 'cache', 'other', 'keep'));
  const ext = join(home, 'Library', 'Application Support', 'Claude');
  put(join(ext, 'Claude Extensions', 'local.mcpb.megatih.c3d-mcp', 'manifest.json'));
  put(join(ext, 'Claude Extensions Settings', 'local.mcpb.megatih.c3d-mcp.json'), '{}');
  put(join(ext, 'extensions-installations.json'), JSON.stringify({ extensions: { 'local.mcpb.megatih.c3d-mcp': {}, 'local.mcpb.x.keep': {} } }));
  put(join(home, '.claude', 'skills', 'c3d-setup', '.c3d-mcp-skill'));
  put(join(home, '.claude', 'skills', 'c3d-setup', 'SKILL.md'), 'c3d_');
  put(join(home, '.claude', 'skills', 'c3d-mine', 'SKILL.md'), 'my Cheetah3D notes');
  put(join(home, '.claude', 'skills', 'unrelated', 'SKILL.md'), 'x');
  put(join(home, 'Library', 'Logs', 'c3d-mcp', 'helper.log'), 'log');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'c3d-legacy-'));
  home = join(root, 'home');
  sys = join(root, 'sys');
  support = join(home, 'Library', 'Application Support', 'Cheetah3D');
  mkdirSync(home, { recursive: true });
  mkdirSync(sys, { recursive: true });
  calls.length = 0;
  runningApps.clear();
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('scanLegacy', () => {
  it('finds nothing on a clean Mac', async () => {
    expect(await scanLegacy(opts())).toEqual([]);
  });

  it('finds every kind of older install and nothing that is not ours', async () => {
    seedEverything();
    const found = await scanLegacy(opts());
    expect(new Set(kinds(found))).toEqual(new Set(['install-sh', 'shell-path', 'npm-global', 'npx-cache', 'helper-app', 'cask', 'launchagent', 'bridge', 'claude-plugin', 'desktop-extension', 'permissions']));
    expect(found.filter((f) => f.kind === 'helper-app')).toHaveLength(2); // the unrelated Other.app is ignored
    expect(found.some((f) => f.id.startsWith('client:'))).toBe(false); // client entries are handled by the AI clients tab, never by Cleanup
    const bridge = found.find((f) => f.kind === 'bridge');
    expect(bridge?.needsQuit).toBe('Cheetah3D');
    expect(bridge?.paths.some((p) => p.endsWith('copy.js'))).toBe(true); // hand copy found by content
    expect(bridge?.paths.some((p) => p.endsWith('mine.js'))).toBe(false);
    expect(bridge?.paths.some((p) => p.includes('MCP-backups'))).toBe(false);
    expect(bridge?.paths).toHaveLength(1); // only the stray copy, nothing of the standard install
  });

  it('never offers the working install of the current app: the standard loader macro, the MCP folder, the skills and the logs are not leftovers', async () => {
    seedEverything();
    const found = await scanLegacy(opts());
    const all = found.flatMap((f) => f.paths).join('\n');
    for (const mine of [join(support, 'Scripts', 'Macro', 'C3D-MCP'), join(support, 'MCP', 'inbox'), join(support, 'MCP', 'secret'), join(support, 'MCP', 'state.json'), join(home, '.claude', 'skills'), join(home, 'Library', 'Logs', 'c3d-mcp')]) {
      expect(all.includes(mine), `${mine} must not be reported`).toBe(false);
    }
    // a Mac whose only c3d-mcp is the current app's install has nothing to clean up
    rmSync(root, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(sys, { recursive: true });
    put(join(support, 'Scripts', 'Macro', 'C3D-MCP', 'C3D-MCP Bridge.js'), '// c3d-mcp bridge loader 0.4.1\nfunction main(doc){}');
    for (const f of ['state.json', 'secret', 'install-manifest.json', 'helper.sock']) put(join(support, 'MCP', f), '{}');
    mkdirSync(join(support, 'MCP', 'inbox'), { recursive: true });
    put(join(home, '.claude', 'skills', 'c3d-setup', '.c3d-mcp-skill'));
    put(join(home, 'Library', 'Logs', 'c3d-mcp', 'helper.log'), 'log');
    expect(await scanLegacy(opts())).toEqual([]);
  });

  it('never reports an app that belongs to the current app (keepPaths) or a client entry, whoever wrote it', async () => {
    seedEverything();
    const found = await scanLegacy(opts({ keepPaths: [join(sys, 'Applications', 'C3D Bridge Helper.app')] }));
    expect(found.filter((f) => f.kind === 'helper-app').map((f) => f.paths[0])).not.toContain(join(sys, 'Applications', 'C3D Bridge Helper.app'));
    // the cursor entry of the seed launches /Applications/C3D MCP.app, claude-desktop's launches npx: neither is a cleanup finding
    const names = new Set(found.flatMap((f) => f.paths).map((p) => p.split('/').pop()));
    for (const clientConfig of ['mcp.json', 'claude_desktop_config.json', 'config.toml', 'mcp_config.json', '.claude.json']) expect(names.has(clientConfig), clientConfig).toBe(false);
  });

  it('never reports helper apps in a git checkout (dev builds) or in MCP-backups (rollback copies)', async () => {
    const plist = infoPlist('dev.c3dmcp.helper');
    put(join(root, 'src', 'proj', '.git', 'HEAD'), 'ref');
    put(join(root, 'src', 'proj', 'helper', 'build', 'C3D Bridge Helper.app', 'Contents', 'Info.plist'), plist);
    put(join(support, 'MCP-backups', 'helper-2026', 'C3D Bridge Helper.app', 'Contents', 'Info.plist'), plist);
    const mdfind: Executor = (cmd) => Promise.resolve({ code: 0, stdout: cmd === '/usr/bin/mdfind' ? `${join(root, 'src', 'proj', 'helper', 'build', 'C3D Bridge Helper.app')}\n${join(support, 'MCP-backups', 'helper-2026', 'C3D Bridge Helper.app')}\n` : '', stderr: '' });
    expect(await scanLegacy(opts({ exec: mdfind }))).toEqual([]);
  });

  it('does not report a PATH line that was edited by hand as removable', async () => {
    put(join(home, '.zshrc'), `export PATH="${join(home, '.c3d-mcp', 'bin')}:/usr/bin:$PATH"\n`);
    const [f] = await scanLegacy(opts());
    expect(f).toMatchObject({ kind: 'shell-path', removable: false });
  });

  it('ignores a source checkout that happens to be called c3d-mcp', async () => {
    put(join(home, '.npm-global', 'lib', 'node_modules', 'c3d-mcp', 'package.json'), '{"name":"c3d-mcp"}');
    mkdirSync(join(home, '.npm-global', 'lib', 'node_modules', 'c3d-mcp', '.git'), { recursive: true });
    expect(kinds(await scanLegacy(opts()))).not.toContain('npm-global');
  });
});

describe('removeLegacy', () => {
  it('a dry run changes nothing', async () => {
    seedEverything();
    const found = await scanLegacy(opts());
    const r = await removeLegacy(found, opts({ dryRun: true }));
    expect(r.filter((x) => x.status === 'would-remove').length).toBe(found.filter((f) => f.removable).length);
    expect((await scanLegacy(opts())).length).toBe(found.length);
  });

  it('removes everything removable, keeps user data and other entries, and sends files to the Trash', async () => {
    seedEverything();
    const found = await scanLegacy(opts());
    const results = await removeLegacy(found, opts());
    const bad = results.filter((r) => r.status !== 'removed' && r.status !== 'skipped');
    expect(bad).toEqual([]);
    expect(await scanLegacy(opts())).toEqual([]);

    // trashed, not deleted
    expect(existsSync(join(home, '.Trash', 'app'))).toBe(true);
    expect(existsSync(join(home, '.Trash', 'copy.js'))).toBe(true);
    expect(existsSync(join(home, '.c3d-mcp'))).toBe(false);
    // the working bridge, the skills and the logs of the current install are not touched
    for (const keep of [join(support, 'Scripts', 'Macro', 'C3D-MCP', 'C3D-MCP Bridge.js'), join(support, 'MCP', 'secret'), join(support, 'MCP', 'state.json'), join(home, '.claude', 'skills', 'c3d-setup', '.c3d-mcp-skill'), join(home, 'Library', 'Logs', 'c3d-mcp', 'helper.log')]) expect(existsSync(keep), `${keep} must stay`).toBe(true);
    expect(existsSync(join(support, 'MCP', 'helper'))).toBe(false); // the old helper app's folder is gone with it
    expect(existsSync(join(support, 'Scripts', 'Macro', 'Mine', 'copy.js'))).toBe(false); // the stray copy of the loader is trashed
    // user data untouched
    expect(readFileSync(join(support, 'MCP-backups', 'scripts-1', 'keep.js'), 'utf8')).toBe('precious');
    expect(existsSync(join(support, 'Scripts', 'Macro', 'Mine', 'mine.js'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'skills', 'c3d-mine'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'skills', 'unrelated'))).toBe(true);
    // other npx cache entry that holds more than us keeps its folder; only our module goes
    expect(existsSync(join(home, '.npm', '_npx', 'bbb', 'package.json'))).toBe(true);
    expect(existsSync(join(home, '.npm', '_npx', 'bbb', 'node_modules', 'c3d-mcp'))).toBe(false);
    expect(existsSync(join(home, '.npm', '_npx', 'aaa'))).toBe(false);
    // client configs are NOT edited by Cleanup (the AI clients tab does that), so every entry is still there
    const desktop = JSON.parse(readFileSync(join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), 'utf8'));
    expect(desktop.mcpServers.c3d).toBeDefined();
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toContain('[mcp_servers.c3d]');
    expect(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers.c3d).toBeDefined();
    // the zprofile PATH line, the Claude Code plugin and the Desktop extension are removed with a backup of what was edited
    expect(readFileSync(join(home, '.zprofile'), 'utf8')).toBe('export A=1\nalias x=1\n');
    expect(JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))).toEqual({ model: 'x', enabledPlugins: { 'keep@m': true }, extraKnownMarketplaces: {} });
    expect(JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')).plugins).toEqual({ 'keep@m': [{}] });
    expect(existsSync(join(home, '.claude', 'plugins', 'cache', 'other', 'keep'))).toBe(true);
    const inst = JSON.parse(readFileSync(join(home, 'Library', 'Application Support', 'Claude', 'extensions-installations.json'), 'utf8'));
    expect(Object.keys(inst.extensions)).toEqual(['local.mcpb.x.keep']);
    expect(readdirSync(home, { recursive: true }).filter((f) => String(f).includes('c3d-backup')).length).toBeGreaterThanOrEqual(3);
    // old helper stopped, launch agent booted out, grants reset
    expect(calls.some((c) => c.startsWith('/usr/bin/pkill'))).toBe(true);
    expect(calls.some((c) => c.includes('bootout'))).toBe(true);
    expect(calls.some((c) => c.includes('tccutil reset Accessibility dev.c3dmcp.helper'))).toBe(true);
  });

  it('blocks findings that need a running app to be quit, and removes nothing from them', async () => {
    seedEverything();
    runningApps.add('Cheetah3D');
    runningApps.add('Claude Desktop');
    const found = await scanLegacy(opts());
    const results = await removeLegacy(found.filter((f) => ['bridge', 'desktop-extension'].includes(f.kind)), opts());
    expect(results.find((r) => r.kind === 'bridge')?.status).toBe('blocked');
    expect(results.find((r) => r.kind === 'desktop-extension')?.status).toBe('blocked');
    expect(existsSync(join(support, 'Scripts', 'Macro', 'Mine', 'copy.js'))).toBe(true);
  });

  it('reports non-removable findings as skipped and writes a report next to the logs', async () => {
    seedEverything();
    const found = await scanLegacy(opts());
    const hand = found.find((f) => f.kind === 'shell-path');
    expect(hand).toBeDefined();
    const results = await removeLegacy(hand ? [{ ...hand, removable: false }] : [], opts());
    expect(results.map((r) => r.status)).toEqual(['skipped']);
    const file = await writeCleanupReport(home, results, found);
    expect(readFileSync(file, 'utf8')).toContain('PATH line');
    expect(existsSync(join(home, 'Library', 'Logs', 'c3d-mcp', 'helper.log'))).toBe(true);
  });
});
