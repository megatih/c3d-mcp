import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adler32, asciiJson } from '../../src/core/json.js';
import { Mailbox, REQUEST_FILE_RE, type BridgeRequest } from '../../src/core/mailbox.js';
import { assertPrivateDir, ensureMcpDirs } from '../../src/core/paths.js';
import { makeTestEnv, type TestEnv } from '../helpers/fakeApp.js';

let env: TestEnv;
afterEach(() => rmSync(env.root, { recursive: true, force: true }));

async function box(clock?: { now(): number; sleep(ms: number): Promise<void> }): Promise<Mailbox> {
  env = makeTestEnv();
  await ensureMcpDirs(env.paths);
  return new Mailbox(env.paths, clock);
}

const request = (seq: string, id: string, extra: Partial<BridgeRequest> = {}): BridgeRequest => ({ protocol: 1, id, seq, secret: 'x'.repeat(32), deadlineAt: Date.now() + 1000, ops: [{ op: 'ping' }], ...extra });
const ID = '123e4567-e89b-12d3-a456-426614174000';

describe('directories and secret', () => {
  it('creates the tree with mode 0700 and the secret with 0600', async () => {
    const mb = await box();
    for (const d of [env.paths.root, env.paths.inbox, env.paths.outbox, env.paths.cancel, env.paths.runtimeDir, env.paths.log, env.paths.tmp]) {
      expect(statSync(d).mode & 0o777).toBe(0o700);
    }
    const first = await mb.ensureSecret();
    expect(first.created).toBe(true);
    expect(first.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(env.paths.secret).mode & 0o777).toBe(0o600);
    const second = await mb.ensureSecret();
    expect(second).toEqual({ secret: first.secret, created: false });
    expect(mb.readSecret()).toBe(first.secret);
  });

  it('reports only newly created directories', async () => {
    env = makeTestEnv();
    mkdirSync(env.paths.root, { recursive: true });
    const created = await ensureMcpDirs(env.paths);
    expect(created).not.toContain(env.paths.root);
    expect(created).toContain(env.paths.inbox);
  });
});

describe('mailbox directory safety', () => {
  it('does not chmod a pre-existing, non-mailbox C3D_MCP_DIR; refuses it while group/world writable', async () => {
    env = makeTestEnv();
    mkdirSync(env.paths.root, { recursive: true });
    writeFileSync(join(env.paths.root, 'precious.txt'), 'user data');
    chmodSync(env.paths.root, 0o775);
    const created = await ensureMcpDirs(env.paths);
    expect(created).not.toContain(env.paths.root);
    expect(statSync(env.paths.root).mode & 0o777).toBe(0o775);
    await expect(assertPrivateDir(env.paths.root)).rejects.toMatchObject({ code: 'PERMISSION_MISSING', hint: expect.stringContaining('chmod 700') });
    const mb = new Mailbox(env.paths);
    await expect(mb.writeRequest(request('0000000000000001', ID))).rejects.toThrow(/writable by group or others/);
  });

  it('still tightens an existing, empty or mailbox-shaped directory it owns', async () => {
    env = makeTestEnv();
    mkdirSync(env.paths.root, { recursive: true });
    chmodSync(env.paths.root, 0o755);
    await ensureMcpDirs(env.paths);
    expect(statSync(env.paths.root).mode & 0o777).toBe(0o700);
    chmodSync(env.paths.inbox, 0o777);
    await expect(assertPrivateDir(env.paths.inbox)).rejects.toThrow(/writable/);
    await ensureMcpDirs(env.paths);
    await expect(assertPrivateDir(env.paths.inbox)).resolves.toBeUndefined();
    await expect(assertPrivateDir(join(env.root, 'does-not-exist'))).resolves.toBeUndefined();
  });
});

describe('seq', () => {
  it('matches the filename contract, is strictly increasing and unique', async () => {
    const mb = await box();
    const seen = new Set<string>();
    let prev = '';
    for (let i = 0; i < 5000; i++) {
      const seq = mb.nextSeq();
      expect(seq).toMatch(/^\d{16}$/);
      expect(seq > prev).toBe(true);
      prev = seq;
      seen.add(seq);
    }
    expect(seen.size).toBe(5000);
    expect(REQUEST_FILE_RE.test(`${prev}-${ID}.json`)).toBe(true);
    expect(REQUEST_FILE_RE.test(`${prev}-${ID}.json.tmp`)).toBe(false);
  });

  it('stays monotonic when the wall clock steps backwards', async () => {
    let t = 2_000_000_000_000;
    const mb = await box({ now: () => t, sleep: () => Promise.resolve() });
    const a = mb.nextSeq();
    t -= 5000;
    const b = mb.nextSeq();
    expect(b > a).toBe(true);
  });
});

describe('request files', () => {
  it('writes ASCII-only JSON atomically (no .tmp left behind)', async () => {
    const mb = await box();
    const seq = mb.nextSeq();
    const file = await mb.writeRequest(request(seq, ID, { expectDocument: { fileName: '名前.jas' }, ops: [{ op: 'rename', args: { name: '名前😀' } }] }));
    const raw = readFileSync(file);
    expect(raw.every((b) => b < 0x7f)).toBe(true);
    expect((JSON.parse(raw.toString('ascii')) as BridgeRequest).ops[0]?.args).toEqual({ name: '名前😀' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(() => statSync(`${file}.tmp`)).toThrow();
    expect(file.endsWith(`${seq}-${ID}.json`)).toBe(true);
  });
});

function putResponse(paths: { outbox: string }, id: string, text: string, done?: object | string): void {
  writeFileSync(join(paths.outbox, `${id}.json`), text);
  if (done !== undefined) writeFileSync(join(paths.outbox, `${id}.done`), typeof done === 'string' ? done : JSON.stringify(done));
}
const okBody = asciiJson({ protocol: 1, id: ID, ok: true, runtimeVersion: '1.0.0', results: [], log: [], startedAt: 1, finishedAt: 2 });

describe('responses', () => {
  it('is pending until .done exists, even if the json is present', async () => {
    const mb = await box();
    putResponse(env.paths, ID, okBody);
    expect(await mb.readResponse(ID, 10)).toBeUndefined();
  });

  it('accepts a response whose length and checksum match', async () => {
    const mb = await box();
    putResponse(env.paths, ID, okBody, { bytes: Buffer.byteLength(okBody), checksum: adler32(okBody) });
    expect((await mb.readResponse(ID))?.ok).toBe(true);
  });

  it('recovers from a torn .done that is completed later', async () => {
    const mb = await box();
    const done = JSON.stringify({ bytes: Buffer.byteLength(okBody), checksum: adler32(okBody) });
    putResponse(env.paths, ID, okBody, done.slice(0, 9));
    setTimeout(() => writeFileSync(join(env.paths.outbox, `${ID}.done`), done), 120);
    expect((await mb.readResponse(ID, 2000))?.id).toBe(ID);
  });

  it('recovers from a response JSON that is completed after .done appeared', async () => {
    const mb = await box();
    putResponse(env.paths, ID, okBody.slice(0, 20), { bytes: Buffer.byteLength(okBody), checksum: adler32(okBody) });
    setTimeout(() => writeFileSync(join(env.paths.outbox, `${ID}.json`), okBody), 120);
    expect((await mb.readResponse(ID, 2000))?.ok).toBe(true);
  });

  it.each([
    ['wrong length', { bytes: 3, checksum: adler32(okBody) }],
    ['wrong checksum', { bytes: Buffer.byteLength(okBody), checksum: '00000000' }],
    ['unparsable marker', 'not json'],
  ])('fails with PARSE_ERROR after the retry window (%s)', async (_name, done) => {
    const mb = await box();
    putResponse(env.paths, ID, okBody, done);
    const started = Date.now();
    await expect(mb.readResponse(ID, 200)).rejects.toMatchObject({ code: 'PARSE_ERROR' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
  });

  it('rejects a body that matches the marker but is not JSON', async () => {
    const mb = await box();
    putResponse(env.paths, ID, 'garbage!!', { bytes: 9, checksum: adler32('garbage!!') });
    await expect(mb.readResponse(ID, 100)).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });
});

describe('state.json', () => {
  it('returns undefined when missing, parses valid state, retries torn writes', async () => {
    const mb = await box();
    expect(await mb.readState(10)).toBeUndefined();
    writeFileSync(env.paths.state, '{"busy":tr');
    setTimeout(() => writeFileSync(env.paths.state, JSON.stringify({ busy: false, runtimeVersion: '1.0.0', lastSeq: '0' })), 120);
    expect((await mb.readState(2000))?.busy).toBe(false);
  });

  it('gives up with PARSE_ERROR after the window', async () => {
    const mb = await box();
    writeFileSync(env.paths.state, 'junk');
    await expect(mb.readState(100)).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });
});

describe('bootstrap error', () => {
  it('surfaces and consumes a fresh _bootstrap-error.json, ignoring stale ones', async () => {
    const mb = await box();
    const file = join(env.paths.outbox, '_bootstrap-error.json');
    writeFileSync(file, JSON.stringify({ message: 'SyntaxError: x' }));
    expect(await mb.takeBootstrapError(Date.now() + 60_000)).toBeUndefined();
    expect(await mb.takeBootstrapError(Date.now() - 60_000)).toBe('SyntaxError: x');
    expect(await mb.takeBootstrapError(0)).toBeUndefined();
    writeFileSync(file, 'plain text');
    expect(await mb.takeBootstrapError(0)).toBe('plain text');
  });
});

describe('cancel and remove', () => {
  it('writes the cancel marker and removes request files', async () => {
    const mb = await box();
    const seq = mb.nextSeq();
    const file = await mb.writeRequest(request(seq, ID));
    putResponse(env.paths, ID, okBody, { bytes: 1, checksum: 'x' });
    await mb.writeCancel(ID);
    expect(readFileSync(join(env.paths.cancel, ID), 'utf8')).toBe('1');
    await mb.remove(seq, ID);
    for (const f of [file, join(env.paths.outbox, `${ID}.json`), join(env.paths.outbox, `${ID}.done`), join(env.paths.cancel, ID)]) expect(() => statSync(f)).toThrow();
  });
});
