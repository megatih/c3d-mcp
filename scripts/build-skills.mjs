#!/usr/bin/env node
// Validates the agent skills in skills/ against the Agent Skills format and this project's rules, mirrors them into the Claude Code
// plugin (plugin/skills) and, with --zip <dir>, writes the upload bundles (one zip per skill + one with all skills).
//   node scripts/build-skills.mjs [--check] [--zip <outDir>]
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(repo, 'skills');
const args = process.argv.slice(2);
const zipIdx = args.indexOf('--zip');
const zipOut = zipIdx >= 0 ? resolve(args[zipIdx + 1]) : undefined;
const checkOnly = args.includes('--check');
const version = JSON.parse(readFileSync(join(repo, 'packages/server/package.json'), 'utf8')).version;

const tools = new Set([...readFileSync(join(repo, 'docs/TOOLS.md'), 'utf8').matchAll(/\bc3d_[a-z0-9_]+\b/g)].map((m) => m[0]));
for (const t of ['c3d_doctor', 'c3d_install_bridge', 'c3d_capabilities']) tools.add(t);

// Built from fragments so this file never contains the strings the public sync scrubs.
const PRIVATE = new RegExp(['/Users/[a-z0-9_-]+/', ['KAGE_V', 'illa'].join(''), ['W23', 'HRVT3KD'].join(''), '@gmail\\.com'].join('|'), 'i');
const errors = [];
const err = (skill, msg) => errors.push(`${skill}: ${msg}`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return undefined;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { fm, body: text.slice(m[0].length) };
}

const names = existsSync(skillsDir) ? readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
if (names.length === 0) errors.push('no skills found in skills/');

for (const name of names) {
  const dir = join(skillsDir, name);
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) { err(name, 'missing SKILL.md'); continue; }
  const parsed = parseFrontmatter(readFileSync(file, 'utf8'));
  if (!parsed) { err(name, 'missing YAML frontmatter'); continue; }
  const { fm, body } = parsed;
  const keys = Object.keys(fm);
  for (const k of keys) if (!['name', 'description'].includes(k)) err(name, `unexpected frontmatter key "${k}"`);
  if (fm.name !== name) err(name, `frontmatter name "${fm.name}" must equal the folder name`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) err(name, 'name must be lowercase-hyphen, at most 64 characters');
  if (/claude|anthropic/.test(name)) err(name, 'name must not contain "claude" or "anthropic"');
  if (!fm.description) err(name, 'missing description');
  else {
    if (fm.description.length > 1024) err(name, `description is ${fm.description.length} characters (max 1024)`);
    if (/<[a-z/][^>]*>/i.test(fm.description)) err(name, 'description must not contain XML tags');
    if (!/\b(use|when)\b/i.test(fm.description)) err(name, 'description should say when to use the skill');
  }
  const lines = body.split('\n').length;
  if (lines > 500) err(name, `SKILL.md body has ${lines} lines (max 500)`);
  for (const f of walk(dir)) {
    const rel = relative(dir, f);
    if (!/\.(md|js|json|txt)$/.test(rel)) err(name, `unsupported file type ${rel}`);
    if (statSync(f).size > 200_000) err(name, `${rel} is larger than 200 KB`);
    const text = readFileSync(f, 'utf8');
    if (PRIVATE.test(text)) err(name, `${rel} contains a private path or identity`);
    if (rel.endsWith('.md')) {
      for (const m of text.matchAll(/\bc3d_[a-z0-9_]+\b/g)) if (!tools.has(m[0]) && !/^c3d_(xxx|mcp)$/.test(m[0])) err(name, `${rel} mentions unknown tool ${m[0]}`);
      for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        const target = m[1];
        if (/^[a-z]+:/i.test(target)) continue;
        if (!existsSync(resolve(dirname(f), target))) err(name, `${rel} links to missing file ${target}`);
      }
    }
    if (rel.endsWith('.js')) {
      try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { err(name, `${rel} has a syntax error: ${String(e.stderr).split('\n')[0]}`); }
    }
  }
  // Every reference file must be reachable from SKILL.md (one level deep).
  for (const sub of ['references', 'templates']) {
    if (!existsSync(join(dir, sub))) continue;
    for (const f of readdirSync(join(dir, sub))) if (!readFileSync(file, 'utf8').includes(`${sub}/${f}`)) err(name, `${sub}/${f} is not linked from SKILL.md`);
  }
}

if (errors.length) {
  console.error(`build-skills: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`build-skills: ${names.length} skills valid (${names.join(', ')})`);
if (checkOnly) process.exit(0);

// Mirror into the Claude Code plugin (replaces the folders of the same names; other plugin skills are not touched).
const pluginSkills = join(repo, 'plugin', 'skills');
mkdirSync(pluginSkills, { recursive: true });
rmSync(join(pluginSkills, 'cheetah3d'), { recursive: true, force: true });
for (const name of names) {
  rmSync(join(pluginSkills, name), { recursive: true, force: true });
  cpSync(join(skillsDir, name), join(pluginSkills, name), { recursive: true });
}

if (zipOut) {
  rmSync(join(zipOut, 'skills'), { recursive: true, force: true });
  mkdirSync(join(zipOut, 'skills'), { recursive: true });
  for (const name of names) execFileSync('zip', ['-qr', join(zipOut, 'skills', `${name}-${version}.zip`), name, '-x', '*.DS_Store'], { cwd: skillsDir });
  execFileSync('zip', ['-qr', join(zipOut, `c3d-skills-${version}.zip`), ...names, '-x', '*.DS_Store'], { cwd: skillsDir });
  console.log(`build-skills: wrote c3d-skills-${version}.zip and ${names.length} per-skill zips to ${zipOut}`);
}
