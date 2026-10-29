// Concatenates bridge/runtime/*.js into bridge/dist/runtime.js (+ runtime.meta.json) and renders the loader macro.
//   node scripts/build-runtime.mjs [--macro-out FILE --runtime-path PATH --mcp-dir DIR]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = join(root, 'bridge', 'runtime');
const distDir = join(root, 'bridge', 'dist');
const templatePath = join(root, 'bridge', 'macro', 'C3D-MCP Bridge.js.template');

// Dependency order: later modules read earlier ones at load time.
export const MODULES = ['util', 'core', 'capabilities', 'params', 'scene', 'geometry', 'materials', 'document', 'anim', 'render', 'exec', 'index'];

const nonAscii = /[^\x00-\x7e\n]/;

export function readVersion() {
  return readFileSync(join(runtimeDir, 'VERSION'), 'utf8').trim();
}

export function buildRuntime({ write = true } = {}) {
  const version = readVersion();
  const parts = [`/* c3d-mcp runtime ${version} */`];
  for (const name of MODULES) {
    const text = readFileSync(join(runtimeDir, `${name}.js`), 'utf8').replace('__C3D_RUNTIME_VERSION__', version);
    if (nonAscii.test(text)) throw new Error(`${name}.js contains non-ASCII characters (File.read counts bytes, P05)`);
    parts.push(text.replace(/\n+$/, ''));
  }
  const source = `${parts.join('\n')}\n`;
  const meta = { version, sha256: createHash('sha256').update(source).digest('hex'), bytes: Buffer.byteLength(source) };
  if (write) {
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'runtime.js'), source);
    writeFileSync(join(distDir, 'runtime.meta.json'), `${JSON.stringify(meta, null, 1)}\n`);
  }
  return { source, meta };
}

function jsString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Renders the loader macro; values are escaped for single-quoted JS string literals. */
export function renderMacro({ runtimePath, mcpDir, version, template = readFileSync(templatePath, 'utf8') }) {
  const values = { RUNTIME_PATH: runtimePath, MCP_DIR: mcpDir.replace(/\/+$/, ''), VERSION: version ?? readVersion() };
  return template.replace(/\{\{(RUNTIME_PATH|MCP_DIR|VERSION)\}\}/g, (_, key) => jsString(values[key]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { meta } = buildRuntime();
  console.log(`runtime ${meta.version}: ${meta.bytes} bytes, sha256 ${meta.sha256}`);
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const out = opt('--macro-out');
  if (out) {
    writeFileSync(out, renderMacro({ runtimePath: opt('--runtime-path'), mcpDir: opt('--mcp-dir'), version: meta.version }));
    console.log(`macro written to ${out}`);
  }
}
