function nm(o){try{return o.getParameter('name');}catch(e){return '<noname>';}}
function probeMain(doc){
  assertMarker(doc);
  var R={};
  // material color + assign
  var b=doc.addObject(BOX);b.setParameter('name','MB');
  var m=doc.addMaterial('Material','probeMat');
  var rn=m.rootNode();
  R.setDiff=tryf(function(){rn.setParameter('diffColor',new Vec4D(1,0,0,1));var v=rn.getParameter('diffColor');return [v.x,v.y,v.z,v.w];});
  R.matColor=tryf(function(){var c=m.color();return String(c);});
  var tag=b.addTagOfType(SHADERTAG);
  R.assign=tryf(function(){tag.setParameter('material',m);var l=tag.getParameter('material');return nm(l);});
  R.materialTags=tryf(function(){return b.materialTags().length;});
  R.linked=tryf(function(){return tag.linkedToMaterial()?nm(tag.linkedToMaterial()):'none';});
  // P18 texture
  R.p18={};
  var img=m.addNodeOfType('image');
  R.p18.setTexPath=tryf(function(){img.setParameter('texture','/tmp/c3d-scratch');var t=img.getParameter('texture');return {t:typeof t,w:t&&t.width?t.width():'n/a',fn:t&&t.filename?t.filename():'n/a'};});
  R.p18.setTexString=tryf(function(){rn.setParameter('diffColor.tex','/tmp/c3d-scratch');return 'ok';});
  R.p18.tex=tryf(function(){var t=new Texture('/tmp/c3d-scratch');return {w:t.width(),h:t.height()};});
  R.p18.connect=tryf(function(){m.addConnection(img.id(),'color',rn.id(),'diffColor');return 'ok';});
  // P31 per-polygon
  R.p31={};
  var po=doc.addObject(POLYGONOBJ);po.setParameter('name','PolyP31');
  var core=po.core();
  var vs=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[2,0,0],[2,1,0]];
  for(var i=0;i<vs.length;i++){core.addVertex(false,new Vec3D(vs[i][0],vs[i][1],vs[i][2]));}
  core.addIndexPolygon(4,[0,1,2,3],[]);
  core.addIndexPolygon(4,[1,4,5,2],[]);
  po.update();
  R.p31.counts=[core.vertexCount(),core.polygonCount()];
  R.p31.mti=tryf(function(){return [core.materialTagIndex(0),core.materialTagIndex(1)];});
  R.p31.setSel=tryf(function(){core.setActivePolygonSelection(1);core.setPolygonSelection(1,1,1);core.setActivePolygonSelection(0);return 'ok';});
  var t1=po.addTagOfType(SHADERTAG);var t2=po.addTagOfType(SHADERTAG);
  t1.setParameter('material',m);
  R.p31.shadeSelectionDefault=t1.getParameter('shadeSelection');
  R.p31.setShadeSel=tryf(function(){t1.setParameter('shadeSelection',1);return t1.getParameter('shadeSelection');});
  R.p31.mti2=tryf(function(){return [core.materialTagIndex(0),core.materialTagIndex(1)];});
  R.p31.polySelState=tryf(function(){return [core.polygonSelection(0),core.polygonSelection(1)];});
  // bad polygon index: validate we DON'T test (fatal)
  // P36: setPolygonSize exists
  R.p31.setPolygonSize=typeof core.setPolygonSize;
  // P12 unmatched release
  R.p12={};
  try{doc.releaseRedrawLock();R.p12.unmatchedRelease='no throw';}catch(e){R.p12.unmatchedRelease=String(e);}
  try{doc.retainRedrawLock();doc.retainRedrawLock();doc.releaseRedrawLock();R.p12.afterTwoRetainOneRelease='locked-one';doc.releaseRedrawLock();}catch(e){R.p12.err=String(e);}
  doc.root().removeChild(b);doc.root().removeChild(po);doc.removeMaterial(m);
  return R;
}
