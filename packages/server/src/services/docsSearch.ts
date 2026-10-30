/* eslint-disable @typescript-eslint/no-non-null-assertion -- loosely typed runtime data; indices are bounds-checked by construction */
// BM25 search over the Cheetah3D knowledge base. Sources, from most to least trustworthy:
//   official  the per-class API reference converted from the app's own help (identical to 8.1.3 for names; descriptions are 8.1.1)
//   verified  project notes of what was MEASURED in the running app (research/02, 08, 10)
//   example   the scripts bundled with Cheetah3D (byte-identical to the 8.1.3 bundle)
//   kb        gotchas and patterns of c3d-scripting-kb (forum-derived; some entries are wrong for 8.1.3, see notes on hits)
//   book      "Learn 3D with Cheetah 3D" (4th ed., reviewed against 8.1.1; passages marked AI draft/TODO are labelled unreviewed)
//   forum     archived forum threads (mostly pre-v7); only searched to fill remaining slots, or when asked for explicitly
import fs from 'node:fs';
import path from 'node:path';
import { kbLayout, listKb, readKb } from './kb.js';
import { KB_NOTES, VERIFIED_ON } from './kbOverlay.js';

export type SourceFilter = 'official' | 'verified' | 'example' | 'kb' | 'book' | 'forum';
export const SOURCE_FILTERS: readonly SourceFilter[] = ['official', 'verified', 'example', 'kb', 'book', 'forum'];
export type Trust = 'official' | 'verified' | 'example' | 'kb' | 'book' | 'book-unreviewed' | 'forum';

export interface DocHit { id: string; title: string; snippet: string; source: string; trust: Trust; note?: string }
interface Raw { title: string; text: string; source: string; trust: Trust; meta?: string }
interface Doc extends Raw { id: string; category: SourceFilter; tf: Map<string, number>; len: number; note?: string }
interface Index { docs: Doc[]; df: Map<string, number>; avg: number }

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

function chunkMarkdown(src: string, source: string, trust: Trust, maxChars = 1400, titlePrefix = ''): Raw[] {
  const out: Raw[] = [];
  const heads: string[] = [];
  let buf: string[] = [];
  const flush = (): void => {
    const text = buf.join('\n').trim();
    if (text.length > 30) out.push({ title: [titlePrefix, ...heads].filter(Boolean).join(' > ') || source, text, source, trust });
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

/** Windows of whole lines, for text without headings or blank lines (constants lists, source code). */
function chunkLines(src: string, source: string, trust: Trust, title: string, maxChars = 1500): Raw[] {
  const out: Raw[] = [];
  let buf = '';
  let n = 0;
  for (const line of src.split('\n')) {
    if (buf.length + line.length > maxChars && buf) {
      out.push({ title: n ? `${title} (part ${n + 1})` : title, text: buf.trim(), source, trust });
      buf = '';
      n++;
    }
    buf += `${line}\n`;
  }
  if (buf.trim().length > 30) out.push({ title: n ? `${title} (part ${n + 1})` : title, text: buf.trim(), source, trust });
  return out;
}

/** One document per method from the converted class pages (signature + description); falls back to the signature-only index. */
function apiDocs(): Raw[] {
  const l = kbLayout();
  const dir = l ? path.join(l.kbRoot, 'reference', 'api') : '';
  if (l && fs.existsSync(dir)) {
    const out: Raw[] = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
      const cls = f.replace(/\.md$/, '');
      const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^_Source:.*$/m, '');
      if (cls === 'Constants') {
        out.push(...chunkLines(src, 'api/Constants', 'official', 'Constants (documented; see notes: a few are undefined at runtime)'));
        continue;
      }
      const parts = src.split(/^### /m);
      const intro = parts[0]!.replace(/^#\s+.*$/m, '').trim();
      if (intro.length > 20) out.push({ title: cls, text: `${cls}\n${intro}`, source: `api/${cls}`, trust: 'official' });
      for (const p of parts.slice(1)) {
        const nl = p.indexOf('\n');
        const sig = p.slice(0, nl < 0 ? p.length : nl).replace(/`/g, '').trim();
        const desc = (nl < 0 ? '' : p.slice(nl + 1)).replace(/\n## [\s\S]*$/, '').trim();
        const name = /([A-Za-z_]\w*)\s*\(/.exec(sig)?.[1] ?? sig.slice(0, 40);
        out.push({ title: `${cls}.${name}`, text: `${cls}.${name}\n${sig}\n${desc}`, source: `api/${cls}`, trust: 'official' });
      }
    }
    return out;
  }
  const raw = readKb('reference/api-index.json');
  if (!raw) return [];
  const api = JSON.parse(raw) as { classes: Record<string, { inherits: string | null; methods: Record<string, string[]> }>; globals: string[]; constants: string[] };
  const out: Raw[] = [];
  for (const [cls, c] of Object.entries(api.classes))
    for (const [m, sigs] of Object.entries(c.methods)) out.push({ title: `${cls}.${m}`, text: `${cls}.${m}\n${sigs.join('\n')}${c.inherits ? `\n(inherits ${c.inherits})` : ''}`, source: 'api-index', trust: 'official' });
  out.push({ title: 'Global functions', text: api.globals.join(', '), source: 'api-index', trust: 'official' });
  out.push({ title: 'Constants', text: api.constants.join(' '), source: 'api-index', trust: 'official' });
  return out;
}

function exampleDocs(): Raw[] {
  const l = kbLayout();
  if (!l) return [];
  const root = path.join(l.kbRoot, 'examples', 'official');
  if (!fs.existsSync(root)) return [];
  const out: Raw[] = [];
  for (const type of fs.readdirSync(root).sort()) {
    const d = path.join(root, type);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.js')).sort()) out.push(...chunkLines(`${type}/${f}\n${fs.readFileSync(path.join(d, f), 'utf8')}`, `example/${type}/${f}`, 'example', `Example script ${type}/${f}`));
  }
  return out;
}

const UNREVIEWED = /AI draft|TODO[ :]*(verify|update|missing|review)/i;

function bookDocs(): Raw[] {
  const root = kbLayout()?.bookRoot;
  if (!root || !fs.existsSync(root)) return [];
  const out: Raw[] = [];
  for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.md')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const chapter = f.replace(/\.md$/, '').replace(/_/g, ' ');
    const src = fs.readFileSync(path.join(root, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const r of chunkMarkdown(src, `book/${f}`, 'book', 1400, chapter)) out.push({ ...r, trust: UNREVIEWED.test(r.text) ? 'book-unreviewed' : 'book' });
  }
  return out;
}

function projectNotes(): Raw[] {
  const l = kbLayout();
  if (!l) return [];
  const out: Raw[] = [];
  const add = (file: string, source: string): void => {
    const f = l.researchDir ? path.join(l.researchDir, file) : undefined;
    if (f && fs.existsSync(f)) out.push(...chunkMarkdown(fs.readFileSync(f, 'utf8'), source, 'verified'));
  };
  if (l.researchDir) {
    add('02-cheetah3d-js-api.md', 'research-02');
    add('08-open-questions-and-probes.md', 'research-08');
    add('10-kb-verification-8.1.3.md', 'research-10');
  } else if (l.research02) out.push(...chunkMarkdown(fs.readFileSync(l.research02, 'utf8'), 'research-02', 'verified'));
  return out;
}

interface ThreadMeta { id: number; url?: string; author?: string; review?: { status?: string; versions_working?: string[]; versions_broken?: string[]; summary?: string } }

function forumDocs(): Raw[] {
  const l = kbLayout();
  if (!l) return [];
  const names = listKb('forum/threads', '.md');
  if (!names.length) return [];
  const meta = new Map<number, ThreadMeta>();
  try {
    const raw = readKb('catalog/forum-threads.json');
    if (raw) for (const t of JSON.parse(raw) as ThreadMeta[]) meta.set(t.id, t);
  } catch {
    /* catalog is optional */
  }
  const out: Raw[] = [];
  for (const n of names) {
    const id = Number(/^(\d+)-/.exec(n)?.[1]);
    const m = meta.get(id);
    const rv = m?.review;
    const label = `forum thread #${id}${m?.author ? ` by ${m.author}` : ''}${m?.url ? ` ${m.url}` : ''}; status: ${rv?.status ?? 'unknown'}${rv?.versions_working?.length ? `; reported working in ${rv.versions_working.join(', ')}` : ''}${rv?.versions_broken?.length ? `; reported broken in ${rv.versions_broken.join(', ')}` : ''}; NOT verified in ${VERIFIED_ON}`;
    for (const r of chunkMarkdown(fs.readFileSync(path.join(l.kbRoot, 'forum', 'threads', n), 'utf8'), `forum/${n}`, 'forum', 1800)) out.push({ ...r, meta: `[${label}]` });
  }
  return out;
}

const CATEGORY: Record<Trust, SourceFilter> = { official: 'official', verified: 'verified', example: 'example', kb: 'kb', book: 'book', 'book-unreviewed': 'book', forum: 'forum' };
const NOTE_RES = KB_NOTES.map((n) => ({ n, res: n.any.map((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')) }));

function buildIndex(raw: Raw[], idPrefix: string): Index {
  const docs: Doc[] = raw.map((r, i) => {
    const toks = [...tokenize(r.text), ...tokenize(r.title), ...tokenize(r.title)];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const hay = `${r.title}\n${r.text}`;
    const notes = r.trust === 'verified' ? [] : NOTE_RES.filter(({ res }) => res.some((re) => re.test(hay))).slice(0, 2);
    const parts = [...(r.meta ? [r.meta] : []), ...notes.map(({ n }) => `[${n.status} in ${VERIFIED_ON}] ${n.text}`)];
    const note = parts.length ? parts.join(' ') : undefined;
    return { ...r, id: `${idPrefix}${r.source}#${i}`, category: CATEGORY[r.trust], tf, len: toks.length, ...(note ? { note } : {}) };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  return { docs, df, avg: docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length) };
}

let core: Index | undefined;
let forum: Index | undefined;

function coreIndex(): Index {
  if (core) return core;
  const raw: Raw[] = [...apiDocs()];
  const md = (rel: string, source: string): void => {
    const t = readKb(rel);
    if (t) raw.push(...chunkMarkdown(t, source, 'kb'));
  };
  if (kbLayout()) {
    md('knowledge/gotchas.md', 'gotchas');
    md('knowledge/patterns.md', 'patterns');
    // dist/c3d-context-*.md are generated from gotchas + patterns; indexing them would only duplicate hits.
    raw.push(...exampleDocs(), ...projectNotes(), ...bookDocs());
  }
  return (core = buildIndex(raw, ''));
}

function forumIndex(): Index {
  return (forum ??= buildIndex(forumDocs(), 'f:'));
}

export function resetDocsIndex(): void {
  core = undefined;
  forum = undefined;
}

function snippetFor(d: Doc, terms: string[]): string {
  const text = d.text.replace(/<!--[\s\S]*?-->/g, '');
  const low = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = low.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at - 80);
  const s = text.slice(start, start + 420).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '... ' : '') + s + (start + 420 < text.length ? ' ...' : '');
}

function rank(ix: Index, q: string[], want: Set<SourceFilter>, limit: number, seen: Set<string>): DocHit[] {
  const { docs, df, avg } = ix;
  const k1 = 1.4;
  const b = 0.75;
  const N = docs.length;
  const scored = docs
    .filter((d) => want.has(d.category))
    .map((d) => {
      let s = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const n = df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.len) / avg));
      }
      // Measured notes and unreviewed book text: small nudges only, relevance still dominates.
      if (d.trust === 'verified') s *= 1.15;
      else if (d.trust === 'book-unreviewed') s *= 0.9;
      return { d, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, c) => c.s - a.s);
  const hits: DocHit[] = [];
  for (const { d } of scored) {
    const key = d.text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ id: d.id, title: d.title, snippet: snippetFor(d, q), source: d.source, trust: d.trust, ...(d.note ? { note: d.note } : {}) });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * @param sources restrict to these sources (default: everything; forum threads only fill slots the other sources leave free,
 *                or are searched alone when requested explicitly).
 */
export function searchDocs(query: string, limit = 5, sources?: readonly SourceFilter[]): DocHit[] {
  const ix = coreIndex();
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];
  const want = new Set<SourceFilter>(sources?.length ? sources : SOURCE_FILTERS);
  const seen = new Set<string>();
  const hits = ix.docs.length ? rank(ix, q, want, limit, seen) : [];
  if (want.has('forum') && hits.length < limit) hits.push(...rank(forumIndex(), q, want, limit - hits.length, seen));
  return hits;
}
