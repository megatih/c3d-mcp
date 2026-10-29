#!/usr/bin/env node
// Phased headless run of docs/benchmark/cyberpunk-diorama.prompt.md with Claude Opus 5.5 against the c3d MCP server.
//   node scripts/cyberpunk-run.mjs [--from=P0] [--to=P7] [--session=<id>] [--run=<dir>] [--model=claude-opus-5-5] [--max-turns=150] [--phase-timeout-min=45]
// Each phase is one `claude -p` turn; phases after the first use --resume so the agent keeps its context.
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const MODEL = args.model ?? 'claude-opus-5-5';
const MAX_TURNS = String(args['max-turns'] ?? 150);
const PHASE_TIMEOUT = Number(args['phase-timeout-min'] ?? 45) * 60_000;
const runDir = resolve(args.run ?? join(repo, 'evals', 'results', `cyberpunk-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const workDir = join(runDir, 'work');
mkdirSync(workDir, { recursive: true });

// --- prompt parsing ---
const text = readFileSync(join(repo, 'docs', 'benchmark', 'cyberpunk-diorama.prompt.md'), 'utf8');
const body = text.slice(text.indexOf('=====MISSION=====') + '=====MISSION====='.length);
const parts = body.split(/^## PHASE (P\d) — /m); // [mission, id, text, id, text, ...]
const mission = parts[0].trim();
const phases = []; for (let i = 1; i < parts.length; i += 2) phases.push({ id: parts[i], text: parts[i + 1].trim() });
const from = phases.findIndex((p) => p.id === (args.from ?? 'P0'));
const to = phases.findIndex((p) => p.id === (args.to ?? 'P7'));
if (from < 0 || to < from) throw new Error(`bad phase range ${args.from}..${args.to}`);

copyFileSync(join(repo, 'docs', 'benchmark', 'cyberpunk', 'reference.png'), join(runDir, 'reference.png'));
writeFileSync(join(runDir, 'mcp.json'), JSON.stringify({ mcpServers: { c3d: { command: process.execPath, args: [join(repo, 'packages/server/bin/c3d-mcp.js'), 'serve'], env: { C3D_MCP_PROFILE: 'full', C3D_MCP_WORKDIR: workDir, C3D_MCP_AUTO_CONFIRM: '1' } } } }));

// --- Cheetah hygiene: only dismisses dialogs/panels (OK/Cancel through Accessibility) ---
const CLEAN = `tell application "System Events"
  if not (exists process "Cheetah3D") then return "none"
  tell process "Cheetah3D"
    set n to count of windows
    repeat with i from n to 1 by -1
      try
        set w to window i
        if subrole of w is "AXDialog" then click button "OK" of w
      end try
    end repeat
  end tell
end tell`;
const clean = () => { try { execFileSync('osascript', ['-e', CLEAN], { timeout: 15_000 }); } catch { /* ignore */ } };
const log = (m) => { const line = `${new Date().toISOString()} ${m}\n`; process.stdout.write(line); appendFileSync(join(runDir, 'run.log'), line); };

let session = args.session && args.session !== true ? args.session : undefined;
const summary = [];

function runPhase(phase, index) {
  const first = !session;
  const prompt = first
    ? `The reference image is at ./reference.png in the current directory: open it with the Read tool and keep it in mind for the whole job.\n\n${mission}\n\n---\nStart now with PHASE ${phase.id}:\n\n${phase.text}`
    : `${index === from && args.note ? args.note + '\n\n' : ''}Continue with PHASE ${phase.id}:\n\n${phase.text}`;
  const cliArgs = ['-p', prompt, '--mcp-config', join(runDir, 'mcp.json'), '--strict-mcp-config', '--tools', 'Read', '--allowedTools', 'mcp__c3d', 'Read',
    '--add-dir', runDir, '--output-format', 'stream-json', '--verbose', '--max-turns', MAX_TURNS, '--model', MODEL, ...(first ? [] : ['--resume', session])];
  log(`PHASE ${phase.id} start (${first ? 'new session' : 'resume ' + session})`);
  const t0 = Date.now();
  const stats = { phase: phase.id, calls: 0, errors: 0, renders: 0, tools: {}, turns: 0, cost: 0, answer: '', session: undefined, ms: 0, stopped: undefined };
  return new Promise((res) => {
    const p = spawn('claude', cliArgs, { cwd: runDir, stdio: ['ignore', 'pipe', 'pipe'] });
    const raw = join(runDir, `phase-${phase.id}.jsonl`);
    let buf = ''; const pending = new Map();
    const timer = setTimeout(() => { stats.stopped = 'timeout'; p.kill('SIGTERM'); }, PHASE_TIMEOUT);
    p.stdout.on('data', (d) => {
      appendFileSync(raw, d); buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'system' && m.session_id) stats.session = m.session_id;
        if (m.type === 'assistant') for (const c of m.message?.content ?? []) if (c.type === 'tool_use') {
          stats.calls++; const n = c.name.replace('mcp__c3d__', ''); stats.tools[n] = (stats.tools[n] ?? 0) + 1; pending.set(c.id, n); if (n === 'c3d_render_image') stats.renders++;
          if (stats.calls % 10 === 0) log(`  ${phase.id}: ${stats.calls} calls, ${stats.errors} errors, last ${n}`);
        }
        if (m.type === 'user') for (const c of m.message?.content ?? []) if (c.type === 'tool_result' && c.is_error) stats.errors++;
        if (m.type === 'result') { stats.answer = m.result ?? ''; stats.cost = m.total_cost_usd ?? 0; stats.turns = m.num_turns ?? 0; stats.session = m.session_id ?? stats.session; if (m.is_error || /usage limit|rate limit/i.test(stats.answer)) stats.stopped = stats.stopped ?? 'error-result'; }
      }
    });
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => { clearTimeout(timer); stats.ms = Date.now() - t0; stats.exit = code; if (err.trim()) stats.stderr = err.slice(-500); res(stats); });
  });
}

for (let i = from; i <= to; i++) {
  clean();
  const s = await runPhase(phases[i], i);
  if (s.session) session = s.session;
  summary.push(s);
  writeFileSync(join(runDir, `phase-${s.phase}.json`), JSON.stringify(s, null, 1));
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ model: MODEL, session, phases: summary }, null, 1));
  log(`PHASE ${s.phase} done: ${s.calls} calls, ${s.errors} errors, ${s.renders} renders, ${(s.ms / 60000).toFixed(1)} min, turns ${s.turns}, cost(API-equiv) $${s.cost.toFixed(2)}${s.stopped ? ' STOPPED=' + s.stopped : ''}`);
  log(`  answer: ${s.answer.slice(0, 300).replace(/\n/g, ' ')}`);
  clean();
  if (s.stopped || s.exit) { log('stopping early; resume with --session=' + session + ' --from=' + phases[i].id); break; }
}
log(`RUN DIR ${runDir}  SESSION ${session}`);
