import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BridgeError, type BridgeOp, type BridgeResponse, type ExpectDoc } from '../toolkit.js';
import { adler32, asciiJson } from './json.js';
import { systemClock, type Clock } from './platform.js';
import { assertPrivateDir, type McpPaths } from './paths.js';

export const PROTOCOL = 1;

export interface BridgeRequest {
  protocol: 1;
  id: string;
  seq: string;
  secret: string;
  expectDocument?: ExpectDoc;
  deadlineAt: number;
  ops: BridgeOp[];
}

export interface RuntimeState {
  busy: boolean;
  reqId?: string | null;
  op?: string | null;
  startedAt?: number | null;
  runtimeVersion: string;
  protocol?: number;
  lastSeq: string;
  document?: string | null;
  updatedAt?: number;
}

export const REQUEST_FILE_RE = /^\d{16}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

const RETRY_STEP_MS = 50;

/** File-level view of the bridge directory (docs/PROTOCOL.md sections 1 and 3). Only this class touches the mailbox files. */
export class Mailbox {
  private counter = 0;
  private lastSeq = 0;

  constructor(readonly paths: McpPaths, private readonly clock: Clock = systemClock) {}

  /** 16 digits: Date.now()*1000 + (counter % 1000); forced strictly increasing within this process. */
  nextSeq(): string {
    const candidate = this.clock.now() * 1000 + (this.counter++ % 1000);
    this.lastSeq = Math.max(candidate, this.lastSeq + 1);
    return String(this.lastSeq).padStart(16, '0');
  }

  /** Read on every request so a reinstall that regenerates the secret never leaves a long-lived server stale. */
  readSecret(): string | undefined {
    try {
      const text = readFileSync(this.paths.secret, 'utf8').trim();
      return text.length >= 16 ? text : undefined;
    } catch {
      return undefined;
    }
  }

  /** Creates the secret (0600) when missing. Returns whether it was created. */
  async ensureSecret(): Promise<{ secret: string; created: boolean }> {
    const existing = this.readSecret();
    if (existing) {
      return { secret: existing, created: false };
    }
    const secret = randomBytes(32).toString('hex');
    await writeFile(this.paths.secret, `${secret}\n`, { mode: 0o600 });
    await chmod(this.paths.secret, 0o600);
    return { secret, created: true };
  }

  requestPath(seq: string, id: string): string {
    return join(this.paths.inbox, `${seq}-${id}.json`);
  }

  /** Atomic: `.json.tmp` + fsync + rename, so the runtime never sees a partial request. */
  async writeRequest(req: BridgeRequest): Promise<string> {
    await assertPrivateDir(this.paths.root);
    await assertPrivateDir(this.paths.inbox);
    const final = this.requestPath(req.seq, req.id);
    const tmp = `${final}.tmp`;
    const fh = await open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(asciiJson(req), 'ascii');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, final);
    return final;
  }

  /** Reads state.json; a torn write is retried for up to `retryMs` and then reported as PARSE_ERROR. */
  async readState(retryMs = 1000): Promise<RuntimeState | undefined> {
    const deadline = this.clock.now() + retryMs;
    for (;;) {
      let text: string;
      try {
        text = await readFile(this.paths.state, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw err;
      }
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || typeof (parsed as RuntimeState).busy !== 'boolean') throw new Error('not a state object');
        return parsed as RuntimeState;
      } catch {
        if (this.clock.now() >= deadline) {
          throw new BridgeError('PARSE_ERROR', 'state.json is not valid JSON', 'The runtime may have crashed mid-write; run `c3d-mcp doctor`.', { path: this.paths.state });
        }
        await this.clock.sleep(RETRY_STEP_MS);
      }
    }
  }

  /**
   * Returns undefined while the `.done` marker is absent. Once present, the response is accepted only when its byte
   * length and Adler-32 match the marker; mismatches are re-read for up to `retryMs` and then fail with PARSE_ERROR.
   */
  async readResponse(id: string, retryMs = 1000): Promise<BridgeResponse | undefined> {
    const donePath = join(this.paths.outbox, `${id}.done`);
    const jsonPath = join(this.paths.outbox, `${id}.json`);
    let doneText: string;
    try {
      doneText = await readFile(donePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
    const deadline = this.clock.now() + retryMs;
    let lastProblem = '';
    for (let first = true; ; first = false) {
      if (!first) {
        try {
          doneText = await readFile(donePath, 'utf8');
        } catch {
          doneText = '';
        }
      }
      const problem = await this.verify(doneText, jsonPath);
      if (typeof problem !== 'string') return problem;
      lastProblem = problem;
      if (this.clock.now() >= deadline) break;
      await this.clock.sleep(RETRY_STEP_MS);
    }
    throw new BridgeError('PARSE_ERROR', `Bridge response for ${id} is corrupt: ${lastProblem}`, 'Retry the call; if it persists run `c3d-mcp doctor`.', { id });
  }

  private async verify(doneText: string, jsonPath: string): Promise<BridgeResponse | string> {
    let done: { bytes?: unknown; checksum?: unknown };
    try {
      done = JSON.parse(doneText) as typeof done;
    } catch {
      return '.done marker is not valid JSON';
    }
    let raw: Buffer;
    try {
      raw = await readFile(jsonPath);
    } catch {
      return 'response file missing';
    }
    if (done.bytes !== raw.length) return `length ${raw.length} != ${String(done.bytes)}`;
    if (done.checksum !== adler32(raw)) return 'checksum mismatch';
    try {
      const parsed: unknown = JSON.parse(raw.toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null || typeof (parsed as BridgeResponse).ok !== 'boolean') return 'response has no ok flag';
      return parsed as BridgeResponse;
    } catch {
      return 'response is not valid JSON';
    }
  }

  /** `outbox/_bootstrap-error.json` is written by the loader macro when runtime.js fails to load (PRD section 3.4). */
  async takeBootstrapError(sinceMs: number): Promise<string | undefined> {
    const file = join(this.paths.outbox, '_bootstrap-error.json');
    try {
      if ((await stat(file)).mtimeMs < sinceMs) return undefined;
      const text = await readFile(file, 'utf8');
      await rm(file, { force: true });
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        return (typeof parsed.message === 'string' ? parsed.message : text).slice(0, 500);
      } catch {
        return text.slice(0, 500);
      }
    } catch {
      return undefined;
    }
  }

  /** Removes inbox files whose seq (epoch ms * 1000 + counter) predates `ms`: requests orphaned by a dead Cheetah3D session. */
  async sweepInboxBefore(ms: number): Promise<number> {
    let removed = 0;
    for (const name of await readdir(this.paths.inbox).catch(() => [] as string[])) {
      const m = /^(\d{16})-([0-9a-f-]{36})\.json$/.exec(name);
      if (m?.[1] && Number(m[1]) / 1000 < ms) {
        await rm(join(this.paths.inbox, name), { force: true });
        await rm(join(this.paths.outbox, `${m[2]}.json`), { force: true });
        await rm(join(this.paths.outbox, `${m[2]}.done`), { force: true });
        removed++;
      }
    }
    return removed;
  }

  async writeCancel(id: string): Promise<void> {
    await writeFile(join(this.paths.cancel, id), '1', { mode: 0o600 });
  }

  /** Delete order from docs/PROTOCOL.md section 3: inbox request first, then outbox json, `.done`, cancel marker. */
  async remove(seq: string, id: string): Promise<void> {
    for (const file of [this.requestPath(seq, id), join(this.paths.outbox, `${id}.json`), join(this.paths.outbox, `${id}.done`), join(this.paths.cancel, id)]) {
      await rm(file, { force: true });
    }
  }
}
