// Scene dump: everything the assertions need, gathered through the same MCP tools an agent would use.
const MARKER = /^__c3d_mcp_session_/;

export async function dumpScene(call, { keyframeParams = [] } = {}) {
  const objects = [];
  let offset = 0;
  for (;;) {
    const page = await call('c3d_list_scene', { depth: 32, offset, limit: 500, response_format: 'detailed' });
    if (page.isError) throw new Error(`list_scene failed: ${JSON.stringify(page.sc)}`);
    objects.push(...page.sc.items);
    if (page.sc.next_offset == null) break;
    offset = page.sc.next_offset;
  }
  const items = objects.filter((o) => !MARKER.test(o.name));
  for (const o of items) {
    const d = await call('c3d_get_object', { ref: { id: o.id }, include: ['parameters', 'tags', 'bbox', 'worldMatrix', 'materials'], response_format: 'detailed' });
    if (d.isError) { o.error = d.sc; continue; }
    Object.assign(o, d.sc.object);
    o.params = Object.fromEntries((d.sc.object.parameters ?? []).map((p) => [p.name, p.value]));
  }
  const matList = await call('c3d_list_materials', { limit: 200, response_format: 'detailed' });
  const materials = matList.isError ? [] : matList.sc.materials ?? [];
  for (const m of materials) {
    const g = await call('c3d_get_material_graph', { material: { name: m.name }, response_format: 'detailed' });
    m.graph = g.isError ? null : g.sc;
  }
  const info = await call('c3d_get_document_info');
  const keyframes = {};
  for (const o of items) {
    for (const p of keyframeParams) {
      const k = await call('c3d_get_keyframes', { ref: { id: o.id }, param: p });
      if (!k.isError) keyframes[`${o.id}:${p}`] = k.sc;
    }
  }
  return { objects: items, materials, document: info.isError ? null : info.sc.document, keyframes };
}

/** Parameter value of an object at a time: the runner moves time itself, then restores 0. */
export async function paramAtTime(call, obj, param, time) {
  await call('c3d_set_time', { time });
  const r = await call('c3d_get_parameters', { ref: { id: obj.id }, names: [param] });
  await call('c3d_set_time', { time: 0 });
  return r.isError ? undefined : r.sc.parameters?.[0]?.value;
}

function mulRows(rows, v) { return [0, 1, 2].map((i) => rows[i][0] * v[0] + rows[i][1] * v[1] + rows[i][2] * v[2]); }

/** World-space AABB of an object from its local bbox, scale-carrying world matrix and position. */
export function worldBox(o) {
  if (!o.bbox || !o.worldMatrix) return null;
  const { min, max } = o.bbox; const { rows, position } = o.worldMatrix;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    const w = mulRows(rows, [x, y, z]).map((c, i) => c + [position.x, position.y, position.z][i]);
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], w[i]); hi[i] = Math.max(hi[i], w[i]); }
  }
  return { lo, hi };
}
