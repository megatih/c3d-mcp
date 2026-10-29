// P16 re-dump: string param types, vec reads, material nodes, renderer, camera
function nm(o){try{return o.getParameter('name');}catch(e){return '<noname>';}}
function ser(o,name,type){
  try{
    var v=o.getParameter(name);
    if(type==='Vec2D')return {x:v.x,y:v.y};
    if(type==='Vec3D')return {x:v.x,y:v.y,z:v.z};
    if(type==='Vec4D')return {x:v.x,y:v.y,z:v.z,w:v.w};
    if(type==='Texture')return {tex:String(v)};
    if(type==='Link')return v?{link:nm(v)}:null;
    if(typeof v==='number'||typeof v==='string'||typeof v==='boolean')return v;
    return {other:String(v),t:typeof v};
  }catch(e){return {unreadable:String(e).substring(0,60)};}
}
function dump(o){var info=o.parameterInfo(),out=[];for(var i=0;i<info.length;i++){out.push({n:info[i][0],t:info[i][1],v:ser(o,info[i][0],info[i][1])});}return out;}
function probeMain(doc){
  assertMarker(doc);
  var R={types:{}};
  // cleanup leaked probe materials
  for(var i=doc.materialCount()-1;i>=0;i--){var m=doc.materialAtIndex(i);if(String(nm(m)).indexOf('pm')===0)doc.removeMaterial(m);}
  R.matsAfterClean=doc.materialCount();
  var cam=doc.activeCamera();R.camera=dump(cam);
  R.renderer=dump(doc.currentRenderer());
  R.renderers=[];for(var r=0;r<doc.rendererCount();r++){var rr=doc.rendererAtIndex(r);R.renderers.push({i:r,params:dump(rr)});}
  var mat=doc.addMaterial('Material','pnode');
  R.material=dump(mat);R.rootNode={type:mat.rootNode().nodeType(),id:mat.rootNode().id(),params:dump(mat.rootNode()),inputs:mat.rootNode().inputCount(),outputs:mat.rootNode().outputCount()};
  R.rootNodeIO={};
  var rn=mat.rootNode();R.rootNodeIO.inputs=[];for(var k=0;k<rn.inputCount();k++){R.rootNodeIO.inputs.push(String(rn.inputAtIndex(k)));}
  R.nodes={};
  var nt=['carpaint','dielectric','material','membrane','metal','pbrmetal','shadow','solid','toon','velvet','brick','cellnoise','checkerboard','directional','dots','fractal','image','marble','noise','reptile','turbulence','voronoi','wireframe','wood','abs','add','cosine','crossprod','divide','dotprod','float2vec','mix','modulo','multiply','multiplyadd','norm','power','pulse','pulsetrain','sine','squareroot','step','subtract','tangent','vec2float','composite','gradient','hsv2rgb','rgb2hsv','color','number','vector','instancestate','state'];
  for(var j=0;j<nt.length;j++){try{var n=mat.addNodeOfType(nt[j]);R.nodes[nt[j]]=n?{id:n.id(),type:n.nodeType(),ins:n.inputCount(),outs:n.outputCount(),params:dump(n),io:(function(){var a=[],b=[];for(var q=0;q<n.inputCount();q++)a.push(String(n.inputAtIndex(q)));for(var q2=0;q2<n.outputCount();q2++)b.push(String(n.outputAtIndex(q2)));return {i:a,o:b};})()}:'null';}catch(e){R.nodes[nt[j]]=String(e);}}
  R.nodeCount=mat.nodeCount();
  doc.removeMaterial(mat);
  // type string distribution
  var seen={};function add(list){for(var x=0;x<list.length;x++)seen[list[x].t]=1;}
  add(R.camera);add(R.renderer);add(R.material);
  for(var key in R.nodes){if(R.nodes[key]&&R.nodes[key].params)add(R.nodes[key].params);}
  R.typeStrings=[];for(var s in seen)R.typeStrings.push(s);
  return R;
}
