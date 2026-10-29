// A Node simulation of the in-app runtime (docs/PROTOCOL.md section 3) working on the REAL mailbox files.
// `runMacro()` is what one press of the bridge menu item does. Tests inject FakeApp-backed Trigger/AppProbe implementations.
import { Ajv2020 } from 'ajv/dist/2020.js';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppProbe, AppStatus } from '../../src/core/appProbe.js';
import { adler32, asciiJson } from '../../src/core/json.js';
import { REQUEST_FILE_RE, type BridgeRequest } from '../../src/core/mailbox.js';
import { mcpPaths, type McpPaths } from '../../src/core/paths.js';
import type { MenuState, Trigger } from '../../src/core/trigger.js';
import { BridgeError } from '../../src/toolkit.js';
import type { RuntimeConfig } from '../../src/config.js';

const CONTRACTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'contracts');
const ajv = new Ajv2020({ allErrors: true, strict: false });
const requestValidator = ajv.compile(JSON.parse(readFileSync(join(CONTRACTS, 'request.schema.json'), 'utf8')) as object);
const responseValidator = ajv.compile(JSON.parse(readFileSync(join(CONTRACTS, 'response.schema.json'), 'utf8')) as object);

export type Behavior = 'normal' | 'noRun' | 'stuck' | 'junkResponse' | 'tornDone' | 'crash';

type OpHandler = (args: Record<string, unknown>, app: FakeApp) => unknown;

export interface TestEnv {
  root: string;
  config: RuntimeConfig;
  paths: McpPaths;
}

/** Short temp dir (unix socket paths are limited to ~104 bytes on macOS). */
export function makeTestEnv(prefix = 'c3d'): TestEnv {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const support = join(root, 'support');
  mkdirSync(join(support, 'Scripts', 'Macro'), { recursive: true });
  const config: RuntimeConfig = {
    profile: 'full',
    disableExec: false,
    disableAssets: false,
    autoConfirm: false,
    disableShell: false,
    mcpDir: join(support, 'MCP'),
    cheetahSupportDir: support,
    logDir: join(root, 'logs'),
    workDir: join(support, 'MCP', 'tmp'),
    trigger: 'osascript',
  };
  return { root, config, paths: mcpPaths(config) };
}

/** Creates the files `install` would, without any install logic (so bridge-client tests stay independent of it). */
export function seedBridgeFiles(paths: McpPaths, secret = 's'.repeat(64)): void {
  for (const d of [paths.root, paths.inbox, paths.outbox, paths.cancel, paths.runtimeDir, paths.log, paths.tmp, paths.macroDir]) mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(paths.secret, `${secret}\n`, { mode: 0o600 });
  writeFileSync(paths.runtimeFile, '// c3d-mcp runtime v1.0.0\nvar RUNTIME_VERSION = "1.0.0";\n');
  writeFileSync(paths.macroFile, '// fake macro\n');
}

export class FakeApp {
  behavior: Behavior = 'normal';
  runtimeVersion = '1.0.0';
  running = true;
  responsive = true;
  /** Menu state reported to install/doctor. */
  menu: MenuState = 'present';
  fileName: string | null = null;
  marker: string | null = null;
  /** Number of times the macro ran (presses that reached the runtime). */
  macroRuns = 0;
  /** Executions per request id: must never exceed 1. */
  readonly executions = new Map<string, number>();
  readonly opLog: { id: string; op: string; args: Record<string, unknown> }[] = [];
  readonly contractViolations: string[] = [];
  objects = 0;
  lastSeq = '0';
  readonly ops = new Map<string, OpHandler>();
  /** Delay (ms) injected before responding to simulate a long operation. */
  opDelayMs = 0;
  /** Overrides the secret read from the secret file (to simulate a mismatching runtime). */
  secretOverride: string | undefined;

  constructor(readonly paths: McpPaths) {
    this.ops.set('ping', (a, app) => ({ counter: a.counter ?? null, echo: a.echo ?? null, runtimeVersion: app.runtimeVersion, now: Date.now(), jsc: true, stateBusy: false }));
    this.ops.set('createObject', (a, app) => ({ ref: { id: ++app.objects }, name: String(a.name ?? 'Box'), type: 'BOX' }));
    this.ops.set('boom', () => {
      throw new Error('kaboom');
    });
    this.ops.set('echoName', (a) => ({ name: a.name }));
  }

  readonly trigger: Trigger = {
    press: async () => {
      if (!this.running) throw new BridgeError('APP_NOT_RUNNING', 'Cheetah3D is not running');
      await this.runMacro();
    },
    menuState: async () => this.menu,
  };

  readonly probe: AppProbe = {
    inspect: async (): Promise<AppStatus> => ({ running: this.running, responsive: this.responsive, source: 'helper' }),
  };

  private async writeState(busy: boolean, extra: Record<string, unknown> = {}): Promise<void> {
    await writeFile(this.paths.state, JSON.stringify({ busy, reqId: null, op: null, startedAt: busy ? Date.now() : null, runtimeVersion: this.runtimeVersion, protocol: 1, lastSeq: this.lastSeq, document: this.fileName, updatedAt: Date.now(), ...extra }));
  }

  /** One run of the loader macro: drains the inbox exactly like the real runtime. */
  async runMacro(): Promise<void> {
    if (this.behavior === 'noRun' || !this.running) return;
    this.macroRuns++;
    if (this.behavior === 'crash') {
      this.running = false;
      return;
    }
    if (this.behavior === 'stuck') {
      await this.writeState(true, { reqId: 'stuck', op: 'render' });
      return;
    }
    await this.writeState(true);
    const names = readdirSync(this.paths.inbox).filter((n) => REQUEST_FILE_RE.test(n)).sort().slice(0, 25);
    for (const name of names) {
      const file = join(this.paths.inbox, name);
      let req: BridgeRequest;
      try {
        req = JSON.parse(await readFile(file, 'latin1')) as BridgeRequest;
      } catch {
        continue;
      }
      await this.handle(req);
    }
    await this.writeState(false);
  }

  private async handle(req: BridgeRequest): Promise<void> {
    const reqId = req.id;
    if (!requestValidator(req)) this.contractViolations.push(`request ${reqId}: ${ajv.errorsText(requestValidator.errors)}`);
    if (existsSync(join(this.paths.outbox, `${req.id}.done`)) || req.seq <= this.lastSeq) return;
    const startedAt = Date.now();
    let body: Record<string, unknown>;
    const top = (code: string, message: string): Record<string, unknown> => ({ ok: false, error: { code, message }, results: [] });
    if (Date.now() > req.deadlineAt) body = top('TIMEOUT', 'deadline passed before the request ran');
    else if (existsSync(join(this.paths.cancel, req.id))) body = top('CANCELLED', 'cancelled');
    else if (req.secret !== this.currentSecret()) body = top('INTERNAL', 'bad secret');
    else if ((req.protocol as number) !== 1) body = top('VERSION_SKEW', 'protocol mismatch');
    else if (!this.documentMatches(req)) body = top('WRONG_DOCUMENT', 'front document differs');
    else {
      this.executions.set(req.id, (this.executions.get(req.id) ?? 0) + 1);
      if (this.opDelayMs > 0) await new Promise((r) => setTimeout(r, this.opDelayMs));
      const results = req.ops.map((op) => {
        this.opLog.push({ id: req.id, op: op.op, args: op.args ?? {} });
        const handler = this.ops.get(op.op);
        if (!handler) return { op: op.op, ok: false, error: { code: 'UNSUPPORTED', message: `unknown op ${op.op}` } };
        try {
          return { op: op.op, ok: true, result: handler(op.args ?? {}, this) };
        } catch (err) {
          return { op: op.op, ok: false, error: { code: (err as { code?: string }).code ?? 'SCRIPT_ERROR', message: err instanceof Error ? err.message : String(err), details: { line: 1 } } };
        }
      });
      body = { ok: results.every((r) => r.ok), results };
    }
    const response = { protocol: 1, id: req.id, runtimeVersion: this.runtimeVersion, log: [], startedAt, finishedAt: Date.now(), ...body };
    if (!responseValidator(response)) this.contractViolations.push(`response ${req.id}: ${ajv.errorsText(responseValidator.errors)}`);
    const text = asciiJson(response);
    const out = join(this.paths.outbox, `${req.id}.json`);
    if (this.behavior === 'junkResponse') {
      await writeFile(out, '{"protocol":1,"id":"x", truncated');
      await writeFile(join(this.paths.outbox, `${req.id}.done`), JSON.stringify({ bytes: Buffer.byteLength(text), checksum: adler32(text) }));
    } else if (this.behavior === 'tornDone') {
      await writeFile(out, text);
      const done = JSON.stringify({ bytes: Buffer.byteLength(text), checksum: adler32(text) });
      await writeFile(join(this.paths.outbox, `${req.id}.done`), done.slice(0, 7));
      setTimeout(() => writeFileSync(join(this.paths.outbox, `${req.id}.done`), done), 300);
    } else {
      await writeFile(out, text);
      await writeFile(join(this.paths.outbox, `${req.id}.done`), JSON.stringify({ bytes: Buffer.byteLength(text), checksum: adler32(text) }));
    }
    this.lastSeq = req.seq;
  }

  private currentSecret(): string {
    return this.secretOverride ?? readFileSync(this.paths.secret, 'utf8').trim();
  }

  private documentMatches(req: BridgeRequest): boolean {
    const e = req.expectDocument;
    if (!e) return true;
    if (e.fileName !== undefined && e.fileName !== this.fileName) return false;
    if (e.marker !== undefined && e.marker !== this.marker) return false;
    return true;
  }

  /** Number of requests executed more than once. */
  duplicates(): number {
    return [...this.executions.values()].filter((n) => n > 1).length;
  }
}
