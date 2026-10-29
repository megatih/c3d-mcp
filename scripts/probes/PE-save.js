function probeMain(doc){
  assertMarker(doc);
  var R={types:{}};
  var D='/tmp/c3d-scratch/probe/save/';
  var b=doc.addObject(BOX);b.setParameter('name','SaveBox');
  R.before=String(doc.fileName());
  var types=['jas','obj','mtl','fbx','dae','stl','3ds','usdz','gltf','glb','abc','dxf','svg','png'];
  for(var i=0;i<types.length;i++){
    var t=types[i];var p=D+'out_'+t+'.'+t;
    try{var rv=doc.saveToFile(p,t);R.types[t]={rv:String(rv),exists:new File(p).exist(),size:new File(p).size(),fileNameAfter:String(doc.fileName())};}catch(e){R.types[t]={err:String(e)};}
  }
  R.after=String(doc.fileName());
  doc.root().removeChild(b);
  return R;
}
