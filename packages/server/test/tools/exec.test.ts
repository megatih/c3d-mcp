 
import { beforeEach, describe, expect, it } from 'vitest';
import { getConsole, lintScript, runScript } from '../../src/tools/exec.js';
import { expectCode, makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';

let t: TestCtx;
beforeEach(() => { t = makeCtx(); });

describe('c3d_run_script', () => {
  it('lints, checkpoints, runs and returns value and log', async () => {
    const r = await runTool(runScript, { code: 'var b = doc.addObject(BOX); b.update(); 42' }, t.ctx);
    expect(r.structured).toMatchObject({ value: 42, log: ['hello'], checkpoint: 'cp1' });
    expect(t.bridge.opNames()).toEqual(['saveTo', 'run']);
    expect(t.confirmCalls).toHaveLength(0);
  });
  it('blocks scripts with lint errors unless forced', async () => {
    const e = await expectCode(runTool(runScript, { code: 'File.mkDir("/tmp/x");' }, t.ctx), 'LINT_BLOCKED');
    expect((e.details as any).findings[0].rule).toBe('file-mkdir');
    expect(t.bridge.calls).toHaveLength(0);
    await runTool(runScript, { code: 'File.mkDir("/tmp/x");', force: true }, t.ctx);
    expect(t.bridge.opNames()).toContain('run');
  });
  it('requires confirmation for OS.system and file writes', async () => {
    t.setConfirm(false);
    await expectCode(runTool(runScript, { code: 'OS.system("echo hi");' }, t.ctx), 'CONFIRMATION_REQUIRED');
    await expectCode(runTool(runScript, { code: 'var f = new File("/tmp/a.txt"); f.open(WRITE_MODE); f.write("x");' }, t.ctx), 'CONFIRMATION_REQUIRED');
    expect(t.bridge.opNames()).not.toContain('run');
    await runTool(runScript, { code: 'OS.system("echo hi");', confirm: true }, t.ctx);
    expect(t.bridge.argsOf('run')[0]).toMatchObject({ allowShellToken: 'OS.system' });
  });
  it('is disabled by config', async () => {
    const d = makeCtx({ config: { disableExec: true } });
    await expectCode(runTool(runScript, { code: '1' }, d.ctx), 'NOT_AVAILABLE_IN_PROFILE');
    const s = makeCtx({ config: { disableShell: true } });
    await expectCode(runTool(runScript, { code: 'OS.system("ls")', confirm: true }, s.ctx), 'NOT_AVAILABLE_IN_PROFILE');
  });
  it('propagates script errors and warns when no checkpoint is possible', async () => {
    t.bridge.failures.set('run', new (await import('../../src/toolkit.js')).BridgeError('SCRIPT_ERROR', 'boom', undefined, { line: 3 }));
    t.bridge.failNth.set('saveTo', { n: 1, count: 0, err: new (await import('../../src/toolkit.js')).BridgeError('INTERNAL', 'no') });
    const e = await expectCode(runTool(runScript, { code: 'x()' }, t.ctx), 'SCRIPT_ERROR');
    expect((e.details as any).line).toBe(3);
    t.bridge.failures.clear();
    t.bridge.failNth.set('saveTo', { n: 1, count: 0, err: new (await import('../../src/toolkit.js')).BridgeError('INTERNAL', 'no') });
    const r = await runTool(runScript, { code: '1' }, t.ctx);
    expect(r.structured.warning).toMatch(/cannot be undone/);
  });
  it('passes the deadline and validates input', async () => {
    await runTool(runScript, { code: '1', timeout_s: 5 }, t.ctx);
    expect(t.bridge.requests.at(-1)!.opts).toMatchObject({ deadlineMs: 5000 });
    expect(() => runScript.inputSchema.parse({ code: '' })).toThrow();
    expect(() => runScript.inputSchema.parse({ code: 'x', timeout_s: 9999 })).toThrow();
  });
});

describe('c3d_lint_script', () => {
  it('reports findings with rule ids and lines', async () => {
    const r = await runTool(lintScript, { code: 'var a = 1;\nwhile(true){}' }, t.ctx);
    expect(r.structured.errors).toBe(1);
    expect((r.structured.findings as any[])[0]).toMatchObject({ rule: 'infinite-loop', line: 2 });
  });
  it('is quiet for clean code', async () => {
    const r = await runTool(lintScript, { code: 'print("ok");' }, t.ctx);
    expect(r.structured.errors).toBe(0);
  });
});

describe('c3d_get_console', () => {
  it('returns the bridge runtime log only', async () => {
    t.bridge.logLines.push('a', 'b', 'c');
    const r = await runTool(getConsole, { tail: 2 }, t.ctx);
    expect(r.structured).toEqual({ lines: ['b', 'c'], source: 'bridge-runtime-log' });
    expect(getConsole.description).toMatch(/NOT Cheetah3D/);
  });
});
