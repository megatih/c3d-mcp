// Detects MCP clients and adds the c3d server entry to their configuration, idempotently and with a backup.
// A file that cannot be parsed is reported, never rewritten; an existing `c3d` entry is never replaced without an explicit yes.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { configSnippet, type SnippetOptions } from './configSnippets.js';
import { systemExec, type Executor } from './platform.js';

/** Clients the wizard can configure (LM Studio has no stable detection and is left to `c3d-mcp config`). */
export const SETUP_CLIENTS = ['claude-desktop', 'claude-code', 'codex', 'antigravity', 'gemini-cli', 'cursor'] as const;
export type SetupClient = (typeof SETUP_CLIENTS)[number];

export const CLIENT_LABELS: Record<SetupClient, string> = {
  'claude-desktop': 'Claude Desktop',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity CLI',
  'gemini-cli': 'Gemini CLI',
  cursor: 'Cursor',
};

export interface ClientDetection { client: SetupClient; detected: boolean; detail: string }

export interface DetectDeps {
  home: string;
  exec?: Executor;
  exists?: (path: string) => boolean;
}

async function onPath(exec: Executor, bin: string): Promise<string | undefined> {
  const r = await exec('/bin/sh', ['-c', `command -v ${bin}`], { timeoutMs: 5000 });
  const p = r.stdout.trim();
  return r.code === 0 && p ? p : undefined;
}

export async function detectClients(deps: DetectDeps): Promise<ClientDetection[]> {
  const exec = deps.exec ?? systemExec;
  const exists = deps.exists ?? existsSync;
  const { home } = deps;
  const out: ClientDetection[] = [];
  const add = (client: SetupClient, found: string | undefined): void => {
    out.push({ client, detected: found !== undefined, detail: found ?? 'not found' });
  };
  const desktop = join(home, 'Library', 'Application Support', 'Claude');
  add('claude-desktop', exists(desktop) ? desktop : undefined);
  add('claude-code', await onPath(exec, 'claude'));
  const codexDir = join(home, '.codex');
  add('codex', exists(codexDir) ? codexDir : await onPath(exec, 'codex'));
  const agyDir = join(home, '.gemini', 'config');
  add('antigravity', (await onPath(exec, 'agy')) ?? (exists(agyDir) ? agyDir : undefined));
  const geminiSettings = join(home, '.gemini', 'settings.json');
  add('gemini-cli', (await onPath(exec, 'gemini')) ?? (exists(geminiSettings) ? geminiSettings : undefined));
  const cursorDir = join(home, '.cursor');
  add('cursor', exists(cursorDir) ? cursorDir : undefined);
  return out;
}

export type ConfigureStatus = 'added' | 'replaced' | 'unchanged' | 'exists' | 'would-add' | 'refused' | 'failed';
export interface ConfigureResult {
  client: SetupClient;
  status: ConfigureStatus;
  /** Config file written (or the command run for Claude Code). */
  target: string;
  backup?: string;
  detail: string;
}

export interface ConfigureOptions {
  home: string;
  /** Launch form: `{ form: 'absolute', nodePath, binPath }` or the default npx form. */
  launch?: SnippetOptions;
  dryRun?: boolean;
  exec?: Executor;
  now?: () => Date;
  /** Asked only when a different `c3d` entry already exists; without it (or on false) the entry is kept. */
  confirmOverwrite?: (client: SetupClient, target: string) => Promise<boolean>;
}

const SERVER = 'c3d';

function timestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

async function backup(path: string, now: Date): Promise<string> {
  const dest = `${path}.c3d-backup-${timestamp(now)}`;
  await copyFile(path, dest);
  return dest;
}

async function readIfExists(path: string): Promise<string | undefined> {
  return readFile(path, 'utf8').catch(() => undefined);
}

async function configureJson(client: SetupClient, target: string, o: ConfigureOptions): Promise<ConfigureResult> {
  const snippet = JSON.parse(configSnippet(client, { ...o.launch, serverName: SERVER, home: o.home }).text) as { mcpServers: Record<string, unknown> };
  const entry = snippet.mcpServers[SERVER];
  const text = await readIfExists(target);
  let doc: Record<string, unknown> = {};
  if (text !== undefined && text.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { client, status: 'refused', target, detail: `${target} is not valid JSON (${err instanceof Error ? err.message : String(err)}); left untouched. Add the entry by hand: c3d-mcp config ${client}` };
    }
    if (!isRecord(parsed)) return { client, status: 'refused', target, detail: `${target} does not contain a JSON object; left untouched.` };
    doc = parsed;
  }
  if (doc.mcpServers !== undefined && !isRecord(doc.mcpServers)) return { client, status: 'refused', target, detail: `"mcpServers" in ${target} is not an object; left untouched.` };
  const servers = (doc.mcpServers ?? {});
  const present = SERVER in servers;
  if (present && same(servers[SERVER], entry)) return { client, status: 'unchanged', target, detail: 'already configured' };
  let replace = false;
  if (present) {
    replace = o.confirmOverwrite ? await o.confirmOverwrite(client, target) : false;
    if (!replace) return { client, status: 'exists', target, detail: `a "${SERVER}" entry with different settings already exists; kept (replace it by hand or answer yes when asked)` };
  }
  if (o.dryRun) return { client, status: 'would-add', target, detail: `would ${replace ? 'replace' : 'add'} "${SERVER}" in ${target}` };
  let bak: string | undefined;
  if (text !== undefined) bak = await backup(target, (o.now ?? ((): Date => new Date()))());
  else await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify({ ...doc, mcpServers: { ...servers, [SERVER]: entry } }, null, 2)}\n`);
  return { client, status: replace ? 'replaced' : 'added', target, ...(bak ? { backup: bak } : {}), detail: replace ? 'replaced existing entry' : 'added' };
}

const TOML_HEADER = /^\s*\[\s*mcp_servers\s*\.\s*(?:c3d|"c3d")\s*\]\s*(?:#.*)?$/m;
const ANY_HEADER = /^\s*\[/;

/** Removes the `[mcp_servers.c3d]` table (and sub-tables) from TOML text. */
function stripTomlSection(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (TOML_HEADER.test(line) || (skipping && /^\s*\[\s*mcp_servers\s*\.\s*(?:c3d|"c3d")\s*\./.test(line))) {
      skipping = true;
      continue;
    }
    if (skipping && ANY_HEADER.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

async function configureToml(client: SetupClient, target: string, o: ConfigureOptions): Promise<ConfigureResult> {
  const block = configSnippet(client, { ...o.launch, serverName: SERVER, home: o.home }).text;
  const text = await readIfExists(target);
  if (text !== undefined && (text.includes('\0') || /^\s*\{/.test(text))) return { client, status: 'refused', target, detail: `${target} does not look like TOML; left untouched. Add the entry by hand: c3d-mcp config ${client}` };
  const present = text !== undefined && TOML_HEADER.test(text);
  let base = text ?? '';
  let replace = false;
  if (present) {
    replace = o.confirmOverwrite ? await o.confirmOverwrite(client, target) : false;
    if (!replace) return { client, status: 'exists', target, detail: `a [mcp_servers.${SERVER}] section already exists; kept` };
    base = stripTomlSection(base);
  }
  if (o.dryRun) return { client, status: 'would-add', target, detail: `would ${replace ? 'replace' : 'append'} [mcp_servers.${SERVER}] in ${target}` };
  let bak: string | undefined;
  if (text !== undefined) bak = await backup(target, (o.now ?? ((): Date => new Date()))());
  else await mkdir(dirname(target), { recursive: true });
  const trimmed = base.replace(/\s+$/, '');
  await writeFile(target, `${trimmed ? `${trimmed}\n\n` : ''}${block}`);
  return { client, status: replace ? 'replaced' : 'added', target, ...(bak ? { backup: bak } : {}), detail: replace ? 'replaced existing section' : 'appended' };
}

async function configureClaudeCode(o: ConfigureOptions): Promise<ConfigureResult> {
  const exec = o.exec ?? systemExec;
  const client: SetupClient = 'claude-code';
  const snippet = configSnippet('claude-code', { ...o.launch, serverName: SERVER, home: o.home });
  const entry = (JSON.parse(snippet.text) as { mcpServers: Record<string, { command: string; args: string[] }> }).mcpServers[SERVER] as { command: string; args: string[] };
  const cmd = ['mcp', 'add', '--scope', 'user', SERVER, '--', entry.command, ...entry.args];
  const shown = `claude ${cmd.join(' ')}`;
  const list = await exec('claude', ['mcp', 'list'], { timeoutMs: 60_000 });
  if (list.code !== 0) return { client, status: 'failed', target: shown, detail: `\`claude mcp list\` failed: ${(list.stderr || list.stdout).trim().slice(0, 200) || `exit ${String(list.code)}`}` };
  const present = /^\s*c3d\s*:/m.test(list.stdout) || /^\s*c3d\s*$/m.test(list.stdout);
  let replace = false;
  if (present) {
    replace = o.confirmOverwrite ? await o.confirmOverwrite(client, 'claude mcp') : false;
    if (!replace) return { client, status: 'exists', target: shown, detail: `"${SERVER}" is already registered in Claude Code; kept` };
  }
  if (o.dryRun) return { client, status: 'would-add', target: shown, detail: `would run: ${shown}` };
  if (replace) await exec('claude', ['mcp', 'remove', '--scope', 'user', SERVER], { timeoutMs: 60_000 });
  const r = await exec('claude', cmd, { timeoutMs: 60_000 });
  if (r.code !== 0) return { client, status: 'failed', target: shown, detail: `claude mcp add failed: ${(r.stderr || r.stdout).trim().slice(0, 200) || `exit ${String(r.code)}`}` };
  return { client, status: replace ? 'replaced' : 'added', target: shown, detail: 'registered with `claude mcp add` (user scope)' };
}

/** Where the client reads its MCP configuration (undefined for Claude Code, which is driven through its CLI). */
export function clientConfigPath(client: SetupClient, home: string): string | undefined {
  if (client === 'claude-code') return undefined;
  return configSnippet(client, { home }).location;
}

export async function configureClient(client: SetupClient, o: ConfigureOptions): Promise<ConfigureResult> {
  try {
    if (client === 'claude-code') return await configureClaudeCode(o);
    const target = clientConfigPath(client, o.home) as string;
    return client === 'codex' ? await configureToml(client, target, o) : await configureJson(client, target, o);
  } catch (err) {
    return { client, status: 'failed', target: clientConfigPath(client, o.home) ?? 'claude mcp add', detail: err instanceof Error ? err.message : String(err) };
  }
}
