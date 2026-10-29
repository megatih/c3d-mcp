// Bisects the OBJ exporter crash (crash #1) with controlled scenes. Crashes are expected; Cheetah3D is relaunched.
import { connect } from './live-driver.mjs';
import { execFileSync } from 'node:child_process';
const alive = () => { try { execFileSync('pgrep', ['-x', 'Cheetah3D']); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (body) => `function add(t,n,p){var o=doc.addObject(t);o.setParameter('name',n);if(p){for(var k in p)o.setParameter(k,p[k]);}o.update();return o;}\n${body}\nreturn 1;`;
const cases = {
  A_box: mk(`add(BOX,'B');`),
  B_two_boxes: mk(`add(BOX,'B1');add(BOX,'B2');`),
  C_folder_box: mk(`var f=add(FOLDER,'F');var b=add(BOX,'B');f.addChildAtIndex(b,0);`),
  D_camera: mk(`add(CAMERA,'C');`),
  E_light: mk(`add(LIGHT,'L');`),
  F_box_camera: mk(`add(BOX,'B');add(CAMERA,'C');`),
  G_folder_camera: mk(`var f=add(FOLDER,'F');var c=add(CAMERA,'C');f.addChildAtIndex(c,0);`),
  H_box_material: mk(`add(BOX,'B');`),
  L_target_tag: mk(`add(BOX,'B');add(CAMERA,'C');`),
  M_tools_scene: mk(`var f=add(FOLDER,'Table');var t=add(BOX,'Top');f.addChildAtIndex(t,0);`),
  I_assigned_material: mk(`add(BOX,'B');`),
  J_table_scene: mk(`var f=add(FOLDER,'Table');var t=add(BOX,'Top');f.addChildAtIndex(t,0);for(var i=0;i<4;i++){var l=add(CYLINDER,'Leg'+i);f.addChildAtIndex(l,i+1);}var c=add(CAMERA,'Cam');f.addChildAtIndex(c,5);`),
  K_table_materials: mk(`var f=add(FOLDER,'Table');var t=add(BOX,'Top');f.addChildAtIndex(t,0);for(var i=0;i<4;i++){var l=add(CYLINDER,'Leg'+i);f.addChildAtIndex(l,i+1);}var c=add(CAMERA,'Cam');f.addChildAtIndex(c,5);`),
};
const only = process.argv.slice(2);
const { call, close } = await connect();
for (const [name, code] of Object.entries(cases)) {
  if (only.length && !only.some((o) => name.startsWith(o))) continue;
  if (!alive()) { console.log('relaunching Cheetah3D'); execFileSync('open', ['-a', 'Cheetah3D']); await sleep(9000); }
  try {
    await call('c3d_new_document', {});
    const r = await call('c3d_run_script', { code });
    if (name.startsWith('I_') || name.startsWith('K_')) { await call('c3d_run_script', { code }); await call('c3d_create_material', { name: 'M2', type: 'Material' }); const a = await call('c3d_assign_material', { ref: { path: name.startsWith('I_') ? '/B' : '/Table/Top' }, material: { name: 'M2' } }); console.log(name, 'assign', a.isError ? 'ERR ' + JSON.stringify(a.sc).slice(0, 200) : 'ok'); if (name.startsWith('K_')) { const t = await call('c3d_add_tag', { ref: { path: '/Table/Leg0' }, type: 'COMPOSITINGTAG' }); console.log('tag', t.isError ? 'ERR ' + JSON.stringify(t.sc).slice(0, 160) : 'ok'); } }
    if (name.startsWith('L_')) { await call('c3d_run_script', { code }); const t = await call('c3d_add_tag', { ref: { path: '/C' }, type: 'TARGETTAG' }); console.log('target tag', t.isError ? 'ERR ' + JSON.stringify(t.sc).slice(0, 200) : 'ok'); }
    if (name.startsWith('M_')) { await call('c3d_run_script', { code }); const c = await call('c3d_set_camera', { name: 'Cam', position: [0, 2, 5], look_at_point: [0, 0, 0], active: true }); const l = await call('c3d_set_light', { name: 'Lamp', light_type: 'area', position: [0, 4, 0], look_at_point: [0, 0, 0] }); const r = await call('c3d_reparent', { refs: [{ path: '/Cam' }], new_parent: { path: '/Table' } }); console.log('tools', c.isError, l.isError, r.isError ? JSON.stringify(r.sc).slice(0, 200) : 'ok'); }
    if (name.startsWith('H_')) { const m = await call('c3d_create_material', { name: 'M', type: 'Material' }); const a = await call('c3d_assign_material', { objects: [{ path: '/B' }], material: { name: 'M' } }); console.log('H material', m.isError ? 'ERR' : 'ok', a.isError ? 'ERR ' + JSON.stringify(a.sc).slice(0, 200) : 'ok'); }
    console.log(name, 'script', r.isError ? 'ERR ' + JSON.stringify(r.sc).slice(0, 150) : 'ok');
    const e = await call('c3d_export', { path: `objb_${name}_${Date.now()}.obj`, confirm: true });
    console.log(name, 'export', e.isError ? 'ERR ' + JSON.stringify(e.sc).slice(0, 150) : 'ok');
  } catch (err) { console.log(name, 'failed', String(err).slice(0, 160)); }
  await sleep(6000);
  console.log(name, '=> Cheetah3D', alive() ? 'ALIVE' : 'CRASHED');
}
await close();
