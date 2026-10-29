// Guards the in-app JavaScript: ES5 only, ASCII only, and no bare references to constants that may be undefined at runtime.
//   node bridge/tests/lint-es5.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRuntime, renderMacro } from '../../scripts/build-runtime.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const acorn = createRequire(join(root, 'packages', 'server', 'package.json'))('acorn');

// Constants verified to exist in 8.1.3 (research/raw/probe_PA_files_env.json) and referenced bare on purpose, plus ES globals.
const BARE_CONSTANTS = new Set(['READ_MODE', 'WRITE_MODE', 'JSON', 'C3D']);

const targets = {
  'runtime.js': buildRuntime({ write: false }).source,
  'macro': renderMacro({ runtimePath: '/x/runtime.js', mcpDir: '/x/MCP', version: '1.0.0' }),
};

const problems = [];
for (const [name, source] of Object.entries(targets)) {
  if (/[^\x00-\x7e\n]/.test(source)) problems.push(`${name}: non-ASCII characters`);
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 5, locations: true });
  } catch (e) {
    problems.push(`${name}: not ES5: ${e.message}`);
    continue;
  }
  const declared = new Set();
  const collect = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'VariableDeclarator') declared.add(node.id.name);
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
      if (node.id) declared.add(node.id.name);
      node.params.forEach((p) => declared.add(p.name));
    }
    if (node.type === 'CatchClause') declared.add(node.param.name);
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v.type === 'string') collect(v);
    }
  };
  collect(ast);
  const visit = (node, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Identifier' && /^[A-Z][A-Z0-9_]{2,}$/.test(node.name) && !BARE_CONSTANTS.has(node.name) && !declared.has(node.name)) {
      const isProperty = (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) || (parent.type === 'Property' && key === 'key');
      const isTypeofOperand = parent.type === 'UnaryExpression' && parent.operator === 'typeof';
      if (!isProperty && !isTypeofOperand) problems.push(`${name}:${node.loc.start.line}: bare reference to ${node.name} (guard with typeof)`);
    }
    for (const [k, v] of Object.entries(node)) {
      if (Array.isArray(v)) v.forEach((c) => visit(c, node, k));
      else if (v && typeof v.type === 'string') visit(v, node, k);
    }
  };
  visit(ast, null, null);
}

if (problems.length) {
  problems.forEach((p) => console.error(`LINT ${p}`));
  process.exit(1);
}
console.log('lint: runtime and macro are ES5, ASCII, and free of bare optional constants');
