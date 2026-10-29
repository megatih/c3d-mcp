// Composition root for everything that talks to Cheetah3D. Every collaborator can be replaced for tests.
import type { RuntimeConfig } from '../config.js';
import { createLogger, type Logger } from '../logging.js';
import type { HelperClient, SessionState } from '../toolkit.js';
import { createAppProbe, type AppProbe } from './appProbe.js';
import { assetLocations, newestExisting, readRuntimeVersionFile } from './assets.js';
import { BridgeClientImpl, type BridgeClientOptions } from './bridgeClient.js';
import { HelperClientImpl, defaultHelperAppPaths } from './helperClient.js';
import { FileLock, RequestQueue } from './lock.js';
import { Mailbox } from './mailbox.js';
import { mcpPaths, type McpPaths } from './paths.js';
import { systemClock, systemExec, type Clock, type Executor } from './platform.js';
import { AutoTrigger, OsascriptTrigger, type Trigger } from './trigger.js';

export interface Runtime {
  config: RuntimeConfig;
  paths: McpPaths;
  mailbox: Mailbox;
  queue: RequestQueue;
  helper: HelperClient & { installedApp?(): string | undefined };
  trigger: Trigger;
  probe: AppProbe;
  bridge: BridgeClientImpl;
  session: SessionState;
  exec: Executor;
  clock: Clock;
  logger: Logger;
  /** Version of the runtime bundled with this package (undefined when no runtime asset is present). */
  bundledRuntimeVersion: string | undefined;
}

export interface RuntimeOverrides {
  exec?: Executor;
  clock?: Clock;
  helper?: Runtime['helper'];
  trigger?: Trigger;
  probe?: AppProbe;
  logger?: Logger;
  session?: SessionState;
  bridge?: Partial<BridgeClientOptions>;
  /** Defaults to the major of the bundled runtime. */
  expectedRuntimeMajor?: number;
}

export function newSession(): SessionState {
  return { ownedPaths: new Set(), scratch: new Map() };
}

export function createRuntime(config: RuntimeConfig, o: RuntimeOverrides = {}): Runtime {
  const exec = o.exec ?? systemExec;
  const clock = o.clock ?? systemClock;
  const paths = mcpPaths(config);
  const mailbox = new Mailbox(paths, clock);
  const queue = new RequestQueue(new FileLock(paths.lock, { clock }));
  const helper = o.helper ?? new HelperClientImpl({ socketPath: paths.helperSock, appPaths: defaultHelperAppPaths(config.mcpDir), exec, clock });
  const trigger = o.trigger ?? new AutoTrigger(helper, new OsascriptTrigger(exec), config.trigger);
  const probe = o.probe ?? createAppProbe(helper, exec);
  const session = o.session ?? newSession();
  const bundledPath = newestExisting(assetLocations().runtime);
  const bundledRuntimeVersion = bundledPath ? readRuntimeVersionFile(bundledPath) : undefined;
  const expectedRuntimeMajor = o.expectedRuntimeMajor ?? (bundledRuntimeVersion ? Number.parseInt(bundledRuntimeVersion.split('.')[0] ?? '', 10) : undefined);
  const logger = o.logger ?? createLogger({ dir: config.logDir, redact: () => [mailbox.readSecret() ?? ''] });
  const bridge = new BridgeClientImpl({ paths, mailbox, queue, trigger, probe, session, clock, expectedRuntimeMajor, ...o.bridge });
  return { config, paths, mailbox, queue, helper, trigger, probe, bridge, session, exec, clock, logger, bundledRuntimeVersion };
}
