import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Profile, ServerConfig } from './toolkit.js';
import type { TriggerMode } from './core/trigger.js';

export interface RuntimeConfig extends ServerConfig {
  trigger: TriggerMode;
}

const PROFILES: readonly Profile[] = ['full', 'local', 'readonly'];
const TRIGGERS: readonly TriggerMode[] = ['auto', 'helper', 'osascript'];

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
  return {
    profile: oneOf('C3D_MCP_PROFILE', env.C3D_MCP_PROFILE, PROFILES, 'full'),
    disableExec: flag(env.C3D_MCP_DISABLE_EXEC),
    disableAssets: flag(env.C3D_MCP_DISABLE_ASSETS),
    disableShell: flag(env.C3D_MCP_DISABLE_SHELL),
    autoConfirm: flag(env.C3D_MCP_AUTO_CONFIRM),
    mcpDir,
    cheetahSupportDir: support,
    logDir: resolve(env.C3D_MCP_LOG_DIR || join(home, 'Library', 'Logs', 'c3d-mcp')),
    workDir: resolve(env.C3D_MCP_WORKDIR || join(mcpDir, 'tmp')),
    trigger: oneOf('C3D_MCP_TRIGGER', env.C3D_MCP_TRIGGER, TRIGGERS, 'auto'),
  };
}
