import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BridgeError } from '../../src/toolkit.js';
import { LIVE, liveRuntime, newScratch } from './live.js';

// Each snippet tries to reach the real global OS/File/eval. Every one must fail or return nothing useful (requirements section 4 escape tests).
const ESCAPES: Record<string, string> = {
  'global this': "return this.OS.system('exit 0');",
  globalThis: "return globalThis.OS.system('exit 0');",
  'indirect eval': "return (0, eval)('OS.system(\"exit 0\")');",
  'Function constructor': "return new Function('return OS.system(\"exit 0\")')();",
  'constructor chain': "return (function(){}).constructor('return OS.system(\"exit 0\")')();",
  "OS['sys'+'tem']": "return OS['sys'+'tem']('exit 0');",
  geval: "return geval('1+1');",
  'File.mkDir': "return new File('/tmp/c3dmcp-should-not-exist').mkDir();",
  'File.mkDir static': "return File.mkDir('/tmp/c3dmcp-should-not-exist');",
  'write outside tmp': "var f = new File('/tmp/c3dmcp-nope.txt'); f.open(WRITE_MODE); f.write('x'); f.close(); return 1;",
  'OS.messageBox': "return OS.messageBox('t','m');",
};

describe.skipIf(!LIVE)('live exec sandbox (real JavaScriptCore)', () => {
  const rt = liveRuntime();
  for (const [name, code] of Object.entries(ESCAPES)) {
    it(`blocks: ${name}`, async () => {
      if (name === 'global this') await newScratch(rt);
      const err = await rt.bridge.one('run', { code }, { deadlineMs: 15_000 }).then(() => undefined, (e: unknown) => e);
      expect(err, 'escape unexpectedly succeeded').toBeInstanceOf(BridgeError);
      expect((err as BridgeError).code).toBe('SCRIPT_ERROR');
    });
  }

  it('a getter on the returned value never runs (no side effect, security review H1)', async () => {
    const marker = '/tmp/c3dmcp-getter-pwned';
    const code = `return { get a() { return (function(){}).constructor('return this')()['O'+'S']['sys'+'tem']('touch ${marker}'); } };`;
    const r: unknown = await rt.bridge.one<{ returned: unknown }>('run', { code }, { deadlineMs: 15_000 }).then((x) => x, (e: unknown) => e);
    expect(existsSync(marker)).toBe(false);
    if (!(r instanceof BridgeError)) expect((r as { returned: unknown }).returned).toBeNull();
  });

  it('real OS and File still work for the bridge afterwards and benign code runs', async () => {
    const r = await rt.bridge.one<{ value: number; log: string[] }>('run', { code: "print('ok'); return doc.root().childCount();" });
    expect(r.value).toBeGreaterThan(0);
    expect(r.log).toEqual(['ok']);
    expect((await rt.bridge.one<{ counter: number }>('ping', { counter: 1 })).counter).toBe(1);
  });
});
