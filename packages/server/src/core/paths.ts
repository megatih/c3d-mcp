import { chmod, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BridgeError, type ServerConfig } from '../toolkit.js';

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

function ownedByMe(uid: number): boolean {
  const me = process.getuid?.();
  return me === undefined || uid === me;
}

/** A pre-existing directory is only tightened when it is ours and clearly an MCP mailbox (empty or already holding mailbox entries). */
async function looksLikeMailbox(dir: string): Promise<boolean> {
  const names = await readdir(dir).catch(() => ['?']);
  return names.length === 0 || names.some((n) => ['inbox', 'outbox', 'secret', 'state.json', 'runtime', 'install-manifest.json'].includes(n));
}

/**
 * Creates the mailbox tree with mode 0700 (JS cannot mkdir, PRD rule 3). Returns the directories that did not exist before.
 * Directories that already exist are chmod-ed only when they belong to the current user AND look like a mailbox; a user-supplied
 * C3D_MCP_DIR that points at someone else's (or an unrelated) directory is left alone and later refused by assertPrivateDir.
 */
export async function ensureMcpDirs(p: McpPaths): Promise<string[]> {
  const created: string[] = [];
  for (const dir of mcpSubdirs(p)) {
    const st = await stat(dir).catch(() => undefined);
    if (!st) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
      created.push(dir);
    } else if (ownedByMe(st.uid) && (dir !== p.root || (await looksLikeMailbox(dir)))) {
      await chmod(dir, 0o700);
    }
  }
  return created;
}

/** Refuses to use a mailbox directory that other users could write to (they could forge requests or responses). */
export async function assertPrivateDir(dir: string): Promise<void> {
  const st = await stat(dir).catch(() => undefined);
  if (!st) return;
  if (!ownedByMe(st.uid)) throw new BridgeError('PERMISSION_MISSING', `Mailbox directory ${dir} is owned by another user.`, 'Set C3D_MCP_DIR to a directory you own (default: ~/Library/Application Support/Cheetah3D/MCP).', { dir });
  if ((st.mode & 0o022) !== 0) throw new BridgeError('PERMISSION_MISSING', `Mailbox directory ${dir} is writable by group or others (mode ${(st.mode & 0o777).toString(8)}).`, `Run: chmod 700 "${dir}" (or choose another C3D_MCP_DIR).`, { dir, mode: st.mode & 0o777 });
}
