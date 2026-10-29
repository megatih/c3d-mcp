// Document selection helpers shared by open/new/restore/import/use_document/merge.
import { randomUUID } from 'node:crypto';
import { BridgeError, type ToolContext } from '../toolkit.js';

export interface DocInfo { fileName?: string | null; marker?: string | null; [k: string]: unknown }
export interface WinInfo { title: string; role?: string; main?: boolean; focused?: boolean; minimized?: boolean; document?: string }

export async function listWindows(ctx: ToolContext): Promise<WinInfo[]> {
  if (!ctx.helper.available()) return [];
  try {
    return (await ctx.helper.call<WinInfo[]>('windows')).filter((w) => w.role !== 'AXDialog');
  } catch {
    return [];
  }
}

/** Raise the window titled `title` (if the helper exists), then point the session at whatever document is front. */
export async function adoptWindow(ctx: ToolContext, title?: string): Promise<DocInfo> {
  if (title !== undefined) {
    if (!ctx.helper.available()) throw new BridgeError('PERMISSION_MISSING', 'The helper is not available, so windows cannot be raised.', 'Run c3d_doctor; if Cheetah3D has a single document window you can call c3d_use_document without title.');
    await ctx.helper.call('raiseWindow', { title });
  }
  ctx.session.expectDocument = undefined;
  const info = await ctx.bridge.one<DocInfo>('getDocumentInfo');
  if (info.fileName) {
    ctx.session.expectDocument = { fileName: info.fileName };
    return info;
  }
  const marker = info.marker ?? (await ctx.bridge.one<{ marker: string }>('setMarker', { uuid: randomUUID() })).marker;
  ctx.session.expectDocument = { marker };
  return { ...info, marker };
}

/** Wait until a window whose title contains `needle` exists. */
export async function waitForWindow(ctx: ToolContext, needle: string, timeoutMs = 15000): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const w = (await listWindows(ctx)).find((x) => x.title.includes(needle));
    if (w) return w.title;
    if (Date.now() > end) throw new BridgeError('TIMEOUT', `No Cheetah3D window containing "${needle}" appeared within ${Math.round(timeoutMs / 1000)} s.`, 'Check for a modal dialog (c3d_doctor) or an unsupported format.');
    await new Promise((r) => setTimeout(r, 250));
  }
}
