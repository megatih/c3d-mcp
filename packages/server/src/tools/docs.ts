import { z } from 'zod';
import { defineTool } from '../toolkit.js';
import { ok } from '../lib/result.js';

export const searchApiDocs = defineTool({
  name: 'c3d_search_api_docs',
  title: 'Search Cheetah3D API docs',
  description:
    'Full-text (BM25) search over the Cheetah3D JavaScript API reference (per-method descriptions), the scripts bundled with the app, measured notes (verified in 8.1.3), gotchas/patterns, the book "Learn 3D with Cheetah 3D" and (last, only to fill free slots) archived forum threads. Use it BEFORE writing a script with c3d_run_script, or when unsure of a method signature, constant or known crash. Each hit has a trust level (official, verified, example, kb, book, book-unreviewed, forum) and, where the claim was tested in 8.1.3, a note saying whether it was confirmed, refined or refuted: prefer official/verified/example, treat kb/book-unreviewed/forum as hints to test. Query with identifiers or short phrases, e.g. "addIndexPolygon", "FCurve keyframe", "retainRedrawLock".',
  group: 'docs',
  inputSchema: z.strictObject({
    query: z.string().min(2).max(200).describe('Search terms: API names, class.method or a short phrase.'),
    limit: z.number().int().min(1).max(10).optional().describe('Max results (default 5).'),
    sources: z.array(z.enum(['official', 'verified', 'example', 'kb', 'book', 'forum'])).min(1).max(6).optional().describe('Restrict to these sources (default: all; forum threads only fill slots the others leave free). Use ["forum"] to search the archived forum alone.'),
  }),
  outputSchema: z.looseObject({
    results: z.array(z.looseObject({ id: z.string(), title: z.string(), snippet: z.string(), source: z.string(), trust: z.string(), note: z.string().optional() })),
    count: z.number().int(),
  }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'local', 'readonly'],
  localDescription: 'Search the Cheetah3D API docs for a method, constant or gotcha.',
  // eslint-disable-next-line @typescript-eslint/require-await
  async handler(input, ctx) {
    const results = ctx.services.searchDocs(input.query, input.limit ?? 5, input.sources);
    const text = results.length ? results.map((r, i) => `${i + 1}. [${r.trust}: ${r.source}] ${r.title}\n   ${r.snippet}${r.note ? `\n   NOTE ${r.note}` : ''}`).join('\n') : 'No matches. Try a shorter query or an API identifier.';
    return ok({ results, count: results.length }, text);
  },
});

export const docsTools = [searchApiDocs];
