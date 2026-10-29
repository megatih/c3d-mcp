import { connect } from './live-driver.mjs';
import { mkdirSync } from 'node:fs';
const { call, close } = await connect();
const out = '/tmp/axis2/' + Date.now(); mkdirSync(out, { recursive: true });
const must = async (l, n, a) => { const r = await call(n, a); if (r.isError) { console.log('FAIL', l, JSON.stringify(r.sc).slice(0, 300)); throw new Error(l); } return r; };
await must('new', 'c3d_new_document', {});
await must('ball', 'c3d_create_object', { type: 'BALL', name: 'Ball', position: [0, 0, 0], params: { radius: 1.5, sections: 48, spans: 32 } });
const l = (await must('light', 'c3d_set_light', { name: 'Sun', light_type: 'distant', position: [0, 0, 8], intensity: 1, color: [1, 1, 1, 1] })).sc.object.id;
await must('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 0, 9], look_at_point: [0, 0, 0], fov: 30, active: true, params: { backgroundColor: [0.05, 0.05, 0.07, 1], cameraLightOnOff: 0 } });
await must('rs', 'c3d_set_render_settings', { width: 200, height: 200, params: { giOn: false, shadowsOn: true } });
const files = [];
for (let a = 0; a <= 5; a++) {
  await must('axis', 'c3d_set_parameters', { ref: { id: l }, params: { axis: a } });
  const r = await must('render', 'c3d_render_image', { path: `${out}/a${a}.png` }); files.push(`axis${a}=${out}/a${a}.png`);
  console.log('axis', a, 'luma', r.sc.meanLuma.toFixed(3));
}
console.log('FILES', files.join(' ')); console.log('OUT', out);
await close();
