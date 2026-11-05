import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadConfig, type RuntimeConfig } from '../config.js';
import { PACKAGE_ROOT, packageVersion } from '../core/assets.js';
import { SKILL_TARGETS, installSkills, listSkills, skillsSourceDir, uninstallSkills, type SkillTarget } from '../core/skillsInstall.js';
import { CLIENTS, configSnippet, type ClientName } from '../core/configSnippets.js';
import { doctor } from '../core/doctor.js';
import { install, uninstall, type InstallReport, type UninstallReport } from '../core/install.js';
import { detectInstall, loadBundle, type InstallState } from '../core/installState.js';
import { createRuntime, type Runtime } from '../core/runtime.js';
import { CLIENT_LABELS, configureClient, unconfigureClient, unconfigureLmStudio, type SetupClient } from '../core/clientConfigs.js';
import { setClaudeCodeAllow } from '../core/permissions.js';
import { CLIENT_NAMES, clientEntry, removeLegacy, scanLegacy, writeCleanupReport } from '../core/legacyScan.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { systemExec as defaultExec } from '../core/platform.js';
import { detectClients } from '../core/clientConfigs.js';
import { serve } from '../server.js';
import { join } from 'node:path';

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
  env: NodeJS.ProcessEnv;
  stdinIsTTY: boolean;
  /** Asks a yes/no question; the default implementation reads from the terminal. */
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  runtime(config: RuntimeConfig): Runtime;
  serve(config: RuntimeConfig): void;
}

const USAGE = `c3d-mcp ${packageVersion()} - MCP server for Cheetah3D 8.1.3 (macOS)

Usage: c3d-mcp <command> [options]

Commands:
  status             Show what is installed (fresh, current, outdated, partial) and what to run next; changes nothing
  install            Install or update the bridge and the helper app: detects a fresh, existing or partial install and does what is needed
                     (idempotent; backs up Scripts/ first). --repair fixes only what is broken, --reinstall rewrites everything
  uninstall          Remove the bridge and the helper app (never backups or your scripts); --all also removes the agent skills and the
                     c3d entries in MCP client configs
  doctor             Check Cheetah3D, the bridge, permissions and the helper
  skills <action>    Agent skills for Claude Code, Codex and Antigravity: install | uninstall | list (see docs/SKILLS.md)
  clients <list|add|remove> [names|all]   Connect or disconnect AI clients (absolute launch form: no npx or login PATH needed); list shows each client's state
  legacy <scan|remove>   Find (scan) or remove (remove) earlier installs made by any method: install.sh, npm, npx, Homebrew cask, Claude Desktop extension, Claude Code plugin, hand copies
  permissions <allow|revoke>   Claude Code: stop (or resume) asking before every c3d tool call (edits ~/.claude/settings.json after asking, with a backup)
  config <client>    Print an MCP config snippet (${CLIENTS.join(', ')})
  serve              Run the MCP server on stdio (default when started by an MCP client)
  version            Print the version

Options:
  --json             Machine-readable output (install, uninstall, doctor, config, version)
  --yes, -y          Do not ask for confirmation (uninstall, clients add, legacy remove, permissions)
  --brief            doctor: one line when healthy, otherwise only the failing checks (for hooks)
  --form <absolute|npx>   config: launch via this install's node and c3d-mcp.js (default) or "npx -y c3d-mcp serve"
  --target <t>       skills: claude, codex, antigravity or all (default all)
  --project <dir>    skills: install into <dir>/.claude|.agents/skills instead of the home directory
  --dry-run          install, uninstall, skills, clients, legacy: show what would change and change nothing
  --repair           install: fix only what is broken or missing; versions stay as they are
  --reinstall        install: rewrite every managed file and replace the helper app (keeps the secret, backups and your scripts)
  --skip-ping        install: do not test the bridge afterwards (does not touch the running Cheetah3D)
  --all              uninstall: also remove the agent skills and the c3d entries in MCP client configs
  --node-path <abs>  clients add: the node binary to launch (default: the one running this command)
  --ids <list>       legacy remove: only these finding ids (comma-separated, from 'legacy scan --json'); default all removable
  --bin-path <abs>   clients add: the c3d-mcp.js to launch (default: this install's)
  --quit-apps        legacy remove: quit Cheetah3D / Claude Desktop when a removal needs them closed
  --keep-path <p>    legacy: never touch entries or apps that contain this path (the current app)
  --raw              config: print only the snippet (no leading comment lines), e.g. c3d-mcp config codex --raw > snippet.toml
  --help, -h

Environment: C3D_MCP_PROFILE=full|local|readonly, C3D_MCP_DISABLE_EXEC/ASSETS/SHELL=1, C3D_MCP_DIR, C3D_CHEETAH_SUPPORT_DIR,
C3D_MCP_WORKDIR, C3D_MCP_LOG_DIR, C3D_MCP_TRIGGER=auto|helper|osascript, C3D_MCP_APPROVAL=strict|session|trusted (default session: a prompt you accepted is not repeated for the same action;
trusted never asks; strict asks every time), C3D_MCP_AUTO_CONFIRM=1 (same as trusted).
`;

export const defaultIO: CliIO = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  env: process.env,
  stdinIsTTY: process.stdin.isTTY,
  confirm: async (q, defaultYes = false) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const a = (await rl.question(`${q} [${defaultYes ? 'Y/n' : 'y/N'}] `)).trim();
      return a === '' ? defaultYes : /^y(es)?$/i.test(a);
    } finally {
      rl.close();
    }
  },
  runtime: (config) => createRuntime(config),
  serve: (config) => {
    serve(config);
  },
};

const PARSE_OPTIONS = {
  allowPositionals: true,
  options: { json: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' }, help: { type: 'boolean', short: 'h' }, form: { type: 'string' }, brief: { type: 'boolean' }, raw: { type: 'boolean' }, target: { type: 'string' }, project: { type: 'string' }, 'dry-run': { type: 'boolean' }, 'node-path': { type: 'string' }, repair: { type: 'boolean' }, reinstall: { type: 'boolean' }, 'skip-ping': { type: 'boolean' }, ids: { type: 'string' }, 'bin-path': { type: 'string' }, 'quit-apps': { type: 'boolean' }, 'keep-path': { type: 'string', multiple: true }, all: { type: 'boolean' } },
} as const;

function parseCli(argv: string[]): ReturnType<typeof parseArgs<typeof PARSE_OPTIONS>> | string {
  try {
    return parseArgs({ args: argv, ...PARSE_OPTIONS });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const MARK = { ok: '[ok]  ', warn: '[warn]', fail: '[FAIL]', done: '[done]', unchanged: '[same]', skipped: '[skip]' } as const;

const NEXT: Record<InstallState['recommended'], string> = { install: 'c3d-mcp install', update: 'c3d-mcp install   (updates what is outdated)', repair: 'c3d-mcp install --repair   (or plain `install` to also update)', none: 'nothing to do' };

function formatState(state: InstallState): string {
  const rows = state.components.map((c) => `  ${c.name.padEnd(9)} ${c.status.padEnd(9)} ${c.detail}`);
  return `c3d-mcp status\n  Detected: ${state.summary}\n${rows.join('\n')}\n\n  Next: ${NEXT[state.recommended]}\n`;
}

function formatInstall(report: InstallReport): string {
  const flags = `${report.mode === 'auto' ? '' : ` --${report.mode}`}${report.dryRun ? ' --dry-run' : ''}`;
  let out = `c3d-mcp install${flags}\n`;
  if (report.state) out += `  Detected: ${report.state.summary}\n`;
  if (report.dryRun) {
    out += report.plan.length ? `  Would do (dry run, nothing was changed):\n${report.plan.map((l) => `    - ${l}`).join('\n')}\n` : '  Nothing to do (dry run, nothing was changed).\n';
    return out;
  }
  for (const st of report.steps) out += `  ${MARK[st.status === 'fail' ? 'fail' : st.status]} ${st.name}: ${st.detail}\n`;
  for (const g of report.guidance) out += `\n  ${g}\n`;
  out += report.ok ? '\nNext: run `c3d-mcp doctor` and add the server to your MCP client (`c3d-mcp config <client>`).\n' : '\nInstall failed; nothing else was changed.\n';
  return out;
}

function formatUninstall(report: UninstallReport): string {
  let out = '';
  const verb = report.dryRun ? 'would remove' : 'removed';
  for (const r of report.removed) out += `  ${verb} ${r}\n`;
  for (const k of report.kept) out += `  kept    ${k}\n`;
  for (const sk of report.skills ?? []) out += `  ${sk.status.padEnd(15)} skill  ${sk.target}: ${sk.dest}\n`;
  for (const c of report.clients ?? []) if (c.status !== 'absent') out += `  ${c.status.padEnd(15)} client ${c.client}: ${c.detail}\n`;
  for (const n of report.notes) out += `  ${n}\n`;
  if (report.removed.length === 0 && !(report.skills?.length) && !(report.clients?.some((c) => c.status !== 'absent'))) out += '  nothing removed\n';
  return out;
}

export async function main(argv: string[], overrides: Partial<CliIO> = {}): Promise<number> {
  const io: CliIO = { ...defaultIO, ...overrides };
  const parsed = parseCli(argv);
  if (typeof parsed === 'string') {
    io.err(`${parsed}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const command = positionals[0] ?? (io.stdinIsTTY ? 'help' : 'serve');
  if (values.help || command === 'help') {
    io.out(USAGE);
    return 0;
  }

  let config: RuntimeConfig;
  try {
    config = loadConfig(io.env);
  } catch (err) {
    io.err(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const json = values.json === true;
  const emit = (value: unknown): void => io.out(`${JSON.stringify(value, null, 2)}\n`);

  switch (command) {
    case 'version':
      io.out(json ? `${JSON.stringify({ version: packageVersion() })}\n` : `${packageVersion()}\n`);
      return 0;

    case 'serve':
      io.serve(config);
      return 0;

    case 'status': {
      const rt = io.runtime(config);
      const loaded = await loadBundle(rt);
      if ('error' in loaded) {
        io.err(`${loaded.error}\n`);
        return 1;
      }
      const state = await detectInstall(rt, loaded.bundle);
      if (json) emit(state);
      else io.out(formatState(state));
      return 0;
    }

    case 'install': {
      if (values.repair && values.reinstall) {
        io.err('Use either --repair or --reinstall, not both.\n');
        return 2;
      }
      const mode = values.reinstall ? 'reinstall' : values.repair ? 'repair' : 'auto';
      const report = await install(io.runtime(config), { mode, dryRun: values['dry-run'] === true, skipPing: values['skip-ping'] === true, installHelper: false });
      if (json) emit(report);
      else io.out(formatInstall(report));
      return report.ok ? 0 : 1;
    }

    case 'uninstall': {
      const dry = values['dry-run'] === true;
      const base = { all: values.all === true, home: io.env.HOME };
      const rt = io.runtime(config);
      if (!values.yes && !json && !dry) {
        if (!io.stdinIsTTY) {
          io.err('Refusing to uninstall without confirmation: pass --yes.\n');
          return 2;
        }
        io.out(formatUninstall(await uninstall(rt, { ...base, dryRun: true })));
        const what = base.all ? 'the C3D-MCP bridge, the helper app, the agent skills and the c3d entries in your MCP client configs' : `the C3D-MCP bridge (${config.mcpDir} and the loader macro)`;
        if (!(await io.confirm(`Remove ${what}? Backups and your scripts are kept.`))) {
          io.out('Aborted.\n');
          return 1;
        }
      }
      const report = await uninstall(rt, { ...base, dryRun: dry });
      if (json) emit(report);
      else io.out(formatUninstall(report));
      return report.ok ? 0 : 1;
    }

    case 'doctor': {
      const report = await doctor(io.runtime(config));
      if (json) emit(report);
      else if (values.brief) {
        const bad = report.checks.filter((c) => c.status !== 'ok');
        io.out(bad.length ? `c3d-mcp doctor: ${report.summary}\n${bad.map((c) => `  ${MARK[c.status]} ${c.name}: ${c.detail}${c.fix ? ` (fix: ${c.fix})` : ''}`).join('\n')}\n` : `c3d-mcp doctor: ${report.summary}\n`);
      } else {
        io.out(`c3d-mcp doctor: ${report.summary}\n`);
        for (const c of report.checks) {
          io.out(`  ${MARK[c.status]} ${c.name}: ${c.detail}\n`);
          if (c.fix) io.out(`         fix: ${c.fix}\n`);
        }
      }
      return report.ok ? 0 : 1;
    }

    case 'skills': {
      const action = parsed.positionals[1];
      const t = values.target ?? 'all';
      if (t !== 'all' && !(SKILL_TARGETS as readonly string[]).includes(t)) {
        io.err(`Unknown target "${t}". Use: ${SKILL_TARGETS.join(', ')}, all.\n`);
        return 2;
      }
      const opts = { targets: t === 'all' ? undefined : [t as SkillTarget], project: values.project, dryRun: values['dry-run'] === true };
      try {
        if (action === 'list') {
          const source = skillsSourceDir();
          const names = source ? listSkills(source) : [];
          if (json) emit({ source, skills: names });
          else io.out(names.length ? `${names.join('\n')}\n` : 'No skills found.\n');
          return names.length ? 0 : 1;
        }
        if (action !== 'install' && action !== 'uninstall') {
          io.err('Usage: c3d-mcp skills <install|uninstall|list> [--target claude|codex|antigravity|all] [--project <dir>] [--dry-run]\n');
          return 2;
        }
        const results = action === 'install' ? installSkills(opts) : uninstallSkills(opts);
        if (json) emit(results);
        else {
          for (const r of results) io.out(`  ${r.status.padEnd(15)} ${r.target.padEnd(11)} ${r.dest}\n`);
          if (results.length === 0) io.out('  nothing to do\n');
          if (results.some((r) => r.status === 'skipped-foreign')) io.out('  (skipped folders exist and were not installed by c3d-mcp; they were left untouched)\n');
          if (action === 'install' && !opts.dryRun) io.out('Restart the client (or start a new session) so it picks up the skills.\n');
        }
        return 0;
      } catch (e) {
        io.err(`${e instanceof Error ? e.message : String(e)}\n`);
        return 1;
      }
    }

    case 'clients': {
      const action = positionals[1];
      if (action !== 'list' && action !== 'add' && action !== 'remove') {
        io.err('Usage: c3d-mcp clients <list|add|remove> [client ...|all] [--node-path <abs>] [--bin-path <abs>] [--keep-path <p>] [--yes] [--dry-run] [--json]\n');
        return 2;
      }
      const home = io.env.HOME ?? homedir();
      const keep = values['keep-path'] ?? [];
      const names = positionals.slice(2);
      const known: readonly string[] = CLIENT_NAMES;
      const bad = names.filter((n) => n !== 'all' && !known.includes(n));
      if (bad.length) {
        io.err(`Unknown client(s): ${bad.join(', ')}. Use: ${CLIENT_NAMES.join(', ')}, all.\n`);
        return 2;
      }
      if (action === 'list') {
        const detected = new Map((await detectClients({ home })).map((d) => [d.client as string, d]));
        const rows = [];
        for (const client of CLIENT_NAMES) {
          const entry = await clientEntry(client, home, defaultExec);
          const state = !entry ? 'none' : keep.some((k) => k !== '' && entry.text.includes(k)) ? 'current' : /c3d-mcp/.test(entry.text) ? 'legacy' : 'foreign';
          const d = detected.get(client);
          rows.push({ client, label: client === 'lm-studio' ? 'LM Studio' : CLIENT_LABELS[client], detected: d?.detected ?? existsSync(join(home, '.lmstudio')), state, detail: entry?.where ?? d?.detail ?? 'not found' });
        }
        if (json) emit(rows);
        else for (const r of rows) io.out(`  ${r.client.padEnd(15)} ${r.state.padEnd(8)} ${r.detected ? 'detected' : 'not detected'}  ${r.detail}\n`);
        return 0;
      }
      const chosen = (names.length === 0 || names.includes('all') ? [...CLIENT_NAMES] : (names as (SetupClient | 'lm-studio')[]));
      const launch = { form: 'absolute' as const, nodePath: values['node-path'] ?? process.execPath, binPath: values['bin-path'] ?? join(PACKAGE_ROOT, 'bin', 'c3d-mcp.js') };
      const results = [];
      for (const client of chosen) {
        if (client === 'lm-studio') {
          if (action === 'add') {
            if (names.includes('lm-studio')) results.push({ client, status: 'refused', target: '', detail: 'LM Studio is not configured automatically; run: c3d-mcp config lm-studio' });
            continue;
          }
          results.push(await unconfigureLmStudio({ home, dryRun: values['dry-run'] === true }));
        } else if (action === 'add') {
          results.push(await configureClient(client, { home, launch, dryRun: values['dry-run'] === true, confirmOverwrite: () => Promise.resolve(values.yes === true) }));
        } else {
          results.push(await unconfigureClient(client, { home, dryRun: values['dry-run'] === true }));
        }
      }
      if (json) emit(results);
      else for (const r of results) io.out(`  ${r.status.padEnd(12)} ${r.client}: ${r.detail}\n`);
      return results.some((r) => r.status === 'failed' || r.status === 'refused') ? 1 : 0;
    }

    case 'legacy': {
      const action = positionals[1];
      if (action !== 'scan' && action !== 'remove') {
        io.err('Usage: c3d-mcp legacy <scan|remove> [--ids a,b] [--keep-path <p>] [--quit-apps] [--yes] [--dry-run] [--json]\n');
        return 2;
      }
      const home = io.env.HOME ?? homedir();
      const scanOpts = { home, supportDir: config.cheetahSupportDir, keepPaths: values['keep-path'] ?? [], ...(io.env.C3D_MCP_SYSTEM_ROOT ? { systemRoot: io.env.C3D_MCP_SYSTEM_ROOT } : {}) };
      const found = await scanLegacy(scanOpts);
      if (action === 'scan') {
        if (json) emit(found);
        else if (found.length === 0) io.out('No earlier c3d-mcp installs found.\n');
        else for (const f of found) io.out(`  ${f.removable ? '[ ]' : '[i]'} ${f.label}\n      by: ${f.installedBy}\n      ${f.evidence}${f.needsQuit ? `\n      needs ${f.needsQuit} closed` : ''}\n      id: ${f.id}\n`);
        return 0;
      }
      const wanted = values.ids ? new Set(values.ids.split(',').map((x) => x.trim())) : undefined;
      const picked = found.filter((f) => f.removable && (!wanted || wanted.has(f.id)));
      if (picked.length === 0) {
        if (json) emit([]);
        else io.out('Nothing to remove.\n');
        return 0;
      }
      const dry = values['dry-run'] === true;
      if (!dry && values.yes !== true && !json) {
        if (!io.stdinIsTTY) {
          io.err('Refusing to remove without confirmation: pass --yes (and --ids to choose).\n');
          return 2;
        }
        io.out(`${picked.map((f) => `  - ${f.label} (${f.evidence})`).join('\n')}\n`);
        if (!(await io.confirm('Move these to the Trash and remove their configuration entries?', false))) {
          io.out('Nothing changed.\n');
          return 0;
        }
      } else if (!dry && values.yes !== true && json) {
        io.err('Refusing to remove without confirmation: pass --yes.\n');
        return 2;
      }
      const results = await removeLegacy(picked, { ...scanOpts, dryRun: dry, quitApps: values['quit-apps'] === true });
      const report = dry ? undefined : await writeCleanupReport(home, results, picked);
      if (json) emit({ results, report });
      else {
        for (const r of results) io.out(`  ${r.status.padEnd(12)} ${r.kind}: ${r.detail}\n`);
        if (report) io.out(`Report: ${report}\nRemoved files are in the Trash. Restart Cheetah3D and your AI clients.\n`);
      }
      return results.some((r) => r.status === 'failed' || r.status === 'blocked') ? 1 : 0;
    }

    case 'permissions': {
      const action = positionals[1];
      if (action !== 'allow' && action !== 'revoke') {
        io.err('Usage: c3d-mcp permissions <allow|revoke> [--yes] [--dry-run] [--json]\n');
        return 2;
      }
      const result = await setClaudeCodeAllow(action, { dryRun: values['dry-run'] === true, confirm: values.yes === true ? () => Promise.resolve(true) : io.stdinIsTTY ? (q) => io.confirm(q, false) : undefined });
      if (json) emit(result);
      else io.out(`  ${result.status.padEnd(12)} ${result.target}\n  ${result.detail}${result.backup ? `\n  backup: ${result.backup}` : ''}\n${result.status === 'added' ? 'Restart Claude Code (or start a new session) for it to take effect.\n' : ''}`);
      return result.status === 'refused' ? 1 : result.status === 'declined' && !io.stdinIsTTY ? 1 : 0;
    }

    case 'config': {
      const client = positionals[1];
      if (!client || !(CLIENTS as readonly string[]).includes(client)) {
        io.err(`Usage: c3d-mcp config <${CLIENTS.join('|')}> [--form npx|absolute] [--raw]\n`);
        return 2;
      }
      const form = values.form === 'absolute' ? 'absolute' : values.form === undefined || values.form === 'npx' ? 'npx' : undefined;
      if (!form) {
        io.err('--form must be npx or absolute\n');
        return 2;
      }
      const env = Object.fromEntries(Object.entries(io.env).filter(([k, v]) => k === 'C3D_MCP_PROFILE' && v !== undefined)) as Record<string, string>;
      const snippet = configSnippet(client as ClientName, { form, binPath: join(PACKAGE_ROOT, 'bin', 'c3d-mcp.js'), env });
      if (json) emit(snippet);
      else if (values.raw) io.out(`${snippet.text}${snippet.text.endsWith('\n') ? '' : '\n'}`);
      else io.out(`# ${snippet.client}:${snippet.location}\n# ${snippet.note}\n${snippet.text}${snippet.text.endsWith('\n') ? '' : '\n'}`);
      return 0;
    }

    default:
      io.err(`Unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
}
