/* eslint-disable @typescript-eslint/no-non-null-assertion -- loosely typed runtime data; indices are bounds-checked by construction */
// BM25 search over the vendored Cheetah3D scripting knowledge base.
import fs from 'node:fs';
import path from 'node:path';
import { kbLayout, readKb } from './kb.js';

export interface DocHit { id: string; title: string; snippet: string; source: string }
interface Doc { id: string; title: string; text: string; source: string; tf: Map<string, number>; len: number }

const SPLIT_CAMEL = /([a-z0-9])([A-Z])/g;
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.split(/[^A-Za-z0-9_]+/)) {
    if (!raw) continue;
    const low = raw.toLowerCase();
    out.push(low);
    const parts = raw.replace(SPLIT_CAMEL, '$1 $2').toLowerCase().split(/[\s_]+/).filter(Boolean);
    if (parts.length > 1) out.push(...parts);
  }
  return out;
}

function chunkMarkdown(src: string, source: string, maxChars = 1400): Array<{ title: string; text: string; source: string }> {
  const out: Array<{ title: string; text: string; source: string }> = [];
  const heads: string[] = [];
  let buf: string[] = [];
  const flush = (): void => {
    const text = buf.join('\n').trim();
    if (text.length > 30) out.push({ title: heads.filter(Boolean).join(' > ') || source, text, source });
    buf = [];
  };
  for (const line of src.split('\n')) {
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heads.length = m[1]!.length - 1;
      heads[m[1]!.length - 1] = m[2]!.trim();
    } else {
      buf.push(line);
      if (buf.join('\n').length > maxChars && /^\s*$/.test(line)) flush();
    }
  }
  flush();
  return out;
}

function apiDocs(): Array<{ title: string; text: string; source: string }> {
  const raw = readKb('reference/api-index.json');
  if (!raw) return [];
  const api = JSON.parse(raw) as { classes: Record<string, { inherits: string | null; methods: Record<string, string[]> }>; globals: string[]; constants: string[] };
  const out: Array<{ title: string; text: string; source: string }> = [];
  for (const [cls, c] of Object.entries(api.classes))
    for (const [m, sigs] of Object.entries(c.methods)) out.push({ title: `${cls}.${m}`, text: `${cls}.${m}\n${sigs.join('\n')}${c.inherits ? `\n(inherits ${c.inherits})` : ''}`, source: 'api-index' });
  out.push({ title: 'Global functions', text: api.globals.join(', '), source: 'api-index' });
  out.push({ title: 'Constants', text: api.constants.join(' '), source: 'api-index' });
  return out;
}

let index: { docs: Doc[]; df: Map<string, number>; avg: number } | undefined;

function build(): NonNullable<typeof index> {
  const raw: Array<{ title: string; text: string; source: string }> = [...apiDocs()];
  const l = kbLayout();
  if (l) {
    const md = (rel: string, source: string): void => {
      const t = readKb(rel);
      if (t) raw.push(...chunkMarkdown(t, source));
    };
    md('knowledge/gotchas.md', 'gotchas');
    md('knowledge/patterns.md', 'patterns');
    const dist = path.join(l.kbRoot, 'dist');
    if (fs.existsSync(dist)) for (const f of fs.readdirSync(dist).filter((x) => x.endsWith('.md')).sort()) md(`dist/${f}`, `dist/${f}`);
    if (l.research02) raw.push(...chunkMarkdown(fs.readFileSync(l.research02, 'utf8'), 'research-02'));
  }
  const docs: Doc[] = raw.map((r, i) => {
    const toks = [...tokenize(r.text), ...tokenize(r.title), ...tokenize(r.title)];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { id: `${r.source}#${i}`, title: r.title, text: r.text, source: r.source, tf, len: toks.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  return { docs, df, avg: docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length) };
}

export function resetDocsIndex(): void {
  index = undefined;
}

function snippetFor(d: Doc, terms: string[]): string {
  const low = d.text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = low.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at - 80);
  const s = d.text.slice(start, start + 420).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '... ' : '') + s + (start + 420 < d.text.length ? ' ...' : '');
}

export function searchDocs(query: string, limit = 5): DocHit[] {
  index ??= build();
  const { docs, df, avg } = index;
  const q = [...new Set(tokenize(query))];
  if (!q.length || !docs.length) return [];
  const k1 = 1.4;
  const b = 0.75;
  const N = docs.length;
  const scored = docs
    .map((d) => {
      let s = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const n = df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.len) / avg));
      }
      return { d, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, c) => c.s - a.s);
  const seen = new Set<string>();
  const hits: DocHit[] = [];
  for (const { d } of scored) {
    const key = d.text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ id: d.id, title: d.title, snippet: snippetFor(d, q), source: d.source });
    if (hits.length >= limit) break;
  }
  return hits;
}
