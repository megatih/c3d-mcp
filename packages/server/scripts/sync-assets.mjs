#!/usr/bin/env node
// Copies the repo-level build inputs into packages/server/assets/ for the npm package. Idempotent: managed paths are
// rebuilt from scratch on every run, nothing else in assets/ is touched.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(pkg, '..', '..');
const assets = join(pkg, 'assets');

function need(path) {
  if (!existsSync(path)) {
    console.error(`sync-assets: missing ${path}`);
    process.exit(1);
  }
  return path;
}

const reset = (...rel) => rmSync(join(assets, ...rel), { recursive: true, force: true });

mkdirSync(assets, { recursive: true });

// Runtime (+ meta). Refuse to ship a runtime whose checksum disagrees with its meta file.
const runtime = need(join(repo, 'bridge', 'dist', 'runtime.js'));
const meta = join(repo, 'bridge', 'dist', 'runtime.meta.json');
if (existsSync(meta)) {
  const expected = JSON.parse(readFileSync(meta, 'utf8')).sha256;
  const actual = createHash('sha256').update(readFileSync(runtime)).digest('hex');
  if (expected && expected !== actual) {
    console.error(`sync-assets: bridge/dist/runtime.js does not match runtime.meta.json (rebuild the bridge)`);
    process.exit(1);
  }
}
reset('runtime.js');
reset('runtime.meta.json');
cpSync(runtime, join(assets, 'runtime.js'));
if (existsSync(meta)) cpSync(meta, join(assets, 'runtime.meta.json'));

// Loader macro template(s).
const macroDir = need(join(repo, 'bridge', 'macro'));
reset('macro');
mkdirSync(join(assets, 'macro'), { recursive: true });
for (const f of readdirSync(macroDir)) {
  if (f.endsWith('.template')) cpSync(join(macroDir, f), join(assets, 'macro', f));
}

// Helper app (zip made by scripts/release.sh); optional so a plain `npm pack` in a fresh checkout still works.
const helperZip = join(repo, 'helper', 'build', 'C3D-Bridge-Helper.zip');
reset('helper');
if (existsSync(helperZip)) {
  mkdirSync(join(assets, 'helper'), { recursive: true });
  cpSync(helperZip, join(assets, 'helper', 'C3D-Bridge-Helper.zip'));
}

// Vendored knowledge base, pruned to what the server reads at runtime, plus its licence files.
const kb = need(join(repo, 'vendor', 'c3d-scripting-kb'));
reset('kb');
const kbOut = join(assets, 'kb');
mkdirSync(join(kbOut, 'reference'), { recursive: true });
mkdirSync(join(kbOut, 'dist'), { recursive: true });
mkdirSync(join(kbOut, 'research'), { recursive: true });
mkdirSync(join(kbOut, 'examples'), { recursive: true });
mkdirSync(join(kbOut, 'forum'), { recursive: true });
cpSync(need(join(kb, 'knowledge')), join(kbOut, 'knowledge'), { recursive: true });
cpSync(need(join(kb, 'reference', 'api-index.json')), join(kbOut, 'reference', 'api-index.json'));
for (const f of readdirSync(need(join(kb, 'dist')))) {
  if (f.endsWith('.md') && statSync(join(kb, 'dist', f)).isFile()) cpSync(join(kb, 'dist', f), join(kbOut, 'dist', f));
}
for (const f of ['LICENSE', 'NOTICE.md']) if (existsSync(join(kb, f))) cpSync(join(kb, f), join(kbOut, f));
cpSync(need(join(kb, 'reference', 'api')), join(kbOut, 'reference', 'api'), { recursive: true });
for (const f of ['book-ch17.8-scripts.md', 'ExecuteScript.md']) if (existsSync(join(kb, 'reference', f))) cpSync(join(kb, 'reference', f), join(kbOut, 'reference', f));
cpSync(need(join(kb, 'examples', 'official')), join(kbOut, 'examples', 'official'), { recursive: true });
// Forum archive (low-ranked, unverified search source): transcripts + per-thread catalog reviews.
cpSync(need(join(kb, 'forum', 'threads')), join(kbOut, 'forum', 'threads'), { recursive: true });
mkdirSync(join(kbOut, 'catalog'), { recursive: true });
cpSync(need(join(kb, 'catalog', 'forum-threads.json')), join(kbOut, 'catalog', 'forum-threads.json'));
// "Learn 3D with Cheetah 3D" (BSD-2-Clause): chapter text only.
const book = need(join(repo, 'vendor', 'learn3d-cheetah'));
cpSync(need(join(book, 'book')), join(kbOut, 'book'), { recursive: true });
cpSync(need(join(book, 'LICENSE')), join(kbOut, 'book', 'LICENSE'));
// Project research notes (02 = API facts, 08 = probes, 10 = verification of the two external sources).
for (const f of ['02-cheetah3d-js-api.md', '08-open-questions-and-probes.md', '10-kb-verification-8.1.3.md']) cpSync(need(join(repo, 'research', f)), join(kbOut, 'research', f));

// Agent skills (source of truth: <repo>/skills, validated by scripts/build-skills.mjs).
const skillsOut = join(pkg, 'skills');
rmSync(skillsOut, { recursive: true, force: true });
if (existsSync(join(repo, 'skills'))) cpSync(join(repo, 'skills'), skillsOut, { recursive: true });

console.log(`sync-assets: wrote ${assets}`);
