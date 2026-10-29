import { connect } from './live-driver.mjs';
import { mkdirSync } from 'node:fs';
const { call, close } = await connect();
const out = '/tmp/polymat2/' + Date.now(); mkdirSync(out, { recursive: true });
const must = async (l, n, a) => { const r = await call(n, a); if (r.isError) { console.log('FAIL', l, JSON.stringify(r.sc).slice(0, 300)); throw new Error(l); } return r; };
await must('new', 'c3d_new_document', {});
for (const [n, c] of [['PR', [1, 0, 0, 1]], ['PG', [0, 1, 0, 1]], ['PB', [0, 0, 1, 1]], ['PY', [1, 1, 0, 1]]]) { await must('m', 'c3d_create_material', { name: n, color: c }); await must('e', 'c3d_set_material_params', { material: { name: n }, params: { emisColor: c } }); }
const strip = (await must('mesh', 'c3d_create_mesh', { name: 'Strip', vertices: [[-3, -1, 0], [-1, -1, 0], [1, -1, 0], [3, -1, 0], [-3, 1, 0], [-1, 1, 0], [1, 1, 0], [3, 1, 0]], polygons: [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6]] })).sc.object.id;
for (const [i, m] of ['PR', 'PG', 'PB'].entries()) { const r = await must('assign', 'c3d_assign_material', { ref: { id: strip }, material: { name: m }, polygons: [i] }); console.log('strip poly', i, m, '->', JSON.stringify({ slot: r.sc.slot, tag: r.sc.tagIndex })); }
const box = (await must('box', 'c3d_create_object', { type: 'BOX', name: 'Cube', position: [0, -3, 0], params: { sizeX: 2, sizeY: 2, sizeZ: 2 } })).sc.object.id;
const bad = await call('c3d_assign_material', { ref: { id: box }, material: { name: 'PY' }, polygons: [0] }); console.log('primitive without make_editable ->', bad.isError ? JSON.stringify(bad.sc).slice(0, 160) : 'ACCEPTED (unexpected)');
await must('edit', 'c3d_make_editable', { ref: { id: box } });
const top = await must('mesh', 'c3d_get_mesh', { ref: { id: box }, vertex_limit: 1, polygon_limit: 1 }); console.log('cube polygons', top.sc.polygonCount);
const r2 = await must('assign cube', 'c3d_assign_material', { ref: { id: box }, material: { name: 'PY' }, polygons: [0, 1, 2] }); console.log('cube 3 faces ->', JSON.stringify({ slot: r2.sc.slot }));
await must('cam', 'c3d_set_camera', { name: 'Cam', position: [0, -1, 10], look_at_point: [0, -1.5, 0], fov: 45, active: true, params: { backgroundColor: [0.15, 0.15, 0.2, 1], cameraLightOnOff: 0 } });
await must('rs', 'c3d_set_render_settings', { width: 360, height: 270, params: { giOn: false } });
await must('render', 'c3d_render_image', { path: `${out}/result.png` }); console.log('OUT', out);
await close();
