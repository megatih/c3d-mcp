import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BridgeError, ERROR_CODES, type BridgeClient, type BridgeOp, type BridgeResponse, type ErrorCode, type OpResult, type RunOpts, type SessionState } from '../toolkit.js';
import type { AppProbe } from './appProbe.js';
import { type RequestQueue } from './lock.js';
import { type Mailbox, PROTOCOL, type BridgeRequest, type RuntimeState } from './mailbox.js';
import type { McpPaths } from './paths.js';
import { systemClock, type Clock } from './platform.js';
import type { Trigger } from './trigger.js';

export interface BridgeClientOptions {
  paths: McpPaths;
  mailbox: Mailbox;
  queue: RequestQueue;
  trigger: Trigger;
  probe: AppProbe;
  session: SessionState;
  clock?: Clock;
  /** Server refuses a runtime whose semver major differs (docs/PROTOCOL.md section 8). */
  expectedRuntimeMajor?: number;
  defaultDeadlineMs?: number;
  pollMinMs?: number;
  pollMaxMs?: number;
  /** How long after a press the runtime may take to show signs of life before the press is retried. */
  pressGraceMs?: number;
  maxPresses?: number;
  /** busy longer than max(deadline, this) while the app still responds => RUNTIME_STUCK (PRD 3.11). */
  stuckAfterMs?: number;
  progressIntervalMs?: number;
}

const HINTS: Partial<Record<ErrorCode, string>> = {
  TIMEOUT: 'The request was discarded (a cancel marker was written) and will not run later. Retry, or raise the tool timeout.',
  CANCELLED: 'The request was cancelled before it ran to completion.',
  VERSION_SKEW: 'The in-app runtime and this server disagree on the protocol version. Run `c3d-mcp install` and restart Cheetah3D.',
  WRONG_DOCUMENT: 'The front document is not the one this session works on. Bring it to the front, or call c3d_get_document_info / c3d_new_document to re-bind the session.',
  BRIDGE_NOT_INSTALLED: 'Run `c3d-mcp install` (or the c3d_install_bridge tool), then restart Cheetah3D.',
};

const MODAL_CHECK_AFTER_MS = 2500;
const MODAL_CHECK_EVERY_MS = 2000;
const ORPHAN_TTL_MS = 10 * 60_000;

function fingerprint(s: RuntimeState | undefined): string {
  return s ? JSON.stringify([s.busy, s.updatedAt, s.startedAt, s.lastSeq, s.reqId]) : 'none';
}

function toCode(code: unknown): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code as string) ? (code as ErrorCode) : 'INTERNAL';
}

export function errorFromOp(error: OpResult['error'] | undefined, fallback: string): BridgeError {
  const code = toCode(error?.code);
  const details = error && code === 'INTERNAL' && error.code !== 'INTERNAL' ? { runtimeCode: error.code, details: error.details } : error?.details;
  return new BridgeError(code, error?.message ?? fallback, error?.hint ?? HINTS[code], details);
}

function major(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10);
}

export class BridgeClientImpl implements BridgeClient {
  /** runtimeVersion of the last response; used to key the capabilities cache. */
  lastRuntimeVersion: string | undefined;
  private readonly clock: Clock;
  private readonly orphans: { seq: string; id: string; since: number }[] = [];
  private readonly tun: Required<Pick<BridgeClientOptions, 'defaultDeadlineMs' | 'pollMinMs' | 'pollMaxMs' | 'pressGraceMs' | 'maxPresses' | 'stuckAfterMs' | 'progressIntervalMs'>>;

  constructor(private readonly o: BridgeClientOptions) {
    this.clock = o.clock ?? systemClock;
    this.tun = {
      defaultDeadlineMs: o.defaultDeadlineMs ?? 30_000,
      pollMinMs: o.pollMinMs ?? 25,
      pollMaxMs: o.pollMaxMs ?? 200,
      pressGraceMs: o.pressGraceMs ?? 2500,
      maxPresses: o.maxPresses ?? 2,
      stuckAfterMs: o.stuckAfterMs ?? 16_000,
      progressIntervalMs: o.progressIntervalMs ?? 2000,
    };
  }

  async run(ops: BridgeOp[], opts: RunOpts = {}): Promise<BridgeResponse> {
    if (ops.length === 0) throw new BridgeError('INVALID_ARGUMENT', 'A bridge request needs at least one op');
    const deadlineMs = opts.deadlineMs ?? this.tun.defaultDeadlineMs;
    this.assertInstalled();
    return this.o.queue.run(() => this.execute(ops, opts, deadlineMs), { signal: opts.signal, lockTimeoutMs: Math.max(30_000, deadlineMs) });
  }

  async one<T = unknown>(op: string, args: Record<string, unknown> = {}, opts?: RunOpts): Promise<T> {
    const res = await this.run([{ op, args }], opts);
    const first = res.results[0];
    if (!first) throw new BridgeError('INTERNAL', `Bridge returned no result for ${op}`);
    if (!first.ok) throw errorFromOp(first.error, `${op} failed`);
    return first.result as T;
  }

  /** Checked before queueing: without the mailbox directory there is nothing to lock or write. */
  private assertInstalled(): string {
    const { mailbox, paths } = this.o;
    const secret = mailbox.readSecret();
    const missing = [!secret && 'secret', !existsSync(paths.runtimeFile) && 'runtime', !existsSync(paths.macroFile) && 'macro'].filter(Boolean);
    if (!secret || missing.length > 0) throw new BridgeError('BRIDGE_NOT_INSTALLED', 'The Cheetah3D bridge is not installed', HINTS.BRIDGE_NOT_INSTALLED, { missing });
    return secret;
  }

  private async execute(ops: BridgeOp[], opts: RunOpts, deadlineMs: number): Promise<BridgeResponse> {
    const { mailbox, session } = this.o;
    const secret = this.assertInstalled();
    await this.sweepOrphans();

    const id = randomUUID();
    const seq = mailbox.nextSeq();
    const startedAt = this.clock.now();
    const deadlineAt = startedAt + deadlineMs;
    const expectDocument = opts.expectDocument ?? session.expectDocument;
    const request: BridgeRequest = { protocol: PROTOCOL, id, seq, secret, ...(expectDocument ? { expectDocument } : {}), deadlineAt, ops };
    const initial = fingerprint(await this.readStateSafe());
    await mailbox.writeRequest(request);

    const graceMs = Math.min(10_000, Math.max(500, Math.round(deadlineMs / 4)));
    const hardEnd = deadlineAt + graceMs;
    const windowTitle = session.scratch.get('windowTitle');
    let presses = 0;
    let pressedOk = 0;
    let lastPressAt = Number.NEGATIVE_INFINITY;
    let pressBaseline = initial;
    let ranSincePress = false;
    let everRan = false;
    let lastProgress = startedAt;
    let lastModalCheck = startedAt;
    let poll = this.tun.pollMinMs;

    try {
      for (;;) {
        const response = await mailbox.readResponse(id);
        if (response) return await this.accept(response, seq, id);

        if (opts.signal?.aborted) {
          await this.abandon(seq, id);
          throw new BridgeError('CANCELLED', 'The request was cancelled by the client', HINTS.CANCELLED);
        }
        const now = this.clock.now();
        const state = await this.readStateSafe();
        const fp = fingerprint(state);
        if (fp !== initial) everRan = true;
        if (presses > 0 && fp !== pressBaseline) ranSincePress = true;

        if (now >= hardEnd) throw await this.classifyTimeout({ seq, id, deadlineMs, startedAt, everRan, state });

        if (state?.busy && now - startedAt > MODAL_CHECK_AFTER_MS && now - lastModalCheck >= MODAL_CHECK_EVERY_MS) {
          lastModalCheck = now;
          const dialogs = await this.o.probe.modals?.().catch(() => []);
          if (dialogs?.length) {
            await this.abandon(seq, id);
            throw this.modalError(dialogs);
          }
        }

        if (now - lastProgress >= this.tun.progressIntervalMs) {
          lastProgress = now;
          opts.onProgress?.(`Waiting for Cheetah3D (${Math.round((now - startedAt) / 1000)}s${state?.busy && state.op ? `, running ${state.op}` : ''})`);
        }

        if (!state?.busy) {
          const boot = await mailbox.takeBootstrapError(startedAt - 1000);
          if (boot) {
            await mailbox.remove(seq, id);
            throw new BridgeError('SCRIPT_ERROR', `The in-app bridge runtime failed to load: ${boot}`, 'Reinstall the runtime with `c3d-mcp install`, then retry. If it persists, run `c3d-mcp doctor`.', { bootstrapError: boot });
          }
          const due = presses === 0 || now - lastPressAt >= this.tun.pressGraceMs;
          if (due) {
            if (presses >= this.tun.maxPresses && !ranSincePress) {
              await mailbox.remove(seq, id);
              throw new BridgeError('TRIGGER_FAILED', 'The bridge macro never ran after pressing the menu item', 'Check: Cheetah3D has a document window and no dialog open; the C3D-MCP menu exists (restart Cheetah3D after install); Accessibility permission is granted. Run `c3d-mcp doctor`.', { presses });
            }
            if (presses < this.tun.maxPresses || (ranSincePress && presses < this.tun.maxPresses + 2)) {
              presses++;
              lastPressAt = now;
              pressBaseline = fp;
              ranSincePress = false;
              try {
                await this.o.trigger.press({ docTitle: typeof windowTitle === 'string' ? windowTitle : undefined, timeoutMs: 2000 });
                pressedOk++;
              } catch (err) {
                if (err instanceof BridgeError && err.code === 'APP_NOT_RUNNING' && pressedOk > 0) {
                  await this.abandon(seq, id);
                  throw new BridgeError('APP_CRASHED', 'Cheetah3D exited after the bridge was triggered; the in-flight request was lost', 'Restart Cheetah3D, then retry.', { via: 'press' });
                }
                const retriable = err instanceof BridgeError && err.code === 'TRIGGER_FAILED' && presses < this.tun.maxPresses;
                if (!retriable) {
                  await mailbox.remove(seq, id);
                  throw err;
                }
                lastPressAt = this.clock.now() - this.tun.pressGraceMs + 300;
              }
            }
          }
        }
        await this.clock.sleep(poll, opts.signal);
        poll = Math.min(this.tun.pollMaxMs, Math.round(poll * 1.5));
      }
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'PARSE_ERROR') this.orphans.push({ seq, id, since: this.clock.now() });
      throw err;
    }
  }

  private async accept(response: BridgeResponse, seq: string, id: string): Promise<BridgeResponse> {
    this.lastRuntimeVersion = response.runtimeVersion;
    await this.o.mailbox.remove(seq, id);
    const expected = this.o.expectedRuntimeMajor;
    if (expected !== undefined && major(response.runtimeVersion) !== expected) {
      throw new BridgeError('VERSION_SKEW', `In-app runtime ${response.runtimeVersion} is incompatible with this server (needs major ${expected})`, HINTS.VERSION_SKEW, { runtimeVersion: response.runtimeVersion });
    }
    const top = (response as { error?: OpResult['error'] }).error;
    if (!response.ok && top) {
      const err = errorFromOp(top, 'Bridge request failed');
      if (top.code === 'INTERNAL' && /bad secret/i.test(top.message)) {
        throw new BridgeError('INTERNAL', 'The in-app runtime rejected the request secret', 'The secret file and the installed macro/runtime disagree. Run `c3d-mcp install` and restart Cheetah3D.', top.details);
      }
      throw err;
    }
    return response;
  }

  private async readStateSafe(): Promise<RuntimeState | undefined> {
    try {
      const state = await this.o.mailbox.readState();
      if (state?.busy) return await this.dropStaleBusy(state);
      return state;
    } catch {
      return undefined;
    }
  }

  private modalError(dialogs: { title: string; text: string; buttons: string[] }[]): BridgeError {
    const first = dialogs[0];
    return new BridgeError('BLOCKED_BY_MODAL', `A dialog is open in Cheetah3D: ${first?.text.replace(/\s+/g, ' ').trim() || first?.title || '(no text)'}`, 'Dismiss the dialog in Cheetah3D (the request cannot run until then), then retry.', { dialogs });
  }

  /** `busy:true` written by a Cheetah3D process that has since died (crash) must not block triggering forever. */
  private async dropStaleBusy(state: RuntimeState): Promise<RuntimeState> {
    const since = state.updatedAt ?? state.startedAt ?? 0;
    const app = await this.o.probe.inspect().catch(() => undefined);
    if (app?.running && app.startedAtMs !== undefined && app.startedAtMs > since) {
      await this.o.mailbox.sweepInboxBefore(app.startedAtMs);
      return { ...state, busy: false };
    }
    return state;
  }

  /** The runtime must never run an abandoned request later, so it is marked cancelled and swept once answered. */
  private async abandon(seq: string, id: string): Promise<void> {
    await this.o.mailbox.writeCancel(id);
    this.orphans.push({ seq, id, since: this.clock.now() });
  }

  private async classifyTimeout(c: { seq: string; id: string; deadlineMs: number; startedAt: number; everRan: boolean; state: RuntimeState | undefined }): Promise<BridgeError> {
    const app = await this.o.probe.inspect();
    const elapsed = this.clock.now() - c.startedAt;
    const dialogs = app.running ? await this.o.probe.modals?.().catch(() => []) : undefined;
    if (dialogs?.length) {
      await this.abandon(c.seq, c.id);
      return this.modalError(dialogs);
    }
    if (!app.running) {
      await this.abandon(c.seq, c.id); // the request file is kept for diagnosis (PRD 3.5)
      return new BridgeError('APP_CRASHED', 'Cheetah3D is no longer running; the in-flight request was lost', 'Restart Cheetah3D, then retry. Unsaved work in the crashed session may be recoverable from Cheetah3D autosave.', { elapsedMs: elapsed, via: app.source });
    }
    if (!c.everRan) {
      await this.o.mailbox.remove(c.seq, c.id);
      return new BridgeError('TRIGGER_FAILED', 'The bridge macro never ran', 'Check: Cheetah3D has a document window and no dialog open; the C3D-MCP menu exists (restart Cheetah3D after install). Run `c3d-mcp doctor`.', { elapsedMs: elapsed });
    }
    await this.abandon(c.seq, c.id);
    const busyFor = c.state?.busy ? this.clock.now() - (c.state.startedAt ?? c.startedAt) : 0;
    if (app.responsive === false) {
      return new BridgeError('APP_BUSY', `Cheetah3D is not responding (${Math.round(elapsed / 1000)} s)`, 'A long operation (render, import) may be running. Wait and retry; do not press anything in Cheetah3D.', { elapsedMs: elapsed });
    }
    if (c.state?.busy) {
      if (busyFor > Math.max(c.deadlineMs, this.tun.stuckAfterMs)) {
        return new BridgeError('RUNTIME_STUCK', `The bridge runtime has reported busy for ${Math.round(busyFor / 1000)} s while Cheetah3D still responds`, 'Check Cheetah3D for a stuck script or dialog. If nothing is running, restart Cheetah3D.', { busyForMs: busyFor, op: c.state.op });
      }
      return new BridgeError('APP_BUSY', `Cheetah3D is still working on "${c.state.op ?? 'a request'}" (${Math.round(elapsed / 1000)} s)`, 'Wait, then retry. Long renders need a larger timeout.', { elapsedMs: elapsed, op: c.state.op });
    }
    return new BridgeError('TIMEOUT', `Cheetah3D did not answer within ${c.deadlineMs} ms`, HINTS.TIMEOUT, { elapsedMs: elapsed });
  }

  private async sweepOrphans(): Promise<void> {
    const now = this.clock.now();
    for (let i = this.orphans.length - 1; i >= 0; i--) {
      const o = this.orphans[i];
      if (!o) continue;
      const answered = existsSync(join(this.o.paths.outbox, `${o.id}.done`));
      if (answered || now - o.since > ORPHAN_TTL_MS) {
        await this.o.mailbox.remove(o.seq, o.id);
        this.orphans.splice(i, 1);
      }
    }
  }
}
