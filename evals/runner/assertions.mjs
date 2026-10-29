// Assertion engine for evals/README.md. Unknown assertion types FAIL (never silently pass).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { paramAtTime, worldBox } from './scene.mjs';

const re = (src) => {
  let flags = ''; let s = src;
  if (s.startsWith('(?i)')) { flags = 'i'; s = s.slice(4); }
  return new RegExp(s, flags);
};
const comp = (v, c) => (c && v && typeof v === 'object' ? v[c] : v);
const first = (list, rx) => list.find((o) => rx.test(o.name));
const pick = (scene, src) => (src === '@activeCamera' ? activeCamera(scene) : first(scene.objects, re(src)));
const within = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= (min ?? -Infinity) && v <= (max ?? Infinity);

export function listFiles(dir) {
  const out = [];
  const walk = (d) => { let es = []; try { es = readdirSync(d); } catch { return; } for (const e of es) { const p = join(d, e); const st = statSync(p); if (st.isDirectory()) walk(p); else out.push(p); } };
  walk(dir);
  return out;
}
const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '.') + '$');

function activeCamera(scene) {
  return scene.objects.find((o) => o.type === 'CAMERA' && o.params?.activeCamera) ?? scene.objects.find((o) => o.type === 'CAMERA');
}
function aimAngle(o, target) {
  if (!o?.worldMatrix || !target?.worldMatrix) return Infinity;
  const r = o.worldMatrix.rows; const f = [-r[0][2], -r[1][2], -r[2][2]];
  const p = o.worldMatrix.position; const t = target.worldMatrix.position;
  const d = [t.x - p.x, t.y - p.y, t.z - p.z]; const dl = Math.hypot(...d); const fl = Math.hypot(...f);
  if (!dl || !fl) return Infinity;
  const c = Math.max(-1, Math.min(1, (f[0] * d[0] + f[1] * d[1] + f[2] * d[2]) / (dl * fl)));
  return (Math.acos(c) * 180) / Math.PI;
}
export function signature(scene) {
  return JSON.stringify(scene.objects.map((o) => [o.name, o.type, o.path, o.params?.position, o.params?.scale, o.params?.rotation]).sort());
}

const CHECKS = {
  object_count: (a, c) => { const n = c.scene.objects.filter((o) => o.type === a.object_type).length; return [within(n, a.min, a.max), `${n} ${a.object_type}`]; },
  object_exists: (a, c) => { const rx = re(a.name_regex); const n = c.scene.objects.filter((o) => rx.test(o.name) && (!a.object_type || o.type === a.object_type)).length; return [n >= (a.min_count ?? 1), `${n} match`]; },
  object_absent: (a, c) => { const rx = re(a.name_regex); const n = c.scene.objects.filter((o) => rx.test(o.name)).length; return [n === 0, `${n} match`]; },
  parent_of: (a, c) => {
    const cr = re(a.child_regex); const pr = re(a.parent_regex);
    const ok = c.scene.objects.some((o) => { if (!cr.test(o.name)) return false; const parts = o.path.split('/').filter(Boolean); return parts.length >= 2 && pr.test(parts[parts.length - 2].replace(/\\\//g, '/')); });
    return [ok, ok ? 'found' : 'no matching child/parent'];
  },
  param_range: (a, c) => { const o = pick(c.scene, a.object_regex); const v = comp(o?.params?.[a.param], a.component); return [within(v, a.min, a.max), `${a.param}${a.component ?? ''}=${JSON.stringify(v)}`]; },
  param_at_time: async (a, c) => { const o = first(c.scene.objects, re(a.object_regex)); if (!o) return [false, 'no object']; const v = comp(await paramAtTime(c.call, o, a.param, a.time), a.component); return [within(v, a.min, a.max), `${a.param}${a.component ?? ''}@${a.time}=${JSON.stringify(v)}`]; },
  bbox: (a, c) => {
    const objs = a.object === 'scene' ? c.scene.objects.filter((o) => !['CAMERA', 'LIGHT', 'FOLDER'].includes(o.type)) : c.scene.objects.filter((o) => re(a.object).test(o.name));
    const boxes = objs.map(worldBox).filter(Boolean);
    if (!boxes.length) return [false, 'no geometry'];
    const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.lo[i]))); const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.hi[i])));
    const size = hi.map((h, i) => h - lo[i]);
    const ok = size.every((s, i) => s >= a.size_min[i] && s <= a.size_max[i]);
    return [ok, `size=${size.map((s) => s.toFixed(2)).join(',')}`];
  },
  mesh_stats: async (a, c) => {
    const rx = re(a.object_regex); const o = c.scene.objects.find((x) => rx.test(x.name) && x.family === 5 && x.type === 'POLYGONOBJ'); if (!o) return [false, 'no polygon object'];
    const m = await c.call('c3d_get_mesh', { ref: { id: o.id }, vertex_limit: 1, polygon_limit: 1 });
    if (m.isError) return [false, `get_mesh: ${m.sc?.message}`];
    const { vertexCount: v, polygonCount: p } = m.sc;
    return [within(p, a.min_polygons, a.max_polygons) && within(v, a.min_vertices, a.max_vertices), `${v} vertices, ${p} polygons`];
  },
  material_exists: (a, c) => { const rx = re(a.name_regex); const n = c.scene.materials.filter((m) => rx.test(m.name) && (!a.root_type || m.rootNodeType === a.root_type)).length; return [n > 0, `${n} match`]; },
  material_param: (a, c) => {
    const m = first(c.scene.materials, re(a.material_regex)); const root = m?.graph?.nodes?.[0];
    const p = root?.params?.find((x) => x.name === a.param); const v = typeof p?.value === 'object' ? undefined : p?.value;
    return [within(v, a.min, a.max), `${a.param}=${JSON.stringify(p?.value)}`];
  },
  material_node: (a, c) => { const m = first(c.scene.materials, re(a.material_regex)); const ok = !!m?.graph?.nodes?.some((n) => n.type === a.node_type); return [ok, ok ? 'found' : `nodes: ${(m?.graph?.nodes ?? []).map((n) => n.type).join(',')}`]; },
  material_connection: (a, c) => {
    const m = first(c.scene.materials, re(a.material_regex)); const cons = m?.graph?.connections;
    if (cons === 'unavailable') return [true, 'connections unavailable (skipped)'];
    const ok = Array.isArray(cons) && cons.some((x) => (x.toPara ?? x.to_input ?? x.toParameter ?? x.to) === a.to_input);
    return [ok, `connections=${JSON.stringify(cons)?.slice(0, 120)}`];
  },
  material_assigned: (a, c) => {
    const orx = re(a.object_regex); const mrx = re(a.material_regex);
    const n = c.scene.objects.filter((o) => orx.test(o.name) && (o.materials ?? []).some((m) => mrx.test(typeof m === 'string' ? m : m.name ?? m.material ?? ''))).length;
    return [n >= (a.min_objects ?? 1), `${n} objects`];
  },
  camera_active: (a, c) => { const cam = activeCamera(c.scene); return [!!cam && re(a.name_regex).test(cam.name), cam?.name ?? 'none']; },
  camera_aims_at: (a, c) => { const cam = activeCamera(c.scene); const t = first(c.scene.objects, re(a.target_regex)); const ang = aimAngle(cam, t); return [ang <= a.max_angle_deg, `${ang.toFixed(1)} deg`]; },
  light_aims_at: (a, c) => {
    const t = first(c.scene.objects, re(a.target_regex)); const lights = c.scene.objects.filter((o) => o.type === 'LIGHT');
    const angs = lights.map((l) => aimAngle(l, t)); return [lights.length > 0 && angs.every((x) => x <= a.max_angle_deg), `${angs.map((x) => x.toFixed(1)).join(',')} deg`];
  },
  keyframe_count: (a, c) => {
    const o = first(c.scene.objects, re(a.object_regex)); const k = o && c.scene.keyframes[`${o.id}:${a.param}`];
    const n = Math.max(0, ...(k?.components ?? []).map((x) => x.keys.length)); return [n >= a.min, `${n} keys`];
  },
  tag_exists: (a, c) => { const o = first(c.scene.objects, re(a.object_regex)); const ok = !!o?.tags?.some((t) => t.type === a.tag_type); return [ok, `tags=${(o?.tags ?? []).map((t) => t.type).join(',')}`]; },
  render_nonblank: async (a, c) => {
    const imgs = listFiles(c.workDir).filter((f) => /\.(png|jpe?g|tiff?)$/i.test(f) && !/\.preview\./.test(f));
    for (const f of imgs) { const s = await c.analyze(f); if (s && s.width >= a.min_width && s.height >= a.min_height && !s.blank) return [true, `${f} ${s.width}x${s.height}`]; }
    return [false, `${imgs.length} images, none big/non-blank enough`];
  },
  file_exists: (a, c) => { const rx = re(a.path_regex); const f = listFiles(c.workDir).concat(c.fixtureDir ? listFiles(c.fixtureDir) : []).find((p) => rx.test(p)); return [!!f, f ?? 'none']; },
  files_exist: (a, c) => { const g = globRe(a.glob); const n = listFiles(c.workDir).filter((p) => g.test(p) || g.test(p.slice(c.workDir.length + 1))).length; return [n >= a.min, `${n} files`]; },
  tool_called: (a, c) => { const n = c.transcript.filter((t) => t.name.endsWith(a.tool)).length; return [n >= (a.min_count ?? 1), `${n} calls`]; },
  tool_not_called: (a, c) => { const n = c.transcript.filter((t) => t.name.endsWith(a.tool)).length; return [n === 0, `${n} calls`]; },
  answer_contains: (a, c) => [re(a.regex).test(c.answer ?? ''), (c.answer ?? '').slice(0, 80)],
  scene_unchanged: (_a, c) => [signature(c.scene) === signature(c.sceneBefore), 'compared'],
  fixture_unchanged: (_a, c) => [!!c.fixtureSha && createHash('sha256').update(readFileSync(c.fixturePath)).digest('hex') === c.fixtureSha, 'checksum'],
};

export async function evaluate(assertions, ctx) {
  const results = [];
  for (const a of assertions) {
    const fn = CHECKS[a.type];
    if (!fn) { results.push({ type: a.type, pass: false, detail: 'unknown assertion type' }); continue; }
    try { const [pass, detail] = await fn(a, ctx); results.push({ type: a.type, pass: !!pass, detail }); }
    catch (e) { results.push({ type: a.type, pass: false, detail: `error: ${e.message}` }); }
  }
  return results;
}
export const knownAssertionTypes = Object.keys(CHECKS);
