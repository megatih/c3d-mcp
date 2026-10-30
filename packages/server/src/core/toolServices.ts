import { createHash } from 'node:crypto';
import { CLIENT_CAPABILITIES_META_KEY, inputResponse, type ServerContext } from '@modelcontextprotocol/server';
import type { BridgeClient, RunOpts, ToolServices } from '../toolkit.js';
import { FALLBACK_CAPABILITIES } from './fallbackCapabilities.js';

/** Thrown by `services.confirm` to unwind the handler; the server turns it into an MCP `input_required` (elicitation) result. */
export class ConfirmationNeeded extends Error {
  constructor(readonly key: string, readonly prompt: string) {
    super(prompt);
    this.name = 'ConfirmationNeeded';
  }
}

/** Capabilities cached per runtimeVersion; a fallback list is served (uncached) while the app is unreachable. */
export class CapabilitiesCache {
  private cached: { version: string; value: Record<string, unknown> } | undefined;

  constructor(private readonly bridge: BridgeClient, private readonly currentVersion: () => string | undefined) {}

  async get(): Promise<Record<string, unknown>> {
    const known = this.currentVersion();
    if (this.cached && known === this.cached.version) return this.cached.value;
    try {
      const value = await this.bridge.one<Record<string, unknown>>('capabilities', {}, { deadlineMs: 15_000 });
      const version = typeof value.runtimeVersion === 'string' ? value.runtimeVersion : (this.currentVersion() ?? 'unknown');
      this.cached = { version, value };
      return value;
    } catch {
      return { ...FALLBACK_CAPABILITIES };
    }
  }
}

export function clientSupportsElicitation(call: ServerContext | undefined, legacyCaps: () => { elicitation?: unknown } | undefined): boolean {
  if (!call) return false;
  const envelope = call.mcpReq.envelope as Record<string, unknown> | undefined;
  const caps = (envelope?.[CLIENT_CAPABILITIES_META_KEY] as { elicitation?: unknown } | undefined) ?? legacyCaps();
  return caps?.elicitation !== undefined;
}

export interface ToolServiceDeps {
  capabilities: () => Promise<Record<string, unknown>>;
  statics: Pick<ToolServices, 'searchDocs' | 'lint' | 'imageTools'>;
  legacyClientCapabilities: () => { elicitation?: unknown } | undefined;
  /** C3D_MCP_AUTO_CONFIRM: unattended agent runs where nobody can answer an elicitation prompt. */
  autoConfirm?: boolean;
}

/** Gives every bridge call of a tool the "Waiting for Cheetah3D (Ns)" heartbeat as MCP progress (only emitted while a call waits longer than the client's progress interval). */
export function withProgress(bridge: BridgeClient, services: Pick<ToolServices, 'progress'>): BridgeClient {
  const withOpts = (opts?: RunOpts): RunOpts => ({ ...opts, onProgress: opts?.onProgress ?? ((message) => { services.progress(message); }) });
  return {
    run: (ops, opts) => bridge.run(ops, withOpts(opts)),
    one: (op, args, opts) => bridge.one(op, args, withOpts(opts)),
  };
}

/** Progress is only valid while the request is in flight; background jobs (c3d_render_sequence) keep using the tool context afterwards. */
export function scopeProgress(services: ToolServices): { services: ToolServices; end(): void } {
  let active = true;
  return {
    services: { ...services, progress: (message, fraction) => { if (active) services.progress(message, fraction); } },
    end: () => { active = false; },
  };
}

/** Per-call services: progress and confirm need the current request's context. */
export function createToolServices(deps: ToolServiceDeps, call?: ServerContext): ToolServices {
  let step = 0;
  let last = 0;
  const token = call?.mcpReq._meta?.progressToken;
  return {
    capabilities: () => deps.capabilities() as Promise<Record<string, any>>,
    // eslint-disable-next-line @typescript-eslint/require-await -- must reject (not throw synchronously) with ConfirmationNeeded
    async confirm({ message, confirmFlag }) {
      if (deps.autoConfirm && confirmFlag === true) return true;
      const key = `confirm-${createHash('sha256').update(message).digest('hex').slice(0, 12)}`;
      const prior = call ? inputResponse(call.mcpReq.inputResponses, key) : ({ kind: 'missing' } as const);
      if (prior.kind === 'elicit') return prior.action === 'accept' && prior.content?.confirm === true;
      // A client that can ask its user always does: the model-supplied confirm flag must not bypass a human prompt (security review H3).
      if (clientSupportsElicitation(call, deps.legacyClientCapabilities)) throw new ConfirmationNeeded(key, message);
      return confirmFlag === true;
    },
    progress(message, fraction) {
      if (!call || token === undefined) return;
      // MCP requires strictly increasing progress: heartbeats (no fraction) and fraction updates can be mixed within one request.
      const progress = Math.max(fraction === undefined ? ++step : fraction, last + 1e-6);
      last = progress;
      call.mcpReq
        .notify({ method: 'notifications/progress', params: { progressToken: token, progress, ...(fraction === undefined ? {} : { total: 1 }), message } })
        .catch(() => undefined);
    },
    ...deps.statics,
  };
}
