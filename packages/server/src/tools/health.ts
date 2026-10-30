import { z } from 'zod';
import { doctor } from '../core/doctor.js';
import { createHelperInstaller } from '../core/helperInstall.js';
import { install } from '../core/install.js';
import { packageVersion } from '../core/assets.js';
import type { Runtime } from '../core/runtime.js';
import { defineTool, type ToolDef } from '../toolkit.js';

const checkSchema = z.object({
  name: z.string(),
  status: z.enum(['ok', 'warn', 'fail']),
  detail: z.string(),
  fix: z.string().describe('What to do about it; empty when status is ok'),
});

/** c3d_doctor, c3d_install_bridge, c3d_capabilities. They need the runtime wiring (paths, probes), hence the factory. */
export function createHealthTools(rt: Runtime, listEnabled: () => string[]): ToolDef[] {
  const doctorTool = defineTool({
    name: 'c3d_doctor',
    title: 'Diagnose the Cheetah3D bridge',
    description:
      'Runs health checks: Node/server versions, Cheetah3D running/version/frontmost, document windows, bridge install state and runtime version, menu item, Accessibility and Screen Recording, helper app, a ping round trip and modal-dialog state. Each check has status ok|warn|fail plus a concrete fix. Call this first in a session and whenever another tool returns APP_*, TRIGGER_FAILED or BRIDGE_NOT_INSTALLED.',
    group: 'health',
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean(), summary: z.string(), checks: z.array(checkSchema) }),
    mutating: false,
    profiles: ['full', 'local', 'readonly'],
    localDescription: 'Check that Cheetah3D and the bridge work; start here.',
    async handler() {
      const report = await doctor(rt);
      const lines = report.checks.map((c) => `${c.status.toUpperCase().padEnd(4)} ${c.name}: ${c.detail}${c.fix ? `  -> ${c.fix}` : ''}`);
      return { structured: { ...report }, text: `${report.summary}\n${lines.join('\n')}` };
    },
  });

  const installTool = defineTool({
    name: 'c3d_install_bridge',
    title: 'Install or update the Cheetah3D bridge',
    description:
      'Detects whether the bridge is fresh, current, outdated or partially installed and does what is needed: backs up Cheetah3D Scripts/, creates the mailbox and secret, installs or repairs the runtime and loader macro (Scripts/Macro/C3D-MCP), installs or replaces an old or damaged helper app. mode: auto (default), repair (fix only what is broken) or reinstall (rewrite everything). dry_run lists the plan and changes nothing. Never downgrades a newer runtime. A new macro appears in the menu only after a Cheetah3D restart; a replaced helper needs the macOS permissions granted again. The result says what is needed.',
    group: 'health',
    inputSchema: z.object({
      skip_ping: z.boolean().optional().describe('Do not ping the runtime after installing'),
      mode: z.enum(['auto', 'repair', 'reinstall']).optional().describe('auto (default): do what the detected state needs; repair: fix only what is broken; reinstall: rewrite every managed file and the helper.'),
      dry_run: z.boolean().optional().describe('Only report what was detected and what would change.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      mode: z.enum(['auto', 'repair', 'reinstall']),
      dry_run: z.boolean(),
      detected: z.string().optional(),
      plan: z.array(z.string()),
      changed: z.boolean(),
      restart_needed: z.boolean(),
      menu: z.enum(['present', 'absent', 'unknown']),
      helper: z.enum(['installed', 'present', 'missing']),
      degraded: z.boolean(),
      steps: z.array(z.object({ name: z.string(), status: z.string(), detail: z.string() })),
      guidance: z.array(z.string()),
      ping: z.object({ ok: z.boolean(), detail: z.string() }).optional(),
      helper_update: z.object({ action: z.string(), permissions: z.string(), detail: z.string() }).optional(),
    }),
    mutating: true,
    idempotent: true,
    profiles: ['full', 'local'],
    localDescription: 'Install/update the Cheetah3D bridge (idempotent).',
    async handler(input) {
      const r = await install(rt, { skipPing: input.skip_ping, mode: input.mode ?? 'auto', dryRun: input.dry_run === true, installHelper: createHelperInstaller() });
      const structured = { ok: r.ok, mode: r.mode, dry_run: r.dryRun, ...(r.state ? { detected: r.state.summary } : {}), plan: r.plan, ...(r.helperUpdate ? { helper_update: { action: r.helperUpdate.action, permissions: r.helperUpdate.permissions, detail: r.helperUpdate.detail } } : {}), changed: r.changed, restart_needed: r.restartNeeded, menu: r.menu, helper: r.helper, degraded: r.degraded, steps: r.steps, guidance: r.guidance, ...(r.ping ? { ping: r.ping } : {}) };
      return { structured, text: [r.dryRun ? 'Dry run: nothing was changed.' : r.ok ? 'Bridge installed.' : 'Install failed.', ...(r.state ? [`Detected: ${r.state.summary}`] : []), ...(r.dryRun ? r.plan.map((l) => `- would ${l}`) : r.steps.map((s) => `- ${s.name}: ${s.status} ${s.detail}`)), ...r.guidance].join('\n') };
    },
  });

  const capabilitiesTool = defineTool({
    name: 'c3d_capabilities',
    title: 'Server and Cheetah3D capabilities',
    description:
      'Returns the server profile and enabled tools plus the Cheetah3D type map (object, tag, material and node types, rotation orders, renderers, render/save formats, limits). Types come from the live runtime and are cached per runtime version; if the app is unreachable a built-in list is returned with source "fallback". Use the names it returns for c3d_create_object / c3d_add_tag.',
    group: 'health',
    inputSchema: z.object({}),
    outputSchema: z.object({
      server_version: z.string(),
      profile: z.enum(['full', 'local', 'readonly']),
      exec_enabled: z.boolean(),
      assets_enabled: z.boolean(),
      source: z.enum(['runtime', 'fallback']),
      runtime_version: z.string().nullable(),
      tools: z.array(z.string()),
      capabilities: z.record(z.string(), z.unknown()),
    }),
    mutating: false,
    profiles: ['full', 'local', 'readonly'],
    localDescription: 'List supported object/tag/material type names and limits.',
    async handler(_input, ctx) {
      const caps = await ctx.services.capabilities();
      const source = caps.fallback === true ? 'fallback' : 'runtime';
      const structured = {
        server_version: packageVersion(),
        profile: ctx.config.profile,
        exec_enabled: !ctx.config.disableExec && ctx.config.profile === 'full',
        assets_enabled: !ctx.config.disableAssets,
        source: source,
        runtime_version: typeof caps.runtimeVersion === 'string' ? caps.runtimeVersion : null,
        tools: listEnabled(),
        capabilities: caps,
      };
      return { structured, text: `c3d-mcp ${structured.server_version}, profile ${structured.profile}, ${structured.tools.length} tools, capabilities from ${source}${structured.runtime_version ? ` (runtime ${structured.runtime_version})` : ''}.` };
    },
  });

  return [doctorTool, installTool, capabilitiesTool];
}
