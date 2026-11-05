import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ApprovalMode, Profile, ServerConfig } from './toolkit.js';
import type { TriggerMode } from './core/trigger.js';

export interface RuntimeConfig extends ServerConfig {
  trigger: TriggerMode;
  /** Launch Cheetah3D when it is not running (needs the helper app). C3D_MCP_NO_AUTOLAUNCH=1 turns it off. */
  autoLaunch: boolean;
}

const APPROVALS: readonly ApprovalMode[] = ['strict', 'session', 'trusted'];
const PROFILES: readonly Profile[] = ['full', 'local', 'readonly'];
const TRIGGERS: readonly TriggerMode[] = ['auto', 'helper', 'osascript'];

/** Reads the control panel's settings file; a missing or broken file means "no saved settings". */
function readSettings(path: string): { approval?: string } {
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof doc === 'object' && doc !== null && typeof (doc as { approval?: unknown }).approval === 'string' ? { approval: (doc as { approval: string }).approval } : {};
  } catch {
    return {};
  }
}

function flag(value: string | undefined): boolean {
  return value !== undefined && /^(1|true|yes|on)$/i.test(value.trim());
}

function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (value === undefined || value.trim() === '') return fallback;
  const v = value.trim().toLowerCase() as T;
  if (!allowed.includes(v)) throw new Error(`${name} must be one of ${allowed.join(' | ')} (got "${value}")`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): RuntimeConfig {
  const support = resolve(env.C3D_CHEETAH_SUPPORT_DIR || join(home, 'Library', 'Application Support', 'Cheetah3D'));
  const mcpDir = resolve(env.C3D_MCP_DIR || join(support, 'MCP'));
  const autoConfirm = flag(env.C3D_MCP_AUTO_CONFIRM);
  // settings.json in the MCP folder holds the values the C3D MCP control panel changes; environment variables win over it.
  const saved = readSettings(join(mcpDir, 'settings.json'));
  // C3D_MCP_AUTO_CONFIRM=1 is the legacy spelling of trusted.
  const approval = oneOf('C3D_MCP_APPROVAL', env.C3D_MCP_APPROVAL ?? saved.approval, APPROVALS, autoConfirm ? 'trusted' : 'session');
  return {
    profile: oneOf('C3D_MCP_PROFILE', env.C3D_MCP_PROFILE, PROFILES, 'full'),
    disableExec: flag(env.C3D_MCP_DISABLE_EXEC),
    disableAssets: flag(env.C3D_MCP_DISABLE_ASSETS),
    disableShell: flag(env.C3D_MCP_DISABLE_SHELL),
    autoConfirm,
    approval,
    mcpDir,
    cheetahSupportDir: support,
    logDir: resolve(env.C3D_MCP_LOG_DIR || join(home, 'Library', 'Logs', 'c3d-mcp')),
    workDir: resolve(env.C3D_MCP_WORKDIR || join(mcpDir, 'tmp')),
    trigger: oneOf('C3D_MCP_TRIGGER', env.C3D_MCP_TRIGGER, TRIGGERS, 'auto'),
    autoLaunch: !flag(env.C3D_MCP_NO_AUTOLAUNCH),
  };
}
