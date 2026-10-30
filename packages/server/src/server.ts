import { McpServer, inputRequired, type ServerContext, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { loadConfig, type RuntimeConfig } from './config.js';
import { packageVersion } from './core/assets.js';
import { toErrorPayload } from './core/errors.js';
import { Mutex } from './core/lock.js';
import { createRuntime, type Runtime, type RuntimeOverrides } from './core/runtime.js';
import { CapabilitiesCache, ConfirmationNeeded, createToolServices, scopeProgress, withProgress } from './core/toolServices.js';
import { createLogger } from './logging.js';
import { createStaticServices } from './services/index.js';
import { createHealthTools } from './tools/health.js';
import { allPrompts, allResources, allTools } from './tools/index.js';
import { BridgeError, type PromptDef, type ResourceDef, type ToolDef, type ToolContext } from './toolkit.js';

export const INSTRUCTIONS = [
  'Controls a running Cheetah3D 8.1.3 on macOS through an in-app bridge.',
  'Workflow: c3d_doctor first (fix anything it flags) -> bind the session to a document (c3d_new_document where available, else c3d_get_document_info) -> build/edit with the c3d_* tools -> render (c3d_render_image where available) to check the result visually.',
  'Cheetah3D is Y-up (heights go on the y axis). Rotation is in degrees. Objects are addressed by {id} (stable) or path; duplicate names return AMBIGUOUS with candidates. Many ops can go into one call to save round trips.',
  'Errors come back as isError results {code,message,hint,details}: follow the hint. APP_BUSY means a long operation is running, wait and retry. Never press buttons in Cheetah3D while a call is in flight.',
].join('\n');

const TIMEOUT_MS: Partial<Record<ToolDef['group'], number>> = { render: 15 * 60_000, assets: 5 * 60_000, files: 5 * 60_000, exec: 2 * 60_000 };
const DEFAULT_TIMEOUT_MS = 2 * 60_000;
const TEXT_LIMIT = 4000;

/** Profile and opt-out filtering (requirements section 6). `full` exposes everything the opt-outs leave. */
export function selectTools(tools: ToolDef[], config: Pick<RuntimeConfig, 'profile' | 'disableExec' | 'disableAssets'>): ToolDef[] {
  return tools.filter((t) => {
    if (config.disableExec && t.group === 'exec') return false;
    if (config.disableAssets && t.group === 'assets') return false;
    if (config.profile === 'readonly') return !t.mutating;
    if (config.profile === 'local') return t.profiles.includes('local');
    return true;
  });
}

export function toolAnnotations(t: ToolDef): { title: string; readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: boolean } {
  return t.mutating
    ? { title: t.title, readOnlyHint: false, destructiveHint: t.destructive ?? false, idempotentHint: t.idempotent ?? false, openWorldHint: t.openWorld ?? false }
    : { title: t.title, readOnlyHint: true, openWorldHint: t.openWorld ?? false };
}

/** Zod validation happens in our handler so failures use the documented INVALID_ARGUMENT shape instead of the SDK's generic one. */
function passThrough(schema: z.ZodObject<z.ZodRawShape>): StandardSchemaWithJSON {
  const std = schema['~standard'];
  return { '~standard': { ...std, validate: (value: unknown) => ({ value }) } };
}

function textOf(structured: Record<string, unknown>): string {
  const json = JSON.stringify(structured);
  return json.length > TEXT_LIMIT ? `${json.slice(0, TEXT_LIMIT)}... (truncated; see structuredContent)` : json;
}

export interface BuiltServer {
  mcp: McpServer;
  tools: ToolDef[];
}

export interface BuildOptions {
  rt: Runtime;
  tools?: ToolDef[];
  prompts?: PromptDef[];
  resources?: ResourceDef[];
  /** Overrides the per-group tool time limits (tests). */
  toolTimeoutMs?: number;
  /** Replaces the vendored-doc/lint/image services (tests). */
  statics?: ReturnType<typeof createStaticServices>;
}

export function buildServer(opts: BuildOptions): BuiltServer {
  const { rt } = opts;
  const { config } = rt;
  const source = opts.tools ?? allTools;
  const names = new Set<string>();
  let enabled: ToolDef[] = [];
  const health = createHealthTools(rt, () => enabled.map((t) => t.name));
  const all = [...health, ...source];
  for (const t of all) {
    if (names.has(t.name)) throw new Error(`Duplicate tool name ${t.name}`);
    names.add(t.name);
    if (!t.name.startsWith('c3d_')) throw new Error(`Tool ${t.name} must be prefixed c3d_`);
    if (t.profiles.includes('local') && !t.localDescription) throw new Error(`Tool ${t.name} is in the local profile but has no localDescription`);
  }
  enabled = selectTools(all, config);

  const mcp = new McpServer({ name: 'c3d-mcp', title: 'Cheetah3D MCP', version: packageVersion() }, { instructions: INSTRUCTIONS });
  const statics = opts.statics ?? createStaticServices({ bridge: rt.bridge, helper: rt.helper, config });
  const caps = new CapabilitiesCache(rt.bridge, () => rt.bridge.lastRuntimeVersion);
  const writeGate = new Mutex();

  for (const tool of enabled) {
    mcp.registerTool(
      tool.name,
      {
        title: tool.title,
        description: config.profile === 'local' ? (tool.localDescription ?? tool.description) : tool.description,
        inputSchema: passThrough(tool.inputSchema),
        outputSchema: tool.outputSchema,
        annotations: toolAnnotations(tool),
      },
      async (args: unknown, call: ServerContext) => {
        const started = Date.now();
        let endProgress = (): void => undefined;
        try {
          const input = tool.inputSchema.parse(args ?? {});
          const timeoutMs = opts.toolTimeoutMs ?? TIMEOUT_MS[tool.group] ?? DEFAULT_TIMEOUT_MS;
          const signal = AbortSignal.any([call.mcpReq.signal, AbortSignal.timeout(timeoutMs)]);
          const scoped = scopeProgress(
            createToolServices(
              {
                capabilities: () => caps.get(),
                statics,
                autoConfirm: config.autoConfirm,
                // eslint-disable-next-line @typescript-eslint/no-deprecated -- only source of initialize-declared capabilities on 2025-era connections
                legacyClientCapabilities: () => mcp.server.getClientCapabilities(),
              },
              call,
            ),
          );
          endProgress = (): void => { scoped.end(); };
          const ctx: ToolContext = {
            bridge: withProgress(rt.bridge, scoped.services),
            helper: rt.helper,
            config,
            session: rt.session,
            signal,
            services: scoped.services,
          };
          const run = (): Promise<Awaited<ReturnType<ToolDef['handler']>>> => tool.handler(input, ctx);
          const timedOut = new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => reject(call.mcpReq.signal.aborted ? new BridgeError('CANCELLED', 'The call was cancelled by the client') : new BridgeError('TIMEOUT', `${tool.name} exceeded its ${timeoutMs} ms limit`, 'Split the work into smaller calls.')), { once: true });
          });
          const result = await Promise.race([tool.mutating ? writeGate.run(run, signal) : run(), timedOut]);
          rt.logger.debug('tool ok', { tool: tool.name, ms: Date.now() - started });
          return {
            content: [{ type: 'text' as const, text: result.text ?? textOf(result.structured) }, ...(result.images ?? []).map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mimeType }))],
            structuredContent: result.structured,
          };
        } catch (err) {
          if (err instanceof ConfirmationNeeded) {
            return inputRequired({
              inputRequests: { [err.key]: inputRequired.elicit({ message: err.prompt, requestedSchema: z.object({ confirm: z.boolean().describe('Set to true to proceed') }) }) },
            });
          }
          const payload = toErrorPayload(err);
          if (payload.code === 'INTERNAL') rt.logger.error('tool failed', { tool: tool.name, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
          else rt.logger.info('tool error', { tool: tool.name, code: payload.code });
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload as unknown as Record<string, unknown> };
        } finally {
          endProgress();
        }
      },
    );
  }

  for (const p of opts.prompts ?? allPrompts) {
    const shape = Object.fromEntries(Object.entries(p.args).map(([k, a]) => [k, a.required ? z.string().describe(a.description) : z.string().optional().describe(a.description)]));
    mcp.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema: z.object(shape) }, (args: Record<string, string | undefined>) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.build(Object.fromEntries(Object.entries(args).filter((e): e is [string, string] => e[1] !== undefined))) } }],
    }));
  }
  for (const r of opts.resources ?? allResources) {
    mcp.registerResource(r.name, r.uri, { description: r.description, mimeType: r.mimeType }, async (uri: URL) => ({
      contents: [{ uri: uri.href, mimeType: r.mimeType, text: await r.read({ bridge: rt.bridge, config, session: rt.session }) }],
    }));
  }
  return { mcp, tools: enabled };
}

/** Runs the server over stdio. stdout carries only protocol traffic; everything else goes to stderr / the log file. */
export function serve(config: RuntimeConfig = loadConfig(), overrides: RuntimeOverrides = {}): StdioServerHandle {
  const logger = overrides.logger ?? createLogger({ dir: config.logDir });
  const rt = createRuntime(config, { ...overrides, logger });
  // One runtime (queue, session) is shared by every server instance the stdio entry may create.
  const handle = serveStdio(() => buildServer({ rt }).mcp, { onerror: (e) => logger.error('transport error', { error: e.message }) });
  logger.info('c3d-mcp serving on stdio', { version: packageVersion(), profile: config.profile });
  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    void handle.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return handle;
}
