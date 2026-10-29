// Bisects the removeMaterial crash (crash #2). Each case runs in a fresh document and waits for idle.
import { connect } from './live-driver.mjs';
import { execFileSync } from 'node:child_process';
const alive = () => { try { execFileSync('pgrep', ['-x', 'Cheetah3D']); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = "function find(n){for(var i=0;i<doc.materialCount();i++){var x=doc.materialAtIndex(i);if(x.getParameter('name')===n)return x;}return null;}";
const cases = {
  F_create_run1_remove_run2: [`var m = doc.addMaterial('Material', 'PX'); return 1;`, find + `var m = find('PX'); doc.removeMaterial(m); return 1;`],
  G_same_run_refetched: [find + `doc.addMaterial('Material', 'PY'); var m2 = find('PY'); doc.removeMaterial(m2); return 1;`],
  H_same_run_wrapper_nulled: [`var m = doc.addMaterial('Material', 'PZ'); doc.removeMaterial(m); m = null; return 1;`],
  I_remove_existing_after_node: [`var m = doc.addMaterial('Material', 'PW'); m.addNodeOfType('wood'); return 1;`, find + `doc.removeMaterial(find('PW')); return 1;`],
};
const { call, close } = await connect();
const must = async (n, a) => { const r = await call(n, a); if (r.isError) throw new Error(n + ' ' + JSON.stringify(r.sc).slice(0, 200)); return r; };
for (const [name, code] of Object.entries(cases)) {
  if (!alive()) { console.log('relaunching Cheetah3D'); execFileSync('open', ['-a', 'Cheetah3D']); await sleep(9000); }
  try { await must('c3d_new_document', {}); for (const c of code) { const r = await call('c3d_run_script', { code: c }); console.log(name, 'script', r.isError ? 'ERR ' + JSON.stringify(r.sc).slice(0, 120) : 'ok'); await sleep(1500); } } catch (e) { console.log(name, 'setup failed', String(e).slice(0, 160)); }
  await sleep(7000);
  console.log(name, '=> Cheetah3D', alive() ? 'ALIVE' : 'CRASHED');
}
await close();
