/* eslint-disable @typescript-eslint/no-non-null-assertion -- loosely typed runtime data; indices are bounds-checked by construction */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { BridgeError, defineTool, type ToolContext } from '../toolkit.js';
import { adoptWindow, waitForWindow } from '../lib/documents.js';
import { ensureDir } from '../lib/files.js';
import { assertHttps, fetchBinary, fetchJson } from '../lib/net.js';
import { openWithCheetah } from '../lib/opener.js';
import { ok, page } from '../lib/result.js';
import { Limit, Offset } from '../lib/schemas.js';

const API = 'https://api.polyhaven.com';
const HOSTS = ['polyhaven.com', 'polyhaven.org'];
const MAX_TOTAL = 100 * 1024 * 1024;
const ALLOWED_EXT = ['fbx', 'obj', 'dae', 'stl', '3ds', 'usdz', 'dxf'];
const TEX_EXT = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'exr', 'hdr', 'mtl', 'bin'];

function assertEnabled(ctx: ToolContext): void {
  if (ctx.config.disableAssets) throw new BridgeError('NOT_AVAILABLE_IN_PROFILE', 'Asset tools are disabled (C3D_MCP_DISABLE_ASSETS).', 'Unset the variable and restart the server.');
}

export const searchAssets = defineTool({
  name: 'c3d_search_assets',
  title: 'Search Poly Haven assets',
  description: 'Searches Poly Haven (CC0, no API key) for models, HDRIs or textures by keyword/category. Network access (api.polyhaven.com). Returns id, name, categories, tags and download count, most popular first. Only models can be imported (c3d_import_asset); see Poly Haven for HDRI/texture use.',
  group: 'assets',
  inputSchema: z.strictObject({
    query: z.string().max(100).optional().describe('Keyword matched against name, tags and categories.'),
    type: z.enum(['models', 'hdris', 'textures']).optional().describe('Asset type (default models).'),
    category: z.string().max(60).optional().describe('Poly Haven category, e.g. "furniture".'),
    offset: Offset,
    limit: Limit(50, 10),
  }),
  outputSchema: z.looseObject({ assets: z.array(z.looseObject({ id: z.string(), name: z.string() })), total: z.number().int(), next_offset: z.number().int().nullable() }),
  mutating: false,
  idempotent: true,
  openWorld: true,
  profiles: ['full', 'readonly'],
  async handler(i, ctx) {
    assertEnabled(ctx);
    const type = i.type ?? 'models';
    const url = `${API}/assets?t=${type}${i.category ? `&c=${encodeURIComponent(i.category)}` : ''}`;
    const data = (await fetchJson(url, HOSTS)) as Record<string, Record<string, any>>;
    const q = (i.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const all = Object.entries(data)
      .map(([id, a]) => ({ id, name: String(a.name ?? id), categories: (a.categories ?? []) as string[], tags: (a.tags ?? []) as string[], downloads: Number(a.download_count ?? 0), type }))
      .filter((a) => q.every((w) => `${a.id} ${a.name} ${a.categories.join(' ')} ${a.tags.join(' ')}`.toLowerCase().includes(w)))
      .sort((x, y) => y.downloads - x.downloads);
    const p = page(all, i.offset ?? 0, i.limit ?? 10);
    return ok({ assets: p.items, total: p.total, next_offset: p.next_offset, license: 'CC0 (polyhaven.com)' }, p.items.map((a) => `${a.id} - ${a.name} [${a.categories.join(', ')}]`).join('\n') || 'No matches.');
  },
});

interface PhFile { url: string; md5?: string; size?: number }

function safeRel(rel: string): string {
  const norm = path.posix.normalize(rel.replace(/\\/g, '/'));
  if (norm.startsWith('/') || norm.startsWith('..') || norm.includes('/../') || norm.includes('\0')) throw new BridgeError('INVALID_ARGUMENT', `Unsafe file path in asset manifest: ${rel}`);
  return norm;
}

export const importAsset = defineTool({
  name: 'c3d_import_asset',
  title: 'Import Poly Haven model (experimental)',
  description: 'EXPERIMENTAL. Downloads a Poly Haven model as FBX (glTF/glb are NOT supported by Cheetah3D) with its textures into <workDir>/assets/<id>/ (HTTPS only, md5 verified, 100 MB cap, SHA-256 + CC0 license + author recorded in asset.json), then opens it as a NEW Cheetah3D document window and binds the session to it. The imported model is NOT merged into your previous scene (use c3d_merge_file for an experimental merge). Needs network.',
  group: 'assets',
  inputSchema: z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9_]{1,80}$/).describe('Poly Haven model id from c3d_search_assets.'),
    resolution: z.enum(['1k', '2k', '4k']).optional().describe('Texture resolution (default 1k).'),
    open: z.boolean().optional().describe('Open the downloaded model in Cheetah3D (default true).'),
  }),
  outputSchema: z.looseObject({ id: z.string(), directory: z.string(), model_path: z.string(), license: z.string(), authors: z.array(z.string()), files: z.array(z.looseObject({ path: z.string(), sha256: z.string() })), window: z.string().optional() }),
  mutating: true,
  idempotent: false,
  openWorld: true,
  profiles: ['full'],
  async handler(i, ctx) {
    assertEnabled(ctx);
    const res = i.resolution ?? '1k';
    const info = (await fetchJson(`${API}/info/${i.id}`, HOSTS)) as Record<string, any>;
    if (info.type !== undefined && info.type !== 2 && info.type !== 'models') throw new BridgeError('UNSUPPORTED', `Asset ${i.id} is not a model.`, 'Only Poly Haven models can be imported.');
    const files = (await fetchJson(`${API}/files/${i.id}`, HOSTS)) as Record<string, any>;
    const node = files.fbx?.[res]?.fbx as (PhFile & { include?: Record<string, PhFile> }) | undefined;
    if (!node?.url) throw new BridgeError('NOT_FOUND', `No FBX variant at ${res} for ${i.id}.`, `Available FBX resolutions: ${Object.keys(files.fbx ?? {}).join(', ') || 'none'}.`);
    const list: Array<{ rel: string; f: PhFile }> = [{ rel: safeRel(path.posix.basename(new URL(node.url).pathname)), f: node }, ...Object.entries(node.include ?? {}).map(([rel, f]) => ({ rel: safeRel(rel), f }))];
    let declared = 0;
    for (const { rel, f } of list) {
      const e = path.extname(rel).slice(1).toLowerCase();
      if (!(ALLOWED_EXT.includes(e) || TEX_EXT.includes(e))) throw new BridgeError('INVALID_ARGUMENT', `File type .${e} (${rel}) is not on the allow-list.`, `Allowed: ${[...ALLOWED_EXT, ...TEX_EXT].join(', ')}.`);
      assertHttps(f.url, HOSTS);
      declared += f.size ?? 0;
    }
    if (declared > MAX_TOTAL) throw new BridgeError('INVALID_ARGUMENT', `Asset is ${Math.round(declared / 1e6)} MB, over the 100 MB cap.`, 'Try resolution "1k".');
    const dir = path.join(ctx.config.workDir, 'assets', i.id);
    ensureDir(dir);
    let total = 0;
    const record: Array<{ path: string; sha256: string; md5: string; size: number; url: string }> = [];
    for (const { rel, f } of list) {
      ctx.services.progress(`downloading ${rel}`);
      const d = await fetchBinary(f.url, HOSTS, MAX_TOTAL - total);
      total += d.data.length;
      if (f.md5 && f.md5.toLowerCase() !== d.md5) throw new BridgeError('DEPENDENCY_FAILED', `MD5 mismatch for ${rel} (expected ${f.md5}, got ${d.md5}); download discarded.`, 'Retry; if it persists the CDN file changed.');
      const dest = path.join(dir, rel);
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, d.data);
      ctx.session.ownedPaths.add(dest);
      record.push({ path: rel, sha256: d.sha256, md5: d.md5, size: d.data.length, url: f.url });
    }
    const authors = Object.keys((info.authors ?? {}) as Record<string, unknown>);
    const sidecar = { id: i.id, name: info.name ?? i.id, source: `https://polyhaven.com/a/${i.id}`, license: 'CC0', licenseUrl: 'https://polyhaven.com/license', authors, resolution: res, downloadedAt: new Date().toISOString(), files: record };
    fs.writeFileSync(path.join(dir, 'asset.json'), JSON.stringify(sidecar, null, 2));
    const modelPath = path.join(dir, list[0]!.rel);
    const out: Record<string, unknown> = { id: i.id, directory: dir, model_path: modelPath, license: 'CC0', authors, files: record.map((r) => ({ path: r.path, sha256: r.sha256, size: r.size })) };
    if (i.open !== false) {
      await openWithCheetah(modelPath);
      out.window = await waitForWindow(ctx, path.basename(modelPath, path.extname(modelPath)));
      out.document = await adoptWindow(ctx, out.window as string);
    }
    return ok(out, `Imported ${i.id} (${record.length} files, CC0, by ${authors.join(', ') || 'unknown'}) to ${dir}.${out.window ? ` Opened in new window "${out.window as string}"; the session now works there.` : ''}`);
  },
});

export const assetTools = [searchAssets, importAsset];
