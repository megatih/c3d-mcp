import { createHelperInstaller } from '../core/helperInstall.js';
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
import { SETUP_CLIENTS, type SetupClient } from '../core/clientConfigs.js';
import { runSetup } from '../core/setup.js';
import { serve } from '../server.js';
import { isAbsolute, join } from 'node:path';

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
  setup              Guided setup: bridge + helper, permissions, MCP clients, skills, test render (see docs/SETUP.md)
  doctor             Check Cheetah3D, the bridge, permissions and the helper
  skills <action>    Agent skills for Claude Code, Codex and Antigravity: install | uninstall | list (see docs/SKILLS.md)
  config <client>    Print an MCP config snippet (${CLIENTS.join(', ')})
  serve              Run the MCP server on stdio (default when started by an MCP client)
  version            Print the version

Options:
  --json             Machine-readable output (install, uninstall, doctor, config, version)
  --yes, -y          Do not ask for confirmation (uninstall; setup accepts the defaults)
  --brief            doctor: one line when healthy, otherwise only the failing checks (for hooks)
  --form <npx|absolute>   config: launch via "npx -y c3d-mcp serve" (default) or absolute node/bin paths
  --target <t>       skills: claude, codex, antigravity or all (default all)
  --project <dir>    skills: install into <dir>/.claude|.agents/skills instead of the home directory
  --dry-run          install, uninstall, skills, setup: show what would change and change nothing
  --repair           install, setup: fix only what is broken or missing; versions stay as they are
  --reinstall        install, setup: rewrite every managed file and replace the helper app (keeps the secret, backups and your scripts)
  --no-helper        install: leave the helper app alone (no install, no update)
  --skip-ping        install: do not test the bridge afterwards (does not touch the running Cheetah3D)
  --all              uninstall: also remove the agent skills and the c3d entries in MCP client configs
  --clients <list>   setup: comma-separated clients (${SETUP_CLIENTS.join(', ')}), all (detected) or none
  --no-skills        setup: do not install the agent skills
  --node-path <abs>  setup: pin this node binary in client configs (absolute launch form instead of npx)
  --raw              config: print only the snippet (no leading comment lines), e.g. c3d-mcp config codex --raw > snippet.toml
  --help, -h

Environment: C3D_MCP_PROFILE=full|local|readonly, C3D_MCP_DISABLE_EXEC/ASSETS/SHELL=1, C3D_MCP_DIR, C3D_CHEETAH_SUPPORT_DIR,
C3D_MCP_WORKDIR, C3D_MCP_LOG_DIR, C3D_MCP_TRIGGER=auto|helper|osascript, C3D_MCP_AUTO_CONFIRM=1 (unattended runs only).
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
  options: { json: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' }, help: { type: 'boolean', short: 'h' }, form: { type: 'string' }, brief: { type: 'boolean' }, raw: { type: 'boolean' }, target: { type: 'string' }, project: { type: 'string' }, 'dry-run': { type: 'boolean' }, clients: { type: 'string' }, 'no-skills': { type: 'boolean' }, 'node-path': { type: 'string' }, repair: { type: 'boolean' }, reinstall: { type: 'boolean' }, 'no-helper': { type: 'boolean' }, 'skip-ping': { type: 'boolean' }, all: { type: 'boolean' } },
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
      const report = await install(io.runtime(config), { mode, dryRun: values['dry-run'] === true, skipPing: values['skip-ping'] === true, installHelper: values['no-helper'] ? false : createHelperInstaller() });
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

    case 'setup': {
      const clientsArg = values.clients;
      let clients: 'all' | 'none' | SetupClient[] | undefined;
      if (clientsArg !== undefined) {
        const names = clientsArg.split(',').map((c) => c.trim()).filter(Boolean);
        if (names.length === 1 && (names[0] === 'all' || names[0] === 'none')) clients = names[0];
        else if (names.length > 0 && names.every((n) => (SETUP_CLIENTS as readonly string[]).includes(n))) clients = names as SetupClient[];
        else {
          io.err(`--clients must be all, none or a comma-separated list of: ${SETUP_CLIENTS.join(', ')}\n`);
          return 2;
        }
      }
      if (values['node-path'] !== undefined && !isAbsolute(values['node-path'])) {
        io.err('--node-path must be an absolute path\n');
        return 2;
      }
      if (!values.yes && !values['dry-run'] && !io.stdinIsTTY) {
        io.err('setup is interactive: run it in a terminal, or pass --yes to accept the defaults (or --dry-run to preview).\n');
        return 2;
      }
      const report = await runSetup(
        { yes: values.yes === true, dryRun: values['dry-run'] === true, clients, skills: values['no-skills'] !== true, nodePath: values['node-path'], mode: values.reinstall ? 'reinstall' : values.repair ? 'repair' : 'auto' },
        { rt: io.runtime(config), home: io.env.HOME, out: json ? (): void => undefined : (t) => io.out(t), confirm: (q, d) => io.confirm(q, d) },
      );
      if (json) emit(report);
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
