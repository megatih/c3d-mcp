// Small platform seams (clock, child-process executor) so every core module is unit-testable without touching the machine.
import { execFile } from 'node:child_process';

export interface Clock {
  now(): number;
  /** Resolves after `ms`, or early when `signal` aborts (callers re-check the signal). */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

export interface ExecResult { code: number | null; stdout: string; stderr: string }
export interface ExecOptions { timeoutMs?: number; input?: string }
/** Runs a child process; never rejects (spawn failures and timeouts are reported through `code`/`stderr`). */
export type Executor = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

export const systemExec: Executor = (cmd, args, opts = {}) =>
  new Promise<ExecResult>((resolve) => {
    const child = execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 30_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === 'number' ? error.code : null;
          resolve({ code, stdout, stderr: stderr || error.message });
        } else {
          resolve({ code: 0, stdout, stderr });
        }
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
