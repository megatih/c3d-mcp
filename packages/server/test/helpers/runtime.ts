import { createRuntime, type Runtime, type RuntimeOverrides } from '../../src/core/runtime.js';
import { createLogger } from '../../src/logging.js';
import type { HelperClient } from '../../src/toolkit.js';
import { FakeApp, makeTestEnv, seedBridgeFiles, type TestEnv } from './fakeApp.js';

export const noHelper: HelperClient & { installedApp(): undefined } = {
  available: () => false,
  call: () => Promise.reject(new Error('no helper')),
  installedApp: () => undefined,
};

export interface Harness { env: TestEnv; app: FakeApp; rt: Runtime }

/** Runtime wired to a FakeApp: real mailbox/queue/lock on temp dirs, fast timings. */
export function makeHarness(over: RuntimeOverrides = {}, opts: { seed?: boolean } = {}): Harness {
  const env = makeTestEnv();
  if (opts.seed !== false) seedBridgeFiles(env.paths);
  const app = new FakeApp(env.paths);
  const rt = createRuntime(env.config, {
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
