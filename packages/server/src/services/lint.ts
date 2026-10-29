/* eslint-disable @typescript-eslint/no-non-null-assertion -- loosely typed runtime data; indices are bounds-checked by construction */
// Advisory static checks for Cheetah3D scripts. Port of vendor/c3d-scripting-kb/tools/c3d_lint.py plus server-side safety rules.
import { readKb } from './kb.js';

export type LintSeverity = 'error' | 'warn';
export interface LintFinding { rule: string; line: number; message: string; severity: LintSeverity }

interface Api { classes: Record<string, { methods: Record<string, string[]> }>; globals: string[]; constants: string[] }
let apiCache: { methods: Set<string>; constants: Set<string> } | null | undefined;
function api(): { methods: Set<string>; constants: Set<string> } | null {
  if (apiCache !== undefined) return apiCache;
  const raw = readKb('reference/api-index.json');
  if (!raw) return (apiCache = null);
  const a = JSON.parse(raw) as Api;
  const methods = new Set<string>(a.globals);
  for (const c of Object.values(a.classes)) for (const m of Object.keys(c.methods)) methods.add(m);
  return (apiCache = { methods, constants: new Set(a.constants) });
}

const FORUM_KNOWN = new Set(['id', 'animationTime']);
const JS_BUILTINS = new Set(
  `push pop shift unshift slice splice concat join split indexOf lastIndexOf toString toFixed toPrecision replace match substr substring charAt charCodeAt fromCharCode toLowerCase toUpperCase sort reverse map filter forEach reduce some every apply call bind floor ceil round sqrt sin cos tan atan atan2 asin acos abs pow min max random exp log keys parseInt parseFloat isNaN getTime now trim test exec hasOwnProperty search getFullYear getMonth getDate getHours getMinutes getSeconds localeCompare parse stringify isArray assign create defineProperty freeze getOwnPropertyNames includes startsWith endsWith padStart padEnd fill from of entries values has get set add delete`.split(/\s+/),
);
const ENTRY: Record<string, string[]> = { Macro: ['main'], Tool: ['buildUI'], Tag: ['buildUI'], Polygonobj: ['buildUI', 'buildObject'], Splineobj: ['buildUI', 'buildObject'], Particle: ['buildUI', 'buildObject'] };
const ADD_PARAM_ARGS: Record<string, number> = {
  addParameterBool: 6, addParameterFloat: 6, addParameterInt: 6, addParameterColor: 6, addParameterVec2D: 6, addParameterVec3D: 6,
  addParameterSelector: 4, addParameterString: 3, addParameterTexture: 3, addParameterLink: 2, addParameterButton: 3, addParameterSeparator: 1,
};

/** Replace comments with spaces/newlines so offsets and line numbers are preserved. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function matchClose(src: string, from: number, open: string, close: string): number {
  let depth = 1;
  let i = from;
  while (i < src.length && depth) {
    const ch = src[i];
    if (ch === open) depth++;
    else if (ch === close) depth--;
    i++;
  }
  return i;
}

function funcBodies(src: string): Map<string, { body: string; start: number }> {
  const out = new Map<string, { body: string; start: number }>();
  for (const m of src.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    const s = m.index + m[0].length;
    out.set(m[1]!, { body: src.slice(s, matchClose(src, s, '{', '}')), start: s });
  }
  return out;
}

function splitArgs(s: string): string[] {
  let depth = 0;
  let cur = '';
  const out: string[] = [];
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function callsWithArgs(src: string, name: string): Array<{ pos: number; args: string[] }> {
  const out: Array<{ pos: number; args: string[] }> = [];
  for (const m of src.matchAll(new RegExp(`\\.\\s*${name}\\s*\\(`, 'g'))) {
    const s = m.index + m[0].length;
    out.push({ pos: m.index, args: splitArgs(src.slice(s, matchClose(src, s, '(', ')') - 1)) });
  }
  return out;
}

export function guessType(src: string): string | null {
  const fns = new Set([...src.matchAll(/function\s+(\w+)\s*\(/g)].map((m) => m[1]!));
  if (fns.has('main')) return 'Macro';
  if (fns.has('buildObject')) {
    if (src.includes('addParticle')) return 'Particle';
    if (/\.(moveTo|curveTo|lineTo|move|curve|line)\s*\(/.test(src) && !src.includes('addPolygon')) return 'Splineobj';
    return 'Polygonobj';
  }
  if (fns.has('performExpression')) return 'Tag';
  if (fns.has('buildUI')) return [...fns].some((f) => f !== 'buildUI' && f !== 'update') ? 'Tool' : 'Tag';
  return null;
}

const LOOP_HEAD = /\b(while\s*\(\s*(?:true|1|!0)\s*\)|for\s*\(\s*;\s*;\s*\))\s*\{/g;

export function lintScript(code: string): LintFinding[] {
  const src = stripComments(code);
  const lineOf = (pos: number): number => src.slice(0, pos).split('\n').length;
  const out: LintFinding[] = [];
  const add = (severity: LintSeverity, rule: string, pos: number | null, message: string): void => {
    out.push({ rule, severity, line: pos === null ? 0 : lineOf(pos), message });
  };
  const fns = funcBodies(src);
  const t = guessType(src);
  if (t) for (const e of ENTRY[t]!) if (!fns.has(e)) add('error', 'entry-missing', null, `${t} script needs function ${e}(...).`);
  if (t === 'Particle' && !src.includes('addParticle')) add('warn', 'particle-no-addparticle', null, 'Particle script never calls core.addParticle().');

  for (const [name, n] of Object.entries(ADD_PARAM_ARGS))
    for (const { pos, args } of callsWithArgs(src, name)) {
      if (args.length < n) add(args.length < Math.min(n, 4) ? 'error' : 'warn', 'addparam-args', pos, `${name} has ${args.length} args, needs ${n}: omitted trailing args have crashed Cheetah3D.`);
      if (args[0] && /^\s*["']type["']\s*$/.test(args[0])) add('error', 'param-named-type', pos, 'Parameter named "type" collides with a hidden built-in; the object vanishes after reload.');
    }
  for (const [name, f] of fns) if (name !== 'buildUI' && /\.addParameter\w+\s*\(/.test(f.body)) add('warn', 'addparam-outside-buildui', f.start, `addParameter* called in ${name}(); only valid inside buildUI().`);

  const reach = (name: string, seen: Set<string>): Set<string> => {
    if (seen.has(name) || !fns.has(name)) return seen;
    seen.add(name);
    for (const m of fns.get(name)!.body.matchAll(/(?<![\w.])(\w+)\s*\(/g)) reach(m[1]!, seen);
    return seen;
  };
  for (const hook of ['buildObject', 'performExpression'])
    for (const fn of [...reach(hook, new Set())].sort()) {
      const f = fns.get(fn)!;
      const where = fn === hook ? hook : `${fn}() (called from ${hook})`;
      for (const { pos, args } of callsWithArgs(f.body, 'setParameter'))
        if (args.length < 3 || args[2]!.trim() !== 'false') add('error', 'setparameter-no-false', f.start + pos, `setParameter in ${where} without third arg false: infinite rebuild loop.`);
      if (hook === 'performExpression' && /recordParametersForUndo|recordGeometryForUndo/.test(f.body)) add('warn', 'undo-in-expression', f.start, `Undo recording inside ${where} runs every evaluation.`);
      if (hook === 'buildObject' && /Math\.random\s*\(/.test(f.body)) add('warn', 'random-in-buildobject', f.start, 'Math.random() in buildObject(): geometry changes on every rebuild; use a seeded PRNG.');
    }

  for (const m of src.matchAll(/(?<![\w.])(?<!new )(Vec2D|Vec3D|Vec4D|Mat3D|Mat4D|FCurveKey|File)\s*\(/g)) add('error', 'ctor-without-new', m.index, `${m[1]}(...) without \`new\` has crashed Cheetah3D.`);
  for (const m of src.matchAll(/\b(Vec2D|Vec3D|Vec4D|Mat3D|Mat4D|PolyCore|SplineCore)\.prototype\b/g)) add('warn', 'native-prototype', m.index, `Extending ${m[1]}.prototype is ignored or breaks on native classes.`);
  for (const m of src.matchAll(/\b(SPOTLIGHT|POINTLIGHT|DISTANTLIGHT|AREALIGHT|SKYLIGHT)\b/g)) add('warn', 'light-constants', m.index, `${m[1]}: lights are LIGHT + the "lightType" parameter (0..4); these constants do not exist or throw at runtime.`);
  for (const m of src.matchAll(/(?<![\w.])print\s*\(\s*(true|false|\d+|[a-zA-Z_]\w*\s*\))/g)) add('warn', 'print-nonstring', m.index, 'print() only reliably accepts strings; wrap values: print("" + x).');
  for (const m of src.matchAll(/\.vertex\s*\([^)]*\)\s*\.\s*(add|sub|multiply|set)\s*\(/g))
    if (!/setVertex/.test(src.slice(Math.max(0, m.index - 80), m.index))) add('warn', 'vertex-copy', m.index, 'core.vertex(i) returns a copy; write back with core.setVertex(i, ...).');
  if (/selectedObject\s*\(\s*\)/.test(src) && /(==|!=)\s*null/.test(src) && !src.includes('owner()')) add('warn', 'selected-object-null', null, 'doc.selectedObject() returns the root (not null) when nothing is selected; test obj.owner() == null.');

  // ---- server safety rules ----
  for (const m of src.matchAll(/\bFile\s*\.\s*mkDir\b|\.mkDir\s*\(/g)) add('error', 'file-mkdir', m.index, 'File.mkDir is banned: it wipes the target directory.');
  for (const m of src.matchAll(/\bOS\s*\.\s*system\b/g)) add('warn', 'os-system', m.index, 'OS.system runs a shell command synchronously; requires confirmation.');
  for (const m of src.matchAll(/\bOS\s*\[|\bglobalThis\s*\[|\bthis\s*\[\s*["'`]OS|\bwindow\s*\[/g)) add('error', 'computed-os-access', m.index, 'Computed access to OS/globals (e.g. OS["sys"+"tem"]) is not allowed.');
  for (const m of src.matchAll(/(?<![\w.])eval\s*\(|\bnew\s+Function\s*\(|(?<![\w.])Function\s*\(/g)) add('warn', 'eval', m.index, 'eval/Function executes dynamic code and bypasses linting.');
  for (const m of src.matchAll(LOOP_HEAD)) {
    const body = src.slice(m.index + m[0].length, matchClose(src, m.index + m[0].length, '{', '}'));
    if (!/\bbreak\b|\breturn\b|\bthrow\b/.test(body)) add('error', 'infinite-loop', m.index, 'Endless loop without break/return would freeze Cheetah3D.');
  }
  if (/\.(addIndexPolygon|addPolygon)\s*\(/.test(src)) {
    for (const m of src.matchAll(/\bwhile\s*\(/g)) {
      const open = src.indexOf('{', m.index);
      if (open > 0 && /addIndexPolygon|addPolygon/.test(src.slice(open, matchClose(src, open + 1, '{', '}')))) add('warn', 'unbounded-addpolygon', m.index, 'addIndexPolygon inside a while loop: bad or unbounded indices crash Cheetah3D; use a bounded for loop and validate indices.');
    }
  }
  if (/\.(setVertex|addIndexPolygon|addPolygon|addVertex|setPolygon)\s*\(/.test(src) && !/\.update\s*\(/.test(src)) add('warn', 'missing-update', null, 'Geometry edited but obj.update() is never called; the viewport/render will not refresh.');

  // ---- API conformance (needs api-index) ----
  const a = api();
  if (a) {
    const defined = new Set([...fns.keys(), ...[...src.matchAll(/(\w+)\s*[:=]\s*function/g)].map((m) => m[1]!)]);
    for (const m of src.matchAll(/\.\s*([a-zA-Z_]\w*)\s*\(/g)) {
      const n = m[1]!;
      if (a.methods.has(n) || JS_BUILTINS.has(n) || defined.has(n)) continue;
      if (FORUM_KNOWN.has(n)) continue;
      add('warn', 'unknown-method', m.index, `.${n}() is not in the 8.x API reference.`);
    }
    const declared = new Set([...src.matchAll(/\b(?:var|let|const)\s+([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]!));
    for (const m of src.matchAll(/(?<![\w."'])([A-Z][A-Z0-9_]{3,})(?![\w"'])/g)) {
      const c = m[1]!;
      if (!a.constants.has(c) && !declared.has(c) && c !== 'LIGHT' && c !== 'NAN' && !/^(JSON|WRITE_MODE|READ_MODE|HPB|NaN)$/.test(c) && !/_MODE$|_INTERPOL$|_PARAMETER$/.test(c))
        add('warn', 'unknown-constant', m.index, `${c}: not a documented constant.`);
    }
  }
  const seen = new Set<string>();
  return out
    .filter((f) => {
      const k = `${f.rule}:${f.line}:${f.message}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .sort((x, y) => x.line - y.line || x.rule.localeCompare(y.rule));
}
