import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { BridgeError, defineTool } from '../toolkit.js';
import { autoCheckpoint, createCheckpoint, listCheckpoints } from '../lib/checkpoints.js';
import { adoptWindow, listWindows, waitForWindow } from '../lib/documents.js';
import { ext, guardWrite, markOpened, resolveOut } from '../lib/files.js';
import { openWithCheetah } from '../lib/opener.js';
import { Confirm } from '../lib/schemas.js';
import { ok } from '../lib/result.js';

const OPENABLE = ['jas', 'obj', 'fbx', 'dae', 'stl', '3ds', 'usdz', 'dxf'];
const EXPORT_TYPES = ['obj', 'fbx', 'dae', 'stl', '3ds', 'usdz', 'gltf', 'glb', 'dxf'] as const;

const DocOut = z.looseObject({ fileName: z.string().nullable().optional(), marker: z.string().nullable().optional() });

export const getDocumentInfo = defineTool({
  name: 'c3d_get_document_info',
  title: 'Get document info',
  description:
    'Describes the document the session works on: file name (null for untitled), fps, current time, animation end, takes, renderer, active camera, object/material counts, plus the open Cheetah3D windows (if the helper is available) and which document this session is bound to. Call it first in a session and after opening/creating documents.',
  group: 'document',
  inputSchema: z.strictObject({}),
  outputSchema: z.looseObject({ document: DocOut, windows: z.array(z.looseObject({})), bound_to: z.looseObject({}).nullable() }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'local', 'readonly'],
  localDescription: 'Show the active document: name, fps, time, counts, camera.',
  async handler(_i, ctx) {
    const document = await ctx.bridge.one<Record<string, any>>('getDocumentInfo');
    const windows = await listWindows(ctx);
    return ok({ document, windows, bound_to: ctx.session.expectDocument ?? null }, `Document ${document.fileName ?? '(untitled)'}: ${document.objectCount ?? '?'} objects, ${document.materialCount ?? '?'} materials, fps ${document.fps}, time ${document.time}/${document.end}.`);
  },
});

export const useDocument = defineTool({
  name: 'c3d_use_document',
  title: 'Select working document',
  description:
    'Chooses which open Cheetah3D document later tools act on: raises the window with the given title (helper) and binds the session to its file name, or to a hidden session marker folder for untitled documents. Use after c3d_open_document/c3d_new_document/restore/import (they call it automatically) or when the user has several windows open. WRONG_DOCUMENT errors mean the bound document is not in front: call this again.',
  group: 'document',
  inputSchema: z.strictObject({
    title: z.string().min(1).optional().describe('Window title to raise (see c3d_get_document_info windows). Omit to bind to the current front document.'),
  }),
  outputSchema: z.looseObject({ document: DocOut, bound_to: z.looseObject({}) }),
  mutating: true,
  idempotent: true,
  profiles: ['full'],
  async handler(input, ctx) {
    const document = await adoptWindow(ctx, input.title);
    return ok({ document, bound_to: ctx.session.expectDocument ?? {} }, `Bound to ${document.fileName ?? `untitled document (marker ${String(document.marker)})`}.`);
  },
});

export const openDocument = defineTool({
  name: 'c3d_open_document',
  title: 'Open document',
  description:
    'Opens a .jas scene or an importable model (obj, fbx, dae, stl, 3ds, usdz, dxf) in Cheetah3D as a NEW document window (open -a Cheetah3D) and binds the session to it. glb/gltf are NOT supported by Cheetah3D (convert to fbx/obj first). Imported models open as separate untitled-style documents, not merged into the current scene.',
  group: 'document',
  inputSchema: z.strictObject({ path: z.string().min(1).describe('Absolute path of the file to open.') }),
  outputSchema: z.looseObject({ opened: z.string(), window: z.string(), document: DocOut }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(input, ctx) {
    const e = ext(input.path);
    if (e === 'glb' || e === 'gltf') throw new BridgeError('UNSUPPORTED', 'Cheetah3D 8.1.3 cannot open glTF/glb files.', 'Use an fbx or obj version of the asset.');
    if (!OPENABLE.includes(e)) throw new BridgeError('INVALID_ARGUMENT', `Unsupported extension .${e}.`, `Allowed: ${OPENABLE.join(', ')}.`);
    const abs = resolveOut(ctx, input.path, '.');
    if (!path.isAbsolute(input.path)) throw new BridgeError('INVALID_ARGUMENT', 'Give an absolute path.');
    if (!fs.existsSync(abs)) throw new BridgeError('NOT_FOUND', `File not found: ${abs}`);
    await openWithCheetah(abs);
    if (e === 'jas') markOpened(ctx, abs);
    const base = path.basename(abs, path.extname(abs));
    const window = await waitForWindow(ctx, base);
    const document = await adoptWindow(ctx, window);
    return ok({ opened: abs, window, document }, `Opened ${abs} in a new window; session now bound to it.`);
  },
});

export const newDocument = defineTool({
  name: 'c3d_new_document',
  title: 'New document',
  description: 'Creates a new empty untitled Cheetah3D document window (File > New via the helper) and binds the session to it with a hidden marker folder (__c3d_mcp_session_<uuid>, root level; ignore it in scene listings). Requires the helper (Accessibility permission).',
  group: 'document',
  inputSchema: z.strictObject({}),
  outputSchema: z.looseObject({ window: z.string(), document: DocOut }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(_i, ctx) {
    if (!ctx.helper.available()) throw new BridgeError('UNSUPPORTED', 'Creating a document needs the helper app.', 'Run c3d_doctor; as a workaround use c3d_open_document on fixtures/empty.jas.');
    const r = await ctx.helper.call<{ title: string }>('newDocument');
    const document = await adoptWindow(ctx, r.title);
    return ok({ window: r.title, document }, `Created "${r.title}" and bound the session to it.`);
  },
});

const SaveOut = z.looseObject({ path: z.string(), type: z.string(), size: z.number().optional() });

export const saveDocument = defineTool({
  name: 'c3d_save_document',
  title: 'Save document copy',
  description:
    'Saves the scene as a .jas file via saveToFile. Copy semantics: the open document is NOT re-pointed to the new path and keeps its title/dirty state. Relative paths go to <workDir>/saves. Never overwrites a file that existed before this session; a file written earlier by this server needs confirmation. The target directory must exist unless it is inside the work directory.',
  group: 'document',
  inputSchema: z.strictObject({ path: z.string().min(1).describe('Target .jas path (absolute, or relative to the work directory).'), confirm: Confirm }),
  outputSchema: SaveOut,
  mutating: true,
  idempotent: false,
  profiles: ['full', 'local'],
  localDescription: 'Save a copy of the scene as a .jas file.',
  async handler(input, ctx) {
    if (ext(input.path) !== 'jas') throw new BridgeError('INVALID_ARGUMENT', 'Path must end in .jas.', 'Use c3d_export for other formats.');
    const abs = resolveOut(ctx, input.path, 'saves');
    await guardWrite(ctx, abs, input.confirm, 'save');
    const r = await ctx.bridge.one<Record<string, unknown>>('saveTo', { path: abs, type: 'jas' });
    return ok({ path: abs, type: 'jas', ...r }, `Saved a copy to ${abs}.`);
  },
});

export const exportDocument = defineTool({
  name: 'c3d_export',
  title: 'Export scene',
  description: `Exports the scene to ${EXPORT_TYPES.join('/')} (obj also writes a sibling .mtl). Other formats are not produced. Does not change the open document. Relative paths go to <workDir>/exports. Never overwrites files that predate the session (sibling .mtl included); missing directories are only created inside the work directory. WARNING: obj export crashed Cheetah3D 8.1.3 once on a scene with nested folders (probe notes, crash #1); prefer fbx/dae/stl/usdz/3ds/dxf. A checkpoint is taken automatically before an obj export.`,
  group: 'document',
  inputSchema: z.strictObject({
    path: z.string().min(1).describe('Target file; extension decides the format unless format is given.'),
    format: z.enum(EXPORT_TYPES).optional().describe('Export format (default: from the extension).'),
    confirm: Confirm,
  }),
  outputSchema: SaveOut,
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(input, ctx) {
    const type = input.format ?? ext(input.path);
    if (!(EXPORT_TYPES as readonly string[]).includes(type)) throw new BridgeError('INVALID_ARGUMENT', `Cannot export format "${type}".`, `Allowed: ${EXPORT_TYPES.join(', ')}.`);
    const abs = resolveOut(ctx, input.path, 'exports');
    const siblings = type === 'obj' ? [path.join(path.dirname(abs), `${path.basename(abs, path.extname(abs))}.mtl`)] : [];
    await guardWrite(ctx, abs, input.confirm, 'export', siblings);
    const guard = type === 'obj' ? await autoCheckpoint(ctx, 'before-obj-export') : {};
    const r = await ctx.bridge.one<Record<string, unknown>>('saveTo', { path: abs, type });
    return ok({ path: abs, type, ...r, ...(guard.checkpoint ? { checkpoint: guard.checkpoint.id } : {}), ...(guard.warning ? { warning: guard.warning } : {}) }, `Exported ${type} to ${abs}.`);
  },
});

const CpOut = z.looseObject({ id: z.string(), label: z.string(), path: z.string(), createdAt: z.string() });

export const checkpoint = defineTool({
  name: 'c3d_checkpoint',
  title: 'Create checkpoint',
  description:
    'Saves a restorable copy of the current scene (saveToFile .jas into <workDir>/checkpoints; the open document is untouched). Cheetah3D Undo cannot revert script changes, so checkpoint before risky edits. Destructive tools do this automatically. Restore with c3d_restore_checkpoint.',
  group: 'document',
  inputSchema: z.strictObject({ label: z.string().max(60).optional().describe('Short label, e.g. "before-boolean".') }),
  outputSchema: z.looseObject({ checkpoint: CpOut, checkpoints: z.array(CpOut) }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(input, ctx) {
    const cp = await createCheckpoint(ctx, input.label ?? 'manual');
    return ok({ checkpoint: cp, checkpoints: listCheckpoints(ctx) }, `Checkpoint ${cp.id} saved to ${cp.path}.`);
  },
});

export const restoreCheckpoint = defineTool({
  name: 'c3d_restore_checkpoint',
  title: 'Restore checkpoint',
  description:
    'Reopens a checkpoint as a NEW Cheetah3D document window (the current window is not modified or closed - an extra window remains, close it manually if unwanted) and binds the session to the restored copy. Needs confirmation. Omit id for the latest checkpoint; with list_only:true just lists checkpoints.',
  group: 'document',
  inputSchema: z.strictObject({
    id: z.string().optional().describe('Checkpoint id such as "cp2" (default: latest).'),
    list_only: z.boolean().optional().describe('Only list checkpoints, do not restore.'),
    confirm: Confirm,
  }),
  outputSchema: z.looseObject({ checkpoints: z.array(CpOut), restored: CpOut.optional(), window: z.string().optional() }),
  mutating: true,
  destructive: true,
  idempotent: false,
  profiles: ['full'],
  async handler(input, ctx) {
    const cps = listCheckpoints(ctx);
    if (input.list_only) return ok({ checkpoints: cps }, `${cps.length} checkpoint(s).`);
    const cp = input.id ? cps.find((c) => c.id === input.id) : cps[cps.length - 1];
    if (!cp) throw new BridgeError('NOT_FOUND', input.id ? `No checkpoint "${input.id}".` : 'No checkpoints exist in this session.', 'Create one with c3d_checkpoint.');
    if (!(await ctx.services.confirm({ message: `Reopen checkpoint ${cp.id} (${cp.label}) as a new window and work in it?`, confirmFlag: input.confirm })))
      throw new BridgeError('CONFIRMATION_REQUIRED', 'Restoring a checkpoint needs confirmation.', 'Retry with confirm:true.');
    await openWithCheetah(cp.path);
    const window = await waitForWindow(ctx, path.basename(cp.path, '.jas'));
    await adoptWindow(ctx, window);
    return ok({ checkpoints: cps, restored: cp, window }, `Restored ${cp.id} in new window "${window}"; the session now works in it. The previous window is still open.`);
  },
});

export const documentTools = [getDocumentInfo, openDocument, newDocument, saveDocument, exportDocument, checkpoint, restoreCheckpoint, useDocument];
