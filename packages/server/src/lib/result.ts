import type { ToolResult } from '../toolkit.js';

export function ok(structured: Record<string, unknown>, text?: string): ToolResult {
  return text === undefined ? { structured } : { structured, text };
}

export function page<T>(items: T[], offset: number, limit: number): { items: T[]; total: number; next_offset: number | null } {
  const slice = items.slice(offset, offset + limit);
  return { items: slice, total: items.length, next_offset: offset + limit < items.length ? offset + limit : null };
}

/** Drop undefined entries so optional args are not sent to the runtime. */
export function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
