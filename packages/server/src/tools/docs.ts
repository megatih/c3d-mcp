import { z } from 'zod';
import { defineTool } from '../toolkit.js';
import { ok } from '../lib/result.js';

export const searchApiDocs = defineTool({
  name: 'c3d_search_api_docs',
  title: 'Search Cheetah3D API docs',
  description:
    'Full-text (BM25) search over the Cheetah3D 8.1.3 JavaScript API reference, gotchas and script patterns. Use it BEFORE writing a script with c3d_run_script, or when unsure of a method signature, constant or known crash. Returns ranked snippets with source and API signatures. Query with identifiers or short phrases, e.g. "addIndexPolygon", "FCurve keyframe", "retainRedrawLock".',
  group: 'docs',
  inputSchema: z.strictObject({
    query: z.string().min(2).max(200).describe('Search terms: API names, class.method or a short phrase.'),
    limit: z.number().int().min(1).max(10).optional().describe('Max results (default 5).'),
  }),
  outputSchema: z.looseObject({
    results: z.array(z.looseObject({ id: z.string(), title: z.string(), snippet: z.string(), source: z.string() })),
    count: z.number().int(),
  }),
  mutating: false,
  idempotent: true,
  profiles: ['full', 'local', 'readonly'],
  localDescription: 'Search the Cheetah3D API docs for a method, constant or gotcha.',
  // eslint-disable-next-line @typescript-eslint/require-await
  async handler(input, ctx) {
    const results = ctx.services.searchDocs(input.query, input.limit ?? 5);
    const text = results.length ? results.map((r, i) => `${i + 1}. [${r.source}] ${r.title}\n   ${r.snippet}`).join('\n') : 'No matches. Try a shorter query or an API identifier.';
    return ok({ results, count: results.length }, text);
  },
});

export const docsTools = [searchApiDocs];
