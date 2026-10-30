// Probes how many material (SHADERTAG) tags one object survives in Cheetah3D 8.1.3. A tag count above the limit crashed the app
// (stack smash in -[MWMnGon buildMaterialArray::], crash report 2026-10-30 10:06). Usage: node scripts/matslot-limit-probe.mjs <N> <box|poly>
import { connect } from './live-driver.mjs';
const [n, kind = 'box'] = [Number(process.argv[2]), process.argv[3]];
const { call, close } = await connect({ C3D_MCP_AUTO_CONFIRM: '1' });
await call('c3d_new_document', {});
const code = `const o=doc.addObject(${kind === 'poly' ? 'POLYGONOBJ' : 'BOX'}); ${kind === 'poly' ? 'const c=o.core(); const a=c.addVertex(false,new Vec3D(0,0,0)),b=c.addVertex(false,new Vec3D(1,0,0)),d=c.addVertex(false,new Vec3D(1,1,0)),e=c.addVertex(false,new Vec3D(0,1,0)); c.addIndexPolygon(4,[a,b,d,e]); o.update();' : ''} let made=0; for(let i=0;i<${n};i++){ const m=doc.addMaterial("Material","LIM"+i); const t=o.addTagOfType(SHADERTAG); t.setParameter("material",m); made++; } return {made, tags:o.tagCount()};`;
const r = await call('c3d_run_script', { code, force: true, confirm: true });
console.log(kind, n, r.isError ? 'ERROR ' + JSON.stringify(r.sc?.error ?? r.text) : JSON.stringify(r.sc?.value));
await close();
