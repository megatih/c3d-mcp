var SESSION='__c3d_mcp_session_4195a28a-c5ec-4529-99e8-05beb0340e54';
var TMP='/tmp/c3d-scratch/probe/tmp/';
function assertMarker(doc){var r=doc.root();for(var i=0;i<r.childCount();i++){if(r.childAtIndex(i).getParameter('name')===SESSION)return true;}throw new Error('MARKER_MISSING: not the scratch document');}
function wfile(p,s){var f=new File(p);f.open(WRITE_MODE);f.write(s);f.close();}
function rfile(p){var f=new File(p);if(!f.exist())return null;f.open(READ_MODE);var s=f.read(f.size());f.close();return s;}
function tryf(fn){try{return fn();}catch(e){return {threw:String(e)};}}
function wrap(doc,fn){assertMarker(doc);return fn(doc);}
