// Child process for the cross-process lock test: takes the lock N times and records enter/exit lines.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [, , distLock, lockPath, logPath, label, rounds] = process.argv;
const { FileLock } = await import(pathToFileURL(distLock).href);
const lock = new FileLock(lockPath, { pollMs: 5 });
for (let i = 0; i < Number(rounds); i++) {
  const release = await lock.acquire({ timeoutMs: 20000 });
  appendFileSync(logPath, `enter ${label}\n`);
  await new Promise((r) => setTimeout(r, 15));
  appendFileSync(logPath, `exit ${label}\n`);
  await release();
}
