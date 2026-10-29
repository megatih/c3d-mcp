 
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as opener from '../../src/lib/opener.js';
import { mergeFile } from '../../src/tools/files.js';
import { expectCode, makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';

vi.mock('../../src/lib/opener.js', () => ({ openWithCheetah: vi.fn(async () => undefined) }));

let t: TestCtx;
let file: string;
beforeEach(() => {
  t = makeCtx(); vi.mocked(opener.openWithCheetah).mockClear();
  file = path.join(t.dir, 'part.obj'); fs.writeFileSync(file, 'x');
  t.bridge.addObject('BOX', 'Existing');
});

describe('c3d_merge_file', () => {
  it('copies root objects across windows and verifies the object count', async () => {
    t.helper.handlers.set('windows', () => [{ title: 'part.obj', role: 'AXWindow', main: true }]);
    t.helper.handlers.set('pressMenu', (a: any) => { if (a.path[1] === 'Paste') t.bridge.addObject('BOX', 'Pasted'); return {}; });
    const r = await runTool(mergeFile, { path: file }, t.ctx);
    expect(r.structured).toMatchObject({ merged: 1, objectCountBefore: 1, objectCountAfter: 2 });
    expect(t.helper.calls.map((c) => c.cmd)).toEqual(expect.arrayContaining(['raiseWindow', 'pressMenu']));
  });
  it('returns UNSUPPORTED when pasting adds nothing', async () => {
    t.helper.handlers.set('windows', () => [{ title: 'part.obj', role: 'AXWindow', main: true }]);
    const e = await expectCode(runTool(mergeFile, { path: file }, t.ctx), 'UNSUPPORTED');
    expect(e.hint).toMatch(/c3d_use_document/);
  });
  it('validates path, extension and helper', async () => {
    await expectCode(runTool(mergeFile, { path: '/a/x.glb' }, t.ctx), 'UNSUPPORTED');
    await expectCode(runTool(mergeFile, { path: '/a/x.txt' }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(mergeFile, { path: '/nope/x.obj' }, t.ctx), 'NOT_FOUND');
    t.helper.on = false;
    await expectCode(runTool(mergeFile, { path: file }, t.ctx), 'UNSUPPORTED');
  });
});
