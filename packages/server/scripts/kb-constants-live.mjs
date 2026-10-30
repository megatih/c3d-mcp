// Checks EVERY ALL-CAPS identifier mentioned in the vendored API docs / official examples / gotchas against the running Cheetah3D:
// which exist (with value) and which are undefined. Output: research/raw/kb-constants-8.1.3.json (input for src/services/kbOverlay.ts).
import { connect } from './live-driver.mjs';
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const kb = join(root, 'vendor/c3d-scripting-kb');
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
walk(join(kb, 'reference/api'));
walk(join(kb, 'examples/official'));
files.push(join(kb, 'knowledge/gotchas.md'), join(kb, 'knowledge/patterns.md'));
const names = new Set();
for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) names.add(m[0]);
// Also every ALL-CAPS string in the app binary (finds undocumented constants such as CONST_INTERPOL) and a few names probed by hand.
try { for (const n of execSync("strings -a /Applications/Cheetah3D.app/Contents/MacOS/Cheetah3D", { maxBuffer: 1 << 28 }).toString().split('\n')) if (/^[A-Z][A-Z0-9_]{3,40}$/.test(n)) names.add(n); } catch { /* optional */ }
for (const f of readdirSync(join(root, 'bridge/runtime'))) if (f.endsWith('.js')) for (const m of readFileSync(join(root, 'bridge/runtime', f), 'utf8').matchAll(/\b[A-Z][A-Z0-9_]{3,}\b/g)) names.add(m[0]); // names the bridge itself relies on
for (const n of ['ENVIRONMENTLIGHT', 'CONST_INTERPOL', 'CONSTANT_INTERPOL', 'STEP_INTERPOL', 'SKYLIGHT', 'SUBDIVMOD', 'IDENTITY']) names.add(n);
const list = [...names].sort();
const { call, close } = await connect({ C3D_MCP_AUTO_CONFIRM: '1' });
await call('c3d_new_document', {});
// the sandbox blocks Function, so generate explicit typeof expressions instead
const expr = list.map((n) => `[${JSON.stringify(n)},(typeof ${n}==="undefined")?null:${n}]`).join(',');
const r = await call('c3d_run_script', { code: `return [${expr}];`, force: true, confirm: true });
if (r.isError) { console.error(r.sc ?? r.text); process.exit(1); }
const present = {}, absent = [], nonNumeric = {};
for (const [n, v] of r.sc.value) { if (v === null) absent.push(n); else if (typeof v === 'number') present[n] = v; else nonNumeric[n] = v; }
writeFileSync(join(root, 'research/raw/kb-constants-8.1.3.json'), JSON.stringify({ app: 'Cheetah3D 8.1.3', candidates: list.length, present, absent, nonNumeric }, null, 1));
console.log('candidates', list.length, 'present', Object.keys(present).length, 'absent', absent.length, 'nonNumeric', Object.keys(nonNumeric).length);
await close();
