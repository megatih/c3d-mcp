// Live verification of claims from c3d-scripting-kb and "Learn 3D with Cheetah 3D" against the RUNNING Cheetah3D.
// Records raw observations (no verdicts) to research/raw/kb-verify-8.1.3.json; verdicts are written by hand in research/10.
// Usage: node scripts/kb-verify-live.mjs [phase ...]   phases: api, scene, enhancements (default: api scene)
// Needs Cheetah3D running with the bridge installed. Works in a scratch document. Skips claims known to crash the app.
import { connect } from './live-driver.mjs';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readPng } from './png-lite.mjs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '../../../research/raw/kb-verify-8.1.3.json');
const phases = process.argv.slice(2).length ? process.argv.slice(2) : ['api', 'scene'];
const { call, close } = await connect({ C3D_MCP_AUTO_CONFIRM: '1' });
const prior = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
const results = { ...(prior.results ?? {}) };
const record = (id, v) => { results[id] = v; console.log(id, JSON.stringify(v).slice(0, 400)); };
const run = async (id, code) => {
  const r = await call('c3d_run_script', { code, force: true, confirm: true });
  if (r.isError) { record(id, { error: r.sc?.error ?? r.text }); return null; }
  record(id, r.sc?.value ?? r.sc);
  return r.sc?.value;
};
const tool = async (id, name, args) => {
  const r = await call(name, args);
  record(id, r.isError ? { error: r.sc?.error ?? r.text } : (r.sc ?? r.text));
  return r;
};
const T = 'const T=(f)=>{try{return f()}catch(e){return "THROWS: "+String(e).slice(0,160)}};';
const typ = (names) => `[${names.map((n) => `[${JSON.stringify(n)},(typeof ${n}==="undefined")?null:${n}]`).join(',')}]`;

if (phases.includes('api')) {
  await call('c3d_new_document', {});
  await run('K01.constants', `return ${typ(['LIGHT','POINTLIGHT','SPOTLIGHT','DISTANTLIGHT','AREALIGHT','SKYLIGHT','ENVIRONMENTLIGHT','LIGHTFAMILY','JOINT','SMARTFOLDER','SOFT_INTERPOL','LINEAR_INTERPOL','SPLINE_INTERPOL','FLAT_INTERPOL','CONST_INTERPOL','CONSTANT_INTERPOL','STEP_INTERPOL','READ_MODE','WRITE_MODE','SEEK_SET','SEEK_CUR','SEEK_END','BIG_ENDIAN','BIG_ENDIAM','LITTLE_ENDIAN','LITTLE_ENDIA','SELECT','UVPOINT','UVEDGE','UVPINNED','SEAM','CREASE','EOF','DOFTAG','TARGETTAG','RENDERTAG','SPLINETRACKINGTAG','FOGTAG','RADIOSITYTAG','HDRITAG','TONEMAPPINGTAG','CAUSTICTAG','PIVOT_MODE','IDENDITY','IDENTITY','SHADERTAG','FALCON','CHEETAH','UVTAG','SUBDIVMOD','SOFTBODYTAG','RIGIDBODYTAG','ROT_HPB','POLYGONOBJ','CAMERA'])};`);

  // selection / parenting (fresh document: nothing selected)
  await run('K02a.selectedObject.fresh', `${T} const r=doc.root(); const s=T(()=>doc.selectedObject()); const ss=T(()=>doc.selectedObjects(true)); return {selType: s===undefined?"undefined":(s===null?"null":(s.id&&r.id&&s.id()===r.id()?"ROOT":"object")), selectedObjectsLen: Array.isArray(ss)?ss.length:String(ss), rootChildCount:r.childCount()};`);
  await run('K02b.parenting.nothingSelected', `${T} const r=doc.root(); const o=doc.addObject(BOX); o.setParameter("name","P_nothing"); return {parentIsRoot: T(()=>o.owner().id()===r.id()), ownerType: T(()=>typeof o.owner), hasParent: typeof o.parent, rootChildren:r.childCount()};`);
  await run('K02c.parenting.objectSelected', `${T} const r=doc.root(); const a=r.childAtIndex(0); doc.selectObject(a,false); const sel=doc.selectedObject(); const o=doc.addObject(BOX); o.setParameter("name","P_sel_child"); return {selectedIsA: sel&&sel.id()===a.id(), newOwnerIsRoot: T(()=>o.owner().id()===r.id()), newOwnerIsA: T(()=>o.owner().id()===a.id()), aChildren:a.childCount(), rootChildren:r.childCount()};`);
  await run('K02d.parenting.nestedSelected', `${T} const r=doc.root(); const a=r.childAtIndex(0); const n=doc.addObject(BOX); n.setParameter("name","P_nested"); a.addChildAtIndex(n,a.childCount()); doc.selectObject(n,false); const o=doc.addObject(BOX); o.setParameter("name","P_sel_nested"); return {newOwnerIsNested: T(()=>o.owner().id()===n.id()), newOwnerIsA: T(()=>o.owner().id()===a.id()), newOwnerIsRoot: T(()=>o.owner().id()===r.id())};`);
  await run('K02e.selectedObject.rootSelected', `${T} const r=doc.root(); T(()=>doc.selectObject(r,false)); const s=T(()=>doc.selectedObject()); return {afterSelectRoot: s===undefined?"undefined":(s===null?"null":(typeof s==="string"?s:(s.id&&s.id()===r.id()?"ROOT":"object")))};`);

  await run('K03.methods', `${T} const o=doc.addObject(BOX); const m=doc.addMaterial("Material","KBM"); const n=m.nodeAtIndex(0); const p=o.parameterWithName("position"); return {objParent: typeof o.parent, objOwner: typeof o.owner, objId: typeof o.id, nodeId: n?typeof n.id:null, matRib: typeof m.rib, docAnimTime: typeof doc.animationTime, docFPS: typeof doc.animationFPS, docSetFPS: typeof doc.setAnimationFPS, prmIsAnimatable: p?typeof p.isAnimatable:null, prmIsAnimateable: p?typeof p.isAnimateable:null, fileReadInt: typeof File.prototype!=="undefined"?typeof File.prototype.readInt:"noproto", docRootObject: typeof doc.rootObject, tagLinked: typeof (o.addTagOfType(SHADERTAG)).linkedToMaterial};`);
  await run('K04.vectors', `${T} const a=new Vec3D(1,2,3); const b=a.add(new Vec3D(1,1,1)); const aAfter=a.x; const c=new Vec3D(1,0,0).cross(new Vec3D(0,1,0)); const v4a=new Vec4D(1,2,3,4); const v4b=new Vec4D(1,2,3,4); return {addReturnsNew: aAfter===1 && b.x===2, dot: T(()=>new Vec3D(1,2,3).dot(new Vec3D(4,5,6))), cross: [c.x,c.y,c.z], v3isEqual: T(()=>a.isEqual(new Vec3D(1,2,3))), v4isEqual: T(()=>v4a.isEqual(v4b)), instanceofVec3D: T(()=>a instanceof Vec3D), ctorNoNew: T(()=>{ const x=Vec3D(1,2,3); return typeof x; })};`);
  // geometry on a fresh polygon object (valid indices only)
  await run('K05.polycore', `${T} const o=doc.addObject(POLYGONOBJ); const c=o.core(); const i0=c.addVertex(false,new Vec3D(0,0,0)); const i1=c.addVertex(false,new Vec3D(1,0,0)); const i2=c.addVertex(false,new Vec3D(1,1,0)); const i3=c.addVertex(false,new Vec3D(0,1,0)); const p=c.addIndexPolygon(4,[i0,i1,i2,i3],[new Vec2D(0,0),new Vec2D(1,0),new Vec2D(1,1),new Vec2D(0,1)]); const uv=c.uvCoord(p,1); const v=c.vertex(0); v.x=99; const copy=c.vertex(0).x; const nrm=c.normal(p); const out={idx:[i0,i1,i2,i3], poly:p, uvType:T(()=>uv.constructor===Vec4D?"Vec4D":(uv.constructor===Vec2D?"Vec2D":"other")), uvHasZW:[typeof uv.z,typeof uv.w], uv:[uv.x,uv.y,uv.z,uv.w], vertexIsCopy: copy===0, normalZ: nrm.z, matTagIdx:T(()=>c.materialTagIndex(p))}; const p2=T(()=>c.addIndexPolygon(3,[i0,i1,i2],[new Vec4D(0,0,0,0),new Vec4D(1,0,0,0),new Vec4D(1,1,0,0)])); out.vec4UvPolygon=p2; out.polyCount=c.polygonCount(); c.flipWinding(p); out.normalZAfterFlip=c.normal(p).z; o.update(); return out;`);
  await run('K06.parameters', `${T} const o=doc.addObject(BOX); return {missingGet: T(()=>o.getParameter("doesNotExist__")), posType: T(()=>{const v=o.getParameter("position"); return typeof v+":"+(v&&v.x!==undefined);}), parameterInfoSample: T(()=>o.parameterInfo().slice(0,3))};`);
  await run('K07.takes', `${T} const t1=doc.addTake("KB_A"); const t2=T(()=>doc.addTake("KB_A")); return {dupReturnsSame: T(()=>t1.name===t2.name), takeCount: doc.takeCount(), cur: doc.currentTake().name, animEnd: doc.animationEnd(), fps: T(()=>doc.animationFPS()), animPos: doc.animPosition(), animTime: T(()=>doc.animationTime())};`);
  await run('K08.keys', `${T} const o=doc.addObject(BOX); const prm=o.parameterWithName("position"); const tk=doc.currentTake(); const tn=prm.takeNodeWithName(tk.name)||prm.addTakeNode(tk.name); const fc=tn.fCurveAtIndex(0); const k=new FCurveKey(); k.time=0; k.value=1; fc.addKey(k); const k2=new FCurveKey(); k2.time=1; k2.value=3; fc.addKey(k2); fc.update(); const kk=fc.keyAtIndex(0); kk.value=77; const again=fc.keyAtIndex(0).value; const before=o.getParameter("position").x; doc.setAnimPosition(0.5); const mid=T(()=>o.getParameter("position").x); return {keyAtIndexIsCopy: again===1, keyCount: fc.keyCount(), valueAtHalf: mid, defaultInterp:[k.left_type,k.right_type], posBefore: before};`);
  await run('K09.setAnimPosition.noKeys', `${T} const o=doc.addObject(BOX); doc.setAnimPosition(2); o.setParameter("position",new Vec3D(5,0,0)); const prm=o.parameterWithName("position"); const tk=doc.currentTake(); const tn=prm.takeNodeWithName(tk.name); doc.setAnimPosition(0); return {takeNodeCreated: !!tn, keysAfter: tn?tn.fCurveAtIndex(0).keyCount():0, posAtT0: o.getParameter("position").x};`);
  await run('K10.undo', `${T} const o=doc.addObject(BOX); return {recordParams: T(()=>{o.recordParametersForUndo(); return "ok";}), recordGeom: T(()=>{ const c=o.core(); return c?"has core":"no core"; })};`);
  await run('K11.takeNames', `${T} return {createsFromAddObjectThrows: T(()=>{ doc.addObject(POINTLIGHT); return "created"; })};`);
  await run('K12.fileio', `${T} const p=File.tmpPath?null:null; return {fileReadlnProto: typeof File.prototype!=="undefined"?Object.getOwnPropertyNames(File.prototype).slice(0,60):"noproto"};`);
  await run('K13.docMethods', `${T} return {docKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(doc)).sort()};`);
  await run('K14.objectMethods', `${T} const o=doc.addObject(BOX); return {objKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(o)).sort()};`);
  await run('K15.renderer', `${T} const r=doc.currentRenderer(); return {res: T(()=>{ r.setParameter("resolution", new Vec2D(320,240)); const v=r.getParameter("resolution"); return [v.x,v.y]; }), rendererCount: doc.rendererCount(), names: T(()=>{ const a=[]; for(let i=0;i<doc.rendererCount();i++){ const x=doc.rendererAtIndex(i); a.push(x.getParameter("name")||null);} return a; })};`);
  await call('c3d_checkpoint', {}).catch(() => {});
}

if (phases.includes('api2')) {
  await call('c3d_new_document', {});
  await run('F01.freshDoc', `${T} const r=doc.root(); const kids=[]; for(let i=0;i<r.childCount();i++){const c=r.childAtIndex(i); kids.push([c.type(),c.getParameter("name")]);} const s=doc.selectedObject(); return {kids, selected: s?[s.type(),s.getParameter("name")]:null};`);
  await run('F02.pointlight', `${T} const o=doc.addObject(POINTLIGHT); return {type:o.type(), isLIGHT:o.type()===LIGHT, family:o.family(), lightType:T(()=>o.getParameter("lightType")), name:T(()=>o.getParameter("name"))};`);
  await run('F03.normals', `${T} const o=doc.addObject(POLYGONOBJ); const c=o.core(); const a=c.addVertex(false,new Vec3D(0,0,0)); const b=c.addVertex(false,new Vec3D(1,0,0)); const d=c.addVertex(false,new Vec3D(1,1,0)); const e=c.addVertex(false,new Vec3D(0,1,0)); const p=c.addIndexPolygon(4,[a,b,d,e]); o.update(); const n1=c.normal(p); const n2=T(()=>c.normal(p,0)); c.flipWinding(p); o.update(); const n3=c.normal(p); return {ccwNormal:[n1.x,n1.y,n1.z], cornerNormal:T(()=>[n2.x,n2.y,n2.z]), afterFlip:[n3.x,n3.y,n3.z]};`);
  await run('F04.parameterInfo', `${T} const o=doc.addObject(BOX); const pi=o.parameterInfo(); return {t:typeof pi, isArray:Array.isArray(pi), len:pi.length, first:T(()=>String(pi[0])), firstKeys:T(()=>Object.keys(pi[0]||{}))};`);
  await run('F05.fileInstance', `${T} const f=new File("/nonexistent_kb_probe.txt"); return {keys:T(()=>{const k=[];for(const x in f)k.push(x);return k;}), readInt:typeof f.readInt, readln:typeof f.readln, exist:T(()=>f.exist())};`);
  await run('F06.vec4', `${T} const a=new Vec4D(1,2,3,4); return {isEqualSelf:T(()=>a.isEqual(a)), isEqualCopy:T(()=>a.isEqual(a.copy())), sumW:T(()=>a.add(new Vec4D(1,1,1,1)).w)};`);
  await run('F07.interpApplied', `${T} const o=doc.addObject(BOX); const prm=o.parameterWithName("position"); const tk=doc.currentTake(); const tn=prm.addTakeNode(tk.name); const fc=tn.fCurveAtIndex(0); const mk=(t,v,ty)=>{const k=new FCurveKey(); k.time=t; k.value=v; k.left_type=ty; k.right_type=ty; return k;}; fc.addKey(mk(0,0,CONST_INTERPOL)); fc.addKey(mk(1,10,CONST_INTERPOL)); fc.update(); doc.setAnimPosition(0.5); const constMid=o.getParameter("position").x; const o2=doc.addObject(BOX); const p2=o2.parameterWithName("position"); const f2=p2.addTakeNode(tk.name).fCurveAtIndex(0); f2.addKey(mk(0,0,LINEAR_INTERPOL)); f2.addKey(mk(1,10,LINEAR_INTERPOL)); f2.update(); doc.setAnimPosition(0.25); const linQ=o2.getParameter("position").x; doc.setAnimPosition(0); return {constMid, linQ};`);
}

if (phases.includes('scene')) {
  await call('c3d_new_document', {});
  // Light parameters: read what exists and defaults on each light type.
  await run('S01.lightParams', `${T} const out={}; const o=doc.addObject(LIGHT); const names=["lightType","axis","samples","intensity","attenuation","geometry","shadowType","shadowSoft","radius","photonLight","iesProfile","cutOffAngle","cutOffAttenuation","cutOffType"]; names.forEach(n=>{ out[n]=T(()=>{const v=o.getParameter(n); return (v&&v.x!==undefined)?[v.x,v.y,v.z]:v;}); }); return out;`);
  await run('S02.cameraParams', `${T} const o=doc.addObject(CAMERA); const out={}; ["projection","fieldOfView","zoom","clipNear","clipFar","apertureSize","focalDistance","cameraLightOnOff","backgroundColor","resolutionX","antialiasing","shadowsOnOff","shutterTime"].forEach(n=>{ out[n]=T(()=>{const v=o.getParameter(n); return (v&&v.x!==undefined)?[v.x,v.y,v.z,v.w]:v;}); }); return out;`);
  await run('S03.renderers', `${T} const out={}; for(let i=0;i<doc.rendererCount();i++){ const r=doc.rendererAtIndex(i); const o={}; ["samples","dofOn","gamma","exposure","filmic","giOn","giType","rayDepth","totalBounces","causticsRefraction","causticsReflection","mbCamera","threadCount","antialiasingMode","photonMapOn"].forEach(n=>{ o[n]=T(()=>r.getParameter(n)); }); out["r"+i]=o; } out.current=T(()=>doc.currentRenderer().getParameter("name")); return out;`);
  await run('S04.materialDefaults', `${T} const out={}; ["Material","PBR","Glass","Toon","Dielectric","Metal","Shadow","Shadowmat","Solid","Special"].forEach(k=>{ out[k]=T(()=>{ const m=doc.addMaterial(k,"KB_"+k); const r=m.rootNode(); return {rootType: r?r.nodeType():null, nodes:m.nodeCount()}; }); }); const m=doc.addMaterial("Material","KB_defaults"); const r=m.nodeAtIndex(0); out.defaults={}; ["specColor","specSize","transEta","reflBlur","reflFresnel","diffColor"].forEach(n=>{ out.defaults[n]=T(()=>{const v=r.getParameter(n); return (v&&v.x!==undefined)?[v.x,v.y,v.z,v.w]:v;}); }); return out;`);
  // S05 (30 material tags on one object) CRASHES Cheetah3D 8.1.3 (stack smash in buildMaterialArray); see scripts/matslot-limit-probe.mjs.
  await run('S06.tagParams', `${T} const o=doc.addObject(BOX); const out={}; [["RENDERTAG",RENDERTAG],["HDRITAG",typeof HDRITAG==="undefined"?null:HDRITAG],["DOFTAG",typeof DOFTAG==="undefined"?null:DOFTAG],["RIGIDBODYTAG",RIGIDBODYTAG]].forEach(a=>{ out[a[0]]=T(()=>{ if(a[1]===null) return "const undefined"; const t=o.addTagOfType(a[1]); const info=t.parameterInfo(); const a=[]; for(let q=0;q<info.length;q++) a.push(info[q][0]+":"+info[q][1]); return info.length+" params: "+a.join(", "); }); }); return out;`);
  await run('S07.envLight', `${T} const o=doc.addObject(ENVIRONMENTLIGHT); const out={}; ["image","mapping","intensity","clamp","samples","visibleInBackground","shadowType"].forEach(n=>{ out[n]=T(()=>o.getParameter(n)); }); return out;`);
  await call('c3d_checkpoint', {}).catch(() => {});
}

if (phases.includes('render')) {
  const dir = process.env.KB_RENDER_DIR ?? '/tmp/kb-verify-render'; mkdirSync(dir, { recursive: true });
  const rend = async (id, name) => { const f = join(dir, name + '.png'); const r = await call('c3d_render_image', { path: f }); if (r.isError) { record(id, { error: r.sc?.error ?? r.text }); return null; } return readPng(f); };
  const set = (ref, params) => tool('set', 'c3d_set_parameters', { ref: { id: ref }, params });
  const gridOf = (png) => png.grid(5, 5);
  const rowProfile = (png) => { const y = Math.floor(png.h / 2), a = []; for (let x = 0; x < png.w; x++) a.push(png.luma(x, y)); return a; };
  const maxGrad = (a) => { let m = 0; for (let i = 3; i < a.length - 3; i++) m = Math.max(m, Math.abs(a[i + 3] - a[i - 3]) / 6); const lo = Math.min(...a), hi = Math.max(...a); return { range: +(hi - lo).toFixed(3), maxGrad: +m.toFixed(4), normGrad: +(hi > lo ? m / (hi - lo) : 0).toFixed(4) }; };

  await call('c3d_new_document', {});
  await tool('rs', 'c3d_set_render_settings', { renderer: 'FALCON', width: 320, height: 320, params: { samples: 60 } });
  await tool('floor', 'c3d_create_object', { type: 'BOX', name: 'Floor', position: [0, -0.05, 0], params: { sizeX: 12, sizeY: 0.1, sizeZ: 12 } });
  await tool('pole', 'c3d_create_object', { type: 'BOX', name: 'Pole', position: [0, 1.5, 0], params: { sizeX: 0.5, sizeY: 3, sizeZ: 0.5 } });
  const cam = (await tool('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 14, 0.01], look_at_point: [0, 0, 0], fov: 40, active: true, params: { backgroundColor: [0, 0, 0, 1] } })).sc?.object?.id;
  const L = (await tool('light', 'c3d_set_light', { name: 'L', light_type: 3, position: [3, 5, 0], intensity: 60, params: { attenuation: 2 } })).sc?.object?.id;
  // R1: what do light types 0..4 do (shadow, falloff, cone)?
  for (const lt of [0, 1, 2, 3, 4]) { await set(L, { lightType: lt }); const p = await rend('R1.lightType' + lt, 'lt' + lt); if (p) record('R1.lightType' + lt, { grid: gridOf(p), centerRow: maxGrad(rowProfile(p)) }); }
  // R2: shadow softness: point light, Falcon. shadowSoft vs radius.
  await set(L, { lightType: 3, attenuation: 0, intensity: 1 });
  for (const [k, prm] of [['hard', { shadowSoft: 0, radius: 0 }], ['shadowSoft0.5', { shadowSoft: 0.5, radius: 0 }], ['shadowSoft2', { shadowSoft: 2, radius: 0 }], ['radius2', { shadowSoft: 0, radius: 2 }], ['radius0.5default', { shadowSoft: 0, radius: 0.5 }]]) { await set(L, prm); const p = await rend('R2.' + k, 'soft_' + k); if (p) record('R2.' + k, maxGrad(rowProfile(p))); }
  // R8: shadowType 0/1/2
  await set(L, { shadowSoft: 0, radius: 0 });
  for (const st of [0, 1, 2]) { await set(L, { shadowType: st }); const p = await rend('R8.shadowType' + st, 'st' + st); if (p) record('R8.shadowType' + st, { grid: gridOf(p), centerRow: maxGrad(rowProfile(p)) }); }
  await set(L, { shadowType: 1 });
  // R5: camera light with no scene lights
  await set(L, { intensity: 0 });
  for (const v of [0, 1, 2]) { await set(cam, { cameraLightOnOff: v }); const p = await rend('R5.cameraLight' + v, 'cl' + v); if (p) record('R5.cameraLight' + v, { mean: +p.region(0, 0, p.w, p.h).toFixed(4) }); }
  await set(cam, { cameraLightOnOff: 0 });
  // R6/R9: alpha in PNG with transparent camera background
  for (const a of [1, 0]) { await set(cam, { backgroundColor: [0, 0, 0, a] }); const p = await rend('R6.bgAlpha' + a, 'alpha' + a); if (p) record('R6.bgAlpha' + a, { channels: p.channels, colorType: p.colorType, cornerRGBA: p.at(2, 2), centerRGBA: p.at(Math.floor(p.w / 2), Math.floor(p.h / 2)) }); }
  await set(cam, { backgroundColor: [0, 0, 0, 1] });
  // R7: camera projection values
  await set(L, { intensity: 1 });
  for (const pr of [0, 1, 2]) { await set(cam, { projection: pr }); const p = await rend('R7.projection' + pr, 'proj' + pr); if (p) record('R7.projection' + pr, { grid: p.grid(5, 5)[2], mean: +p.region(0, 0, p.w, p.h).toFixed(4) }); }
  await set(cam, { projection: 0 });
}

if (phases.includes('render2')) {
  const dir = process.env.KB_RENDER_DIR ?? '/tmp/kb-verify-render'; mkdirSync(dir, { recursive: true });
  const rend = async (id, name) => { const f = join(dir, name + '.png'); const r = await call('c3d_render_image', { path: f }); if (r.isError) { record(id, { error: r.sc?.error ?? r.text }); return null; } return readPng(f); };
  const set = (ref, params) => tool('set', 'c3d_set_parameters', { ref: { id: ref }, params });
  const leftGrad = (png) => { const y = Math.floor(png.h / 2), a = []; for (let x = 0; x < Math.floor(png.w / 2) - 25; x++) a.push(png.luma(x, y)); let m = 0; for (let i = 3; i < a.length - 3; i++) m = Math.max(m, Math.abs(a[i + 3] - a[i - 3]) / 6); return { min: +Math.min(...a).toFixed(3), max: +Math.max(...a).toFixed(3), maxGrad: +m.toFixed(4) }; };
  const stage = async (extra = {}) => {
    await call('c3d_new_document', {});
    await tool('rs', 'c3d_set_render_settings', { renderer: 'FALCON', width: 320, height: 320, params: { samples: 60 } });
    await tool('floor', 'c3d_create_object', { type: 'BOX', name: 'Floor', position: [0, -0.05, 0], params: { sizeX: 12, sizeY: 0.1, sizeZ: 12 } });
    await tool('pole', 'c3d_create_object', { type: 'BOX', name: 'Pole', position: [0, 1.5, 0], params: { sizeX: 0.5, sizeY: 3, sizeZ: 0.5 } });
    return (await tool('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 14, 0.01], look_at_point: [0, 0, 0], fov: 40, active: true, params: { backgroundColor: [0, 0, 0, 1], ...extra } })).sc?.object?.id;
  };
  // R2b: larger shadowSoft values; point (3), spot (4) and distant (2, aimed)
  let cam = await stage();
  const L = (await tool('light', 'c3d_set_light', { name: 'L', light_type: 3, position: [3, 5, 0], intensity: 1, params: { attenuation: 0, radius: 0 } })).sc?.object?.id;
  for (const v of [0, 5, 20, 60]) { await set(L, { shadowSoft: v }); const p = await rend('R2b.point.shadowSoft' + v, 'p_ss' + v); if (p) record('R2b.point.shadowSoft' + v, leftGrad(p)); }
  await set(L, { shadowSoft: 0 });
  for (const v of [0.5, 2, 8]) { await set(L, { radius: v }); const p = await rend('R2b.point.radius' + v, 'p_r' + v); if (p) record('R2b.point.radius' + v, leftGrad(p)); }
  await set(L, { radius: 0 });
  await tool('dist', 'c3d_set_light', { ref: { id: L }, light_type: 2, look_at_point: [0, 0, 0] });
  for (const v of [0, 5, 20, 60]) { await set(L, { shadowSoft: v }); const p = await rend('R2b.distant.shadowSoft' + v, 'd_ss' + v); if (p) record('R2b.distant.shadowSoft' + v, leftGrad(p)); }
  // R2c: does the CHEETAH renderer soften with shadowSoft / radius / light samples?
  await tool('rs', 'c3d_set_render_settings', { renderer: 'CHEETAH', width: 320, height: 320 });
  await tool('pt', 'c3d_set_light', { ref: { id: L }, light_type: 3, position: [3, 5, 0] });
  for (const prm of [{ shadowSoft: 0, radius: 0 }, { shadowSoft: 0, radius: 2 }, { shadowSoft: 20, radius: 0 }]) { await set(L, prm); const p = await rend('R2c.cheetah.' + JSON.stringify(prm), 'c_' + prm.shadowSoft + '_' + prm.radius); if (p) record('R2c.cheetah.' + JSON.stringify(prm), leftGrad(p)); }

  // R5b: camera light with NO lights at all
  cam = await stage();
  for (const v of [0, 1, 2]) { await set(cam, { cameraLightOnOff: v }); const p = await rend('R5b.noLights.cameraLight' + v, 'nl' + v); if (p) record('R5b.noLights.cameraLight' + v, { mean: +p.region(0, 0, p.w, p.h).toFixed(4) }); }

  // R6b: transparent background through doc.render directly (bypassing the tool), both engines
  cam = await stage();
  await set(cam, { backgroundColor: [0, 0, 0, 0] });
  for (const eng of ['FALCON', 'CHEETAH']) {
    await tool('rs', 'c3d_set_render_settings', { renderer: eng, width: 200, height: 200 });
    const f = join(dir, 'direct_' + eng + '.png');
    await run('R6b.render.' + eng, `doc.render(${JSON.stringify(f)}); return "ok";`);
    try { const p = readPng(f); record('R6b.alpha.' + eng, { channels: p.channels, cornerRGBA: p.at(1, 1), midLeftRGBA: p.at(1, 100) }); } catch (e) { record('R6b.alpha.' + eng, { error: String(e) }); }
  }
  await run('R6c.cameraParams', `const c=doc.activeCamera(); const out=[]; const pi=c.parameterInfo(); for(let q=0;q<pi.length;q++) out.push(pi[q][0]+":"+pi[q][1]); return out.join(", ");`);

  // R7b: projection invariance under camera distance (orthographic should not change with distance)
  cam = await stage();
  await tool('l', 'c3d_set_light', { name: 'L', light_type: 3, position: [3, 5, 0], intensity: 1, params: { attenuation: 0 } });
  for (const pr of [0, 1, 2]) {
    const grids = [];
    for (const h of [14, 28]) { await tool('mv', 'c3d_set_camera', { ref: { id: cam }, position: [0, h, 0.01], look_at_point: [0, 0, 0], params: { projection: pr } }); const p = await rend('R7b.projection' + pr + '.h' + h, 'pr' + pr + '_' + h); if (p) grids.push(p.grid(5, 5)[2]); }
    record('R7b.projection' + pr, { rowAtH14vsH28: grids });
  }

  // R3: area light 'Visible in camera' (geometry)
  await call('c3d_new_document', {});
  await tool('rs', 'c3d_set_render_settings', { renderer: 'FALCON', width: 320, height: 320, params: { samples: 40 } });
  await tool('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 0, 8], look_at_point: [0, 3, 0], fov: 40, active: true, params: { backgroundColor: [0, 0, 0, 1], cameraLightOnOff: 0 } });
  const A = (await tool('area', 'c3d_set_light', { name: 'Area', light_type: 1, position: [0, 3, 0], intensity: 1, params: { attenuation: 0 } })).sc?.object?.id;
  for (const g of [0, 1]) { await set(A, { geometry: g }); const p = await rend('R3.geometry' + g, 'geo' + g); if (p) record('R3.geometry' + g, { mean: +p.region(0, 0, p.w, p.h).toFixed(4), centerGrid: p.grid(5, 5)[2] }); }

  // R4: does emission light neighbouring surfaces in Falcon?
  cam = await stage({ cameraLightOnOff: 0 });
  const emitCode = (v) => `const m=doc.addMaterial("Material","EmitMat"); const rn=m.rootNode(); rn.setParameter("diffColor",new Vec4D(0.1,0.1,0.1,1)); rn.setParameter("emisColor",new Vec4D(${v},${v},${v},1)); const root=doc.root(); let box=null; for(let i=0;i<root.childCount();i++){ const c=root.childAtIndex(i); if(c.getParameter("name")==="Pole") box=c; } const t=box.addTagOfType(SHADERTAG); t.setParameter("material",m); return box.tagCount();`;
  for (const v of [0, 1, 5]) {
    await call('c3d_new_document', {});
    await tool('rs', 'c3d_set_render_settings', { renderer: 'FALCON', width: 320, height: 320, params: { samples: 60 } });
    await tool('floor', 'c3d_create_object', { type: 'BOX', name: 'Floor', position: [0, -0.05, 0], params: { sizeX: 12, sizeY: 0.1, sizeZ: 12 } });
    await tool('pole', 'c3d_create_object', { type: 'BOX', name: 'Pole', position: [0, 1.5, 0], params: { sizeX: 0.5, sizeY: 3, sizeZ: 0.5 } });
    await tool('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 14, 0.01], look_at_point: [0, 0, 0], fov: 40, active: true, params: { backgroundColor: [0, 0, 0, 1], cameraLightOnOff: 0 } });
    await run('R4.setup.emis' + v, emitCode(v));
    const p = await rend('R4.emission' + v, 'emis' + v); if (p) record('R4.emission' + v, { floorGrid: p.grid(5, 5) });
  }
}

if (phases.includes('render3')) {
  const dir = process.env.KB_RENDER_DIR ?? '/tmp/kb-verify-render'; mkdirSync(dir, { recursive: true });
  const rend = async (id, name) => { const f = join(dir, name + '.png'); const r = await call('c3d_render_image', { path: f }); if (r.isError) { record(id, { error: r.sc?.error ?? r.text }); return null; } return readPng(f); };
  const set = (ref, params) => tool('set', 'c3d_set_parameters', { ref: { id: ref }, params });
  // R6d: background VISIBLE (no floor): is alpha honoured? both engines; camera light auto-on
  for (const eng of ['FALCON', 'CHEETAH']) {
    await call('c3d_new_document', {});
    await tool('rs', 'c3d_set_render_settings', { renderer: eng, width: 200, height: 200 });
    await tool('box', 'c3d_create_object', { type: 'BOX', name: 'Box', position: [0, 0, 0], params: { sizeX: 1, sizeY: 1, sizeZ: 1 } });
    const cam = (await tool('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 0, 8], look_at_point: [0, 0, 0], fov: 40, active: true })).sc?.object?.id;
    for (const bg of [[0.2, 0.4, 0.8, 1], [0.2, 0.4, 0.8, 0], [0, 0, 0, 0]]) {
      await set(cam, { backgroundColor: bg });
      const p = await rend('R6d.' + eng + '.' + bg.join(','), `bg_${eng}_${bg.join('_')}`);
      if (p) record('R6d.' + eng + '.' + bg.join(','), { channels: p.channels, corner: p.at(2, 2), center: p.at(100, 100) });
    }
  }
  // R9: Shadowmat ground + transparent background: alpha under shadow?
  await call('c3d_new_document', {});
  await tool('rs', 'c3d_set_render_settings', { renderer: 'FALCON', width: 240, height: 240, params: { samples: 60 } });
  await tool('ground', 'c3d_create_object', { type: 'PLANE', name: 'Ground', position: [0, 0, 0], params: {} });
  await tool('box', 'c3d_create_object', { type: 'BOX', name: 'Box', position: [0, 1, 0], params: { sizeX: 1, sizeY: 1, sizeZ: 1 } });
  await tool('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 9, 7], look_at_point: [0, 0, 0], fov: 40, active: true, params: { backgroundColor: [0.2, 0.4, 0.8, 0], cameraLightOnOff: 0 } });
  await tool('l', 'c3d_set_light', { name: 'Sun', light_type: 2, position: [4, 8, 2], look_at_point: [0, 0, 0], intensity: 1 });
  await run('R9.shadowmat', `const g=doc.root(); let ground=null; for(let i=0;i<g.childCount();i++){ const c=g.childAtIndex(i); if(c.getParameter("name")==="Ground") ground=c; } const m=doc.addMaterial("Shadowmat","ShadowCatcher"); const t=ground.addTagOfType(SHADERTAG); t.setParameter("material",m); const rn=m.rootNode(); const info=rn.parameterInfo(); const a=[]; for(let q=0;q<info.length;q++) a.push(info[q][0]+":"+info[q][1]); return {rootType:rn.nodeType(), params:a.join(", ")};`);
  const p9 = await rend('R9.render', 'shadowmat');
  if (p9) { const a = []; for (const [x, y] of [[5, 5], [120, 20], [120, 120], [90, 150], [150, 130], [120, 200]]) a.push([x, y, p9.at(x, y)]); record('R9.pixels', { channels: p9.channels, samples: a }); }
  // R4b: emission parameters of the material root node and clamping
  await run('R4b.emisParams', `const m=doc.addMaterial("Material","E"); const rn=m.rootNode(); const info=rn.parameterInfo(); const a=[]; for(let q=0;q<info.length;q++) a.push(info[q][0]+":"+info[q][1]); rn.setParameter("emisColor",new Vec4D(5,5,5,1)); const v=rn.getParameter("emisColor"); return {params:a.join(", "), emisReadback:[v.x,v.y,v.z,v.w]};`);
}

if (phases.includes('render4')) {
  const dir = process.env.KB_RENDER_DIR ?? '/tmp/kb-verify-render'; mkdirSync(dir, { recursive: true });
  await call('c3d_new_document', {});
  await tool('rs', 'c3d_set_render_settings', { renderer: 'FALCON', width: 240, height: 240, params: { samples: 60 } });
  await tool('ground', 'c3d_create_object', { type: 'PLANE', name: 'Ground', position: [0, 0, 0], params: {} });
  await tool('box', 'c3d_create_object', { type: 'BOX', name: 'Box', position: [0, 1, 0], params: { sizeX: 1, sizeY: 1, sizeZ: 1 } });
  await tool('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 9, 7], look_at_point: [0, 0, 0], fov: 40, active: true, params: { backgroundColor: [0.2, 0.4, 0.8, 0], cameraLightOnOff: 0 } });
  await tool('l', 'c3d_set_light', { name: 'Sun', light_type: 2, position: [4, 8, 2], look_at_point: [0, 0, 0], intensity: 1 });
  await run('R9b.setup', `const g=doc.root(); let ground=null; for(let i=0;i<g.childCount();i++){ const c=g.childAtIndex(i); if(c.getParameter("name")==="Ground") ground=c; } const m=doc.addMaterial("Shadowmat","ShadowCatcher"); const t=ground.addTagOfType(SHADERTAG); t.setParameter("material",m); const rn=m.rootNode(); return {color:[rn.getParameter("color").x,rn.getParameter("color").y,rn.getParameter("color").z,rn.getParameter("color").w], whitePoint:rn.getParameter("whitePoint")};`);
  for (const [wp, col] of [[1, null], [0.1, null], [0.5, null], [1, [0, 0, 0, 1]], [0.1, [0, 0, 0, 1]]]) {
    await run('R9b.set', `const m=doc.materialAtIndex(doc.materialCount()-1); const rn=m.rootNode(); rn.setParameter("whitePoint",${wp}); ${col ? `rn.setParameter("color",new Vec4D(${col.join(',')}));` : ''} return rn.getParameter("whitePoint");`);
    const f = join(dir, `shadowmat_${wp}_${col ? 'blk' : 'def'}.png`);
    const r = await call('c3d_render_image', { path: f });
    if (r.isError) { record('R9b.render', { error: r.text }); continue; }
    const pg = readPng(f); let maxA = 0, cnt = 0, minRGBsum = 999;
    for (let y = 0; y < pg.h; y++) for (let x = 0; x < pg.w; x++) { const a = pg.at(x, y); if (a[3] > 0 && a[3] < 255) { cnt++; if (a[3] > maxA) { maxA = a[3]; minRGBsum = a[0] + a[1] + a[2]; } } }
    record(`R9b.whitePoint${wp}.${col ? 'colorBlack' : 'colorDefault'}`, { semiPixels: cnt, maxSemiAlpha: maxA, rgbAtMax: minRGBsum });
  }
}

if (phases.includes('render5')) {
  const dir = process.env.KB_RENDER_DIR ?? '/tmp/kb-verify-render'; mkdirSync(dir, { recursive: true });
  const build = async (eng, ltype) => {
    await call('c3d_new_document', {});
    await tool('rs', 'c3d_set_render_settings', { renderer: eng, width: 240, height: 240 });
    await tool('ground', 'c3d_create_object', { type: 'PLANE', name: 'Ground', position: [0, 0, 0], params: {} });
    await tool('box', 'c3d_create_object', { type: 'BOX', name: 'Box', position: [0, 1, 0], params: { sizeX: 1, sizeY: 1, sizeZ: 1 } });
    await tool('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 9, 7], look_at_point: [0, 0, 0], fov: 40, active: true, params: { backgroundColor: [0.2, 0.4, 0.8, 0], cameraLightOnOff: 0 } });
    await tool('l', 'c3d_set_light', ltype === 2 ? { name: 'Sun', light_type: 2, position: [4, 8, 2], look_at_point: [0, 0, 0], intensity: 1 } : { name: 'Pt', light_type: 3, position: [3, 6, 2], intensity: 1, params: { attenuation: 0 } });
    await run('setup', `const g=doc.root(); let ground=null; for(let i=0;i<g.childCount();i++){ const c=g.childAtIndex(i); if(c.getParameter("name")==="Ground") ground=c; } const m=doc.addMaterial("Shadowmat","ShadowCatcher"); const t=ground.addTagOfType(SHADERTAG); t.setParameter("material",m); return 1;`);
    const f = join(dir, `sm_${eng}_${ltype}.png`); await call('c3d_render_image', { path: f }); const pg = readPng(f);
    let semi = 0, maxA = 0, shadowish = 0; for (let y = 0; y < pg.h; y++) for (let x = 0; x < pg.w; x++) { const a = pg.at(x, y); if (a[3] > 0 && a[3] < 255) { semi++; maxA = Math.max(maxA, a[3]); } if (a[3] > 20 && a[3] < 200) shadowish++; }
    // pixels away from the box silhouette (box occupies roughly x 95..145 / y 70..135): count semi-alpha outside it
    let outside = 0; for (let y = 0; y < pg.h; y++) for (let x = 0; x < pg.w; x++) { const a = pg.at(x, y); if (a[3] > 0 && !(x > 90 && x < 150 && y > 65 && y < 140)) outside++; }
    record(`R9c.${eng}.light${ltype}`, { semi, maxA, shadowish, nonClearOutsideBoxArea: outside });
  };
  for (const eng of ['CHEETAH', 'FALCON']) for (const lt of [2, 3]) await build(eng, lt);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ app: 'Cheetah3D 8.1.3', date: new Date().toISOString(), phases: [...new Set([...(prior.phases ?? []), ...phases])], results }, null, 2));
console.log('WROTE', outFile);
await close();
