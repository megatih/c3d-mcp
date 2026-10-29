/* eslint-disable @typescript-eslint/no-non-null-assertion -- loosely typed runtime data; indices are bounds-checked by construction */
// Image downscale/analysis. Helper (ImageIO/Vision) first, `sips` + a minimal PNG decoder as fallback.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { BridgeError, type HelperClient, type ToolServices } from '../toolkit.js';

type Analysis = Awaited<ReturnType<ToolServices['imageTools']['analyze']>>;
type Scaled = Awaited<ReturnType<ToolServices['imageTools']['downscale']>>;

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000 }, (e, out) => {
      if (e) reject(e); // eslint-disable-line @typescript-eslint/prefer-promise-reject-errors
      else resolve(out);
    });
  });

const mimeOf = (p: string): string => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tiff': 'image/tiff', '.tif': 'image/tiff' })[path.extname(p).toLowerCase()] ?? 'application/octet-stream';

export async function sipsSize(p: string): Promise<{ width: number; height: number }> {
  const out = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p]);
  const w = /pixelWidth:\s*(\d+)/.exec(out);
  const h = /pixelHeight:\s*(\d+)/.exec(out);
  if (!w || !h) throw new BridgeError('DEPENDENCY_FAILED', `sips could not read ${p}.`);
  return { width: Number(w[1]), height: Number(h[1]) };
}

export interface Raster { width: number; height: number; luma: Float32Array }

/** Minimal PNG decoder: non-interlaced, 8/16-bit gray, gray+alpha, RGB, RGBA, palette. Returns luma (0..1). */
export function decodePng(buf: Buffer): Raster {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new BridgeError('PARSE_ERROR', 'Not a PNG file.');
  let pos = 8;
  let width = 0, height = 0, depth = 8, ctype = 2, interlace = 0;
  const idat: Buffer[] = [];
  let plte: Buffer | undefined;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]!; ctype = data[9]!; interlace = data[12]!;
    } else if (type === 'PLTE') plte = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (interlace) throw new BridgeError('UNSUPPORTED', 'Interlaced PNG is not supported by the fallback decoder.');
  if (depth !== 8 && depth !== 16) throw new BridgeError('UNSUPPORTED', `PNG bit depth ${depth} is not supported by the fallback decoder.`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (!channels) throw new BridgeError('PARSE_ERROR', `Unknown PNG color type ${ctype}.`);
  const bpp = channels * (depth / 8);
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      let v = line[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const luma = new Float32Array(width * height);
  const step = depth / 8;
  const sample = (i: number): number => (depth === 16 ? px.readUInt16BE(i) / 65535 : px[i]! / 255);
  for (let i = 0; i < width * height; i++) {
    const o = i * bpp;
    let r: number, g: number, bl: number;
    if (ctype === 0 || ctype === 4) r = g = bl = sample(o);
    else if (ctype === 3) {
      const idx = px[o]! * 3;
      r = (plte?.[idx] ?? 0) / 255; g = (plte?.[idx + 1] ?? 0) / 255; bl = (plte?.[idx + 2] ?? 0) / 255;
    } else { r = sample(o); g = sample(o + step); bl = sample(o + 2 * step); }
    luma[i] = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  }
  return { width, height, luma };
}

export function statsOf(r: Raster): Analysis {
  const hist = new Array<number>(16).fill(0);
  let sum = 0, min = 1, max = 0;
  for (const v of r.luma) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
    hist[Math.min(15, Math.floor(v * 16))]!++;
  }
  const n = Math.max(1, r.luma.length);
  return { width: r.width, height: r.height, blank: max - min <= 2 / 255, meanLuma: sum / n, histogram: hist.map((h) => h / n) };
}

async function analyzeFallback(p: string): Promise<Analysis> {
  let file = p;
  let tmp: string | undefined;
  if (path.extname(p).toLowerCase() !== '.png') {
    tmp = path.join(os.tmpdir(), `c3d-mcp-an-${process.pid}-${Date.now()}.png`);
    await run('sips', ['-s', 'format', 'png', p, '--out', tmp]);
    file = tmp;
  }
  try {
    return statsOf(decodePng(fs.readFileSync(file)));
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}

async function downscaleFallback(p: string, maxDim: number, maxBytes: number): Promise<Scaled> {
  const size = await sipsSize(p);
  const bytes = fs.statSync(p).size;
  const base = p.replace(/\.[^.]+$/, '');
  if (Math.max(size.width, size.height) <= maxDim && bytes <= maxBytes) return { path: p, ...size, bytes, mime: mimeOf(p) };
  const png = `${base}.preview.png`;
  await run('sips', ['-Z', String(maxDim), '-s', 'format', 'png', p, '--out', png]);
  if (fs.statSync(png).size <= maxBytes) return { path: png, ...(await sipsSize(png)), bytes: fs.statSync(png).size, mime: 'image/png' };
  const jpg = `${base}.preview.jpg`;
  for (const q of [80, 60, 40, 25]) {
    await run('sips', ['-Z', String(maxDim), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(q), p, '--out', jpg]);
    if (fs.statSync(jpg).size <= maxBytes) break;
  }
  return { path: jpg, ...(await sipsSize(jpg)), bytes: fs.statSync(jpg).size, mime: 'image/jpeg' };
}

export function createImageTools(helper: HelperClient): ToolServices['imageTools'] {
  return {
    async downscale(p, opts) {
      if (helper.available()) {
        try {
          const outPath = `${p.replace(/\.[^.]+$/, '')}.preview.png`;
          const r = await helper.call<Record<string, any>>('downscaleImage', { path: p, outPath, maxDim: opts.maxDim, maxBytes: opts.maxBytes });
          const outFile = String(r.outPath ?? r.path ?? outPath);
          if (fs.existsSync(outFile)) return { path: outFile, width: Number(r.width), height: Number(r.height), bytes: Number(r.bytes ?? fs.statSync(outFile).size), mime: String(r.mime ?? mimeOf(outFile)) };
        } catch {
          /* fall through to sips */
        }
      }
      return downscaleFallback(p, opts.maxDim, opts.maxBytes);
    },
    async analyze(p) {
      if (helper.available()) {
        try {
          const r = await helper.call<Analysis>('analyzeImage', { path: p });
          if (typeof r.width === 'number') return r;
        } catch {
          /* fall through */
        }
      }
      return analyzeFallback(p);
    },
  };
}
