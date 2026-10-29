import { BridgeError, type ErrorCode, type ToolContext } from '../toolkit.js';

export interface ApplyResult { applied: string[]; errors: Array<{ name: string; code?: string; message?: string }>; [k: string]: unknown }

/** Runs a parameter-writing op, tolerating partial success ({applied, errors}). Throws only when nothing was applied. */
export async function runApply(ctx: ToolContext, op: string, args: Record<string, unknown>): Promise<ApplyResult> {
  const r = (await ctx.bridge.run([{ op, args }])).results[0];
  if (!r) throw new BridgeError('INTERNAL', `No result for ${op}.`);
  const res = (r.result ?? {}) as Partial<ApplyResult>;
  if (r.ok) return { applied: [], errors: [], ...res };
  const errors = res.errors ?? [];
  const applied = res.applied ?? [];
  if (applied.length > 0 && errors.length > 0) return { ...res, applied, errors };
  const first = errors[0];
  const code = ((first?.code ?? r.error?.code) as ErrorCode | undefined) ?? 'INVALID_ARGUMENT';
  throw new BridgeError(code, first ? `${first.name}: ${first.message ?? 'rejected'}` : (r.error?.message ?? `${op} failed`), r.error?.hint ?? 'Read valid names/types with c3d_get_parameters first.', { errors, ...(r.error?.details as object | undefined) });
}

export function applyText(what: string, r: ApplyResult): string {
  return `${what}: applied ${r.applied.length}${r.errors.length ? `, ${r.errors.length} rejected (${r.errors.map((e) => e.name).join(', ')})` : ''}.`;
}
