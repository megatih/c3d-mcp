// batch B: P16 P17 P19 P20 P13 P33 P30 — object creation, param dumps, naming
function nm(o){try{return o.getParameter('name');}catch(e){return '<noname>';}}
function ser(o,name,type){
  try{
    var v=o.getParameter(name);
    if(type===VEC2D_PARAMETER)return {x:v.x,y:v.y};
    if(type===VEC3D_PARAMETER)return {x:v.x,y:v.y,z:v.z};
    if(type===VEC4D_PARAMETER)return {x:v.x,y:v.y,z:v.z,w:v.w};
    if(type===TEXTURE_PARAMETER)return {tex:String(v)};
    if(type===LINK_PARAMETER)return v?{link:String(v.getParameter('name'))}:null;
    if(typeof v==='number'||typeof v==='string'||typeof v==='boolean')return v;
    return {other:String(v)};
  }catch(e){return {unreadable:String(e).substring(0,60)};}
}
function dump(o){
  var info=o.parameterInfo(),out=[];
  for(var i=0;i<info.length;i++){out.push({n:info[i][0],t:info[i][1],v:ser(o,info[i][0],info[i][1])});}
  return out;
}
function probeMain(doc){
  assertMarker(doc);
  var R={objects:{},fails:{}};
  var types=['BALL','BOX','DISC','CONE','CAPSULE','CYLINDER','PLANE','POLYHEDRA','TORUS','TUBE','STAIR','POLYGONOBJ','CIRCLE','COG','FLOWER','HELIX','LINE','NEDGE','RECT','SPLINE','STAR','BLUEPRINT','CAMERA','FOLDER','BOOLEAN','CHAIN','EXTRUDE','ISOSURFACE','LATHE','POLYPLANE','RELIEF','SUBDIV','SWEEP','SYMMETRY','PARTICLE','PARTICLEEMITTER','PARTICLEARRAY','PARTICLEMESH','PARTICLESPLINE','ORIENTATIONEFF','LIGHT','POINTLIGHT','JOINT','SMARTFOLDER','LOFT','BACKGROUND','TRIANGULATEMOD','WIREFRAMEMOD','ENVIRONMENTLIGHT'];
  var created=[];
  doc.retainRedrawLock();
  try{
  for(var i=0;i<types.length;i++){
    var tn=types[i],c=(0,eval)('typeof '+tn+'==="undefined"?undefined:'+tn);
    if(c===undefined){R.fails[tn]='undefined constant';continue;}
    try{
      var o=doc.addObject(c);
      if(!o){R.fails[tn]='null';continue;}
      created.push(o);
      R.objects[tn]={name:o.getParameter('name'),family:o.family(),type:o.type(),params:dump(o),tags:o.tagCount(),childCount:o.childCount(),hasCore:(function(){try{return !!o.core();}catch(e){return false;}})()};
    }catch(e){R.fails[tn]=String(e);}
  }
  }finally{doc.releaseRedrawLock();}
  // light types
  R.lights=[];
  try{for(var lt=0;lt<8;lt++){var L=doc.addObject(LIGHT);created.push(L);try{L.setParameter('lightType',lt);R.lights.push({lt:lt,read:L.getParameter('lightType'),params:dump(L).map(function(p){return p.n;})});}catch(e){R.lights.push({lt:lt,err:String(e)});}}}catch(e){R.lights.push({err:String(e)});}
  // naming P20
  R.naming={};
  var a=doc.addObject(BOX),b=doc.addObject(BOX),c2=doc.addObject(BOX);created.push(a,b,c2);
  a.setParameter('name','Dup');b.setParameter('name','Dup');c2.setParameter('name','a/b');
  R.naming={a:a.getParameter('name'),b:b.getParameter('name'),slash:c2.getParameter('name')};
  var f=doc.addObject(FOLDER);created.push(f);f.setParameter('name','Dup');R.naming.folderDup=f.getParameter('name');
  // names with unicode
  try{var u=doc.addObject(BOX);created.push(u);u.setParameter('name','名前');R.naming.uni=u.getParameter('name').charCodeAt(0);}catch(e){R.naming.uni=String(e);}
  // tags
  R.tags={};
  var tagTypes=['ANCHORTAG','IKHANDLETAG','IKCONSTRAINTTAG','METABALLTAG','MODETAG','MORPHTAG','ORIENTCONSTRAINTTAG','PARENTCONSTRAINTTAG','PARTICLETAG','POINTCONSTRAINTTAG','POSETAG','PROPWINTAG','RIGIDBODYTAG','ROPETAG','SKELETONTAG','SOFTBODYTAG','SPLINEIKTAG','SHADERTAG','FOGTAG','RADIOSITYTAG','HDRITAG','DOFTAG','RENDERTAG','CAUSTICTAG','SPLINETRACKINGTAG','TARGETTAG'];
  var host=doc.addObject(BOX);created.push(host);
  for(var j=0;j<tagTypes.length;j++){
    var tc=(0,eval)('typeof '+tagTypes[j]+'==="undefined"?undefined:'+tagTypes[j]);
    if(tc===undefined){R.tags[tagTypes[j]]='undefined';continue;}
    try{var tg=host.addTagOfType(tc);R.tags[tagTypes[j]]=tg?{type:tg.type(),family:tg.family(),params:dump(tg)}:'null';}catch(e){R.tags[tagTypes[j]]=String(e);}
  }
  R.tagCountOnHost=host.tagCount();
  // P33 removeChild
  var root=doc.root();R.rootChildrenBefore=root.childCount();
  R.p33={};
  var victim=doc.addObject(BOX);victim.setParameter('name','VictimX');
  var parentBefore=victim.owner?String(victim.owner()):'n/a';
  root.removeChild(victim);
  R.p33.afterRemove={rootChildren:root.childCount(),stillReadable:tryf(function(){return victim.getParameter('name');}),owner:tryf(function(){return victim.owner()===null||victim.owner()===undefined?'null':'obj';})};
  // cleanup: remove all created from root (they are direct children of root) 
  for(var k=0;k<created.length;k++){try{root.removeChild(created[k]);}catch(e){}}
  R.rootChildrenAfter=root.childCount();
  // materials P19
  R.materials={};
  var mt=['Material','Material (PBR)','PBR','Standard','Toon','Metal','Glass','Cheetah3D Material','pbrmetal','shader'];
  var mats=[];
  for(var m=0;m<mt.length;m++){try{var mm=doc.addMaterial(mt[m],'pm'+m);R.materials[mt[m]]=mm?{name:mm.getParameter('name'),root:mm.rootNode()?mm.rootNode().nodeType():null}:'null';}catch(e){R.materials[mt[m]]=String(e);}}
  R.materialCount=doc.materialCount();
  // doc info P13
  R.doc={fps:tryf(function(){return doc.animationFPS();}),time:tryf(function(){return doc.animationTime();}),pos:tryf(function(){return doc.animPosition();}),end:tryf(function(){return doc.animationEnd();}),editMode:doc.editMode(),takes:doc.takeCount(),renderers:doc.rendererCount(),currentRenderer:nm(doc.currentRenderer()),cam:nm(doc.activeCamera())};
  R.sel={selectedObject:tryf(function(){return doc.selectedObject().getParameter('name');}),selectedObjects:tryf(function(){return doc.selectedObjects(false).length;})};
  return R;
}
