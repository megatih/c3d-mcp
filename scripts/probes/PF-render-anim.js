function nm(o){try{return o.getParameter('name');}catch(e){return '<noname>';}}
function probeMain(doc){
  assertMarker(doc);
  var R={};var D='/tmp/c3d-scratch/probe/render/';
  var b=doc.addObject(BOX);b.setParameter('name','RB');
  var rend=doc.currentRenderer();
  R.resSet=tryf(function(){rend.setParameter('resolution',new Vec2D(320,240));var v=rend.getParameter('resolution');return {x:v.x,y:v.y};});
  var t0=new Date().getTime();
  R.renderPng=tryf(function(){var rv=doc.render(D+'r1.png');return String(rv);});R.renderPngMs=new Date().getTime()-t0;
  R.png={exists:new File(D+'r1.png').exist(),size:new File(D+'r1.png').size()};
  var fmts=['jpg','tiff','exr','tga','bmp'];R.fmts={};
  for(var i=0;i<fmts.length;i++){var p=D+'r_x.'+fmts[i];R.fmts[fmts[i]]=tryf(function(){doc.render(p);return {exists:new File(p).exist(),size:new File(p).size()};});}
  // P13
  R.p13={};
  R.p13.setFps=tryf(function(){doc.setAnimationFPS(24);return doc.animationFPS();});
  R.p13.setTime=tryf(function(){doc.setAnimationTime(1.5);return [doc.animationTime(),doc.animPosition()];});
  R.p13.setAnimPos=tryf(function(){doc.setAnimPosition(2);return [doc.animationTime(),doc.animPosition()];});
  R.p13.end=tryf(function(){return doc.animationEnd();});
  R.p13.setFpsBack=tryf(function(){doc.setAnimationFPS(30);doc.setAnimPosition(0);return doc.animationFPS();});
  // P14 keyframes
  R.p14={};
  try{
    var take=doc.currentTake();R.p14.take={name:take.name?take.name():'?',takes:doc.takeCount()};
    var prm=b.parameterWithName('position');
    R.p14.paramType=prm.type();R.p14.anim=prm.isAnimateable();
    var tn=prm.takeNodeWithName(R.p14.take.name)||prm.addTakeNode(R.p14.take.name);
    R.p14.tnCurves=tn.fCurveCount();
    var fc=tn.fCurveAtIndex(1);
    var k=new FCurveKey();k.time=0;k.value=0;fc.addKey(k);
    var k2=new FCurveKey();k2.time=1;k2.value=3;fc.addKey(k2);
    fc.update();
    R.p14.keys=fc.keyCount();R.p14.k0=(function(){var q=fc.keyAtIndex(0);return {time:q.time,value:q.value,lt:q.left_type,rt:q.right_type,lv:q.left_value,rv:q.right_value,lti:q.left_time,rti:q.right_time};})();
    R.p14.valueAt05=fc.valueAtTime(0.5);
    doc.setAnimPosition(0.5);R.p14.posAt05=b.getParameter('position').y;
    doc.setAnimPosition(1);R.p14.posAt1=b.getParameter('position').y;
    doc.setAnimPosition(0);
    R.p14.totalKeys=tn.totalKeyCount();
    R.p14.interp={LINEAR_INTERPOL:typeof LINEAR_INTERPOL,SOFT_INTERPOL:typeof SOFT_INTERPOL,SPLINE_INTERPOL:typeof SPLINE_INTERPOL,FLAT_INTERPOL:typeof FLAT_INTERPOL,CONST_INTERPOL:typeof CONST_INTERPOL};
    R.p14.interpVals={};for(var nme in {LINEAR_INTERPOL:1,SOFT_INTERPOL:1,SPLINE_INTERPOL:1,FLAT_INTERPOL:1,CONST_INTERPOL:1}){try{R.p14.interpVals[nme]=(0,eval)(nme);}catch(e){}}
  }catch(e){R.p14.err=String(e);}
  // P15 euler
  R.p15={};
  try{
    b.setParameter('rotation',new Vec3D(30,45,60));
    var m=b.obj2WorldMatrix();R.p15.m=[m.m00,m.m01,m.m02,m.m10,m.m11,m.m12,m.m20,m.m21,m.m22];
    R.p15.rotorder=b.getParameter('rotorder');
    var v=new Vec3D(30,45,60);var c=v.convertEuler(ROT_HPB,ROT_XYZ);R.p15.conv=[c.x,c.y,c.z];
    var c2=v.convertEuler(ROT_XYZ,ROT_HPB);R.p15.conv2=[c2.x,c2.y,c2.z];
    b.setParameter('rotation',new Vec3D(0,0,0));
  }catch(e){R.p15.err=String(e);}
  // P30 selection
  R.p30={};
  doc.selectObject(b,false);
  R.p30.sel=tryf(function(){return nm(doc.selectedObject());});
  R.p30.list=tryf(function(){return doc.selectedObjects(false).length;});
  R.p30.rootWhenNone=tryf(function(){doc.selectObject(doc.root(),false);var s=doc.selectedObject();return s?nm(s):'none';});
  // P32 camera switching
  R.p32={};
  var cam2=doc.addObject(CAMERA);cam2.setParameter('name','Cam2');
  R.p32.before=nm(doc.activeCamera());
  R.p32.setParam=tryf(function(){cam2.setParameter('activeCamera',1);return nm(doc.activeCamera());});
  R.p32.camFlag=tryf(function(){return [doc.root().childAtIndex(0).getParameter('activeCamera'),cam2.getParameter('activeCamera')];});
  doc.root().removeChild(cam2);
  R.p32.afterRemove=nm(doc.activeCamera());
  doc.root().removeChild(b);
  return R;
}
