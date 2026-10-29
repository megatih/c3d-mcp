#!/usr/bin/env node
// Eval runner: for each task x N, prepares a fixture document, runs `claude -p` against the c3d MCP server, dumps the scene
// through the same tools, scores the assertions and records spend. Stops when the budget cap is hit.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { connect } from '../../packages/server/scripts/live-driver.mjs';
import { evaluate, knownAssertionTypes } from './assertions.mjs';
import { runLocalAgent } from './mlx-agent.mjs';
import { dumpScene } from './scene.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const N = Number(args.n ?? 3);
const BUDGET = Number(args.budget ?? 25);
const PER_RUN = Number(args['per-run'] ?? 0.75);
const MODEL = args.model ?? 'claude-sonnet-5-5';
const AGENT = args.agent ?? 'claude';
const LOCAL_URL = args.url ?? 'http://127.0.0.1:8088';
const onlyProfile = args.profile;
const onlyTasks = args.tasks ? String(args.tasks).split(',') : null;
const outDir = resolve(args.out ?? join(repo, 'evals', 'results', new Date().toISOString().replace(/[:.]/g, '-')));
mkdirSync(outDir, { recursive: true });

const tasks = readdirSync(join(repo, 'evals', 'tasks')).filter((f) => f.endsWith('.yaml')).map((f) => parse(readFileSync(join(repo, 'evals', 'tasks', f), 'utf8')))
  .filter((t) => (!onlyProfile || t.profile === onlyProfile) && (!onlyTasks || onlyTasks.includes(t.id)));
for (const t of tasks) for (const a of t.assertions) if (!knownAssertionTypes.includes(a.type)) throw new Error(`task ${t.id}: unknown assertion ${a.type}`);

const SOCK = join(homedir(), 'Library/Application Support/Cheetah3D/MCP/helper.sock');
function helperCall(cmd, a = {}) {
  return new Promise((res, rej) => {
    const s = createConnection(SOCK); let buf = '';
    s.on('connect', () => s.write(JSON.stringify({ id: 'r', cmd, args: a }) + '\n'));
    s.on('data', (d) => { buf += d; if (buf.includes('\n')) { s.end(); try { res(JSON.parse(buf.split('\n')[0])); } catch (e) { rej(e); } } });
    s.on('error', rej); setTimeout(() => rej(new Error('helper timeout')), 15000);
  });
}
const analyze = async (path) => { try { const r = await helperCall('analyzeImage', { path }); return r.ok ? r.result : null; } catch { return null; } };
const osa = (s) => { try { return execFileSync('osascript', ['-e', s], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const windowTitles = () => osa('tell application "System Events" to tell process "Cheetah3D" to get name of every window').split(', ').filter(Boolean);

/** Closes document windows that appeared during a run (our own documents), answering "Don't Save" for them only. */
function closeNewWindows(before) {
  for (const t of windowTitles()) {
    if (before.includes(t) || t === 'Render Manager' || t === '') continue;
    osa(`tell application "System Events" to tell process "Cheetah3D"
      try
        set w to first window whose name is ${JSON.stringify(t)}
        click button 1 of w
        delay 0.6
        if (count of sheets of w) > 0 then click (first button of sheet 1 of w whose name contains "Don")
      end try
    end tell`);
  }
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
let spent = 0; const rows = [];

async function ensureDocumentWindow() {
  const w = await helperCall('windows').catch(() => null);
  const docs = (w?.result ?? []).filter((x) => x.role === 'AXWindow' && x.title && x.title !== 'Render Manager');
  if (!docs.length) { await helperCall('newDocument').catch(() => null); await new Promise((r) => setTimeout(r, 1500)); }
}

async function runOnce(task, rep) {
  await ensureDocumentWindow();
  const runDir = mkdtempSync(join(outDir, `${task.id}-${rep}-`));
  const workDir = join(runDir, 'work'); mkdirSync(workDir);
  const before = windowTitles();
  const srv = await connect({ C3D_MCP_PROFILE: 'full', C3D_MCP_WORKDIR: workDir });
  let fixturePath = null; let fixtureSha = null;
  try {
    if (task.fixture) {
      const src = join(repo, task.fixture);
      if (!existsSync(src)) return { skipped: `fixture ${task.fixture} missing` };
      fixtureSha = sha(src); fixturePath = join(runDir, 'fixture.jas'); copyFileSync(src, fixturePath);
      const o = await srv.call('c3d_open_document', { path: fixturePath });
      if (o.isError) return { error: `open fixture: ${JSON.stringify(o.sc)}` };
      if (task.id === 'turntable_selected' || task.fixture.endsWith('selected_cube.jas')) await srv.call('c3d_select', { refs: [{ path: '/Model' }] });
    } else {
      const n = await srv.call('c3d_new_document'); if (n.isError) return { error: `new doc: ${JSON.stringify(n.sc)}` };
    }
    const sceneBefore = await dumpScene(srv.call);
    const cfg = join(runDir, 'mcp.json');
    writeFileSync(cfg, JSON.stringify({ mcpServers: { c3d: { command: process.execPath, args: [join(repo, 'packages/server/bin/c3d-mcp.js'), 'serve'], env: { C3D_MCP_PROFILE: task.profile, C3D_MCP_WORKDIR: workDir, C3D_MCP_AUTO_CONFIRM: '1' } } } }));
    const sys = 'You control Cheetah3D through the c3d MCP tools. Do not ask the user questions: act, verify your result (inspect the scene and, for visual tasks, render), then reply with a short summary of what you did.';
    const transcript = []; let answer = ''; let cost = 0; let turns = 0;
    if (AGENT === 'mlx') {
      const r = await runLocalAgent({ prompt: task.prompt, system: sys, serverArgs: [join(repo, 'packages/server/bin/c3d-mcp.js'), 'serve'], env: { C3D_MCP_PROFILE: task.profile, C3D_MCP_WORKDIR: workDir, C3D_MCP_AUTO_CONFIRM: '1' }, baseUrl: LOCAL_URL, model: MODEL, timeoutMs: (task.timeout_s ?? 300) * 1000 });
      transcript.push(...r.transcript); answer = r.answer; turns = r.turns;
    } else await new Promise((res) => {
      const p = spawn('claude', ['-p', task.prompt, '--mcp-config', cfg, '--strict-mcp-config', '--tools', '', '--allowedTools', 'mcp__c3d', '--output-format', 'stream-json', '--verbose', '--max-turns', '40', '--model', MODEL, '--max-budget-usd', String(PER_RUN), '--no-session-persistence', '--append-system-prompt', sys], { cwd: runDir, stdio: ['ignore', 'pipe', 'pipe'] });
      let buf = ''; const timer = setTimeout(() => p.kill('SIGTERM'), (task.timeout_s ?? 300) * 1000);
      p.stdout.on('data', (d) => {
        buf += d; let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
          try {
            const m = JSON.parse(line);
            if (m.type === 'assistant') for (const c of m.message?.content ?? []) if (c.type === 'tool_use') transcript.push({ name: c.name, input: c.input, id: c.id });
            if (m.type === 'user') for (const c of m.message?.content ?? []) if (c.type === 'tool_result') { const t = transcript.find((x) => x.id === c.tool_use_id); if (t) t.isError = !!c.is_error; }
            if (m.type === 'result') { answer = m.result ?? ''; cost = m.total_cost_usd ?? 0; turns = m.num_turns ?? 0; }
          } catch { /* partial line */ }
        }
      });
      p.on('close', () => { clearTimeout(timer); res(); });
    });
    spent += cost;
    const keyframeParams = [...new Set(task.assertions.filter((a) => ['keyframe_count', 'param_at_time'].includes(a.type)).map((a) => a.param))];
    // Fresh session without a bound document: the agent may have opened/restored/imported other windows, so use the front one.
    const post = await connect({ C3D_MCP_PROFILE: 'full', C3D_MCP_WORKDIR: workDir });
    let scene; let results;
    try {
      scene = await dumpScene(post.call, { keyframeParams });
      results = await evaluate(task.assertions, { scene, sceneBefore, call: post.call, transcript, answer, workDir, analyze, fixturePath, fixtureSha, fixtureDir: runDir });
    } finally { await post.close(); }
    writeFileSync(join(runDir, 'result.json'), JSON.stringify({ task: task.id, rep, cost, turns, results, transcript, answer }, null, 1));
    return { cost, turns, calls: transcript.length, results, pass: results.every((r) => r.pass), score: results.filter((r) => r.pass).length / results.length };
  } finally {
    await srv.close();
    closeNewWindows(before);
    await new Promise((r) => setTimeout(r, 2500));
  }
}

for (const task of tasks) {
  for (let rep = 1; rep <= N; rep++) {
    if (spent >= BUDGET) { console.log(`BUDGET CAP REACHED ($${spent.toFixed(2)} >= $${BUDGET}); stopping. PAUSE and report.`); break; }
    process.stdout.write(`${task.id} #${rep} ... `);
    let r; try { r = await runOnce(task, rep); } catch (e) { r = { error: String(e) }; }
    rows.push({ id: task.id, rep, profile: task.profile, tags: task.tags, ...r });
    if (r.skipped || r.error) console.log(`SKIP/ERROR ${r.skipped ?? r.error}`);
    else console.log(`${r.pass ? 'PASS' : 'FAIL'} score=${r.score.toFixed(2)} cost=$${r.cost.toFixed(3)} turns=${r.turns} calls=${r.calls}${r.pass ? '' : ' :: ' + r.results.filter((x) => !x.pass).map((x) => `${x.type}(${x.detail})`).join('; ')}`);
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ model: MODEL, N, spent, rows }, null, 1));
  }
}
const ran = rows.filter((r) => r.results);
const pass = ran.filter((r) => r.pass).length;
console.log(`\nTOTAL runs=${ran.length} pass=${pass} (${ran.length ? ((100 * pass) / ran.length).toFixed(1) : 0}%) spent=$${spent.toFixed(2)} out=${outDir}`);
