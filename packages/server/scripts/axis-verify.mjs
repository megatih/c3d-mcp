import { connect } from './live-driver.mjs';
import { mkdirSync } from 'node:fs';
const { call, close } = await connect();
const out = '/tmp/axis3/' + Date.now(); mkdirSync(out, { recursive: true });
const must = async (l, n, a) => { const r = await call(n, a); if (r.isError) { console.log('FAIL', l, JSON.stringify(r.sc).slice(0, 300)); throw new Error(l); } return r; };
await must('new', 'c3d_new_document', {});
await must('ball', 'c3d_create_object', { type: 'BALL', name: 'Ball', params: { radius: 1.5, sections: 48, spans: 32 } });
await must('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 0, 9], look_at_point: [0, 0, 0], fov: 30, active: true, params: { backgroundColor: [0.05, 0.05, 0.07, 1], cameraLightOnOff: 0 } });
await must('rs', 'c3d_set_render_settings', { width: 200, height: 200, params: { giOn: false } });
const files = [];
for (const [label, type, pos] of [['distant upper-left', 'distant', [-6, 6, 6]], ['distant lower-right', 'distant', [6, -6, 6]], ['spot upper-left', 'spot', [-6, 6, 6]], ['point upper-left', 'point', [-6, 6, 6]]]) {
  const l = await must('light', 'c3d_set_light', { name: 'L', light_type: type, position: pos, look_at_point: [0, 0, 0], intensity: type === 'point' ? 60 : 1.2, color: [1, 1, 1, 1], params: type === 'spot' ? { cutOffAngle: 40 } : {} });
  const r = await must('render', 'c3d_render_image', { path: `${out}/${label.replace(/ /g, '_')}.png` });
  files.push(`${label}=${out}/${label.replace(/ /g, '_')}.png`); console.log(label, 'residual', l.sc.look_at.residual_deg.toFixed(4), 'luma', r.sc.meanLuma.toFixed(3));
  await must('del', 'c3d_delete_objects', { refs: [{ id: l.sc.object.id }] });
}
console.log('GRID', files.join(' '));
await close();
