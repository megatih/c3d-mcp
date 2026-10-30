// Minimal PNG reader for dev probes (8-bit, non-interlaced; gray, gray+alpha, RGB, RGBA). No dependencies.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
export function readPng(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, depth = 0, ct = 0, interlace = 0; const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; interlace = d[12]; }
    else if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG depth=${depth} interlace=${interlace}`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  if (!ch) throw new Error('unsupported color type ' + ct);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0, up = y ? px[dst - stride + x] : 0, c = x >= ch && y ? px[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[dst + x] = v & 255;
    }
  }
  const at = (x, y) => { const i = (y * w + x) * ch; return ch >= 3 ? [px[i], px[i + 1], px[i + 2], ch === 4 ? px[i + 3] : 255] : [px[i], px[i], px[i], ch === 2 ? px[i + 1] : 255]; };
  const luma = (x, y) => { const p = at(x, y); return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255; };
  const region = (x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += luma(x, y); n++; } return s / n; };
  const grid = (nx, ny) => { const g = []; for (let j = 0; j < ny; j++) { const r = []; for (let i = 0; i < nx; i++) r.push(+region(Math.floor(i * w / nx), Math.floor(j * h / ny), Math.floor((i + 1) * w / nx), Math.floor((j + 1) * h / ny)).toFixed(3)); g.push(r); } return g; };
  return { w, h, channels: ch, colorType: ct, at, luma, region, grid };
}
