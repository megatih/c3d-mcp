#!/usr/bin/env node
// Leak scanner for everything that gets published: a source tree, build archives, or a git history.
//   node scripts/check-public.mjs --tree <dir>
//   node scripts/check-public.mjs --archive <file.tgz|.mcpb|.zip|.sh> [...]
//   node scripts/check-public.mjs --history <git-repo>
// Exit 1 when an error is found. The private patterns are assembled from fragments so this file never contains them.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';

const j = (...p) => p.join('');
// [label, regex, severity]
const RULES = [
  ['private project name', new RegExp(j('japanese', 'house'), 'i'), 'error'],
  ['private file name', new RegExp(j('KAGE', '_V', 'illa') + '|' + j('Kage ', 'V', 'illa'), 'i'), 'error'],
  ['private checksum prefix', new RegExp(j('9f95', 'd3a7')), 'error'],
  ['personal name', new RegExp(j('Megat ', 'Isk', 'andar') + '|' + j('Isk', 'andar'), 'i'), 'error'],
  ['personal email', new RegExp(j('mega', 't', 'isk', 'andar')), 'error'],
  ['signing identity', new RegExp(j('W23', 'HRVT3KD')), 'error'],
  ['home path', /\/Users\/(?!<|\$|\.\.\.|name\/|you\/|user\/|username\/|Shared\/|x\/|me\/|foo\/|bar\/|alice\/|bob\/|tester\/|someone\/)[A-Za-z0-9_.-]+\//, 'error'],
  ['scratch path', new RegExp(j('claude', '-501') + '|' + j('Users-', 'mega', 'tih')), 'error'],
  ['private host', new RegExp(j('syno', 'logy')), 'error'],
  ['webmail address', /[A-Za-z0-9._%+-]+@(?:gmail|googlemail|icloud|me|outlook|hotmail|yahoo|proton|protonmail)\.[a-z.]+/i, 'error'],
  ['token', /ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'error'],
  ['private network address', /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/, 'error'],
];
// Informational: the signed helper carries its signing certificate subject (unavoidable for a signed app).
const SIGNATURE_ONLY = new RegExp(j('Apple Development', ': '));
const DENY_PATHS = [/^PRD\.md$/, /(^|\/)research\/raw\//, /(^|\/)docs\/benchmark\/cyberpunk\/(reference|blender-astra-opus-result|montage|montage-fullframe)\.png$/, /(^|\/)\.env(\.|$)/, /\.p12$|\.pem$|\.key$|id_rsa/, /(^|\/)\.DS_Store$/];

const args = process.argv.slice(2);
const mode = args[0];
const targets = args.slice(1);
const findings = [];
const add = (severity, where, label, snippet) => findings.push({ severity, where, label, snippet: String(snippet).slice(0, 120) });

// Third-party code (node_modules) legitimately contains other people's emails and example IPs: only the identity rules apply there.
const GENERIC = new Set(['webmail address', 'private network address']);
function scanText(where, text, signatureContext = false) {
  const lines = text.split('\n');
  const vendored = /(^|\/)node_modules\//.test(where);
  lines.forEach((line, i) => {
    for (const [label, re, sev] of RULES) {
      if (vendored && GENERIC.has(label)) continue;
      const m = re.exec(line);
      if (!m) continue;
      const downgrade = signatureContext && SIGNATURE_ONLY.test(line);
      add(downgrade ? 'warn' : sev, `${where}:${i + 1}`, downgrade ? `${label} (code-signature subject)` : label, m[0]);
    }
  });
}

const isBinary = (buf) => buf.subarray(0, 4096).includes(0);

function scanFile(root, file, signatureContext = false) {
  const rel = relative(root, file);
  for (const re of DENY_PATHS) if (re.test(rel)) add('error', rel, 'path must not be published', rel);
  let st;
  try { st = statSync(file); } catch { return; }
  if (!st.isFile() || st.size > 60 * 1024 * 1024) return;
  const buf = readFileSync(file);
  if (isBinary(buf)) {
    if (/\.(png|jpe?g|gif|zip|gz|tgz|woff2?|ico|icns|tiff?)$/i.test(rel)) return;
    let text = '';
    try { text = execFileSync('strings', ['-a', file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); } catch { return; }
    scanText(rel, text, true);
    return;
  }
  scanText(rel, buf.toString('utf8'), signatureContext || /\.app\//.test(rel));
}

const SKIP = new Set(['.git', 'node_modules', '.build', 'build', 'release', 'results', 'bundle']);
function walk(dir, skip = (n) => SKIP.has(n)) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (skip(d.name)) continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(p, skip)); else out.push(p);
  }
  return out;
}

function scanTree(dir) {
  for (const f of walk(dir)) scanFile(dir, f);
}

function scanArchive(file) {
  const tmp = mkdtempSync(join(tmpdir(), 'c3d-leak-'));
  try {
    if (/\.(tgz|tar\.gz)$/.test(file)) execFileSync('tar', ['-xzf', file, '-C', tmp]);
    else if (/\.(zip|mcpb)$/.test(file)) execFileSync('unzip', ['-q', '-o', file, '-d', tmp]);
    else { scanFile(join(file, '..'), file); return; }
    // dependencies inside archives are third-party code: scan everything, but ignore node_modules test fixtures noise only for personal-name false positives
    for (const f of walk(tmp, (n) => n === '.git')) scanFile(tmp, f);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function scanHistory(repo) {
  const git = (a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  const names = git(['log', '--all', '--name-only', '--format=']).split('\n').filter(Boolean);
  for (const n of new Set(names)) for (const re of DENY_PATHS) if (re.test(n)) add('error', `history:${n}`, 'path must not appear in history', n);
  const patch = git(['log', '--all', '-p', '--no-color', '--format=commit %h', '--text']);
  let commit = '?';
  for (const line of patch.split('\n')) {
    if (line.startsWith('commit ')) { commit = line.slice(7, 14); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const [label, re, sev] of RULES) { const m = re.exec(line); if (m) add(sev, `history:${commit}`, label, m[0]); }
  }
  const authors = new Set(git(['log', '--all', '--format=%ae|%ce']).split(/[|\n]/).filter(Boolean));
  for (const a of authors) if (!/noreply/.test(a)) add('error', 'history:authors', 'commit author/committer email is not a noreply address', a);
}

if (!['--tree', '--archive', '--history'].includes(mode) || targets.length === 0) {
  console.error('usage: check-public.mjs --tree <dir> | --archive <file>... | --history <repo>');
  process.exit(2);
}
for (const t of targets) {
  if (!existsSync(t)) { console.error(`not found: ${t}`); process.exit(2); }
  if (mode === '--tree') scanTree(t); else if (mode === '--archive') scanArchive(t); else scanHistory(t);
}
const errors = findings.filter((f) => f.severity === 'error');
const warns = findings.filter((f) => f.severity === 'warn');
const uniq = (arr) => [...new Map(arr.map((f) => [`${f.where}|${f.label}|${f.snippet}`, f])).values()];
for (const f of uniq(errors).slice(0, 80)) console.error(`ERROR ${f.where}  ${f.label}: ${f.snippet}`);
for (const f of uniq(warns).slice(0, 5)) console.error(`warn  ${f.where}  ${f.label}`);
console.log(`check-public ${mode.slice(2)}: ${errors.length} error(s), ${warns.length} warning(s) in ${targets.map((t) => basename(t)).join(', ')}`);
process.exit(errors.length ? 1 : 0);
