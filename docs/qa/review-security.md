# Independent security/safety review (read-only)

Scope: requirements section 0 and 7, docs/SECURITY.md, docs/PROTOCOL.md against packages/server/src, bridge/runtime, helper/Sources, packaging, plugin, mcpb.
Method: code reading plus one throwaway JavaScriptCore harness (outside the repo, scratchpad) that loads the real `util.js` and `exec.js` with a fake non-writable `OS`/`File`. Nothing in the repo was edited. The real app, the network and `~/Library/Application Support/Cheetah3D` were not touched.

## HIGH

### H1. `c3d_run_script` sandbox escape: sandbox is torn down before the result is processed (verified)
`bridge/runtime/exec.js:145-150`. The `finally` block calls `restoreCtor()` and restores `G.OS`/`G.File`. Only after that does `describeResult(value)` (line 150) run `plain()`, which reads getters and calls `String(v)`/`toString` on objects returned by user code. Those user functions run with the real `Function.prototype.constructor` back in place.
Verified in JSC with a non-writable `OS` (the real-app condition): 
```
return { get a(){ var F=(function(){}).constructor; var g=F('return this')(); g['O'+'S']['sys'+'tem']('x'); return 1; } }
```
and the `toString` variant both reached the real `OS.system`. Inside the run, `(function(){}).constructor(...)` is correctly blocked, so the escape is purely the ordering bug.
Impact: real `OS.system` and real `File` (shell, arbitrary write) from a script. The server-side gate cannot catch it. `tools/exec.ts:8-9,34-39` only asks for confirmation when a regex sees `OS.system` or `new File(` in the source. `'O'+'S'` evades it. The lint rule `computed-os-access` (`lint.ts:167`) does not match `g['O'+'S']`, and `force:true` skips lint anyway. So a prompt-injected agent gets shell with no prompt. docs/SECURITY.md says the sandbox is "not a boundary", but the confirmation story in requirements section 7 ("run_script with OS.system ... elicits") is not true as built.
Fix: compute `describeResult` inside the `try`, before `restoreCtor()`, and deep-copy plain data only through `Object.getOwnPropertyDescriptor` data properties, rejecting accessors and anything with a non-Object prototype. Never call user `toString`; if a string is needed, return `'[object]'`. Better, run the whole teardown in a `finally` that cannot call user code. Add a harness case (getter and toString returns that touch `Function`).
Defence in depth: do not rely on a source regex for the shell gate. Either always confirm `c3d_run_script`, or tell the user plainly that every run is full-privilege. Also persistent mutation of builtins (`Object.prototype`, `JSON`, `Array.prototype`) by user code survives the run. If the app's JS context persists between presses this taints later runtime code, so consider freezing or snapshotting.

### H2. `confirm:true` bypasses elicitation, so there is no human in the loop
`packages/server/src/core/toolServices.ts:55-56`: `if (confirmFlag === true) return true;` is checked before the elicitation path, even when the client supports elicitation. Every gate (delete >5, overwrite, restore checkpoint, run_script OS.system/file) is therefore model-controllable, and the schema tells the model about the flag (`lib/schemas.ts:57`). docs/SECURITY.md ("elicitation puts a human in the loop") and requirements section 7 imply the opposite.
Related: the elicitation message for scripts (`tools/exec.ts:38`) does not show the code. The retry key is `sha256(message)` (`toolServices.ts:57`) and is not bound to the arguments. A consent for "This script uses OS.system. Run it?" is valid for any code on the retried call, and for any "Delete 6 object(s)?" on any six objects.
Fix: honour `confirmFlag` only when the client has no elicitation capability. Put a digest of the salient arguments (code hash plus the first N bytes of code, target path, ref ids) into both the message and the key, and verify them on retry.

## MEDIUM

### M1. SCRIPTTAG (and similar script-bearing objects) as an un-sandboxed code path (unverified, needs live check)
`c3d_add_tag` (type is any name from `tagTypes`, including `SCRIPTTAG`) and `c3d_set_tag_params` / `c3d_set_parameters` (`tools/tags.ts`, profile `full`) have no deny-list. If a script tag or script object exposes its source or script path as a settable String parameter (the API lists `script()` / `scriptPath()` on every object), an agent can plant JS that the app runs with its full global environment (real OS/File), skipping `c3d_run_script`, its lint, its confirm and the sandbox. Also check whether `obj.script()` / `doc.document()` / `obj.owner()` inside `c3d_run_script` return objects whose methods expose raw globals. I could not test without the app.
Fix: probe it. If confirmed, deny `SCRIPTTAG` and script-source parameters in `addTag`/`setParameters`, or put them behind the same confirmation as run_script.

### M2. "Never overwrite pre-existing user files" is only soft
- `tools/document.ts:74` + `lib/files.ts:34-37`: `c3d_open_document` of a user `.jas` marks it as session-owned. Then `c3d_save_document` to the same path only needs `confirm:true` (see H2) to overwrite it. This contradicts requirements section 0.1 for the exact case it targets (the user's project).
- Sibling files are unguarded. `c3d_export` obj writes `<name>.mtl` (`tools/document.ts:141-143`, `saveTo` in `bridge/runtime/document.js:38-44`). `services/images.ts:146` writes `<render>.preview.png` / `.preview.jpg`. A pre-existing `foo.mtl` or `foo.preview.png` is silently replaced.
- `c3d_export` takes `format` independent of the file extension (`document.ts:138`). Content (OBJ/DAE text, partly attacker-influenced via object names) can be written to any new path the user can write (for example `~/.zshenv` if absent), and `ensureDir(path.dirname(abs))` (`lib/files.ts:29`) creates arbitrary parent directories. No path confinement to `workDir`.
- TOCTOU: `fs.existsSync` (`lib/files.ts:23`) then a later bridge write. A dangling symlink reports "absent" and the write goes through the link.
Fix: remove `markOpened` for pre-existing files (only files created by the server count as owned); check sibling outputs (`.mtl`, previews); require the extension to match the format; confine outputs to workDir unless an elicited, human-visible path confirmation is given; use `O_EXCL`-style checks in the runtime (`saveTo`/`render` verify `!exists` themselves).

### M3. Guarded `File` reads anywhere, and the read/write test uses a mutable global
- `exec.js:32,40`: `mode !== READ_MODE` compares against the global `READ_MODE`, looked up at call time. If that global is writable in the app, `READ_MODE = WRITE_MODE;` (legal in strict code for an existing global) turns every write into a "read" and the root check is skipped. I could not check writability in the real app (OS/File are non-writable, so constants might be too). Capture `var READ = READ_MODE` at load.
- Reads are allowed everywhere by design, including `MCP/secret`, `~/.ssh`, and every user project. Combined with `value`/`log` coming back to the model this is a confidentiality hole with no prompt unless the regex at `tools/exec.ts:9` matches. `var F = File; new F(p)` evades it. Consider read roots, or at least elicit on any `File` identifier.
- `isWritable` follows symlinks (no `realpath` in JS). Fine unless something plants links under `MCP/tmp`.

### M4. Plugin SessionStart hook runs `npx -y c3d-mcp@0.1.0 doctor` on every session
`plugin/hooks/hooks.json:6` and `plugin/.mcp.json`. If the npm name or version is not owned by the author at install time, anyone can publish `c3d-mcp@0.1.0` and get code execution as the user on every Claude Code startup. Even when owned, there is no integrity pin. Fix: confirm ownership of the name before distribution; prefer a bundled path or a pinned integrity; make the hook opt-in.

### M5. `c3d_run_script` cannot be interrupted
A `while(true){}` (lint is advisory and bypassable with `force`) freezes Cheetah3D's main thread. The deadline is checked only before the run (`core.js:155`). The server times out, but the app stays frozen until force-quit, and unsaved work can be lost. Mitigation: always auto-checkpoint (already done), and document it. Consider an op-count or time guard via cooperative checks in the helper-driven API wrappers (hard in JSC).

## LOW

- L1 `core.js:148,159`: `finish()` sets `ctx.lastSeq = seq` even for a bad-secret request. A same-user (or permission-drifted) writer can drop `9999999999999999-<uuid>.json` with a wrong secret and every later legitimate request is skipped as stale until `state.json` is reset. Fix: only advance `lastSeq` after the secret check passes (or when `seq` is within a sane window of `Date.now()*1000`). Also TIMEOUT and CANCELLED answers are issued before the secret check (harmless).
- L2 `core/paths.ts:73-79`: `ensureMcpDirs` runs `chmod 0700` on a user-supplied `C3D_MCP_DIR` even if it already existed and held other things. Only chmod directories it created, or refuse a non-empty pre-existing root.
- L3 `core/install.ts:257-267`: uninstall always deletes `manifest.macroFile`, even if a user's own file of that name existed before install (install overwrote it; the tar backup exists). Record `existedBefore` and restore or keep. Uninstall `rm -rf` of the whole `mcpDir` is correct only when install created it (it checks), but `workDir` content (renders, exports, checkpoints in `MCP/tmp`) is deleted with it. The command prompt text should say so.
- L4 `core/assets.ts:62` `renderMacroTemplate` escapes quotes/backslashes/non-ASCII but not `\n`, `\r`, U+2028/2029 (the last two are > 0x7f and escaped; `\n` and `\r` are not). A newline in `C3D_MCP_DIR` breaks the macro literal. Env-controlled, same user only.
- L5 `lib/net.ts:17-34`: `fetchJson` has no size cap; `fetchBinary` buffers the full body with `arrayBuffer()` before the size check when `Content-Length` is absent (memory DoS within the 120 s timeout). md5 is verified only if the manifest supplies it (the same server vouches for the hash; SHA-256 is recorded, not pinned). Redirects are rejected, HTTPS-only, host suffix check is sound, `safeRel` is sound. Fix: stream with a running byte counter and abort at the cap; cap JSON at a few MB.
- L6 Helper IPC (`SocketServer.swift`): authorization is only the 0600 socket in a 0700 dir (as documented). No `LOCAL_PEERCRED`/`getpeereid` check, no limit on concurrent connections or in-flight tasks (`dispatch` spawns a `Task` per line), and `captureWindow`/`downscaleImage` accept any absolute `outPath` and overwrite atomically (`Imaging.swift:105,132`). `pressMenu` accepts any menu path (File > Close, etc.). All within the same-user threat model, but adding `getpeereid == geteuid()` is cheap. The socket path itself comes from `--socket`; if it lies in a shared directory only the 0600 mode protects it.
- L7 Helper app discovery (`helperClient.ts:12`): `~/Applications` and `C3D_HELPER_APP` are user-writable. The server launches whatever app is there and trusts its socket replies. Verify the code signature or designated requirement (`codesign --verify -R`) before `open`. Low impact: a rogue helper has no TCC grants, but it can feed fake window/permission data.
- L8 Packaging: Homebrew cask has a placeholder `sha256` (build will fail rather than be unsafe); the cask caveat tells users to strip quarantine. `sign-dev.sh` comments embed a throwaway p12 password (`c3d`) for a local dev cert; not a secret but copy-paste hazard. No secrets found in the repo (regex scan).
- L9 `tools/files.ts` / `assets.ts`: files opened by Cheetah3D (fbx/obj/usdz from Poly Haven or a user path) are parsed by a native importer; that attack surface is out of scope but worth one line in SECURITY.md next to "never executed".
- L10 `describeResult` fallback `String(v)` (`exec.js:97`) also runs user code; covered by the H1 fix.

## Checked and found sound

- No shell interpolation anywhere: every child process uses `execFile` with argument arrays (`platform.ts`, `opener.ts`, `images.ts`, `install.ts`, `helperInstall.ts`). `open -a Cheetah3D <abs path>` takes only absolute paths, so no option injection.
- AppleScript: `PRESS_SCRIPT` / `MENU_SCRIPT` take window titles and menu paths as `argv`, not string-built. No AppleScript injection through titles. Helper `raiseWindow` matches titles by equality.
- Request pipeline order (`core.js:150-166`): deadline, cancel, secret, protocol, expectDocument, all before any op. Request file names are regex-validated (ids are UUIDs), so no traversal into `outbox/`. The replay guard (`seq <= lastSeq`, `.done` exists) works. `resolveRefs` uses `hasOwn`.
- Atomic request writes (tmp, fsync, rename, mode 0600), response verified by length and Adler-32 (acknowledged as non-MAC). Secret is 32 random bytes, 0600, never logged (`logging.ts` scrubs by key and by value, plus any 48+ hex run). Log file 0600, dir 0700, rotation fine.
- Cross-process lock: `wx` create, token-checked release, stale reclaim with re-read; the non-atomicity is documented and tolerated.
- `GuardedFile` write check normalizes `/../`, trailing `/..`, requires absolute paths, uses a slash-terminated prefix (no `/tmpfoo` bypass), and blocks `mkDir`, `copyTo` outside the roots and `open(write)`. `allowFiles` is not reachable from the MCP surface (strict zod schema, only `code` and `allowShellToken` are sent; `allowShellToken` is derived server-side). Constructors (Function, async, generator, async generator) are neutralized during the run; `this` is undefined; `eval`, `Function`, `geval`, `globalThis` are shadowed. I could not find a route to the globals while the sandbox is active (`F_stack`, `this`, async/generator constructors all failed to reach them); H1 is the post-run gap.
- Uninstall: only manifest entries inside `mcpDir` or `macroDir`, explicit refusal of home, support dir, Scripts, MCP-backups and `/`; `MCP-backups` is protected; a manifest whose `mcpDir` differs is refused; non-empty script dirs are kept; `rm` does not follow symlinks.
- Install: tar backup before any change and abort on failure; refuses to clobber a newer runtime; macro and runtime are written atomically.
- Asset import: ids restricted to `[A-Za-z0-9_]`, `safeRel` rejects absolute and `..` paths from the manifest, extension allow-list, HTTPS plus host allow-list with `redirect:'error'`, 100 MB total declared and actual cap, SHA-256 and license sidecar written.
- Helper: socket created with umask 0177 plus `chmod 0600`; refuses to unlink a non-socket path or a live instance; 4 MB line cap; strict argument parsing (`ArgReader.finish`) rejects unknown fields; helper only dismisses modals it registered.
- Stdout is reserved for the protocol; errors never include stacks to the client.
- No TCC database, `tccutil`, or self-grant code found.

## Suggested priority
1. Fix H1 (ordering) and add a regression case to `bridge/tests/cases/40-exec-sandbox.json`.
2. Fix H2 (`confirm` flag vs. elicitation; bind consent to the arguments, show the code).
3. Probe M1 live (SCRIPTTAG and `script()`); decide on a deny-list.
4. Tighten file-ownership semantics (M2) and the `lastSeq` ordering (L1).
