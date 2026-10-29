# Final report template

Fill every section from facts you observed (tool results, renders), not from memory. Verify counts with `c3d_list_scene` / `c3d_get_scene_stats` before quoting them.

1. **Final render.** Path, resolution, render time, aspect ratio match with the reference. Also show the reference side by side if possible.

2. **Phases table.**

| Phase | c3d calls | Errors | Renders | Notes |
|---|---|---|---|---|
| P0 ... P7 | n | n | n | what was built / fixed after viewing the draft |
| Total | | | | crashes and calls lost to them |

Totals: objects, polygons, materials, folders with counts.

3. **Feature checklist.** The numbered feature list from the reference, each marked present / partial / missing, with one short reason for partial or missing.

4. **Scorecard (1-5, one sentence each).** Silhouette and proportions; composition and camera; materials; lighting and colour; detail density; style/NPR look (state what missing outlines, bloom or compositor cost). Compare colour numerically when possible (mean RGB of the subject region against the reference). Score honestly; flat or clean results are not a 4.

5. **Bugs, surprises and limitations.** One row each:

| # | What happened | Exact triggering call (tool + key args) | Error code/hint | Workaround used | Status |
|---|---|---|---|---|---|

Include slow calls, confusing tool descriptions, crashes (with the call before the crash), recovery steps, and anything unsupported that you reported instead of faking.

6. **Delivery set.** Final PNG, checkpoint `.jas` (id and path), FBX path, optional post-processed image path and which operations were applied.

7. **What I would change next.** Concrete scene improvements ranked by visual impact.
