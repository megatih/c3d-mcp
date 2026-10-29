import { describe, expect, it, vi } from 'vitest';
import { HelperUnavailableError } from '../../src/core/helperClient.js';
import { BRIDGE_MENU_PATH } from '../../src/core/paths.js';
import type { Executor } from '../../src/core/platform.js';
import { AutoTrigger, OsascriptTrigger, type Trigger } from '../../src/core/trigger.js';
import { BridgeError, type HelperClient } from '../../src/toolkit.js';

function execReturning(code: number, stdout = '', stderr = ''): { exec: Executor; calls: { cmd: string; args: string[] }[] } {
  const calls: { cmd: string; args: string[] }[] = [];
  return { calls, exec: (cmd, args) => { calls.push({ cmd, args }); return Promise.resolve({ code, stdout, stderr }); } };
}

describe('OsascriptTrigger', () => {
  it('runs the PROTOCOL 2.1 sequence: remember app, activate, AXRaise, wait enabled, click, restore', async () => {
    const { exec, calls } = execReturning(0, 'pressed');
    await new OsascriptTrigger(exec).press({ docTitle: 'Untitled 2', timeoutMs: 1500 });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.cmd).toBe('osascript');
    const script = call?.args[1] ?? '';
    for (const needle of ['first application process whose frontmost is true', 'set frontmost to true', 'AXRaise', 'enabled of mi', 'delay 0.025', 'click mi', 'set frontmost of process prevName', 'AXDialog']) {
      expect(script).toContain(needle);
    }
    expect(call?.args.slice(2)).toEqual(['Untitled 2', '1500', ...BRIDGE_MENU_PATH]);
  });

  it.each([
    ['C3D:APP_NOT_RUNNING:Cheetah3D is not running', 'APP_NOT_RUNNING'],
    ['execution error: C3D:BLOCKED_BY_MODAL:A dialog is open (-2700)', 'BLOCKED_BY_MODAL'],
    ['C3D:TRIGGER_FAILED:Menu item stayed disabled', 'TRIGGER_FAILED'],
    ['osascript is not allowed assistive access. (-25211)', 'PERMISSION_MISSING'],
    ['syntax error somewhere', 'TRIGGER_FAILED'],
  ])('maps osascript failure %j to %s', async (stderr, code) => {
    const { exec } = execReturning(1, '', stderr);
    await expect(new OsascriptTrigger(exec).press()).rejects.toMatchObject({ code });
  });

  it('reads the menu state', async () => {
    expect(await new OsascriptTrigger(execReturning(0, 'present\n').exec).menuState()).toBe('present');
    expect(await new OsascriptTrigger(execReturning(0, 'absent\n').exec).menuState()).toBe('absent');
    expect(await new OsascriptTrigger(execReturning(0, 'unknown\n').exec).menuState()).toBe('unknown');
    expect(await new OsascriptTrigger(execReturning(1, '', 'denied').exec).menuState()).toBe('unknown');
  });
});

function helperStub(over: Partial<HelperClient> = {}): HelperClient & { call: ReturnType<typeof vi.fn> } {
  return { available: () => true, call: vi.fn(() => Promise.resolve({})), ...over } as HelperClient & { call: ReturnType<typeof vi.fn> };
}
const osa = (): Trigger & { press: ReturnType<typeof vi.fn> } => ({ press: vi.fn(() => Promise.resolve()), menuState: vi.fn(() => Promise.resolve('absent' as const)) });

describe('AutoTrigger', () => {
  it('prefers the helper pressBridge with the menu path', async () => {
    const helper = helperStub();
    const fallback = osa();
    await new AutoTrigger(helper, fallback).press({ docTitle: 'Doc', timeoutMs: 1000 });
    expect(helper.call).toHaveBeenCalledWith('pressBridge', { requireDocTitle: 'Doc', timeoutMs: 1000, menuPath: BRIDGE_MENU_PATH }, expect.any(Number));
    expect(fallback.press).not.toHaveBeenCalled();
  });

  it('falls back to osascript only when the helper is unreachable', async () => {
    const helper = helperStub({ call: vi.fn(() => Promise.reject(new HelperUnavailableError('down'))) });
    const fallback = osa();
    await new AutoTrigger(helper, fallback).press();
    expect(fallback.press).toHaveBeenCalledTimes(1);
  });

  it('does not fall back on a semantic helper error', async () => {
    const helper = helperStub({ call: vi.fn(() => Promise.reject(new BridgeError('BLOCKED_BY_MODAL', 'dialog'))) });
    const fallback = osa();
    await expect(new AutoTrigger(helper, fallback).press()).rejects.toMatchObject({ code: 'BLOCKED_BY_MODAL' });
    expect(fallback.press).not.toHaveBeenCalled();
  });

  it('uses osascript when the helper is not available, and honours the modes', async () => {
    const fallback = osa();
    await new AutoTrigger(helperStub({ available: () => false }), fallback).press();
    expect(fallback.press).toHaveBeenCalledTimes(1);

    const helper = helperStub();
    const f2 = osa();
    await new AutoTrigger(helper, f2, 'osascript').press();
    expect(helper.call).not.toHaveBeenCalled();
    expect(f2.press).toHaveBeenCalledTimes(1);

    await expect(new AutoTrigger(helperStub({ available: () => false }), osa(), 'helper').press()).rejects.toBeInstanceOf(HelperUnavailableError);
    const failing = helperStub({ call: vi.fn(() => Promise.reject(new HelperUnavailableError('x'))) });
    await expect(new AutoTrigger(failing, osa(), 'helper').press()).rejects.toBeInstanceOf(HelperUnavailableError);
  });

  it('menuState comes from the helper status, else osascript', async () => {
    const helper = helperStub({ call: vi.fn(() => Promise.resolve({ bridgeMenuPresent: true })) as never });
    expect(await new AutoTrigger(helper, osa()).menuState()).toBe('present');
    const noFlag = helperStub({ call: vi.fn(() => Promise.resolve({})) as never });
    const fb = osa();
    expect(await new AutoTrigger(noFlag, fb).menuState()).toBe('absent');
    const down = helperStub({ call: vi.fn(() => Promise.reject(new HelperUnavailableError('x'))) });
    expect(await new AutoTrigger(down, osa()).menuState()).toBe('absent');
    expect(await new AutoTrigger(down, osa(), 'helper').menuState()).toBe('unknown');
  });
});
