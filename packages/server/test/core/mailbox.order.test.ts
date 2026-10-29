import type * as FsPromises from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { makeTestEnv, type TestEnv } from '../helpers/fakeApp.js';

const removed: string[] = [];
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof FsPromises>();
  return { ...real, rm: (path: string, opts?: object) => { removed.push(path); return real.rm(path, opts); } };
});

let env: TestEnv;
afterEach(() => rmSync(env.root, { recursive: true, force: true }));

describe('delete order (docs/PROTOCOL.md section 3)', () => {
  it('removes inbox request, then outbox json, then .done, then cancel marker', async () => {
    const { Mailbox } = await import('../../src/core/mailbox.js');
    env = makeTestEnv();
    const mb = new Mailbox(env.paths);
    await mb.remove('0000000000000001', 'abc');
    expect(removed.map((p) => p.replace(env.paths.root, ''))).toEqual(['/inbox/0000000000000001-abc.json', '/outbox/abc.json', '/outbox/abc.done', '/cancel/abc']);
  });
});
