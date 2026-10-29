import { existsSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BridgeError, ERROR_CODES, type ErrorCode, type HelperClient } from '../toolkit.js';
import { systemClock, systemExec, type Clock, type Executor } from './platform.js';

export const HELPER_APP_NAME = 'C3D Bridge Helper.app';

export function defaultHelperAppPaths(mcpDir: string): string[] {
  const fromEnv = process.env.C3D_HELPER_APP;
  return [...(fromEnv ? [fromEnv] : []), join(mcpDir, 'helper', HELPER_APP_NAME), join(homedir(), 'Applications', HELPER_APP_NAME), join('/Applications', HELPER_APP_NAME)];
}

/** Thrown when the helper cannot be reached at all (as opposed to the helper answering with an error). */
export class HelperUnavailableError extends BridgeError {
  constructor(message: string, details?: unknown, hint = 'Install the C3D Bridge Helper app (`c3d-mcp install`) or use C3D_MCP_TRIGGER=osascript.') {
    super('INTERNAL', message, hint, details);
    this.name = 'HelperUnavailableError';
  }
}

export interface HelperClientOptions {
  socketPath: string;
  /** Candidate locations of the helper bundle; the first that exists is launched on demand. */
  appPaths: string[];
  exec?: Executor;
  clock?: Clock;
  autoLaunch?: boolean;
  launchWaitMs?: number;
  /** After a failed launch, `available()` reports false for this long so callers fall back quickly. */
  retryAfterMs?: number;
  /** Skip the code-signature check before auto-launching the helper (also: env C3D_HELPER_SKIP_VERIFY=1). */
  skipVerify?: boolean;
  env?: NodeJS.ProcessEnv;
}

function asErrorCode(code: unknown): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code as string) ? (code as ErrorCode) : 'INTERNAL';
}

/** JSON-lines client for the helper's Unix socket (contracts/helper-ipc.schema.json). One short-lived connection per call. */
export class HelperClientImpl implements HelperClient {
  private readonly exec: Executor;
  private readonly clock: Clock;
  private readonly autoLaunch: boolean;
  private readonly launchWaitMs: number;
  private readonly retryAfterMs: number;
  private readonly skipVerify: boolean;
  private readonly verified = new Set<string>();
  private failedAt = Number.NEGATIVE_INFINITY;
  private nextId = 1;

  constructor(private readonly opts: HelperClientOptions) {
    this.exec = opts.exec ?? systemExec;
    this.clock = opts.clock ?? systemClock;
    this.autoLaunch = opts.autoLaunch ?? true;
    this.launchWaitMs = opts.launchWaitMs ?? 8000;
    this.retryAfterMs = opts.retryAfterMs ?? 30_000;
    this.skipVerify = opts.skipVerify ?? (opts.env ?? process.env).C3D_HELPER_SKIP_VERIFY === '1';
  }

  installedApp(): string | undefined {
    return this.opts.appPaths.find((p) => existsSync(p));
  }

  socketPresent(): boolean {
    return existsSync(this.opts.socketPath);
  }

  available(): boolean {
    if (this.clock.now() - this.failedAt < this.retryAfterMs) return false;
    return this.socketPresent() || (this.autoLaunch && this.installedApp() !== undefined);
  }

  async call<T = unknown>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    const socket = await this.connect();
    return this.exchange<T>(socket, cmd, args, timeoutMs);
  }

  private async connect(): Promise<Socket> {
    try {
      return await this.dial();
    } catch (first) {
      const app = this.autoLaunch ? this.installedApp() : undefined;
      if (!app) throw this.fail('Helper socket is not reachable and no helper app is installed', first);
      await this.verifyApp(app);
      const launched = await this.exec('open', ['-g', '-a', app, '--args', '--socket', this.opts.socketPath], { timeoutMs: 10_000 });
      if (launched.code !== 0) throw this.fail('Could not launch the helper app', launched.stderr);
      const until = this.clock.now() + this.launchWaitMs;
      for (;;) {
        try {
          return await this.dial();
        } catch (err) {
          if (this.clock.now() >= until) throw this.fail('Helper app was launched but its socket never became reachable', err);
          await this.clock.sleep(100);
        }
      }
    }
  }

  /** `codesign --verify --deep --strict` before the app is launched; a tampered or unsigned bundle is never opened. */
  private async verifyApp(app: string): Promise<void> {
    if (this.skipVerify || this.verified.has(app)) return;
    const res = await this.exec('codesign', ['--verify', '--deep', '--strict', app], { timeoutMs: 20_000 });
    if (res.code !== 0) {
      this.failedAt = this.clock.now();
      throw new HelperUnavailableError(
        `The helper app's code signature could not be verified (${res.stderr.trim() || `codesign exit ${String(res.code)}`}); it was not launched`,
        { app, code: res.code },
        'Reinstall the helper with `c3d-mcp install` (a signed or ad-hoc signed build). For a locally built, unsigned helper set C3D_HELPER_SKIP_VERIFY=1.',
      );
    }
    this.verified.add(app);
  }

  private fail(message: string, cause: unknown): HelperUnavailableError {
    this.failedAt = this.clock.now();
    return new HelperUnavailableError(message, { cause: cause instanceof Error ? cause.message : String(cause) });
  }

  private dial(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.opts.socketPath);
      socket.once('connect', () => {
        socket.removeListener('error', reject);
        resolve(socket);
      });
      socket.once('error', reject);
    });
  }

  private exchange<T>(socket: Socket, cmd: string, args: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const id = `c${this.nextId++}`;
    return new Promise<T>((resolve, reject) => {
      let buffer = '';
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new BridgeError('TIMEOUT', `Helper command "${cmd}" timed out after ${timeoutMs} ms`, 'The helper may be waiting on a macOS permission prompt or a busy app.'))), timeoutMs);
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg: { id?: string; ok?: boolean; result?: T; error?: { code?: string; message?: string; hint?: string; details?: unknown } };
          try {
            msg = JSON.parse(line) as typeof msg;
          } catch {
            finish(() => reject(new BridgeError('PARSE_ERROR', 'Helper sent malformed JSON')));
            return;
          }
          if (msg.id !== id) continue;
          if (msg.ok) finish(() => resolve(msg.result as T));
          else finish(() => reject(new BridgeError(asErrorCode(msg.error?.code), msg.error?.message ?? `Helper command "${cmd}" failed`, msg.error?.hint, msg.error?.details)));
        }
      });
      socket.on('error', (err) => finish(() => reject(new HelperUnavailableError('Helper connection failed', { cause: err.message }))));
      socket.on('close', () => finish(() => reject(new HelperUnavailableError('Helper closed the connection without answering'))));
      socket.write(`${JSON.stringify({ id, cmd, args })}\n`);
    });
  }
}
