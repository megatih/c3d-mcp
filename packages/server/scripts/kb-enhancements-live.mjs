// End-to-end check of the tools changed because of research/10, against the RUNNING Cheetah3D (scratch documents). Prints PASS/FAIL per check.
import { connect } from './live-driver.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readPng } from './png-lite.mjs';
const dir = process.env.KB_RENDER_DIR ?? '/tmp/kb-verify-render'; mkdirSync(dir, { recursive: true });
const { call, close } = await connect({ C3D_MCP_AUTO_CONFIRM: '1' });
let failed = 0;
const check = (name, ok, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', name, extra); if (!ok) failed++; };
const must = async (l, n, a) => { const r = await call(n, a); if (r.isError) throw new Error(`${l}: ${JSON.stringify(r.sc ?? r.text).slice(0, 300)}`); return r; };
const val = async (code) => (await must('script', 'c3d_run_script', { code, force: true, confirm: true })).sc.value;

// 1. material tag cap: the 25th shader tag is refused instead of crashing the app
await call('c3d_new_document', {});
const boxId = (await must('box', 'c3d_create_object', { type: 'BOX', name: 'Tagged' })).sc.object.id;
let accepted = 0, refusedWith = null;
for (let i = 0; i < 27 && !refusedWith; i++) {
  const m = await must('mat', 'c3d_create_material', { name: `Cap${i}` });
  const r = await call('c3d_assign_material', { ref: { id: boxId }, material: { name: m.sc.material.name }, replace_existing: false });
  if (r.isError) refusedWith = r.sc?.code ?? r.sc?.error?.code ?? JSON.stringify(r.sc).slice(0, 120); else accepted++;
}
check('tag cap: assignment is refused (UNSUPPORTED) and the app survives', refusedWith === 'UNSUPPORTED' && accepted >= 20 && accepted <= 24, `accepted=${accepted} refused=${refusedWith}`);
const viaAddTag = await call('c3d_add_tag', { ref: { id: boxId }, type: 'SHADERTAG' });
check('tag cap: c3d_add_tag SHADERTAG is refused too', viaAddTag.isError === true && (viaAddTag.sc?.code ?? '') === 'UNSUPPORTED', JSON.stringify(viaAddTag.sc).slice(0, 100));
check('tag cap: app still responds', (await call('c3d_get_document_info', {})).isError === false);

// 2. light + camera fields reach the app
await call('c3d_new_document', {});
const L = (await must('light', 'c3d_set_light', { name: 'A', light_type: 'area', shadow_softness: 3, visible_in_camera: true })).sc.object.id;
const lp = (await must('getp', 'c3d_get_parameters', { ref: { id: L }, names: ['shadowSoft', 'geometry', 'lightType'] })).sc;
console.log(JSON.stringify(lp).slice(0, 300));
const cam = (await must('cam', 'c3d_set_camera', { name: 'C', position: [0, 0, 8], look_at_point: [0, 0, 0], projection: 'orthographic', camera_light: 'on', active: true })).sc.object.id;
const cp = (await must('getc', 'c3d_get_parameters', { ref: { id: cam }, names: ['projection', 'cameraLightOnOff'] })).sc;
console.log(JSON.stringify(cp).slice(0, 300));

// 3. transparent background -> alpha 0 in the PNG (and the shadow-catcher material can be created)
await call('c3d_new_document', {});
await must('box', 'c3d_create_object', { type: 'BOX', name: 'Subject' });
await must('cam', 'c3d_set_camera', { name: 'C', position: [0, 0, 8], look_at_point: [0, 0, 0], fov: 40, active: true });
await must('bg', 'c3d_set_background', { kind: 'transparent' });
await must('rs', 'c3d_set_render_settings', { renderer: 'FALCON', width: 160, height: 160, params: { samples: 30 } });
const f = join(dir, `enh_transparent_${Date.now()}.png`);
await must('render', 'c3d_render_image', { path: f });
const png = readPng(f);
check('transparent background: corner alpha 0, subject opaque', png.at(2, 2)[3] === 0 && png.at(80, 80)[3] === 255, JSON.stringify([png.at(2, 2), png.at(80, 80)]));
const sm = await must('shadowmat', 'c3d_create_material', { name: 'Catcher', type: 'Shadowmat', color: '#000000' });
check('Shadowmat material has a shadow root node', sm.sc.material.rootNodeType === 'shadow', JSON.stringify(sm.sc.material).slice(0, 120));

// 4. samples guard
const g = await call('c3d_set_render_settings', { renderer: 'FALCON', params: { samples: 0 } });
check('samples 0 is refused', g.isError === true);

// 5. lint blocks the same mistakes inside scripts
const bad = await call('c3d_run_script', { code: 'doc.currentRenderer().setParameter("samples", 0); return 1;', confirm: true });
check('run_script refuses samples=0 (LINT_BLOCKED)', bad.isError === true && /LINT/.test(JSON.stringify(bad.sc)), JSON.stringify(bad.sc).slice(0, 160));

// 6. meshes created by the tools have outward normals (cube given counter-clockwise polygons)
await call('c3d_new_document', {});
const v = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
await must('mesh', 'c3d_create_mesh', { name: 'Cube', vertices: v, polygons: [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]] });
const n = await val(`const root=doc.root(); for(let i=0;i<root.childCount();i++){ const o=root.childAtIndex(i); if(o.getParameter("name")!=="Cube") continue; const c=o.core(); let out=0,inn=0; for(let p=0;p<c.polygonCount();p++){ let x=0,y=0,z=0; for(let k=0;k<4;k++){const q=c.vertex(c.vertexIndex(p,k)); x+=q.x;y+=q.y;z+=q.z;} const nm=c.normal(p); (nm.x*x+nm.y*y+nm.z*z)>0?out++:inn++; } return {out,inn}; } return null;`);
check('create_mesh: all 6 normals outward', n && n.out === 6 && n.inn === 0, JSON.stringify(n));

console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
await close();
process.exit(failed ? 1 : 0);
