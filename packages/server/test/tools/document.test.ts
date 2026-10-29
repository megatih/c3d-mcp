 
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as opener from '../../src/lib/opener.js';
import { checkpoint, exportDocument, getDocumentInfo, newDocument, openDocument, restoreCheckpoint, saveDocument, useDocument } from '../../src/tools/document.js';
import { expectCode, makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';

vi.mock('../../src/lib/opener.js', () => ({ openWithCheetah: vi.fn(async () => undefined) }));

let t: TestCtx;
beforeEach(() => { t = makeCtx(); vi.mocked(opener.openWithCheetah).mockClear(); });

describe('c3d_get_document_info', () => {
  it('returns document, windows and binding', async () => {
    t.ctx.session.expectDocument = { marker: 'm' };
    const r = await runTool(getDocumentInfo, {}, t.ctx);
    expect(r.structured).toMatchObject({ document: { fps: 30 }, bound_to: { marker: 'm' } });
    expect((r.structured.windows as unknown[]).length).toBe(1);
  });
  it('works without a helper', async () => {
    t.helper.on = false;
    expect((await runTool(getDocumentInfo, {}, t.ctx)).structured.windows).toEqual([]);
  });
  it('rejects unknown arguments', () => expect(() => getDocumentInfo.inputSchema.parse({ x: 1 })).toThrow());
});

describe('c3d_use_document', () => {
  it('binds an untitled document through a marker', async () => {
    const r = await runTool(useDocument, { title: 'Untitled' }, t.ctx);
    expect(t.helper.calls[0]).toMatchObject({ cmd: 'raiseWindow', args: { title: 'Untitled' } });
    expect(t.ctx.session.expectDocument?.marker).toMatch(/^__c3d_mcp_session_/);
    expect((r.structured.bound_to as any).marker).toBeTruthy();
  });
  it('binds a saved document by file name', async () => {
    t.bridge.doc.fileName = '/tmp/x.jas';
    await runTool(useDocument, {}, t.ctx);
    expect(t.ctx.session.expectDocument).toEqual({ fileName: '/tmp/x.jas' });
  });
  it('needs the helper to raise a titled window', async () => {
    t.helper.on = false;
    await expectCode(runTool(useDocument, { title: 'A' }, t.ctx), 'PERMISSION_MISSING');
  });
});

describe('c3d_open_document', () => {
  it('opens a model in a new window and adopts it', async () => {
    const f = path.join(t.dir, 'chair.fbx'); fs.writeFileSync(f, 'x');
    t.helper.handlers.set('windows', () => [{ title: 'chair.fbx', role: 'AXWindow', main: true }]);
    const r = await runTool(openDocument, { path: f }, t.ctx);
    expect(opener.openWithCheetah).toHaveBeenCalledWith(f);
    expect(r.structured.window).toBe('chair.fbx');
    expect(t.ctx.session.expectDocument).toBeTruthy();
  });
  it('rejects glb/gltf as UNSUPPORTED and unknown extensions', async () => {
    await expectCode(runTool(openDocument, { path: '/a/b.glb' }, t.ctx), 'UNSUPPORTED');
    await expectCode(runTool(openDocument, { path: '/a/b.txt' }, t.ctx), 'INVALID_ARGUMENT');
  });
  it('reports missing files and relative paths', async () => {
    await expectCode(runTool(openDocument, { path: '/nope/x.jas' }, t.ctx), 'NOT_FOUND');
    await expectCode(runTool(openDocument, { path: 'x.jas' }, t.ctx), 'INVALID_ARGUMENT');
  });
});

describe('c3d_new_document', () => {
  it('creates and adopts a document', async () => {
    t.helper.handlers.set('newDocument', () => ({ title: 'Untitled 3' }));
    const r = await runTool(newDocument, {}, t.ctx);
    expect(r.structured.window).toBe('Untitled 3');
    expect(t.bridge.opNames()).toContain('setMarker');
  });
  it('is UNSUPPORTED without helper', async () => {
    t.helper.on = false;
    await expectCode(runTool(newDocument, {}, t.ctx), 'UNSUPPORTED');
  });
});

describe('c3d_save_document / c3d_export', () => {
  it('saves a .jas copy under the work dir and marks it owned', async () => {
    const r = await runTool(saveDocument, { path: 'a.jas' }, t.ctx);
    const p = path.join(t.ctx.config.workDir, 'saves', 'a.jas');
    expect(r.structured.path).toBe(p);
    expect(fs.existsSync(p)).toBe(true);
    expect(t.ctx.session.ownedPaths.has(p)).toBe(true);
    expect(t.bridge.argsOf('saveTo')[0]).toMatchObject({ type: 'jas' });
  });
  it('refuses to overwrite a pre-existing file', async () => {
    const f = path.join(t.dir, 'mine.jas'); fs.writeFileSync(f, 'user data');
    await expectCode(runTool(saveDocument, { path: f, confirm: true }, t.ctx), 'INVALID_ARGUMENT');
    expect(fs.readFileSync(f, 'utf8')).toBe('user data');
  });
  it('overwrites an owned file only after confirmation', async () => {
    await runTool(saveDocument, { path: 'b.jas' }, t.ctx);
    t.setConfirm(false);
    await expectCode(runTool(saveDocument, { path: 'b.jas' }, t.ctx), 'CONFIRMATION_REQUIRED');
    await runTool(saveDocument, { path: 'b.jas', confirm: true }, t.ctx);
    expect(t.confirmCalls.length).toBe(2);
  });
  it('a .jas opened through this server may be saved over, but only with confirmation (requirements scope note)', async () => {
    const f = path.join(t.dir, 'opened.jas'); fs.writeFileSync(f, 'old');
    // the helper-reported window title for the opened file lets adoptWindow succeed in the fake environment
    t.helper.handlers.set('windows', () => [{ title: 'opened.jas', role: 'AXWindow', main: true }]);
    await runTool(openDocument, { path: f }, t.ctx);
    t.setConfirm(false);
    await expectCode(runTool(saveDocument, { path: f }, t.ctx), 'CONFIRMATION_REQUIRED');
    expect(fs.readFileSync(f, 'utf8')).toBe('old');
    await runTool(saveDocument, { path: f, confirm: true }, t.ctx);
    expect(fs.readFileSync(f, 'utf8')).not.toBe('old');
  });
  it('validates the extension', async () => {
    await expectCode(runTool(saveDocument, { path: 'a.obj' }, t.ctx), 'INVALID_ARGUMENT');
  });
  it('export also guards the sibling .mtl and never creates directories outside the work dir', async () => {
    const out = path.join(t.dir, 'exports-here');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'scene.mtl'), 'user material');
    const e = await expectCode(runTool(exportDocument, { path: path.join(out, 'scene.obj') }, t.ctx), 'INVALID_ARGUMENT');
    expect(e.message).toMatch(/scene\.mtl/);
    expect(t.bridge.opNames()).not.toContain('saveTo');
    await expectCode(runTool(exportDocument, { path: path.join(t.dir, 'nodir', 'sub', 'a.fbx') }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(saveDocument, { path: path.join(t.dir, 'nodir2', 'a.jas') }, t.ctx), 'INVALID_ARGUMENT');
    expect(fs.existsSync(path.join(t.dir, 'nodir'))).toBe(false);
    await runTool(exportDocument, { path: 'deep/er/a.fbx' }, t.ctx); // inside the work dir: created
    expect(fs.existsSync(path.join(t.ctx.config.workDir, 'exports', 'deep', 'er', 'a.fbx'))).toBe(true);
  });
  it('treats a dangling symlink as an existing file', async () => {
    const link = path.join(t.dir, 'link.jas');
    fs.symlinkSync(path.join(t.dir, 'nowhere.jas'), link);
    await expectCode(runTool(saveDocument, { path: link }, t.ctx), 'INVALID_ARGUMENT');
  });
  it('exports with the format from the extension or argument', async () => {
    await runTool(exportDocument, { path: 'm.obj' }, t.ctx);
    await runTool(exportDocument, { path: 'm2.dat', format: 'fbx' }, t.ctx);
    expect(t.bridge.argsOf('saveTo').map((a) => a.type)).toEqual(['jas', 'obj', 'fbx']); // obj export is preceded by an automatic checkpoint (crash #1)
    await expectCode(runTool(exportDocument, { path: 'm.png' }, t.ctx), 'INVALID_ARGUMENT');
    expect(() => exportDocument.inputSchema.parse({ path: 'a.obj', format: 'mtl' })).toThrow();
  });
});

describe('checkpoints survive a server restart', () => {
  it('lists checkpoint files already on disk and continues the id sequence', async () => {
    const dir = path.join(t.ctx.config.workDir, 'checkpoints');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '1793276359012-cp7-P5-environment-signs-done.jas'), 'x');
    const list = await runTool(restoreCheckpoint, { list_only: true }, t.ctx);
    expect((list.structured.checkpoints as any[]).map((c) => c.id)).toEqual(['cp7']);
    expect((list.structured.checkpoints as any[])[0].label).toBe('P5-environment-signs-done');
    const next = await runTool(checkpoint, { label: 'after restart' }, t.ctx);
    expect((next.structured.checkpoint as any).id).toBe('cp8');
  });
});

describe('checkpoints', () => {
  it('creates, lists and restores via a new window', async () => {
    const a = await runTool(checkpoint, { label: 'before boolean!' }, t.ctx);
    expect((a.structured.checkpoint as any).path).toMatch(/checkpoints.*\.jas$/);
    await runTool(checkpoint, {}, t.ctx);
    const list = await runTool(restoreCheckpoint, { list_only: true }, t.ctx);
    expect((list.structured.checkpoints as unknown[]).length).toBe(2);
    t.helper.handlers.set('windows', () => [{ title: path.basename(String(vi.mocked(opener.openWithCheetah).mock.calls.at(-1)?.[0])), role: 'AXWindow', main: true }]);
    const r = await runTool(restoreCheckpoint, { confirm: true }, t.ctx);
    expect((r.structured.restored as any).id).toBe('cp2');
    expect(opener.openWithCheetah).toHaveBeenCalledOnce();
    expect(t.confirmCalls.length).toBe(1);
  });
  it('restore needs confirmation and an existing checkpoint', async () => {
    await expectCode(runTool(restoreCheckpoint, {}, t.ctx), 'NOT_FOUND');
    await runTool(checkpoint, {}, t.ctx);
    t.setConfirm(false);
    await expectCode(runTool(restoreCheckpoint, {}, t.ctx), 'CONFIRMATION_REQUIRED');
    expect(opener.openWithCheetah).not.toHaveBeenCalled();
    await expectCode(runTool(restoreCheckpoint, { id: 'cp9', confirm: true }, t.ctx), 'NOT_FOUND');
  });
  it('surfaces save failures', async () => {
    t.bridge.failures.set('saveTo', new (await import('../../src/toolkit.js')).BridgeError('INTERNAL', 'disk full'));
    await expectCode(runTool(checkpoint, {}, t.ctx), 'INTERNAL');
  });
});
