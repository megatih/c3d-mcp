import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { backup } from './clientConfigs.js';

/** Claude Code permission rules covering every c3d tool: the standalone server and the same server inside the c3d-mcp plugin. */
export const CLAUDE_CODE_RULES: readonly string[] = ['mcp__c3d', 'mcp__plugin_c3d-mcp_c3d'];

export type PermissionsStatus = 'added' | 'removed' | 'unchanged' | 'would-add' | 'would-remove' | 'declined' | 'refused';

export interface PermissionsResult {
  status: PermissionsStatus;
  target: string;
  rules: string[];
  backup?: string;
  detail: string;
}

export interface PermissionsOptions {
  home?: string;
  dryRun?: boolean;
  /** Asked before the file is changed. Without it nothing is written. */
  confirm?: (question: string) => Promise<boolean>;
  now?: () => Date;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const claudeSettingsPath = (home: string = homedir()): string => join(home, '.claude', 'settings.json');

async function load(target: string): Promise<{ text?: string; doc: Record<string, unknown> } | { error: string }> {
  const text = await readFile(target, 'utf8').catch(() => undefined);
  if (text === undefined) return { doc: {} };
  if (text.trim() === '') return { text, doc: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: `${target} is not valid JSON (${err instanceof Error ? err.message : String(err)}); left untouched.` };
  }
  return isRecord(parsed) ? { text, doc: parsed } : { error: `${target} does not contain a JSON object; left untouched.` };
}

/**
 * Adds (allow) or removes (revoke) the c3d rules in `permissions.allow` of ~/.claude/settings.json so Claude Code stops asking before every
 * c3d tool call. Other settings and other rules are preserved; the file is backed up first; nothing is written without confirmation.
 */
export async function setClaudeCodeAllow(mode: 'allow' | 'revoke', o: PermissionsOptions = {}): Promise<PermissionsResult> {
  const target = claudeSettingsPath(o.home);
  const rules = [...CLAUDE_CODE_RULES];
  const loaded = await load(target);
  if ('error' in loaded) return { status: 'refused', target, rules, detail: loaded.error };
  const { doc, text } = loaded;
  if (doc.permissions !== undefined && !isRecord(doc.permissions)) return { status: 'refused', target, rules, detail: `"permissions" in ${target} is not an object; left untouched.` };
  const perms = doc.permissions ?? {};
  if (perms.allow !== undefined && !Array.isArray(perms.allow)) return { status: 'refused', target, rules, detail: `"permissions.allow" in ${target} is not a list; left untouched.` };
  const allow: unknown[] = perms.allow ?? [];
  const next = mode === 'allow' ? [...allow, ...rules.filter((r) => !allow.includes(r))] : allow.filter((r) => typeof r !== 'string' || !rules.includes(r));
  if (next.length === allow.length) return { status: 'unchanged', target, rules, detail: mode === 'allow' ? 'already allowed' : 'no c3d rules present' };
  if (o.dryRun) return { status: mode === 'allow' ? 'would-add' : 'would-remove', target, rules, detail: `would ${mode === 'allow' ? 'add' : 'remove'} ${rules.join(', ')} ${mode === 'allow' ? 'to' : 'from'} permissions.allow in ${target}` };
  const question = mode === 'allow'
    ? `Let Claude Code run every c3d tool without asking (adds ${rules.join(' and ')} to permissions.allow in ${target})?`
    : `Remove the c3d rules from permissions.allow in ${target}?`;
  if (!o.confirm || !(await o.confirm(question))) return { status: 'declined', target, rules, detail: 'not confirmed; nothing was changed' };
  let bak: string | undefined;
  if (text !== undefined) bak = await backup(target, (o.now ?? ((): Date => new Date()))());
  else await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify({ ...doc, permissions: { ...perms, allow: next } }, null, 2)}\n`);
  return { status: mode === 'allow' ? 'added' : 'removed', target, rules, ...(bak ? { backup: bak } : {}), detail: mode === 'allow' ? 'c3d tools are now allowed' : 'c3d rules removed' };
}
