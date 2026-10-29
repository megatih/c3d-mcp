import { randomUUID } from 'node:crypto';
import { open, readFile, rename, stat, unlink, utimes } from 'node:fs/promises';
import { BridgeError } from '../toolkit.js';
import { systemClock, type Clock } from './platform.js';

/** In-process FIFO mutex. Waiters can leave the queue through an AbortSignal. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;

  get pending(): number {
    return this.waiting;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new BridgeError('CANCELLED', 'Cancelled while waiting for the bridge queue');
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.waiting++;
    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => {
        reject(new BridgeError('CANCELLED', 'Cancelled while waiting for the bridge queue'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([prev, abortPromise]);
    } catch (err) {
      // Our slot must still pass the baton once the predecessor finishes.
      void prev.then(release);
      throw err;
    } finally {
      this.waiting--;
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
    return release;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export interface FileLockOptions {
  /** A lock whose heartbeat (mtime) is older than this is considered abandoned. */
  staleMs?: number;
  pollMs?: number;
  clock?: Clock;
  pid?: number;
  isAlive?: (pid: number) => boolean;
}

interface LockBody { pid: number; token: string; startedAt: number }

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Cross-process lock: `open(O_EXCL)` on a lock file holding our PID. Stale locks (dead PID or no heartbeat) are
 * reclaimed. Reclaiming is not perfectly atomic (the file is re-read right before removal); the worst case is two
 * servers interleaving one press, which the runtime tolerates because it only runs requests addressed by uuid.
 */
export class FileLock {
  private readonly staleMs: number;
  private readonly pollMs: number;
  private readonly clock: Clock;
  private readonly pid: number;
  private readonly isAlive: (pid: number) => boolean;

  constructor(private readonly path: string, opts: FileLockOptions = {}) {
    this.staleMs = opts.staleMs ?? 30_000;
    this.pollMs = opts.pollMs ?? 25;
    this.clock = opts.clock ?? systemClock;
    this.pid = opts.pid ?? process.pid;
    this.isAlive = opts.isAlive ?? processAlive;
  }

  async acquire(opts: { timeoutMs: number; signal?: AbortSignal }): Promise<() => Promise<void>> {
    const started = this.clock.now();
    const token = randomUUID();
    for (;;) {
      if (opts.signal?.aborted) throw new BridgeError('CANCELLED', 'Cancelled while waiting for the cross-process bridge lock');
      try {
        const fh = await open(this.path, 'wx', 0o600);
        try {
          const body: LockBody = { pid: this.pid, token, startedAt: this.clock.now() };
          await fh.writeFile(JSON.stringify(body));
          await fh.sync();
        } finally {
          await fh.close();
        }
        return this.holder(token);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      if (await this.reclaimIfStale()) continue;
      if (this.clock.now() - started > opts.timeoutMs) {
        throw new BridgeError('APP_BUSY', 'Another c3d-mcp server holds the bridge lock', 'Wait for the other client to finish; a lock left behind by a crashed server is reclaimed automatically.', {
          lock: this.path,
        });
      }
      await this.clock.sleep(this.pollMs, opts.signal);
    }
  }

  private holder(token: string): () => Promise<void> {
    const beat = setInterval(() => {
      const now = new Date();
      utimes(this.path, now, now).catch(() => undefined);
    }, Math.max(250, this.staleMs / 4));
    beat.unref();
    return async () => {
      clearInterval(beat);
      const body = await this.read();
      if (body?.token === token) await unlink(this.path).catch(() => undefined);
    };
  }

  private async read(): Promise<LockBody | undefined> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as LockBody;
    } catch {
      return undefined;
    }
  }

  private async reclaimIfStale(): Promise<boolean> {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(this.path)).mtimeMs;
    } catch {
      return true; // vanished: retry the exclusive create
    }
    const body = await this.read();
    const dead = body !== undefined && !this.isAlive(body.pid);
    const silent = this.clock.now() - mtimeMs > this.staleMs;
    // An unparsable lock is mid-creation by its owner, so only the heartbeat age may condemn it.
    if (!dead && !silent) return false;
    const again = await this.read();
    if (again?.token !== body?.token) return false;
    const grave = `${this.path}.stale-${randomUUID()}`;
    try {
      await rename(this.path, grave);
    } catch {
      return true;
    }
    await unlink(grave).catch(() => undefined);
    return true;
  }
}

export interface QueueRunOptions { signal?: AbortSignal; lockTimeoutMs?: number }

/** One bridge request at a time: in-process FIFO first, then the cross-process lock. */
export class RequestQueue {
  readonly mutex = new Mutex();

  constructor(private readonly fileLock: FileLock, private readonly defaultLockTimeoutMs = 60_000) {}

  async run<T>(fn: () => Promise<T>, opts: QueueRunOptions = {}): Promise<T> {
    const release = await this.mutex.acquire(opts.signal);
    try {
      const unlock = await this.fileLock.acquire({ timeoutMs: opts.lockTimeoutMs ?? this.defaultLockTimeoutMs, signal: opts.signal });
      try {
        return await fn();
      } finally {
        await unlock();
      }
    } finally {
      release();
    }
  }
}
