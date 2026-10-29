// Validates every request/response written by the harness cases against contracts/*.json and checks op coverage.
//   node bridge/tests/validate-schemas.mjs <dump-dir>
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'packages', 'server', 'package.json'));
const Ajv2020 = require('ajv/dist/2020').default;

const dumpDir = process.argv[2];
if (!dumpDir) {
  console.error('usage: validate-schemas.mjs <dump-dir>');
  process.exit(2);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const contracts = join(root, 'contracts');
const ajv = new Ajv2020({ strict: false, allErrors: true });
const requestSchema = ajv.compile(readJson(join(contracts, 'request.schema.json')));
const responseSchema = ajv.compile(readJson(join(contracts, 'response.schema.json')));
const opsDoc = readJson(join(contracts, 'ops.json'));
const errorCodes = new Set(Object.keys(readJson(join(contracts, 'errors.json')).codes));
const argValidators = Object.fromEntries(Object.entries(opsDoc.ops).map(([name, def]) => [name, ajv.compile(def.args)]));

const ALIAS = /^\$[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
// Alias strings may stand in for integers or refs (docs/PROTOCOL.md section 3); try neutral stand-ins for each alias leaf.
const STAND_INS = [(s) => s, () => 0, () => ({ id: 0 }), () => ({ name: 'x' })];

function aliasLeaves(value, path = [], out = []) {
  if (typeof value === 'string' && ALIAS.test(value)) out.push(path);
  else if (Array.isArray(value)) value.forEach((v, i) => aliasLeaves(v, [...path, i], out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => aliasLeaves(v, [...path, k], out));
  return out;
}

function withValue(value, path, replacement) {
  if (path.length === 0) return replacement;
  const copy = Array.isArray(value) ? [...value] : { ...value };
  copy[path[0]] = withValue(value[path[0]], path.slice(1), replacement);
  return copy;
}

function argsValid(validate, args) {
  const leaves = aliasLeaves(args);
  const attempt = (current, i) => {
    if (i === leaves.length) return validate(current);
    const original = leaves[i].reduce((v, k) => v[k], current);
    return STAND_INS.some((make) => attempt(withValue(current, leaves[i], make(original)), i + 1));
  };
  return attempt(args, 0);
}

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const covered = new Map(); // op -> { ok, error }
let requests = 0;
let responses = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.request\.(noargs\.)?json$/.test(entry)) checkRequest(p, entry.includes('.noargs.'));
    else if (entry.endsWith('.response.json')) checkResponse(p);
  }
}

function checkRequest(path, noArgs) {
  requests++;
  const req = readJson(path);
  if (!requestSchema(req)) return fail(path, `request schema: ${ajv.errorsText(requestSchema.errors)}`);
  if (noArgs) return;
  for (const [i, o] of req.ops.entries()) {
    const validate = argValidators[o.op];
    if (!validate) fail(path, `ops[${i}] "${o.op}" is not in contracts/ops.json`);
    else if (!argsValid(validate, o.args ?? {})) fail(path, `ops[${i}] ${o.op} args: ${ajv.errorsText(validate.errors)}`);
  }
}

function checkResponse(path) {
  responses++;
  const res = readJson(path);
  if (!responseSchema(res)) return fail(path, `response schema: ${ajv.errorsText(responseSchema.errors)}`);
  if (res.error && !errorCodes.has(res.error.code)) fail(path, `unknown error code ${res.error.code}`);
  const reqPath = path.replace(/\.response\.json$/, '');
  const reqFile = ['.request.json', '.request.noargs.json'].map((s) => reqPath + s).find((p) => { try { statSync(p); return true; } catch { return false; } });
  const req = reqFile ? readJson(reqFile) : null;
  if (res.ok && req && (res.results.length !== req.ops.length || res.results.some((r, i) => r.op !== (req.ops[i].op ?? '?')))) {
    fail(path, 'results do not line up with request ops');
  }
  for (const r of res.results) {
    if (r.error && !errorCodes.has(r.error.code)) fail(path, `unknown error code ${r.error.code} in ${r.op}`);
    if (r.ok && r.result !== undefined && (r.result === null || typeof r.result !== 'object' || Array.isArray(r.result))) fail(path, `${r.op}: ok result must be a plain JSON object (PROTOCOL section 5)`);
    const c = covered.get(r.op) ?? { ok: 0, error: 0 };
    c[r.ok ? 'ok' : 'error']++;
    covered.set(r.op, c);
  }
}

walk(dumpDir);

// Ops whose handlers have no input-dependent failure mode; their error path is exercised via host fault injection instead.
const NO_INPUT_FAILURE = new Set(['ping', 'capabilities', 'getLog', 'getDocumentInfo', 'listMaterials']);
for (const name of Object.keys(opsDoc.ops)) {
  const c = covered.get(name) ?? { ok: 0, error: 0 };
  if (!c.ok) fail('coverage', `${name}: no successful call in any case`);
  if (!c.error && !NO_INPUT_FAILURE.has(name)) fail('coverage', `${name}: no error-path call in any case`);
}

console.log(`validated ${requests} requests and ${responses} responses; ${Object.keys(opsDoc.ops).length} ops in contracts, ${covered.size} exercised`);
if (failures.length) {
  failures.slice(0, 40).forEach((f) => console.error(`FAIL ${f}`));
  console.error(`${failures.length} schema/coverage failure(s)`);
  process.exit(1);
}
console.log('schema validation: ok');
