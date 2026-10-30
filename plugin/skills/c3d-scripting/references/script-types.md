# Script types (for the standalone macro fallback and for scripts you hand to the user)

The Polygonobj, Splineobj, Particle and Tag rows were checked in Cheetah3D 8.1.3 by instantiating the example scripts that ship with the app (Tools › Script menus); the Tool row and everything marked (reported) come from the knowledge base and were not tested. Find them with `c3d_search_api_docs {query, sources:["example"]}`; they are the best templates.

| Folder (`~/Library/Application Support/Cheetah3D/Scripts/`) | Entry points | Result in the scene |
|---|---|---|
| `Macro/` | `main(doc)`, run from Tools › Script › Macro Script | nothing by itself; the script edits the document |
| `Polygonobj/` | `buildUI(base)` declares parameters, `buildObject(base, core)` builds geometry | an object of type `SCRIPTPOLY` (59); official `Menger.js` gives 1056 polygons |
| `Splineobj/` | `buildUI`, `buildObject(base, core)` with `core.move/line/curve` | `SCRIPTSPLINE` (60) |
| `Particle/` | `buildUI`, `buildObject(base, core)` with `core.addParticle()` | `PARTICLESCRIPT` (81) |
| `Tag/` | `performExpression(...)` runs on time changes; optional `buildUI` | a `SCRIPTTAG` (115) on the selected object; official `CircleExpression.js` moves it to (cos t, 0, sin t) |
| `Tool/` | `buildUI` plus button callbacks (reported, not tested) | acts on the current selection (reported) |

- The folder decides the type; a file in the wrong folder fails silently, errors or crashes (reported by the book; not tested). New files appear in the menu only after a restart of Cheetah3D (there is no "Update Menu" item); edits to an existing file are picked up.
- Call `base.addParameter*` only in `buildUI` (reported, not tested). Pass all documented arguments; the official `Menger.js` passes 4 to `addParameterBool` and works, fewer has crashed older versions.
- Inside `buildObject`/`performExpression` pass `false` as the third argument of `setParameter` (the knowledge base reports an endless rebuild loop otherwise; not re-tested), never call `Math.random()` in `buildObject` (geometry would change on every rebuild; use a seeded generator) and validate polygon indices.
- `c3d_run_script` is for macros only: it cannot create script-type objects (`SCRIPTPOLY`, `SCRIPTTAG`, ... are refused on purpose because they run unsandboxed JavaScript). Give the user the file and the folder instead.
- `c3d_lint_script` checks these rules (entry points, argument counts, `setParameter` without `false`, undo recording in expressions).
