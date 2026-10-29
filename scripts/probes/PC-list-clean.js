function nm(o){try{return o.getParameter('name');}catch(e){return '<noname:'+o.type()+'>';}}
function probeMain(doc){
  assertMarker(doc);
  var r=doc.root(),out=[],kill=[];
  for(var i=0;i<r.childCount();i++){var c=r.childAtIndex(i);var n=nm(c);out.push({n:n,type:c.type(),fam:c.family()});if(n!==SESSION&&c.type()!==CAMERA&&c.type()!==LIGHT)kill.push(c);}
  // keep marker + default objects (those before marker): only remove kill when flagged
  return {children:out,rootName:nm(r),rootType:r.type(),activeCam:nm(doc.activeCamera()),camType:doc.activeCamera().type()};
}
