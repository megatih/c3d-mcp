function probeMain(doc){
  assertMarker(doc);var R={};
  var mA=doc.addMaterial('Material','mA'),mB=doc.addMaterial('Material','mB');
  var po=doc.addObject(POLYGONOBJ);var core=po.core();
  var vs=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[2,0,0],[2,1,0],[3,0,0],[3,1,0]];
  for(var i=0;i<vs.length;i++)core.addVertex(false,new Vec3D(vs[i][0],vs[i][1],vs[i][2]));
  core.addIndexPolygon(4,[0,1,2,3],[]);core.addIndexPolygon(4,[1,4,5,2],[]);core.addIndexPolygon(4,[4,6,7,5],[]);
  po.update();
  var tA=po.addTagOfType(SHADERTAG);tA.setParameter('material',mA);   // whole object (selection 0)
  var tB=po.addTagOfType(SHADERTAG);tB.setParameter('material',mB);
  core.setActivePolygonSelection(2);
  core.setPolygonSelection(0,false);core.setPolygonSelection(1,true);core.setPolygonSelection(2,true);
  R.selVals2=[core.polygonSelection(0),core.polygonSelection(1),core.polygonSelection(2)];
  core.setActivePolygonSelection(0);
  tB.setParameter('shadeSelection',2);po.update();tB.update();doc.redrawAll();
  R.sel2b=(function(){core.setActivePolygonSelection(2);var v=[core.polygonSelection(0),core.polygonSelection(1),core.polygonSelection(2)];core.setActivePolygonSelection(0);return v;})();
  R.shade=tB.getParameter('shadeSelection');
  R.mti=[core.materialTagIndex(0),core.materialTagIndex(1),core.materialTagIndex(2)];
  R.tagOrder=[0,1].map(function(i){var t=po.materialTags()[i];return t.getParameter('material').getParameter('name');});
  R.selVals=[core.polygonSelection(0),core.polygonSelection(1),core.polygonSelection(2)];
  R.priority=[tA.getParameter('priority'),tB.getParameter('priority')];
  po.setParameter('name','P31OBJ');
  return R;
}
