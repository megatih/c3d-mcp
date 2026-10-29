import { connect } from './live-driver.mjs';
import { mkdirSync } from 'node:fs';
const { call, close } = await connect();
const out = '/tmp/polymat/' + Date.now(); mkdirSync(out, { recursive: true });
const must = async (l, n, a) => { const r = await call(n, a); if (r.isError) { console.log('FAIL', l, JSON.stringify(r.sc).slice(0, 400)); throw new Error(l); } return r; };
await must('new', 'c3d_new_document', {});
const code = `
function em(name, c) { var m = doc.addMaterial('Material', name), r = m.rootNode(); r.setParameter('diffColor', new Vec4D(c[0], c[1], c[2], 1)); r.setParameter('emisColor', new Vec4D(c[0], c[1], c[2], 1)); return m; }
var R = em('PM_R', [1, 0, 0]), G = em('PM_G', [0, 1, 0]), B = em('PM_B', [0, 0, 1]);
var o = doc.addObject(POLYGONOBJECT_PLACEHOLDER); o.setParameter('name', 'Strip'); var core = o.core();
var xs = [-3, -1, 1, 3], i;
for (i = 0; i < 4; i++) { core.addVertex(false, new Vec3D(xs[i], -1, 0)); }
for (i = 0; i < 4; i++) { core.addVertex(false, new Vec3D(xs[i], 1, 0)); }
// three quads facing +Z (counter-clockwise seen from +Z)
core.addIndexPolygon(4, [0, 1, 5, 4]); core.addIndexPolygon(4, [1, 2, 6, 5]); core.addIndexPolygon(4, [2, 3, 7, 6]);
// selection slot k holds polygon k-1 (slot 0 holds polygon 0)
var slots = [[0], [0], [1], [2]];
for (var k = 0; k < slots.length; k++) { core.setActivePolygonSelection(k); for (var p = 0; p < 3; p++) { core.setPolygonSelection(p, slots[k].indexOf(p) >= 0); } }
core.setActivePolygonSelection(0);
o.update();
var t = o.addTagOfType(SHADERTAG); t.setParameter('material', R);
return { id: o.id(), polys: core.polygonCount() };`.replace('POLYGONOBJECT_PLACEHOLDER', 'POLYGONOBJ');
const r = await must('build', 'c3d_run_script', { code }); const id = r.sc.value.id; console.log('built', JSON.stringify(r.sc.value));
await must('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 0, 9], look_at_point: [0, 0, 0], fov: 35, active: true, params: { backgroundColor: [0.15, 0.15, 0.2, 1], cameraLightOnOff: 0 } });
await must('rs', 'c3d_set_render_settings', { width: 300, height: 120, params: { giOn: false } });
const files = [];
for (const s of [0, 1, 2, 3, 4]) {
  await must('sel', 'c3d_set_tag_params', { ref: { id }, tag_index: 1, params: { shadeSelection: s } });
  await must('r', 'c3d_render_image', { path: `${out}/s${s}.png` }); files.push(`shadeSelection=${s}=${out}/s${s}.png`);
}
console.log('GRID', files.join(' ')); console.log('OUT', out);
await close();
