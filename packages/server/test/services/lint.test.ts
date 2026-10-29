 
import { describe, expect, it } from 'vitest';
import { lintScript } from '../../src/services/lint.js';

const rules = (code: string): string[] => lintScript(code).map((f) => f.rule);

describe('lint rules (positive / negative)', () => {
  const cases: Array<[string, string, string]> = [
    ['file-mkdir', 'File.mkDir("/tmp/x");', 'var f = new File("a");'],
    ['remove-material', 'doc.removeMaterial(m);', 'var m = doc.addMaterial("Material", "x");'],
    ['os-system', 'OS.system("ls");', 'print("hi");'],
    ['computed-os-access', 'OS["sys"+"tem"]("ls");', 'var a = [1]; a[0];'],
    ['eval', 'eval("1+1");', 'var evaluate = 1;'],
    ['infinite-loop', 'while(true){ var a = 1; }', 'while(true){ if (x) break; }'],
    ['ctor-without-new', 'var v = Vec3D(1,2,3);', 'var v = new Vec3D(1,2,3);'],
    ['light-constants', 'doc.addObject(SPOTLIGHT);', 'doc.addObject(LIGHT);'],
    ['missing-update', 'var c = obj.core(); c.setVertex(0, new Vec3D(0,0,0));', 'var c = obj.core(); c.setVertex(0, new Vec3D(0,0,0)); obj.update();'],
    ['unbounded-addpolygon', 'var i=0; while(i<n){ core.addIndexPolygon([0,1,2]); i++; } obj.update();', 'for(var i=0;i<n;i++){ core.addIndexPolygon([0,1,2]); } obj.update();'],
    ['addparam-args', 'function buildUI(base){ base.addParameterFloat("a", 1); }\nfunction buildObject(b,c){}', 'function buildUI(base){ base.addParameterFloat("a", 1, 0, 2, true, true); }\nfunction buildObject(b,c){}'],
    ['param-named-type', 'function buildUI(b){ b.addParameterInt("type", 1, 0, 3, true, true); }\nfunction buildObject(b,c){}', 'function buildUI(b){ b.addParameterInt("kind", 1, 0, 3, true, true); }\nfunction buildObject(b,c){}'],
    ['setparameter-no-false', 'function buildUI(b){}\nfunction buildObject(b,c){ b.setParameter("a", 1); }', 'function buildUI(b){}\nfunction buildObject(b,c){ b.setParameter("a", 1, false); }'],
    ['entry-missing', 'function buildObject(b,c){}', 'function buildUI(b){}\nfunction buildObject(b,c){}'],
    ['print-nonstring', 'print(42);', 'print("42");'],
    ['native-prototype', 'Vec3D.prototype.foo = function(){};', 'var p = Vec3D;'],
  ];
  it.each(cases)('%s fires on bad code and stays quiet on good code', (rule, bad, good) => {
    expect(rules(bad)).toContain(rule);
    expect(rules(good)).not.toContain(rule);
  });

  it('reports 1-based line numbers', () => {
    const f = lintScript('var a = 1;\n\nFile.mkDir("/x");').find((x) => x.rule === 'file-mkdir');
    expect(f?.line).toBe(3);
    expect(f?.severity).toBe('error');
  });

  it('ignores patterns inside comments', () => {
    expect(rules('// OS.system("x")\n/* File.mkDir("y") */ var a = 1;')).not.toContain('os-system');
    expect(rules('// OS.system("x")\n/* File.mkDir("y") */')).not.toContain('file-mkdir');
  });

  it('does not require an entry point for plain snippets', () => {
    expect(lintScript('print("x");').filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('flags unknown API methods as warnings', () => {
    const f = lintScript('doc.fooBarBaz();').find((x) => x.rule === 'unknown-method');
    expect(f?.severity).toBe('warn');
  });

  it('accepts a realistic clean snippet without errors', () => {
    const code = 'var b = doc.addObject(BOX);\nb.setParameter("name", "X");\nb.update();';
    expect(lintScript(code).filter((f) => f.severity === 'error')).toEqual([]);
  });
});
