import { ZodError } from 'zod';
import { BridgeError, type ErrorCode } from '../toolkit.js';

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  hint?: string;
  details?: unknown;
}

/** Maps anything thrown by a tool into the documented error shape. Stacks never leave the process. */
export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof BridgeError) return { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}), ...(err.details !== undefined ? { details: err.details } : {}) };
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message }));
    return {
      code: 'INVALID_ARGUMENT',
      message: `Invalid arguments: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
      hint: 'Fix the listed fields and call the tool again.',
      details: { issues },
    };
  }
  if (err instanceof Error && err.name === 'AbortError') return { code: 'CANCELLED', message: 'The call was cancelled' };
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'INTERNAL', message: `Internal error: ${message.slice(0, 300)}`, hint: 'Run c3d_doctor; if it persists, check ~/Library/Logs/c3d-mcp/.' };
}
