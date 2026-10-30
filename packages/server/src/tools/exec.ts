import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BridgeError, defineTool } from '../toolkit.js';
import { autoCheckpoint } from '../lib/checkpoints.js';
import { clean, ok } from '../lib/result.js';
import { Confirm } from '../lib/schemas.js';

const FINDING = z.looseObject({ rule: z.string(), line: z.number().int(), message: z.string(), severity: z.enum(['error', 'warn']) });
const SHELL = /\bOS\s*\.\s*system\b/;
const FILE_WRITE = /\bnew\s+File\s*\(|\bFile\s*\.\s*(?:mkDir|remove|write|copy|move)\b|\.(?:write|writeln|copyTo|remove|open)\s*\(|\bWRITE_MODE\b/;

export const runScript = defineTool({
  name: 'c3d_run_script',
  title: 'Run JavaScript in Cheetah3D',
  description:
    'Runs a JavaScript snippet inside Cheetah3D with the full scripting API (doc, ES5-style; JSC engine). Use only when no dedicated tool fits. Search c3d_search_api_docs first. The code is linted first and blocked on error-severity findings unless force:true. Code touching OS.system or files needs confirmation. An automatic checkpoint is saved first (changes cannot be undone otherwise). print() output is returned in log; use an explicit return to send a JSON-able value back. doc.addObject puts the new object under the parent of the currently selected object, so parent every new object explicitly with parent.addChildAtIndex(obj, parent.childCount()). A script that throws keeps the geometry it already created (check c3d_list_scene, restore the checkpoint if needed). The code runs in strict mode (undeclared variables throw). No setTimeout/require; never call File.mkDir; always obj.update() after core edits.',
  group: 'exec',
  inputSchema: z.strictObject({
    code: z.string().min(1).max(200000).describe('JavaScript source. Use print() for output; use an explicit `return` to send a JSON-able value back (a trailing expression is NOT returned).'),
    force: z.boolean().optional().describe('Run even when lint reports errors (use sparingly).'),
    confirm: Confirm,
    timeout_s: z.number().min(1).max(600).optional().describe('Deadline in seconds (default 60).'),
  }),
  outputSchema: z.looseObject({ value: z.any(), log: z.array(z.string()), lint: z.array(FINDING), checkpoint: z.string().optional(), warning: z.string().optional() }),
  mutating: true,
  destructive: true,
  idempotent: false,
  openWorld: true,
  profiles: ['full'],
  async handler(i, ctx) {
    if (ctx.config.disableExec) throw new BridgeError('NOT_AVAILABLE_IN_PROFILE', 'Script execution is disabled (C3D_MCP_DISABLE_EXEC).', 'Use the dedicated tools instead, or unset the variable and restart.');
    const lint = ctx.services.lint(i.code);
    const errors = lint.filter((f) => f.severity === 'error');
    if (errors.length && !i.force) throw new BridgeError('LINT_BLOCKED', `Script blocked by ${errors.length} lint error(s): ${errors.map((e) => `${e.rule}@L${e.line}`).join(', ')}.`, 'Fix the errors (see details) or pass force:true if you are sure.', { findings: lint });
    const shell = SHELL.test(i.code);
    const files = FILE_WRITE.test(i.code);
    if (shell && ctx.config.disableShell) throw new BridgeError('NOT_AVAILABLE_IN_PROFILE', 'OS.system is disabled (C3D_MCP_DISABLE_SHELL).', 'Remove shell calls from the script.');
    if (shell || files) {
      const yes = await ctx.services.confirm({ message: `This script uses ${shell ? 'OS.system (shell commands)' : 'file writes'}. Run it?\n\n${i.code.length > 800 ? `${i.code.slice(0, 800)}\n… (${i.code.length} chars total, sha256 ${createHash('sha256').update(i.code).digest('hex').slice(0, 12)})` : i.code}`, confirmFlag: i.confirm });
      if (!yes) throw new BridgeError('CONFIRMATION_REQUIRED', `Scripts using ${shell ? 'OS.system' : 'file access'} need confirmation.`, 'Retry with confirm:true after checking the code.');
    }
    const cp = await autoCheckpoint(ctx, 'run_script');
    const r = await ctx.bridge.one<{ value?: unknown; log?: string[]; returned?: unknown }>('run', clean({ code: i.code, allowShellToken: shell ? 'OS.system' : undefined }), { deadlineMs: (i.timeout_s ?? 60) * 1000 });
    const log = r.log ?? [];
    return ok({ value: r.value ?? null, returned: r.returned ?? null, log, lint, ...(cp.checkpoint ? { checkpoint: cp.checkpoint.id } : {}), ...(cp.warning ? { warning: cp.warning } : {}) }, `Script finished.${log.length ? `\nlog:\n${log.join('\n')}` : ''}${r.value !== undefined ? `\nvalue: ${JSON.stringify(r.value)}` : ''}${cp.warning ? `\nWARNING: ${cp.warning}` : ''}`);
  },
});

export const lintScript = defineTool({
  name: 'c3d_lint_script',
  title: 'Lint script',
  description: 'Static, advisory checks of Cheetah3D JavaScript (no execution): known crash patterns (missing `new`, addParameter arg counts, setParameter loops), banned calls (File.mkDir, OS.system, eval, computed OS access), endless loops, missing update(), unknown API methods/constants. Returns rule ids with line numbers. Run it before c3d_run_script on non-trivial code.',
  group: 'lint',
  inputSchema: z.strictObject({ code: z.string().min(1).max(200000).describe('Script source.') }),
  outputSchema: z.looseObject({ findings: z.array(FINDING), errors: z.number().int(), warnings: z.number().int() }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'readonly'],
  // eslint-disable-next-line @typescript-eslint/require-await
  async handler(i, ctx) {
    const findings = ctx.services.lint(i.code);
    const errors = findings.filter((f) => f.severity === 'error').length;
    return ok({ findings, errors, warnings: findings.length - errors }, findings.length ? findings.map((f) => `L${f.line} ${f.severity} ${f.rule}: ${f.message}`).join('\n') : 'No static issues found (not executed in Cheetah3D).');
  },
});

export const getConsole = defineTool({
  name: 'c3d_get_console',
  title: 'Get bridge log',
  description: 'Returns the bridge RUNTIME log ring buffer (diagnostics of c3d-mcp operations inside Cheetah3D). It is NOT Cheetah3D\'s own Console window, which cannot be read externally; script print() output comes back in the c3d_run_script result instead.',
  group: 'log',
  inputSchema: z.strictObject({ tail: z.number().int().min(1).max(1000).optional().describe('Last N lines (default 100).') }),
  outputSchema: z.looseObject({ lines: z.array(z.string()), source: z.literal('bridge-runtime-log') }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'readonly'],
  async handler(i, ctx) {
    const r = await ctx.bridge.one<{ lines: string[] }>('getLog', { tail: i.tail ?? 100 });
    return ok({ lines: r.lines, source: 'bridge-runtime-log' }, r.lines.join('\n') || '(log empty)');
  },
});

export const execTools = [runScript, lintScript, getConsole];
