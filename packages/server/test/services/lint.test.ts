 
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
    ['light-constants', 'doc.addObject(POINTLIGHT);', 'var l = doc.addObject(LIGHT); l.setParameter("lightType", 3);'],
    ['selected-object-null', 'var o = doc.selectedObject(); if (o === null) { return; }', 'var o = doc.selectedObject(); if (!o) { return; }'],
    ['vec4-isequal', 'var a = new Vec4D(1,2,3,4); var b = a.copy(); a.isEqual(b);', 'var a = new Vec3D(1,2,3); a.isEqual(a.copy());'],
    ['many-shader-tags', 'for (var i = 0; i < 30; i++) { o.addTagOfType(SHADERTAG); }', 'var t = o.addTagOfType(SHADERTAG);'],
    ['falcon-samples-zero', 'doc.currentRenderer().setParameter("samples", 0);', 'doc.currentRenderer().setParameter("samples", 50);'],
    ['unknown-constant', 'var t = o.addTagOfType(UVTAG);', 'var t = o.addTagOfType(SHADERTAG);'],
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

describe('lint knows what was measured in 8.1.3 (research/10)', () => {
  it('does not flag methods and constants that exist at runtime but are missing from the reference', () => {
    const r = rules('var f = doc.animationFPS(); doc.setAnimationFPS(24); var id = obj.id(); var p = obj.parameterWithName("position"); p.isAnimatable(); var m = FLAT_INTERPOL + CONST_INTERPOL + WRITE_MODE + BIG_ENDIAN + SEAM + LIGHT;');
    expect(r).not.toContain('unknown-method');
    expect(r).not.toContain('unknown-constant');
  });
  it('says what to use instead of parent() and rib()', () => {
    const f = lintScript('var p = obj.parent(); mat.rib();').filter((x) => x.rule === 'unknown-method');
    expect(f.map((x) => x.message).join(' ')).toMatch(/owner\(\)/);
    expect(f.map((x) => x.message).join(' ')).toMatch(/rib/);
  });
  it('ignores identifiers inside string literals', () => {
    expect(rules('var s = "EQUATION_X + BOGUS_THING";')).not.toContain('unknown-constant');
  });
  it('treats samples=0 as an error because a synchronous render would never finish', () => {
    expect(lintScript('r.setParameter("samples", 0);')[0]).toMatchObject({ rule: 'falcon-samples-zero', severity: 'error' });
  });
  it('flags negative and zero Falcon sample counts but not positive ones', () => {
    expect(rules('r.setParameter("samples", -1);')).toContain('falcon-samples-zero');
    expect(rules('r.setParameter("samples", 0.0);')).toContain('falcon-samples-zero');
    expect(rules('r.setParameter("samples", 100);')).not.toContain('falcon-samples-zero');
    expect(rules('r.setParameter("samples", 0.5);')).not.toContain('falcon-samples-zero');
  });
  it('warns about removeMaterial reached through obj.document() and says it is not guarded', () => {
    const f = lintScript('var d = o.document(); d.removeMaterial(m);').find((x) => x.rule === 'remove-material');
    expect(f?.message).toMatch(/obj\.document\(\)/);
  });
  it('accepts File.readInt (undocumented but present in 8.1.3)', () => {
    expect(rules('var f = new File("/x"); f.open(READ_MODE, BIG_ENDIAN); var a = f.readInt();')).not.toContain('unknown-method');
  });
  it('flags the misspelt isAnimateable (the method is isAnimatable)', () => {
    const f = lintScript('var a = p.isAnimateable();').filter((x) => x.rule === 'unknown-method');
    expect(f.map((x) => x.message).join(' ')).toMatch(/isAnimatable/);
    expect(rules('var a = p.isAnimatable();')).not.toContain('unknown-method');
  });
  it('lints every official example script without errors', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { kbLayout } = await import('../../src/services/kb.js');
    const root = path.join(kbLayout()!.kbRoot, 'examples', 'official');
    let n = 0;
    for (const type of fs.readdirSync(root)) for (const f of fs.readdirSync(path.join(root, type))) {
      const errors = lintScript(fs.readFileSync(path.join(root, type, f), 'utf8')).filter((x) => x.severity === 'error');
      expect(errors, `${type}/${f}`).toEqual([]);
      n++;
    }
    expect(n).toBe(17);
  });
  it('accepts addParameterBool with 4 arguments (official Menger.js builds in 8.1.3) but not with 2', () => {
    const four = 'function buildUI(b){ b.addParameterBool("level", true, false, true); }\nfunction buildObject(b,c){}';
    expect(rules(four)).not.toContain('addparam-args');
    expect(rules(four.replace('"level", true, false, true', '"level", true'))).toContain('addparam-args');
  });
  it('does not mistake Object.prototype members for removed API methods (review finding)', () => {
    const r = lintScript('var s = (5).toString(); o.hasOwnProperty("a"); x.valueOf(); y.constructor();');
    expect(r.filter((f) => /does not exist in 8\.1\.3/.test(f.message))).toEqual([]);
  });
  it('relaxes the argument count only for addParameterBool', () => {
    const f = (call: string): string[] => rules(`function buildUI(b){ b.${call}; }\nfunction buildObject(b,c){}`);
    expect(f('addParameterBool("a", true, false, true)')).not.toContain('addparam-args');
    expect(f('addParameterFloat("a", 1, 0, 2)')).toContain('addparam-args');
  });
  it('ignores constructor calls and light constants inside strings', () => {
    expect(rules('print("Vec3D(1) and SPOTLIGHT");')).not.toContain('ctor-without-new');
    expect(rules('print("Vec3D(1) and SPOTLIGHT");')).not.toContain('light-constants');
  });
});
