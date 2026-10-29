/* eslint-disable @typescript-eslint/no-non-null-assertion -- indices are bounds-checked by construction */
// Pure-Node PNG writer and linear gradient rasterizer (sRGB interpolation, optional triangular dither against banding).
import zlib from 'node:zlib';
import { BridgeError } from '../toolkit.js';

export interface GradientStop { pos: number; color: { r: number; g: number; b: number; a: number } }

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const v of b) c = CRC_TABLE[(c ^ v) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encodes 8-bit RGBA pixels (row-major, width*height*4 bytes) as a PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new BridgeError('INTERNAL', 'encodePng: pixel buffer has the wrong size.');
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Deterministic hash noise in [0,1) for (x,y). */
function noise(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface GradientOptions { stops: GradientStop[]; angleDeg: number; width: number; height: number; dither?: boolean }

/**
 * Rasterizes a linear gradient. angleDeg is the direction of the gradient vector in screen space with y pointing down:
 * 0 = left to right, 90 = top to bottom, 180 = right to left, 270 = bottom to top.
 */
export function renderGradient(o: GradientOptions): Uint8Array {
  const { width: w, height: h } = o;
  if (o.stops.length < 2) throw new BridgeError('INVALID_ARGUMENT', 'A gradient needs at least 2 stops.');
  const stops = [...o.stops].sort((a, b) => a.pos - b.pos);
  const a = (o.angleDeg * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
  const out = new Uint8Array(w * h * 4);
  const dither = o.dither ?? true;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = Math.min(1, Math.max(0, 0.5 + ((x + 0.5 - w / 2) * dx + (y + 0.5 - h / 2) * dy) / (2 * half)));
      let i = 0;
      while (i < stops.length - 2 && t > stops[i + 1]!.pos) i++;
      const s0 = stops[i]!, s1 = stops[i + 1]!;
      const span = s1.pos - s0.pos;
      const f = span <= 1e-12 ? (t >= s1.pos ? 1 : 0) : Math.min(1, Math.max(0, (t - s0.pos) / span));
      const o4 = (y * w + x) * 4;
      const chans: Array<'r' | 'g' | 'b'> = ['r', 'g', 'b'];
      chans.forEach((ch, c) => {
        const v = (s0.color[ch] + (s1.color[ch] - s0.color[ch]) * f) * 255;
        const d = dither ? noise(x, y, c + 1) + noise(x, y, c + 11) - 1 : 0; // triangular, +-1 LSB
        out[o4 + c] = Math.min(255, Math.max(0, Math.round(v + d)));
      });
      out[o4 + 3] = 255;
    }
  }
  return out;
}
