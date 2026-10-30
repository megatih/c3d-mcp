import type { RuntimeConfig } from '../../src/config.js';
import { createRuntime, type Runtime, type RuntimeOverrides } from '../../src/core/runtime.js';
import { createLogger } from '../../src/logging.js';
import { systemExec, type Executor } from '../../src/core/platform.js';
import type { HelperClient } from '../../src/toolkit.js';
import { FakeApp, makeTestEnv, seedBridgeFiles, type TestEnv } from './fakeApp.js';

/**
 * Default executor for tests: real for harmless commands (tar, ditto, codesign, pgrep ...), but commands with side effects outside the
 * temp directories are blocked. A test that really launched or killed the helper, started launchd jobs or talked to the developer's
 * claude CLI would change the machine it runs on (an early draft of an uninstall test once left helper processes running).
 */
const BLOCKED = new Set(['open', 'kill', 'launchctl', 'claude']);
export const safeExec: Executor = (cmd, args, o) => (BLOCKED.has(cmd) ? Promise.resolve({ code: 127, stdout: '', stderr: `${cmd}: blocked in tests (pass your own fake exec)` }) : systemExec(cmd, args, o));

export const noHelper: HelperClient & { installedApp(): undefined } = {
  available: () => false,
  call: () => Promise.reject(new Error('no helper')),
  installedApp: () => undefined,
};

export interface Harness { env: TestEnv; app: FakeApp; rt: Runtime }

/** Runtime wired to a FakeApp: real mailbox/queue/lock on temp dirs, fast timings. */
export function makeHarness(over: RuntimeOverrides = {}, opts: { seed?: boolean; config?: Partial<RuntimeConfig> } = {}): Harness {
  const env = makeTestEnv();
  Object.assign(env.config, opts.config);
  if (opts.seed !== false) seedBridgeFiles(env.paths);
  const app = new FakeApp(env.paths);
  const rt = createRuntime(env.config, {
    exec: safeExec,
    trigger: app.trigger,
    probe: app.probe,
    helper: noHelper,
    logger: createLogger({ write: () => undefined }),
    expectedRuntimeMajor: 1,
    bridge: { pressGraceMs: 300, pollMinMs: 5, pollMaxMs: 20, progressIntervalMs: 50, defaultDeadlineMs: 3000 },
    ...over,
  });
  return { env, app, rt };
}
