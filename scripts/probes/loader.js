// Probe runner (P00 Hello.js): evals $SP/probe/current.js then calls probeMain(doc). Output -> out.json
var PROBE_DIR='/tmp/c3d-scratch/probe/';
function main(doc){
  var out={ok:true};
  try{
    var f=new File(PROBE_DIR+'current.js');f.open(READ_MODE);var src=f.read(f.size());f.close();
    var geval=eval;geval(src);
    out.result=probeMain(doc);
  }catch(e){out.ok=false;out.error=String(e);}
  var g=new File(PROBE_DIR+'out.json');g.open(WRITE_MODE);
  try{g.write(JSON.stringify(out).replace(/[\u007f-\uffff]/g,function(c){return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);}));}catch(e){g.write('{"ok":false,"error":"stringify: '+String(e)+'"}');}
  g.close();
  var d=new File(PROBE_DIR+'done');d.open(WRITE_MODE);d.write('1');d.close();
}
