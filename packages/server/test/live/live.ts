// Live-test helpers: talk to the REAL Cheetah3D through the installed bridge. Only runs with C3D_LIVE=1.
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config.js';
import { createRuntime, type Runtime } from '../../src/core/runtime.js';

export const LIVE = process.env['C3D_LIVE'] === '1';

export function liveRuntime(): Runtime {
  return createRuntime(loadConfig());
}

/** Creates a fresh untitled scratch document carrying a unique marker and pins the session to it. */
export async function newScratch(rt: Runtime): Promise<string> {
  await rt.exec('osascript', ['-e', 'tell application "System Events" to tell process "Cheetah3D" to click menu item "New" of menu 1 of menu bar item "File" of menu bar 1']);
  await new Promise((r) => setTimeout(r, 1500));
  const marker = `__c3d_mcp_session_${randomUUID()}`;
  rt.session.expectDocument = undefined;
  await rt.bridge.one('setMarker', { uuid: marker.slice('__c3d_mcp_session_'.length) });
  rt.session.expectDocument = { marker };
  return marker;
}
