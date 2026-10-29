 
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { BridgeError, defineTool } from '../toolkit.js';
import { adoptWindow, listWindows, waitForWindow } from '../lib/documents.js';
import { ext } from '../lib/files.js';
import { openWithCheetah } from '../lib/opener.js';
import { ok } from '../lib/result.js';

const MERGEABLE = ['jas', 'obj', 'fbx', 'dae', 'stl', '3ds', 'usdz', 'dxf'];

export const mergeFile = defineTool({
  name: 'c3d_merge_file',
  title: 'Merge file into scene (experimental)',
  description:
    'EXPERIMENTAL. Brings the top-level objects of a file (jas, obj, fbx, dae, stl, 3ds, usdz, dxf) into the CURRENT document: opens the file in a temporary NEW window, selects its root objects, Edit > Copy, switches back and Edit > Paste (helper menu automation, needs Accessibility). Success is verified by the object count; materials may not survive the copy. The extra window stays open. If the count does not grow the tool returns UNSUPPORTED - then work in the opened window instead (c3d_use_document).',
  group: 'files',
  inputSchema: z.strictObject({ path: z.string().min(1).describe('Absolute path of the file to merge.') }),
  outputSchema: z.looseObject({ merged: z.number().int(), objectCountBefore: z.number().int(), objectCountAfter: z.number().int(), source_window: z.string() }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    const e = ext(i.path);
    if (e === 'glb' || e === 'gltf') throw new BridgeError('UNSUPPORTED', 'Cheetah3D cannot open glTF/glb files.', 'Use fbx/obj.');
    if (!MERGEABLE.includes(e)) throw new BridgeError('INVALID_ARGUMENT', `Unsupported extension .${e}.`, `Allowed: ${MERGEABLE.join(', ')}.`);
    if (!path.isAbsolute(i.path) || !fs.existsSync(i.path)) throw new BridgeError('NOT_FOUND', `File not found (absolute path required): ${i.path}`);
    if (!ctx.helper.available()) throw new BridgeError('UNSUPPORTED', 'Merging needs the helper (menu automation).', 'Open the file with c3d_open_document and rebuild the needed parts in the target scene.');
    const home = (await listWindows(ctx)).find((w) => w.main || w.focused);
    if (!home) throw new BridgeError('NOT_FOUND', 'Could not identify the current document window.', 'Run c3d_doctor and bring the target document to front.');
    const origin = ctx.session.expectDocument ? { ...ctx.session.expectDocument } : undefined;
    const before = (await ctx.bridge.one<{ total: number }>('listScene', { depth: 0, limit: 1 })).total;

    await openWithCheetah(i.path);
    const srcWindow = await waitForWindow(ctx, path.basename(i.path, path.extname(i.path)));
    await adoptWindow(ctx, srcWindow);
    const roots = (await ctx.bridge.one<{ items: Array<{ id: number; name: string }> }>('listScene', { depth: 0, limit: 2000 })).items.filter((o) => !o.name.startsWith('__c3d_mcp_session_'));
    if (!roots.length) throw new BridgeError('NOT_FOUND', 'The opened file contains no objects.');
    await ctx.bridge.one('select', { refs: roots.map((o) => ({ id: o.id })) });
    await ctx.helper.call('pressMenu', { path: ['Edit', 'Copy'], timeoutMs: 5000 });

    await ctx.helper.call('raiseWindow', { title: home.title });
    ctx.session.expectDocument = origin;
    await ctx.helper.call('pressMenu', { path: ['Edit', 'Paste'], timeoutMs: 5000 });
    const after = (await ctx.bridge.one<{ total: number }>('listScene', { depth: 0, limit: 1 })).total;
    if (after <= before)
      throw new BridgeError('UNSUPPORTED', 'Copy/paste between documents did not add objects.', `The imported model is open in window "${srcWindow}"; use c3d_use_document to work there.`, { before, after, source_window: srcWindow });
    return ok({ merged: after - before, objectCountBefore: before, objectCountAfter: after, source_window: srcWindow }, `Merged ${after - before} top-level object(s) from ${path.basename(i.path)}. The temporary window "${srcWindow}" is still open.`);
  },
});

export const fileTools = [mergeFile];
