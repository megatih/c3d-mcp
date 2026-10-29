// batch A: P04 P05 P06 P34 P35 + ES features + constants (P17) — pure, no scene mutation
function probeMain(doc){
  assertMarker(doc);
  var R={};
  // ES feature detection
  R.es={};
  var tests={
    let:"(function(){let a=1;return a})()", const:"(function(){const a=1;return a})()",
    arrow:"(function(){var f=(x)=>x+1;return f(1)})()", template:"(function(){var a=1;return `x${a}`})()",
    forOf:"(function(){var s=0;for(var x of [1,2])s+=x;return s})()", spread:"(function(){return [...[1,2]].length})()",
    destructure:"(function(){var {a}={a:1};return a})()", classes:"(function(){class A{};return typeof A})()",
    promise:"typeof Promise", map:"typeof Map", set:"typeof Set", symbol:"typeof Symbol",
    padStart:"typeof ''.padStart", includes:"typeof [].includes", assign:"typeof Object.assign",
    keys:"typeof Object.keys", isArray:"typeof Array.isArray", jsonStringify:"typeof JSON.stringify",
    defaultParam:"(function(){function f(a=2){return a};return f()})()", fround:"typeof Math.fround",
    trunc:"typeof Math.trunc", startsWith:"typeof ''.startsWith", arrayFrom:"typeof Array.from",
    dateNow:"typeof Date.now", regexpSticky:"typeof /a/y", typedArrays:"typeof Float32Array",
    globalThis:"typeof globalThis", strictMode:"(function(){'use strict';return this===undefined})()"
  };
  for(var k in tests){try{R.es[k]=(0,eval)(tests[k]);}catch(e){R.es[k]='ERR '+String(e).substring(0,40);}}
  // geval global leak
  (0,eval)("var __probe_global_x=42;"); R.indirectEvalGlobal=(typeof __probe_global_x);
  R.thisIsGlobal=((function(){return this;})()===(0,eval)('this'));
  // constants
  var names=['BALL','BOX','DISC','CONE','CAPSULE','CYLINDER','FRACTAL','PLANE','POLYGONOBJ','POLYHEDRA','TORUS','TUBE','SCRIPTPOLY','STAIR','CIRCLE','COG','FLOWER','HELIX','LINE','NEDGE','RECT','SCRIPTSPLINE','SPLINE','STAR','TEXT','BLUEPRINT','CAMERA','FOLDER','BOOLEAN','CHAIN','EXTRUDE','ISOSURFACE','LATHE','POLYPLANE','RELIEF','SUBDIV','SWEEP','SYMMETRY','PARTICLE','PARTICLEEMITTER','PARTICLEARRAY','PARTICLEMESH','PARTICLESPLINE','PARTICLESCRIPT','ORIENTATIONEFF','MATERIAL','LIGHT','POINTLIGHT','SPOTLIGHT','SKYLIGHT','ENVIRONMENTLIGHT','JOINT','SMARTFOLDER','LOFT','BACKGROUND','SUBDIVMOD','TRIANGULATEMOD','WIREFRAMEMOD',
   'ANCHORTAG','BAKETAG','IKHANDLETAG','IKCONSTRAINTTAG','METABALLTAG','MODETAG','MORPHTAG','ORIENTCONSTRAINTTAG','PARENTCONSTRAINTTAG','PARTICLETAG','POINTCONSTRAINTTAG','POSETAG','PROPWINTAG','RIGIDBODYTAG','ROPETAG','SKELETONTAG','SOFTBODYTAG','SPLINEIKTAG','UVTAG','SCRIPTTAG','SHADERTAG','FOGTAG','RADIOSITYTAG','HDRITAG','DOFTAG','RENDERTAG','CAUSTICTAG','SPLINETRACKINGTAG','TARGETTAG',
   'POINT_MODE','EDGE_MODE','POLY_MODE','OBJECT_MODE','PIVOT_MODE','MODIFIED_NOTHING','MODIFIED_TRANSFORM','MODIFIED_PARAMETER','MODIFIED_GEOMETRY','MODIFIED_MODI','MODIFIED_PARTICLE','MODIFIED_TIME','EMPTY_SELECTION','PRIMARY_SELECTION','SECONDARY_SELECTION','LINEAR','SOFT','SPLINE','FLAT','CONST','INT_PARAMETER','FLOAT_PARAMETER','BOOL_PARAMETER','STRING_PARAMETER','VEC2D_PARAMETER','VEC3D_PARAMETER','VEC4D_PARAMETER','TEXTURE_PARAMETER','LINK_PARAMETER','GRADIENT_PARAMETER','FLOAT_ARRAY_PARAMETER','ROT_XYZ','ROT_XZY','ROT_YXZ','ROT_YZX','ROT_ZXY','ROT_ZYX','ROT_HPB','CHEETAH','FALCON','IDENDITY','IDENTITY','TRANSLATE','SCALE','ROTATE','ROTATE_HPB','READ_MODE','WRITE_MODE','BIG_ENDIAN','LITTLE_ENDIAN','SEEK_SET','SEEK_CUR','SEEK_END','OTHERFAMILY','SPLINEFAMILY','LIGHTFAMILY','MODIFIERFAMILY','NGONFAMILY','TAGFAMILY','LOADERFAMILY','PARTICLEFAMILY','MATERIALFAMILY','NODEFAMILY','SETTINGFAMILY','FORCEFAMILY','EFFECTORFAMILY'];
  R.consts={};R.missing=[];
  for(var i=0;i<names.length;i++){var v;try{v=(0,eval)('typeof '+names[i]+'==="undefined"?undefined:'+names[i]);}catch(e){v=undefined;}
    if(v===undefined)R.missing.push(names[i]);else R.consts[names[i]]=(typeof v==='number'||typeof v==='string')?v:typeof v;}
  // enumerate global names that look like constants (UPPER_CASE) via scanning for likely suffixes
  R.globalsTypeof={print:typeof print,clearConsole:typeof clearConsole,version:typeof version,intToBinary:typeof intToBinary,geval:typeof geval,OS:typeof OS,File:typeof File,Vec3D:typeof Vec3D,Mat4D:typeof Mat4D,FCurveKey:typeof FCurveKey,Texture:typeof Texture,Document:typeof Document,require:typeof require,setTimeout:typeof setTimeout,console:typeof console,JSON:typeof JSON};
  // files
  var T=TMP; R.tmpExists=new File(T).exist(); R.tmpIsDir=new File(T).isDir();
  wfile(T+'ascii.txt','hello\nworld\n'); wfile(T+'t.txt','AAAAAAAAAA'); wfile(T+'t.txt','BB'); R.truncated=rfile(T+'t.txt');
  var uni='\u540d\u524d caf\u00e9'; wfile(T+'u.txt',uni);
  var f=new File(T+'u.txt');R.unicode={written:uni.length,size:f.size(),readChars:(function(){f.open(READ_MODE);var s=f.read(f.size());f.close();return s.length;})(),readN:(function(){f.open(READ_MODE);var s=f.read(5);f.close();return s;})()};
  var esc=JSON.stringify({a:'\u540d\u524d'});R.jsonRaw=esc; 
  wfile(T+'j.json','{"a":"\\u540d\\u524d","n":[1,2,{"x":1.5}]}');var jj=JSON.parse(rfile(T+'j.json'));R.jsonParse={a_len:jj.a.length,a0:jj.a.charCodeAt(0),n2x:jj.n[2].x};
  var g=new File(T+'dir1/'); R.contentOfDirRaw=tryf(function(){return new File(T).contentOfDir();});
  R.sizeMissing=tryf(function(){return new File(T+'nope.txt').size();}); R.existMissing=new File(T+'nope.txt').exist();
  R.openReadMissing=tryf(function(){var h=new File(T+'nope.txt');return h.open(READ_MODE);});
  R.dot=tryf(function(){wfile(T+'.hidden','x');wfile(T+'x.json.tmp','x');return new File(T).contentOfDir();});
  R.fileProps={ext:new File(T+'t.txt').extension(),last:new File(T+'t.txt').lastPathComponent(),dir:new File(T+'t.txt').directory()};
  R.readln=tryf(function(){var h=new File(T+'ascii.txt');h.open(READ_MODE);var a=h.readln();var b=h.readln();h.close();return [a,b];});
  R.copyTo=tryf(function(){new File(T+'t.txt').copyTo(T+'t2.txt');return rfile(T+'t2.txt');});
  R.tilde=tryf(function(){return new File('~/x').exist();});
  // writing while reading (partial read)
  // OS.system
  R.sys={};
  var cmds={exit0:'exit 0',exit3:'exit 3',echo:'echo hi > "'+T+'echo out.txt"',space:'echo ok > "'+T+'sp ace.txt"',bg:'sleep 1 &'};
  for(var k in cmds){var t0=new Date().getTime();var rv=tryf(function(){return OS.system(cmds[k]);});R.sys[k]={rv:rv,ms:new Date().getTime()-t0};}
  R.sys.echoOut=rfile(T+'echo out.txt');R.sys.spaceOut=rfile(T+'sp ace.txt');
  var t1=new Date().getTime();OS.system('sleep 1');R.sys.sleep1ms=new Date().getTime()-t1;
  // print capture
  R.print=tryf(function(){print('c3dmcp-print-probe');return 'ok';});
  R.version=version();
  return R;
}
