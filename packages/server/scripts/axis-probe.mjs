import { connect } from './live-driver.mjs';
import { mkdirSync } from 'node:fs';
const { call, close } = await connect();
const out = '/tmp/axis/' + Date.now(); mkdirSync(out, { recursive: true });
const must = async (l, n, a) => { const r = await call(n, a); if (r.isError) { console.log('FAIL', l, JSON.stringify(r.sc).slice(0, 300)); throw new Error(l); } return r; };
await must('new', 'c3d_new_document', {});
await must('floor', 'c3d_create_object', { type: 'BOX', name: 'Floor', position: [0, -0.05, 0], params: { sizeX: 12, sizeY: 0.1, sizeZ: 12 } });
await must('pole', 'c3d_create_object', { type: 'BOX', name: 'Pole', position: [0, 1.5, 0], params: { sizeX: 0.5, sizeY: 3, sizeZ: 0.5 } });
const l = (await must('light', 'c3d_set_light', { name: 'Sun', light_type: 'distant', position: [0, 6, 0], intensity: 1.2, color: [1, 1, 1, 1] })).sc.object.id;
await must('tr', 'c3d_set_transform', { ref: { id: l }, rotation: { x: 0, y: 0, z: 0 } });
await must('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 14, 0.01], look_at_point: [0, 0, 0], fov: 40, active: true, params: { backgroundColor: [0.1, 0.1, 0.1, 1] } });
await must('rs', 'c3d_set_render_settings', { width: 320, height: 320, params: { giOn: false, shadowsOn: true } });
for (const rx of [90, -90]) {
  await must('tr', 'c3d_set_transform', { ref: { id: l }, rotation: { x: 0, y: rx, z: 0 } });
  for (let a = 0; a <= 5; a++) {
    await must('axis', 'c3d_set_parameters', { ref: { id: l }, params: { axis: a } });
    const r = await must('render', 'c3d_render_image', { path: `${out}/axis${a}_rx${rx}.png` });
    console.log('rotation x', rx, 'axis', a, 'luma', r.sc.meanLuma.toFixed(3));
  }
}
console.log('OUT', out);
await close();
