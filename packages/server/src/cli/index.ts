import { createHelperInstaller } from '../core/helperInstall.js';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadConfig, type RuntimeConfig } from '../config.js';
import { PACKAGE_ROOT, packageVersion } from '../core/assets.js';
import { CLIENTS, configSnippet, type ClientName } from '../core/configSnippets.js';
import { doctor } from '../core/doctor.js';
import { install, uninstall } from '../core/install.js';
import { createRuntime, type Runtime } from '../core/runtime.js';
import { serve } from '../server.js';
import { join } from 'node:path';

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
  env: NodeJS.ProcessEnv;
  stdinIsTTY: boolean;
  /** Asks a yes/no question; the default implementation reads from the terminal. */
  confirm(question: string): Promise<boolean>;
  runtime(config: RuntimeConfig): Runtime;
  serve(config: RuntimeConfig): void;
}

const USAGE = `c3d-mcp ${packageVersion()} - MCP server for Cheetah3D 8.1.3 (macOS)

Usage: c3d-mcp <command> [options]

Commands:
  install            Install the in-app bridge (idempotent; backs up Scripts/ first)
  uninstall          Remove what install created (never backups or your scripts)
  doctor             Check Cheetah3D, the bridge, permissions and the helper
  config <client>    Print an MCP config snippet (${CLIENTS.join(', ')})
  serve              Run the MCP server on stdio (default when started by an MCP client)
  version            Print the version

Options:
  --json             Machine-readable output (install, uninstall, doctor, config, version)
  --yes, -y          Do not ask for confirmation (uninstall)
  --brief            doctor: one line when healthy, otherwise only the failing checks (for hooks)
  --form <npx|absolute>   config: launch via "npx -y c3d-mcp serve" (default) or absolute node/bin paths
  --help, -h

Environment: C3D_MCP_PROFILE=full|local|readonly, C3D_MCP_DISABLE_EXEC/ASSETS/SHELL=1, C3D_MCP_DIR, C3D_CHEETAH_SUPPORT_DIR,
C3D_MCP_WORKDIR, C3D_MCP_LOG_DIR, C3D_MCP_TRIGGER=auto|helper|osascript.
`;

export const defaultIO: CliIO = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  env: process.env,
  stdinIsTTY: process.stdin.isTTY,
  confirm: async (q) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return /^y(es)?$/i.test((await rl.question(`${q} [y/N] `)).trim());
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
  options: { json: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' }, help: { type: 'boolean', short: 'h' }, form: { type: 'string' }, brief: { type: 'boolean' } },
} as const;

function parseCli(argv: string[]): ReturnType<typeof parseArgs<typeof PARSE_OPTIONS>> | string {
  try {
    return parseArgs({ args: argv, ...PARSE_OPTIONS });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const MARK = { ok: '[ok]  ', warn: '[warn]', fail: '[FAIL]', done: '[done]', unchanged: '[same]', skipped: '[skip]' } as const;

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

    case 'install': {
      const report = await install(io.runtime(config), { installHelper: createHelperInstaller() });
      if (json) emit(report);
      else {
        io.out('c3d-mcp install\n');
        for (const s of report.steps) io.out(`  ${MARK[s.status === 'fail' ? 'fail' : s.status]} ${s.name}: ${s.detail}\n`);
        for (const g of report.guidance) io.out(`\n  ${g}\n`);
        io.out(report.ok ? '\nNext: run `c3d-mcp doctor` and add the server to your MCP client (`c3d-mcp config <client>`).\n' : '\nInstall failed; nothing else was changed.\n');
      }
      return report.ok ? 0 : 1;
    }

    case 'uninstall': {
      if (!values.yes && !json) {
        if (!io.stdinIsTTY) {
          io.err('Refusing to uninstall without confirmation: pass --yes.\n');
          return 2;
        }
        if (!(await io.confirm(`Remove the C3D-MCP bridge (${config.mcpDir} and the loader macro)? Backups and your scripts are kept.`))) {
          io.out('Aborted.\n');
          return 1;
        }
      }
      const report = await uninstall(io.runtime(config));
      if (json) emit(report);
      else {
        for (const r of report.removed) io.out(`  removed ${r}\n`);
        for (const n of report.notes) io.out(`  ${n}\n`);
        if (report.removed.length === 0) io.out('  nothing removed\n');
      }
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

    case 'config': {
      const client = positionals[1];
      if (!client || !(CLIENTS as readonly string[]).includes(client)) {
        io.err(`Usage: c3d-mcp config <${CLIENTS.join('|')}> [--form npx|absolute]\n`);
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
      else io.out(`# ${snippet.client}: ${snippet.location}\n# ${snippet.note}\n${snippet.text}${snippet.text.endsWith('\n') ? '' : '\n'}`);
      return 0;
    }

    default:
      io.err(`Unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
}
