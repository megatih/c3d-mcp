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
      'Idempotent, version-aware install of the in-app bridge: backs up Cheetah3D Scripts/, creates the mailbox directory and secret, installs the runtime and the loader macro (Scripts/Macro/C3D-MCP). Never overwrites a newer runtime. A newly installed macro only appears in the menu after Cheetah3D is restarted; the result says whether that is needed. Safe to call repeatedly.',
    group: 'health',
    inputSchema: z.object({ skip_ping: z.boolean().optional().describe('Do not ping the runtime after installing') }),
    outputSchema: z.object({
      ok: z.boolean(),
      changed: z.boolean(),
      restart_needed: z.boolean(),
      menu: z.enum(['present', 'absent', 'unknown']),
      helper: z.enum(['installed', 'present', 'missing']),
      degraded: z.boolean(),
      steps: z.array(z.object({ name: z.string(), status: z.string(), detail: z.string() })),
      guidance: z.array(z.string()),
      ping: z.object({ ok: z.boolean(), detail: z.string() }).optional(),
    }),
    mutating: true,
    idempotent: true,
    profiles: ['full', 'local'],
    localDescription: 'Install/update the Cheetah3D bridge (idempotent).',
    async handler(input) {
      const r = await install(rt, { skipPing: input.skip_ping, installHelper: createHelperInstaller() });
      const structured = { ok: r.ok, changed: r.changed, restart_needed: r.restartNeeded, menu: r.menu, helper: r.helper, degraded: r.degraded, steps: r.steps, guidance: r.guidance, ...(r.ping ? { ping: r.ping } : {}) };
      return { structured, text: [r.ok ? 'Bridge installed.' : 'Install failed.', ...r.steps.map((s) => `- ${s.name}: ${s.status} ${s.detail}`), ...r.guidance].join('\n') };
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
