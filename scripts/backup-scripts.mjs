// Timestamped tar backup of Cheetah3D's Scripts dir (PRD §0). Dirs are created from Node, never from JS.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const base = join(homedir(), 'Library/Application Support/Cheetah3D');
const dest = join(base, 'MCP-backups');
mkdirSync(dest, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(dest, `Scripts-${stamp}.tar`);
execFileSync('tar', ['-cf', out, '-C', base, 'Scripts']);
console.log(out);
