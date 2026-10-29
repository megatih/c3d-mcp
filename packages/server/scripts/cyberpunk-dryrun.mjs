// Dev: feasibility checks for the cyberpunk diorama port (bulk creation, Toon, emission, folders, GI render time).
import { connect } from './live-driver.mjs';
import { mkdirSync } from 'node:fs';
const { call, close } = await connect();
const out = '/tmp/cyber/' + Date.now(); mkdirSync(out, { recursive: true });
const must = async (label, name, args) => { const r = await call(name, args); if (r.isError) { console.log('FAIL', label, JSON.stringify(r.sc).slice(0, 500)); throw new Error(label); } return r; };
await must('new', 'c3d_new_document', {});
const code = `
function mat(name, kind, c) {
  var m = doc.addMaterial(kind, name), r = m.rootNode();
  if (kind === 'Toon') { r.setParameter('color', new Vec4D(c[0], c[1], c[2], 1)); }
  else if (kind === 'Material (PBR)') { r.setParameter('baseColor', new Vec4D(c[0], c[1], c[2], 1)); }
  else { r.setParameter('diffColor', new Vec4D(c[0], c[1], c[2], 1)); }
  return m;
}
function put(o, m) { var t = o.addTagOfType(SHADERTAG); t.setParameter('material', m); }
var t0 = Date.now();
var folder = doc.addObject(FOLDER); folder.setParameter('name', '05_CANOPIES_ROOFS');
var lav = mat('Lavender', 'Material', [0.66, 0.6, 0.93]);
var rnd = (function () { var s = 12345; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
var n = 0, i, o;
for (i = 0; i < 400; i++) {
  o = doc.addObject(BOX);
  o.setParameter('name', 'Plank ' + i);
  o.setParameter('sizeX', 0.2 + rnd() * 0.15); o.setParameter('sizeY', 0.04 + rnd() * 0.02); o.setParameter('sizeZ', 1.0 + rnd() * 0.4);
  o.setParameter('position', new Vec3D(-3 + (i % 40) * 0.16, 1 + Math.floor(i / 40) * 0.06, 0));
  o.setParameter('bevelRadius', 0.008); o.setParameter('bevelSections', 2);
  put(o, lav); folder.addChildAtIndex(o, folder.childCount()); n++;
}
for (i = 0; i < 150; i++) {
  o = doc.addObject(CYLINDER);
  o.setParameter('name', 'Pipe ' + i); o.setParameter('radius', 0.03 + rnd() * 0.03); o.setParameter('height', 0.5 + rnd());
  o.setParameter('position', new Vec3D(-3 + (i % 30) * 0.2, 2.5, -1 - Math.floor(i / 30) * 0.2)); put(o, lav); n++;
}
return { created: n, ms: Date.now() - t0, folderChildren: folder.childCount() };`;
let t = Date.now(); const r = await must('bulk', 'c3d_run_script', { code, timeout_s: 120 }); console.log('bulk', Date.now() - t, 'ms', JSON.stringify(r.sc.value ?? r.sc));
const ls = await must('list', 'c3d_list_scene', { depth: 0, limit: 10 }); console.log('scene total', ls.sc.total);
// Toon vs Material spheres + emissive neon + coloured lights
const sph = async (name, x, kind, color) => { const o = (await must(name, 'c3d_create_object', { type: 'BALL', name, position: [x, 4.5, 3], params: { radius: .5 } })).sc.object.id; await must('mat', 'c3d_create_material', { name: name + 'Mat', type: kind, color }); await must('as', 'c3d_assign_material', { ref: { id: o }, material: { name: name + 'Mat' } }); return o; };
await sph('ToonBall', -1.5, 'Toon', [.66, .6, .93, 1]); await sph('StdBall', 0, 'Material', [.66, .6, .93, 1]);
const neon = (await must('neon', 'c3d_create_object', { type: 'BOX', name: 'NeonSign', position: [1.5, 4.5, 3], params: { sizeX: .4, sizeY: 1.2, sizeZ: .1 } })).sc.object.id;
await must('nm', 'c3d_create_material', { name: 'NeonMat', type: 'Material', color: [1, .55, .1, 1] }); await must('ne', 'c3d_set_material_params', { material: { name: 'NeonMat' }, params: { emisColor: [1, .55, .1, 1] } }); await must('na', 'c3d_assign_material', { ref: { id: neon }, material: { name: 'NeonMat' } });
await must('floor', 'c3d_create_object', { type: 'PLANE', name: 'Floor', position: [0, 3.9, 3], params: { sizeX: 8, sizeY: 4 } });
await must('l1', 'c3d_set_light', { name: 'Ambient', light_type: 'ambient', intensity: .5, color: [.7, .6, 1, 1] });
await must('l2', 'c3d_set_light', { name: 'Key', light_type: 'distant', position: [-3, 9, 8], look_at_point: [0, 4.5, 3], intensity: .9, color: [1, .95, 1, 1] });
await must('l3', 'c3d_set_light', { name: 'OrangeSpill', light_type: 'point', position: [1.5, 4.9, 3.7], intensity: 2, color: [1, .55, .1, 1], params: { attenuation: 2 } });
await must('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 6.5, 11], look_at_point: [0, 4.4, 3], fov: 35, active: true, params: { backgroundColor: [.55, .38, .72, 1] } });
await must('rs', 'c3d_set_render_settings', { width: 960, height: 540, params: { giOn: true, giSamples: 150, rayDepth: 6 } });
t = Date.now(); const rr = await must('render', 'c3d_render_image', { path: `${out}/toon.png` }); console.log('render with', ls.sc.total, 'objects', Date.now() - t, 'ms luma', rr.sc.meanLuma);
console.log('OUT', out);
await close();
