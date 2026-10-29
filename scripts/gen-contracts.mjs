// Generates contracts/ops.json and contracts/errors.json from contracts/ops.src.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ops, errorCodes } from '../contracts/ops.src.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'contracts');
const out = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'c3d-mcp bridge ops',
  protocol: 1,
  ops: Object.fromEntries(
    Object.entries(ops).map(([name, d]) => [name, { rw: d.rw, summary: d.summary, args: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...d.args } }]),
  ),
};
writeFileSync(join(root, 'ops.json'), JSON.stringify(out, null, 1) + '\n');
writeFileSync(join(root, 'errors.json'), JSON.stringify({ codes: errorCodes }, null, 1) + '\n');
console.log(`wrote ${Object.keys(ops).length} ops, ${Object.keys(errorCodes).length} error codes`);
