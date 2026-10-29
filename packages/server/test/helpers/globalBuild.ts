// Builds the TypeScript sources once so tests can spawn real child processes (cross-process lock, stdio server).
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, '.test-dist');

export default function setup(): () => void {
  rmSync(outDir, { recursive: true, force: true });
  // Type errors elsewhere must not hide runtime test failures, so the exit status is ignored; emit still happens.
  spawnSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json', '--outDir', outDir, '--noEmitOnError', 'false'], { cwd: root, stdio: 'ignore' });
  process.env.C3D_TEST_DIST = outDir;
  return () => rmSync(outDir, { recursive: true, force: true });
}
