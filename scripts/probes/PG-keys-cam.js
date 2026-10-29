function nm(o){try{return o.getParameter('name');}catch(e){return '<noname>';}}
function probeMain(doc){
  assertMarker(doc);
  var R={};
  var b=doc.addObject(BOX);b.setParameter('name','KB');
  R.p14={};
  try{
    var take=doc.currentTake();R.p14.take={name:take.name,len:take.length,takes:doc.takeCount()};
    var prm=b.parameterWithName('position');
    R.p14.paramType=String(prm.type());R.p14.anim=prm.isAnimatable();R.p14.tnCountBefore=prm.takeNodeCount();
    var tn=prm.takeNodeWithName(take.name);R.p14.tnExisting=!!tn;
    if(!tn)tn=prm.addTakeNode(take.name);
    R.p14.tnCurves=tn.fCurveCount();
    var fc=tn.fCurveAtIndex(1);
    var k=new FCurveKey();k.time=0;k.value=0;fc.addKey(k);
    var k2=new FCurveKey();k2.time=1;k2.value=3;fc.addKey(k2);
    fc.update();
    R.p14.keys=fc.keyCount();
    var q=fc.keyAtIndex(0);R.p14.k0={time:q.time,value:q.value,lt:q.left_type,rt:q.right_type,lv:q.left_value,rv:q.right_value,lti:q.left_time,rti:q.right_time,sel:q.selected};
    R.p14.valueAt05=fc.valueAtTime(0.5);
    doc.setAnimPosition(0.5);R.p14.posAt05=b.getParameter('position').y;
    doc.setAnimPosition(1);R.p14.posAt1=b.getParameter('position').y;
    doc.setAnimPosition(0);
    R.p14.totalKeys=tn.totalKeyCount();
    R.p14.curvesAfter=tn.fCurveCount();
    R.p14.xKeys=tn.fCurveAtIndex(0).keyCount();
    R.p14.interpVals={};var names=['LINEAR_INTERPOL','SOFT_INTERPOL','SPLINE_INTERPOL','FLAT_INTERPOL','CONST_INTERPOL','LINEAR','SOFT'];
    for(var i=0;i<names.length;i++){try{R.p14.interpVals[names[i]]=(0,eval)(names[i]);}catch(e){R.p14.interpVals[names[i]]='undef';}}
    // set interpolation type via key
    var k3=new FCurveKey();k3.time=2;k3.value=0;k3.left_type=0;k3.right_type=0;fc.addKey(k3);fc.update();
    R.p14.keysAfter3=fc.keyCount();
    // remove
    fc.removeAllKeys();fc.update();R.p14.afterRemoveAll=fc.keyCount();
  }catch(e){R.p14.err=String(e);}
  // P32 switching
  R.p32={};
  var camA=doc.activeCamera();var an=nm(camA);
  var cam2=doc.addObject(CAMERA);cam2.setParameter('name','Cam2');
  R.p32.afterAdd=nm(doc.activeCamera());
  camA.setParameter('activeCamera',1);
  R.p32.afterSetOld=nm(doc.activeCamera());
  R.p32.flags=[camA.getParameter('activeCamera'),cam2.getParameter('activeCamera')];
  doc.root().removeChild(cam2);
  R.p32.final=nm(doc.activeCamera());
  doc.root().removeChild(b);
  R.ids={};try{var o1=doc.addObject(BOX),o2=doc.addObject(BOX);R.ids.a=o1.id();R.ids.b=o2.id();R.ids.again=o1.id();o1.setParameter('name','renamed');R.ids.afterRename=o1.id();doc.root().removeChild(o1);doc.root().removeChild(o2);}catch(e){R.ids.err=String(e);}
  // P12: lock nesting (safe form): retain x2, release x2
  R.p12={};
  try{doc.retainRedrawLock();doc.retainRedrawLock();doc.releaseRedrawLock();doc.releaseRedrawLock();R.p12.nested='ok';}catch(e){R.p12.nested=String(e);}
  // P03: 200 file ops timing
  var t0=new Date().getTime();for(var z=0;z<200;z++){var f=new File(TMP+'bulk'+z+'.json');f.open(WRITE_MODE);f.write('{"a":'+z+'}');f.close();}
  R.p03={ms200writes:new Date().getTime()-t0};
  var t1=new Date().getTime();var lst=new File(TMP).contentOfDir();R.p03.listMs=new Date().getTime()-t1;R.p03.listLen=lst.length;
  return R;
}
