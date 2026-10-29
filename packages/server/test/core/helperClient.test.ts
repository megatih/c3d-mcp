import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HelperClientImpl, HelperUnavailableError, defaultHelperAppPaths } from '../../src/core/helperClient.js';
import type { Executor } from '../../src/core/platform.js';
import { FakeHelper } from '../helpers/fakeHelper.js';

const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function sandbox(): { dir: string; sock: string } {
  const dir = mkdtempSync(join(tmpdir(), 'c3dh-'));
  roots.push(dir);
  return { dir, sock: join(dir, 'h.sock') };
}
async function startHelper(sock: string): Promise<FakeHelper> {
  const h = new FakeHelper(sock);
  await h.start();
  cleanups.push(() => h.stop());
  return h;
}

describe('HelperClientImpl', () => {
  it('round-trips commands and surfaces results', async () => {
    const { sock } = sandbox();
    const helper = await startHelper(sock);
    helper.handlers.set('status', () => ({ cheetah: { running: true } }));
    const client = new HelperClientImpl({ socketPath: sock, appPaths: [] });
    expect(client.available()).toBe(true);
    expect(await client.call('ping')).toEqual({ version: '0.1.0', pid: 4242 });
    expect(await client.call('status', { x: 1 })).toEqual({ cheetah: { running: true } });
    expect(helper.calls.at(-1)).toEqual({ cmd: 'status', args: { x: 1 } });
  });

  it('maps helper errors onto BridgeError codes (unknown codes become INTERNAL)', async () => {
    const { sock } = sandbox();
    const helper = await startHelper(sock);
    helper.handlers.set('pressBridge', () => { throw Object.assign(new Error('dialog open'), { code: 'BLOCKED_BY_MODAL', hint: 'close it', details: { title: 't' } }); });
    helper.handlers.set('odd', () => { throw Object.assign(new Error('strange'), { code: 'SOMETHING_ELSE' }); });
    const client = new HelperClientImpl({ socketPath: sock, appPaths: [] });
    await expect(client.call('pressBridge')).rejects.toMatchObject({ code: 'BLOCKED_BY_MODAL', hint: 'close it', details: { title: 't' } });
    await expect(client.call('odd')).rejects.toMatchObject({ code: 'INTERNAL' });
    const err: unknown = await client.call('pressBridge').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(HelperUnavailableError);
  });

  it('times out when the helper never answers', async () => {
    const { sock } = sandbox();
    const helper = await startHelper(sock);
    helper.silent = true;
    const client = new HelperClientImpl({ socketPath: sock, appPaths: [] });
    await expect(client.call('ping', {}, 100)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports HelperUnavailableError when the connection drops', async () => {
    const { sock } = sandbox();
    const helper = await startHelper(sock);
    helper.hangUp = true;
    const client = new HelperClientImpl({ socketPath: sock, appPaths: [] });
    await expect(client.call('ping')).rejects.toBeInstanceOf(HelperUnavailableError);
  });

  it('is unavailable (and fails fast) without socket or app bundle', async () => {
    const { sock } = sandbox();
    const client = new HelperClientImpl({ socketPath: sock, appPaths: [join(tmpdir(), 'no-such-helper.app')] });
    expect(client.available()).toBe(false);
    await expect(client.call('ping')).rejects.toBeInstanceOf(HelperUnavailableError);
  });

  it('launches the app bundle with `open -g -a ... --args --socket` and then connects', async () => {
    const { dir, sock } = sandbox();
    const app = join(dir, 'C3D Bridge Helper.app');
    mkdirSync(app);
    const calls: string[][] = [];
    let helper: FakeHelper | undefined;
    const exec: Executor = async (cmd, args) => {
      calls.push([cmd, ...args]);
      helper = await startHelper(sock);
      return { code: 0, stdout: '', stderr: '' };
    };
    const client = new HelperClientImpl({ socketPath: sock, appPaths: [app], exec, launchWaitMs: 2000 });
    expect(client.available()).toBe(true);
    expect(client.installedApp()).toBe(app);
    expect(await client.call('ping')).toMatchObject({ pid: 4242 });
    expect(calls).toEqual([['open', '-g', '-a', app, '--args', '--socket', sock]]);
    expect(helper).toBeDefined();
  });

  it('gives up when the launch fails and then reports unavailable for a while', async () => {
    const { dir, sock } = sandbox();
    const app = join(dir, 'C3D Bridge Helper.app');
    mkdirSync(app);
    let now = 1000;
    const exec: Executor = () => Promise.resolve({ code: 1, stdout: '', stderr: 'nope' });
    const client = new HelperClientImpl({ socketPath: sock, appPaths: [app], exec, clock: { now: () => now, sleep: () => Promise.resolve() }, retryAfterMs: 5000 });
    await expect(client.call('ping')).rejects.toBeInstanceOf(HelperUnavailableError);
    expect(client.available()).toBe(false);
    now += 6000;
    expect(client.available()).toBe(true);
  });

  it('does not launch when autoLaunch is off', async () => {
    const { dir, sock } = sandbox();
    const app = join(dir, 'x.app');
    mkdirSync(app);
    writeFileSync(join(dir, 'unused'), '');
    const client = new HelperClientImpl({ socketPath: sock, appPaths: [app], autoLaunch: false });
    expect(client.available()).toBe(false);
  });

  it('lists candidate app locations including the MCP dir', () => {
    expect(defaultHelperAppPaths('/m')).toContain('/m/helper/C3D Bridge Helper.app');
  });
});
