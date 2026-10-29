import { chmod, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerConfig } from '../toolkit.js';

export interface McpPaths {
  root: string;
  inbox: string;
  outbox: string;
  cancel: string;
  runtimeDir: string;
  log: string;
  tmp: string;
  state: string;
  secret: string;
  helperSock: string;
  lock: string;
  runtimeFile: string;
  manifest: string;
  supportDir: string;
  scriptsDir: string;
  macroDir: string;
  macroFile: string;
  backupsDir: string;
}

export const MACRO_DIR_NAME = 'C3D-MCP';
export const MACRO_FILE_NAME = 'C3D-MCP Bridge.js';
/** Menu path of the loader macro (research/raw/menus.json: items keep their ".js" suffix). */
export const BRIDGE_MENU_PATH = ['Tools', 'Script', 'Macro Script', MACRO_DIR_NAME, MACRO_FILE_NAME] as const;

export function mcpPaths(config: Pick<ServerConfig, 'mcpDir' | 'cheetahSupportDir'>): McpPaths {
  const root = config.mcpDir;
  const supportDir = config.cheetahSupportDir;
  const macroDir = join(supportDir, 'Scripts', 'Macro', MACRO_DIR_NAME);
  return {
    root,
    inbox: join(root, 'inbox'),
    outbox: join(root, 'outbox'),
    cancel: join(root, 'cancel'),
    runtimeDir: join(root, 'runtime'),
    log: join(root, 'log'),
    tmp: join(root, 'tmp'),
    state: join(root, 'state.json'),
    secret: join(root, 'secret'),
    helperSock: join(root, 'helper.sock'),
    lock: join(root, 'lock'),
    runtimeFile: join(root, 'runtime', 'runtime.js'),
    manifest: join(root, 'install-manifest.json'),
    supportDir,
    scriptsDir: join(supportDir, 'Scripts'),
    macroDir,
    macroFile: join(macroDir, MACRO_FILE_NAME),
    backupsDir: join(supportDir, 'MCP-backups'),
  };
}

export function mcpSubdirs(p: McpPaths): string[] {
  return [p.root, p.inbox, p.outbox, p.cancel, p.runtimeDir, p.log, p.tmp];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Creates the mailbox tree with mode 0700 (JS cannot mkdir, PRD rule 3). Returns the directories that did not exist before. */
export async function ensureMcpDirs(p: McpPaths): Promise<string[]> {
  const created: string[] = [];
  for (const dir of mcpSubdirs(p)) {
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      created.push(dir);
    }
    await chmod(dir, 0o700);
  }
  return created;
}
