// Shared zod fragments for tool input/output schemas.
import { z } from 'zod';
import { BridgeError } from '../toolkit.js';

const strictObj = z.strictObject;

export const ObjectRef = z
  .union([
    z.number().int().describe('Object id (from c3d_list_scene).'),
    z.string().min(1).describe('Path such as "/Table/Leg" (use id when names repeat).'),
    strictObj({ id: z.number().int() }),
    strictObj({ path: z.string().min(1) }),
    strictObj({ indexPath: z.array(z.number().int().min(0)) }),
    strictObj({ selected: z.literal(true) }),
  ])
  .describe('Object reference: integer id (preferred), "/Path/Name", {id}, {path}, {indexPath:[..]} or {selected:true}.');

export type ObjectRefInput = z.infer<typeof ObjectRef>;

export function normRef(r: ObjectRefInput): Record<string, unknown> | string {
  if (typeof r === 'number') return { id: r };
  if (typeof r === 'string') return r.startsWith('$') ? r : { path: r };
  return r;
}

export const MaterialRef = z
  .union([z.string().min(1), z.number().int().min(0), strictObj({ name: z.string().min(1) }), strictObj({ index: z.number().int().min(0) })])
  .describe('Material: name (string), index (integer) or {name}/{index}. Names are unique; "Mat.2" style suffixes may have been added.');
export type MaterialRefInput = z.infer<typeof MaterialRef>;

export function normMat(m: MaterialRefInput): Record<string, unknown> | string {
  if (typeof m === 'number') return { index: m };
  if (typeof m === 'string') return m.startsWith('$') ? m : { name: m };
  return m;
}

const num = z.number();
export const Vec3 = z
  .union([z.tuple([num, num, num]), strictObj({ x: num, y: num, z: num })])
  .describe('3D vector as [x,y,z] or {x,y,z}.');
export const Vec3Mesh = z.tuple([num, num, num]);

export const ParamValue = z
  .union([z.number(), z.string(), z.boolean(), z.null(), z.array(z.number()), z.record(z.string(), z.any())])
  .describe('number | string | boolean | [numbers] | {x,y[,z[,w]]} | {r,g,b,a} | {path} (Texture) | {ref}/null (Link)');
export const ParamMap = z.record(z.string(), ParamValue);

/** Normalises Link values: {ref: 5} / {ref: "/Path"} / {ref: {...}} -> {ref: <runtime object ref>}; everything else passes through. */
export function normParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && 'ref' in v && Object.keys(v).length === 1) {
      const r: unknown = v.ref;
      if (typeof r === 'number' && Number.isInteger(r)) out[k] = { ref: normRef(r) };
      else if (typeof r === 'string' && r.length > 0) out[k] = { ref: normRef(r) };
      else out[k] = v;
    } else out[k] = v;
  }
  return out;
}

export const ResponseFormat = z
  .enum(['concise', 'detailed'])
  .optional()
  .describe('concise (default): short fields only; detailed: everything the runtime returns.');

export const Offset = z.number().int().min(0).optional().describe('Pagination offset (default 0).');
export const Limit = (max: number, def: number) =>
  z.number().int().min(1).max(max).optional().describe(`Page size (default ${def}, max ${max}).`);

export const Confirm = z.boolean().optional().describe('Set true to confirm when the client cannot show a confirmation prompt.');

export const Descriptor = z.looseObject({ id: z.number().int().optional(), name: z.string().optional(), path: z.string().optional(), type: z.string().optional() });
export const AnyObject = z.looseObject({});

export function requireDefined<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new BridgeError('INVALID_ARGUMENT', `${what} is required.`);
  return v;
}

/** Convert vec input to {x,y,z}. */
export function toXyz(v: z.infer<typeof Vec3>): { x: number; y: number; z: number } {
  return Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v;
}

export const Color = z
  .union([
    z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/),
    z.tuple([num, num, num]),
    z.tuple([num, num, num, num]),
    strictObj({ r: num, g: num, b: num, a: num.optional() }),
  ])
  .describe('Color: "#rrggbb[aa]", [r,g,b[,a]] or {r,g,b,a} with 0..1 channels (hex is 0..255).');

export function toColor(c: z.infer<typeof Color>): { r: number; g: number; b: number; a: number } {
  if (typeof c === 'string') {
    const n = (i: number): number => parseInt(c.slice(i, i + 2), 16) / 255;
    return { r: n(1), g: n(3), b: n(5), a: c.length > 7 ? n(7) : 1 };
  }
  if (Array.isArray(c)) return { r: c[0], g: c[1], b: c[2], a: c[3] ?? 1 };
  return { r: c.r, g: c.g, b: c.b, a: c.a ?? 1 };
}
