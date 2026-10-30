---
name: c3d-scripting
description: Writes and debugs Cheetah3D 8.1.3 JavaScript (ES5, JavaScriptCore) for c3d_run_script and for standalone macro files, including the crash-avoiding rules, API cheat sheet and a ready-to-run macro template. Use when the user needs bulk or parametric geometry, scene automation or a Cheetah3D script, or when the c3d_* MCP tools are unavailable and a macro .js must be handed to the user to run.
---

# Cheetah3D scripting

If the c3d_* tools are not available, skip to "Standalone macro fallback" and deliver a macro file the user runs by hand.

## With the tools
1. `c3d_search_api_docs` for signatures; never rely on memory for method names. Every hit has a trust level: `official` (API reference), `verified` (measured in 8.1.3), `example` (scripts shipped with Cheetah3D) are reliable; `kb`, `book`, `book-unreviewed` and `forum` are hints, and a `NOTE [refuted|refined in Cheetah3D 8.1.3]` line overrides the text above it. `sources:["official","example"]` narrows the search; resource `c3d://verified` lists what was confirmed or refuted.
2. `c3d_lint_script` first (checks missing `new`, banned calls, endless loops, missing `update()`, unknown methods). Fix every error; warnings about unknown constants are often harmless.
3. `c3d_checkpoint`, then `c3d_run_script` (default deadline 60 s, `timeout_s` up to 600). Keep each script under ~8000 characters; split big builds into several runs.
4. End with an explicit `return {...}` of counts and ids (a trailing expression is NOT returned). Use `print()` for logs; both come back in the result. Only JSON-able values (plain objects, arrays, strings, finite numbers) come back; Vec3D/objects are not returned, convert to `{x,y,z}` or ids.
5. Verify with `c3d_list_scene`, `c3d_get_scene_stats`, `c3d_get_mesh`, then a draft `c3d_render_image`.
6. If a script throws, run `c3d_list_scene`: geometry created before the throw stays. Restore the checkpoint or delete the strays.

## Sandbox facts
- Engine is JavaScriptCore. Modern syntax (`let/const`, arrows, template strings) runs in 8.1.3, but write ES5 style (`var`, `function`) like the bundled scripts; there is no `require`, timers or network. `main(doc)` is for macros; in `c3d_run_script` the globals `doc`, `print`, `Vec3D`, `Vec4D` and constants (BOX, FOLDER, SHADERTAG...) are provided.
- `OS.messageBox`, panels, `eval`, the Function constructor and `File.mkDir` are blocked; file writes are limited to the work directory. `OS.system` runs only after confirmation, is synchronous, returns the raw wait status (exit code x 256, so `exit 3` returns 768) and does not capture stdout (redirect it to a file). Prefer no `File`/`OS` at all.
- It is advisory containment, not a security boundary; an endless loop freezes Cheetah3D.
- `doc.removeMaterial` on a material created in the same run crashes Cheetah3D; the runtime refuses it with `UNSUPPORTED` on `doc`, but cannot guard a document reached through `obj.document()`, so never do it either way. Create in one call, remove in a later one, or just leave it.

## Rules that prevent crashes and silent bugs
- Call `obj.update()` after editing parameters or geometry.
- Validate every polygon index (integer, `0 <= i < core.vertexCount()`) before `core.addIndexPolygon(n, list)`; a bad index crashes the app.
- `doc.addObject(TYPE)` attaches under the parent of the currently selected object. Always parent explicitly: `parent.addChildAtIndex(obj, parent.childCount())`.
- Names are not unique; keep object references or ids, not names.
- Accessors return copies: write back with `setVertex` / `setParameter`.
- Vectors: `new Vec3D(x,y,z)`, `new Vec4D(r,g,b,a)` (missing `new` throws a TypeError in 8.1.3); read `.x .y .z .w`. Colours are Vec4D 0..1.
- `parameterInfo()` yields `[name, typeString]` pairs.
- `rotation` is HPB degrees (x heading, y pitch, z bank).
- Pair `doc.retainRedrawLock()` with `doc.releaseRedrawLock()` in `try/finally` when you take the lock; an unbalanced lock freezes redraw. Bulk loops are faster under the lock.
- `File.write` with non-ASCII text truncates: keep source ASCII, escape as `\uXXXX`. Never call `File.mkDir` (deletes an existing path).
- Never create SCRIPTTAG/SCRIPTPOLY objects; avoid `setParameter` in tight loops on one object (set once, then `update()`).
- Primitives (BOX, BALL, CYLINDER...) are parametric: size via `sizeX/sizeY/sizeZ`, `radius`, `height`; use `bevelRadius`/`bevelSections` for bevels. One SHADERTAG per object unless you set polygon selections yourself.
- Avoid coplanar overlapping faces; offset by >= 0.01 m.

Full lists: `references/api-cheatsheet.md`, `references/pitfalls.md`; script folders, entry points and what each type produces: `references/script-types.md`.

## Templates
- `templates/macro-template.js` - minimal `main(doc)` macro with helpers and lock handling.
- `templates/bulk-geometry.js` - parametric script that builds N varied boxes (planks) inside a named folder with explicit parenting; works in `c3d_run_script` and as a macro.

## Standalone macro fallback (no MCP, e.g. ChatGPT)
Produce one self-contained file, then guide the user.
1. Write ES5 only, ASCII only, a top-level `function main(doc) { ... }`, no `require`/imports, no `File`/`OS`, no `return` at top level outside functions. Start from `templates/macro-template.js`. Parent every new object explicitly and call `update()`.
2. Put results into a visible place: build objects in a named FOLDER and `print()` a summary (the Cheetah3D Console shows it).
3. Tell the user:
   - Save the file as `something.js` in `~/Library/Application Support/Cheetah3D/Scripts/Macro/` (the folder, not the file contents, decides the script type; a macro in another folder silently does nothing). Subfolders are fine.
   - Restart Cheetah3D once (new scripts appear only after a restart; edits to an already listed script take effect on the next run).
   - Open a scratch document, then run it from Tools > Script > Macro Script > the file name.
   - Save a copy of the document first: Cheetah3D Undo does not reliably revert macro changes.
4. Do not: promise the macro was tested; use modern JS syntax; call `File.mkDir`, `doc.removeMaterial` or non-ASCII file writes; build giant meshes in one run; edit the user's saved files; ask them to run it in a document with unsaved work.
5. Ask the user to paste back: the Console output or error text (Cheetah3D Console window), what the scene looks like (screenshot or description), and the object count shown. Then fix the script and re-send the whole file, not a diff.
