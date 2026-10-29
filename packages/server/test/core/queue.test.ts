import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileLock, Mutex, RequestQueue } from '../../src/core/lock.js';
import { BridgeError } from '../../src/toolkit.js';
import { distFile } from '../helpers/childScripts.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'c3dq-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Mutex', () => {
  it('runs tasks strictly in FIFO order, one at a time', async () => {
    const m = new Mutex();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const task = (name: string, ms: number) =>
      m.run(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(`start ${name}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end ${name}`);
        active--;
      });
    await Promise.all([task('a', 20), task('b', 1), task('c', 1)]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('releases the lock when the task throws', async () => {
    const m = new Mutex();
    await expect(m.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(m.run(() => Promise.resolve(5))).resolves.toBe(5);
  });

  it('lets a waiter leave the queue via AbortSignal without blocking later waiters', async () => {
    const m = new Mutex();
    const release = await m.acquire();
    const ac = new AbortController();
    const waiting = m.acquire(ac.signal);
    const later = m.run(() => Promise.resolve('later'));
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(m.pending).toBeGreaterThanOrEqual(1);
    release();
    await expect(later).resolves.toBe('later');
    await expect(m.acquire(ac.signal)).rejects.toBeInstanceOf(BridgeError);
  });
});

describe('FileLock', () => {
  it('is exclusive and releases only its own token', async () => {
    const path = join(tmp(), 'lock');
    const a = new FileLock(path, { pollMs: 5 });
    const b = new FileLock(path, { pollMs: 5 });
    const releaseA = await a.acquire({ timeoutMs: 1000 });
    await expect(b.acquire({ timeoutMs: 60 })).rejects.toMatchObject({ code: 'APP_BUSY' });
    await releaseA();
    const releaseB = await b.acquire({ timeoutMs: 1000 });
    await releaseB();
  });

  it('reclaims a lock whose owner PID is dead', async () => {
    const path = join(tmp(), 'lock');
    writeFileSync(path, JSON.stringify({ pid: 999_999, token: 'dead', startedAt: 1 }));
    const lock = new FileLock(path, { pollMs: 5, isAlive: () => false });
    const release = await lock.acquire({ timeoutMs: 1000 });
    expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(process.pid);
    await release();
  });

  it('reclaims a lock without a heartbeat for staleMs', async () => {
    const path = join(tmp(), 'lock');
    writeFileSync(path, JSON.stringify({ pid: process.pid, token: 'old', startedAt: 1 }));
    const lock = new FileLock(path, { pollMs: 5, staleMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    await (await lock.acquire({ timeoutMs: 1000 }))();
  });

  it('does not steal a live lock held by another live process', async () => {
    const path = join(tmp(), 'lock');
    writeFileSync(path, JSON.stringify({ pid: process.pid, token: 'live', startedAt: Date.now() }));
    const lock = new FileLock(path, { pollMs: 5, staleMs: 60_000 });
    await expect(lock.acquire({ timeoutMs: 50 })).rejects.toMatchObject({ code: 'APP_BUSY' });
  });

  it('honours AbortSignal while waiting', async () => {
    const path = join(tmp(), 'lock');
    const holder = await new FileLock(path).acquire({ timeoutMs: 100 });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    await expect(new FileLock(path, { pollMs: 5 }).acquire({ timeoutMs: 5000, signal: ac.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    await holder();
  });

  it('serialises two real Node processes (no interleaving)', async () => {
    const d = tmp();
    const lockPath = join(d, 'lock');
    const logPath = join(d, 'log');
    writeFileSync(logPath, '');
    const run = (label: string): Promise<number | null> =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'helpers', 'lockChild.mjs'), distFile('core/lock.js'), lockPath, logPath, label, '6'], { stdio: 'inherit' });
        child.on('exit', resolve);
      });
    const codes = await Promise.all([run('A'), run('B')]);
    expect(codes).toEqual([0, 0]);
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(24);
    for (let i = 0; i < lines.length; i += 2) {
      const [enter, exit] = [lines[i]!, lines[i + 1]!];
      expect(enter.startsWith('enter ')).toBe(true);
      expect(exit).toBe(enter.replace('enter', 'exit'));
    }
  });
});

describe('RequestQueue', () => {
  it('serialises in-process callers and holds the file lock while running', async () => {
    const d = tmp();
    const lockPath = join(d, 'lock');
    const q = new RequestQueue(new FileLock(lockPath, { pollMs: 5 }));
    let lockSeen = false;
    const order: number[] = [];
    await Promise.all([
      q.run(async () => {
        lockSeen = readFileSync(lockPath, 'utf8').includes(String(process.pid));
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      }),
      q.run(() => {
        order.push(2);
        return Promise.resolve();
      }),
    ]);
    expect(lockSeen).toBe(true);
    expect(order).toEqual([1, 2]);
    expect(() => readFileSync(lockPath)).toThrow();
  });
});
