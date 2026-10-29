// Shared types between the server core (src/core, src/server.ts, src/cli) and tool modules (src/tools/*).
// Tool handlers talk ONLY to ctx.bridge / ctx.helper / ctx.services; never to files or sockets directly.
import type { z } from 'zod';

export const ERROR_CODES = [
  'APP_NOT_RUNNING', 'APP_CRASHED', 'APP_BUSY', 'TRIGGER_FAILED', 'BLOCKED_BY_MODAL', 'WRONG_DOCUMENT', 'VERSION_SKEW',
  'BRIDGE_NOT_INSTALLED', 'PERMISSION_MISSING', 'NOT_FOUND', 'AMBIGUOUS', 'INVALID_ARGUMENT', 'UNSUPPORTED', 'SCRIPT_ERROR',
  'LINT_BLOCKED', 'CONFIRMATION_REQUIRED', 'TIMEOUT', 'CANCELLED', 'RUNTIME_STUCK', 'DEPENDENCY_FAILED',
  'NOT_AVAILABLE_IN_PROFILE', 'PARSE_ERROR', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class BridgeError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public hint?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export interface ExpectDoc { fileName?: string; marker?: string }
export interface BridgeOp { op: string; args?: Record<string, unknown>; as?: string }
export interface OpResult { op: string; ok: boolean; result?: any; error?: { code: ErrorCode; message: string; hint?: string; details?: unknown } }
export interface BridgeResponse { id: string; ok: boolean; runtimeVersion: string; results: OpResult[]; log: string[]; startedAt: number; finishedAt: number }
export interface RunOpts {
  expectDocument?: ExpectDoc;
  deadlineMs?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
export interface BridgeClient {
  /** Runs ops as one request. Throws BridgeError for request-level failures (APP_*, TRIGGER_FAILED, TIMEOUT, WRONG_DOCUMENT, VERSION_SKEW...). Per-op failures are returned in results[]. */
  run(ops: BridgeOp[], opts?: RunOpts): Promise<BridgeResponse>;
  /** Runs one op and returns its result; throws BridgeError (with the op's error code) if the op failed. */
  one<T = any>(op: string, args?: Record<string, unknown>, opts?: RunOpts): Promise<T>;
}

export interface HelperClient {
  available(): boolean;
  call<T = any>(cmd: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

export type Profile = 'full' | 'local' | 'readonly';

export interface ServerConfig {
  profile: Profile;
  disableExec: boolean;
  disableAssets: boolean;
  disableShell: boolean;
  mcpDir: string;
  cheetahSupportDir: string;
  logDir: string;
  /** Directory where renders/exports/checkpoints are written (inside mcpDir/tmp or user-provided). */
  workDir: string;
}

export interface SessionState {
  /** Document the agent is working in; sent as expectDocument with every request when set. */
  expectDocument?: ExpectDoc;
  /** Files that existed before this session (never overwritten without confirm) are tracked by path; paths created/opened via this server are in `ownedPaths`. */
  ownedPaths: Set<string>;
  /** Set of object ids etc. can be cached here by tools. */
  scratch: Map<string, unknown>;
}

export interface ToolServices {
  /** Cached capabilities from the runtime (falls back to research lists if the app is unreachable). */
  capabilities(): Promise<Record<string, any>>;
  /** Ask the user to confirm (MCP elicitation when the client supports it, else require input.confirm === true). Returns true when confirmed. */
  confirm(opts: { message: string; confirmFlag?: boolean }): Promise<boolean>;
  /** Report progress for the current tool call. */
  progress(message: string, fraction?: number): void;
  /** Search vendored docs (BM25). */
  searchDocs(query: string, limit?: number): Array<{ id: string; title: string; snippet: string; source: string }>;
  /** Lint a script (advisory). */
  lint(code: string): Array<{ rule: string; line: number; message: string; severity: 'error' | 'warn' }>;
  /** Downscale/analyze images via helper, falling back to sips. */
  imageTools: {
    downscale(path: string, opts: { maxDim: number; maxBytes: number }): Promise<{ path: string; width: number; height: number; bytes: number; mime: string }>;
    analyze(path: string): Promise<{ width: number; height: number; blank: boolean; meanLuma: number; histogram?: number[] }>;
  };
}

export interface ToolContext {
  bridge: BridgeClient;
  helper: HelperClient;
  config: ServerConfig;
  session: SessionState;
  services: ToolServices;
  signal?: AbortSignal;
}

export interface ToolImage { data: string /* base64 */; mimeType: string }
export interface ToolResult {
  /** structuredContent; must validate against the tool's outputSchema */
  structured: Record<string, unknown>;
  /** short human text; default = JSON.stringify of structured (truncated) */
  text?: string;
  images?: ToolImage[];
}

export interface ToolDef<I extends z.ZodObject<any> = z.ZodObject<any>, O extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string; // c3d_*
  title: string;
  description: string; // what it does, when to use, caveats; <= ~900 chars
  group: 'health' | 'docs' | 'document' | 'scene' | 'geometry' | 'materials' | 'tags' | 'camera-light' | 'animation' | 'render' | 'assets' | 'files' | 'exec' | 'lint' | 'log';
  inputSchema: I;
  outputSchema: O;
  /** false => readOnlyHint true */
  mutating: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
  /** which profiles expose it; default ['full'] only if omitted => must be explicit */
  profiles: Profile[];
  /** one-line guidance for the `local` profile (<= 260 chars); required when profiles includes 'local' */
  localDescription?: string;
  handler(input: z.infer<I>, ctx: ToolContext): Promise<ToolResult>;
}

export function defineTool<I extends z.ZodObject<any>, O extends z.ZodObject<any>>(t: ToolDef<I, O>): ToolDef<I, O> {
  return t;
}

export interface PromptDef { name: string; title: string; description: string; args: Record<string, { description: string; required?: boolean }>; build(args: Record<string, string>): string }
export interface ResourceDef { uri: string; name: string; description: string; mimeType: string; read(ctx: Pick<ToolContext, 'bridge' | 'config' | 'session'>): Promise<string> }
