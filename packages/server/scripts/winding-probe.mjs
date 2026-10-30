// Which winding gives OUTWARD normals in Cheetah3D 8.1.3? Compares a native BOX (made editable) with c3d_create_mesh given
// "counter-clockwise seen from outside" polygons (the documented convention). Metric: dot(core.normal(p), polygonCentroid - meshCentroid).
import { connect } from './live-driver.mjs';
const { call, close } = await connect({ C3D_MCP_AUTO_CONFIRM: '1' });
const must = async (l, n, a) => { const r = await call(n, a); if (r.isError) throw new Error(l + ' ' + JSON.stringify(r.sc ?? r.text)); return r; };
await call('c3d_new_document', {});
const box = (await must('box', 'c3d_create_object', { type: 'BOX', name: 'NativeBox', position: [0, 0, 0], params: { sizeX: 2, sizeY: 2, sizeZ: 2 } })).sc.object.id;
await must('edit', 'c3d_make_editable', { ref: { id: box } });
const v = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
// faces listed counter-clockwise when seen from OUTSIDE the cube (right-handed reading of the index order)
const polys = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]];
await must('mesh', 'c3d_create_mesh', { name: 'CcwBox', vertices: v, polygons: polys, position: [5, 0, 0] });
const code = `const out={}; const root=doc.root(); for(let i=0;i<root.childCount();i++){ const o=root.childAtIndex(i); const n=o.getParameter("name"); if(n!=="NativeBox"&&n!=="CcwBox") continue; const c=o.core(); const pc=c.polygonCount(); let cx=0,cy=0,cz=0; for(let k=0;k<c.vertexCount();k++){const q=c.vertex(k); cx+=q.x;cy+=q.y;cz+=q.z;} cx/=c.vertexCount();cy/=c.vertexCount();cz/=c.vertexCount(); let outward=0,inward=0; for(let p=0;p<pc;p++){ let px=0,py=0,pz=0; const sz=c.polygonSize(p); for(let k=0;k<sz;k++){const q=c.vertex(c.vertexIndex(p,k)); px+=q.x;py+=q.y;pz+=q.z;} px/=sz;py/=sz;pz/=sz; const nm=c.normal(p); const d=nm.x*(px-cx)+nm.y*(py-cy)+nm.z*(pz-cz); if(d>0)outward++; else inward++; } out[n]={polygons:pc,outward,inward}; } return out;`;
const r = await must('probe', 'c3d_run_script', { code, force: true, confirm: true });
console.log(JSON.stringify(r.sc.value));
await close();
