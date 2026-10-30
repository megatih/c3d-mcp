import { BridgeError, type HelperClient, type SessionState } from '../toolkit.js';

/** Starts Cheetah3D when a request finds it not running (requirements section 3.9). */
export interface Launcher {
  ensureRunning(): Promise<void>;
}

export interface LauncherTuning {
  /** How long to wait for Cheetah3D to open its own untitled document before creating one. */
  windowWaitMs?: number;
  pollMs?: number;
}

const LAUNCH_TIMEOUT_MS = 45_000;
const isDocumentWindow = (w: { title?: string; subrole?: string }): boolean => w.subrole === 'AXStandardWindow' && !!w.title && w.title !== 'Render Manager';

/**
 * Uses the helper app (Accessibility): `launchApp` starts Cheetah3D and waits for its menu bar; a launch normally opens one
 * untitled document, otherwise File > New is pressed. The document bound to the session belonged to the previous process, so it
 * is forgotten (a stale marker would end in WRONG_DOCUMENT).
 */
export function createLauncher(helper: HelperClient, session: SessionState, tuning: LauncherTuning = {}): Launcher {
  const windowWaitMs = tuning.windowWaitMs ?? 8_000;
  const pollMs = tuning.pollMs ?? 250;
  return {
    async ensureRunning(): Promise<void> {
      if (!helper.available()) {
        throw new BridgeError('APP_NOT_RUNNING', 'Cheetah3D is not running and the helper app, which launches it, is not available', 'Install the helper (`c3d-mcp install`) or start Cheetah3D yourself.');
      }
      await helper.call('launchApp', {}, LAUNCH_TIMEOUT_MS);
      const hasDocument = async (): Promise<boolean> => {
        const windows = await helper.call<Array<{ title?: string; subrole?: string }>>('windows', {}, 10_000).catch(() => []);
        return Array.isArray(windows) && windows.some(isDocumentWindow);
      };
      const until = Date.now() + windowWaitMs;
      let found = await hasDocument();
      while (!found && Date.now() < until) {
        await new Promise((r) => setTimeout(r, pollMs));
        found = await hasDocument();
      }
      if (!found) await helper.call('newDocument', {}, 15_000);
      session.expectDocument = undefined;
      session.scratch.delete('windowTitle');
    },
  };
}
