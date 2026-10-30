# c3d-mcp bridge protocol (authoritative implementation spec)

Supersedes research/03 and refines requirements section 3–§4 with M0 probe results (research/08). Schemas: `contracts/*.json`.
If this document and the requirements disagree, this document wins (and the requirements changelog records it).

## 1. Directory layout (`MCP_DIR = ~/Library/Application Support/Cheetah3D/MCP`, mode 0700, created by Node/Swift only)
```
inbox/   outbox/   cancel/   runtime/   log/   tmp/   state.json   secret(0600)   helper.sock(0600)   lock
```
`runtime/` holds the installed runtime (`index.js` + modules, concatenated into one file `runtime.js` at install; the macro reads `runtime/runtime.js`).
The loader macro is installed at `~/Library/Application Support/Cheetah3D/Scripts/Macro/C3D-MCP/C3D-MCP Bridge.js`.

## 2. Probe-derived platform facts every component must respect
1. **Trigger needs Cheetah3D active.** The menu item `Tools › Script › Macro Script › C3D-MCP › C3D-MCP Bridge.js` is `AXEnabled=0` and presses are silently dropped unless Cheetah3D is the frontmost app **and** a document window is key (Render Manager/other panels as key window also disable it). Press sequence: remember frontmost app → activate Cheetah3D → `AXRaise` the target document window → wait until the item `AXEnabled==1` (≤2 s, poll 25 ms) → press → wait for completion → restore previous frontmost app. Newly installed macros appear only after a Cheetah3D **restart** (no Update Menu).
2. **I/O is ASCII-only.** `File.write` truncates non-ASCII; `File.read(n)` is byte≙char. Every JSON file read/written by the runtime is ASCII with all code points ≥ 0x7F escaped `\uXXXX`. Server writes requests the same way (JSON.stringify + replace) and decodes responses with plain `JSON.parse`.
3. `File.contentOfDir()` → array of bare names (sorted, includes dotfiles and `.tmp`). `open(WRITE_MODE)` truncates. No rename/delete/mkdir from JS (mkDir is BANNED).
4. `parameterInfo()` → `[[name, typeString]]` with type strings `String Bool Int Float Vec2D Vec3D Vec4D Texture Link` (`unknown` for the renderer `resolution` = Vec2D). Vec values read via `.x .y .z .w`; Texture value = path string; Link value = object or undefined.
5. Objects are NOT name-uniquified; materials are (`name.2`). `obj.id()` is a stable integer per object (survives rename) → the primary handle (`{id}` ref). `doc.addObject` attaches the new object under the parent of the currently selected object (research/10 B4); the runtime therefore re-parents every created object explicitly.
6. `doc.render(path)`: png|jpg|tiff only (other extension ⇒ blocking modal!). Synchronous. May open the Render Manager window.
7. `saveToFile(path,type)` does not re-point the document; types: jas obj fbx dae stl 3ds usdz gltf glb dxf (obj also writes `.mtl`). Untitled documents: `fileName()` is `undefined`.
8. `open -a Cheetah3D file` opens obj/fbx/dae/stl/3ds/usdz/dxf as a NEW document window; **glb/gltf are not supported** (modal). Menu "undo" does not revert macro changes.
9. Dialogs are `AXWindow` with `AXSubrole=AXDialog` (not sheets): text in child `AXStaticText`, button `AXButton "OK"`.
10. Keyframes: `prm=obj.parameterWithName(n)`, `tn=prm.takeNodeWithName(take.name)||prm.addTakeNode(take.name)`, `fc=tn.fCurveAtIndex(component)`, `k=new FCurveKey(); k.time; k.value; fc.addKey(k); fc.update()`. Interpolation constants `LINEAR_INTERPOL=1 SOFT_INTERPOL=0 SPLINE_INTERPOL=2 FLAT_INTERPOL=2 CONST_INTERPOL=3` (`k.left_type/right_type`).
11. Active camera switching: `cam.setParameter('activeCamera',1)`.
12. Lights: `addObject(LIGHT)` + Int `lightType` 0..4 (SPOTLIGHT etc. do not exist). Constants missing at runtime must never be referenced bare (use `typeof`).
13. Do NOT add a `BAKETAG` to a non-polygon object (modal). Do not pass bad polygon indices (fatal).

## 3. Request / response files
* Request `inbox/<seq>-<uuid>.json` (written `.json.tmp`, fsync, rename). `seq` = 16 digits `Date.now()*1000 + (counter%1000)` zero-padded (Date.now()*1000 ≈ 1.8e15 → 16 digits). Filename regex: `^\d{16}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$`.
* Response `outbox/<id>.json` then marker `outbox/<id>.done` containing `{"bytes":N,"checksum":"<adler32 hex8>"}` of the response text. Server reads the JSON only after `.done` and when `bytes`/checksum match (else re-read for ≤1 s, then `PARSE_ERROR`).
* Runtime order per request (all checks BEFORE any op): skip if `outbox/<id>.done` exists or `seq <= state.lastSeq` → `now > deadlineAt` ⇒ `TIMEOUT` response / `cancel/<id>` exists ⇒ `CANCELLED` response → `secret` mismatch ⇒ `ok:false, error.code=INTERNAL` message "bad secret" (no ops) → `protocol != 1` ⇒ `VERSION_SKEW` → `expectDocument` mismatch ⇒ `WRONG_DOCUMENT` → run ops (retainRedrawLock … finally releaseRedrawLock; `doc.redrawAll()` if any write op ran) → write outbox json, `.done`, update `lastSeq`.
* Drain cap: 25 requests or 8 s per macro run; `state.json` written at start (`busy:true`) and end (`busy:false,lastSeq`). A run with an empty inbox still updates state (used by ping/health).
* `expectDocument`: `{fileName}` compared with `doc.fileName()`; `{marker}` ⇒ a root-level child named `marker` must exist. Both given ⇒ both must match.
* Batch refs: op `as:"a"` stores the op's result; later args may contain `"$a"` or `"$a.path.to.field"` (anywhere a ref/matRef/int is expected, or as a whole string value). Object-creating ops return `{ref:{id}, ...descriptor}`; `"$a"` used as an object ref resolves to `result.ref` if present. If the referenced op failed ⇒ `DEPENDENCY_FAILED`.
* Server deletes `inbox/<req>` FIRST, then `outbox/<id>.json`, `.done`, `cancel/<id>`.

## 4. Value encoding (runtime ↔ JSON)
* Vec2D `{x,y}`, Vec3D `{x,y,z}`, Vec4D `{x,y,z,w}` on output. Input also accepts arrays and Vec4D `{r,g,b,a}` (a defaults 1).
* Texture ↔ string path (`""` = none). Link ↔ `{id,name}` or `null`; input `{ref}` or `null`. Gradient/FloatArray/unknown → `{unsupported:true}` and writes rejected with `UNSUPPORTED`.
* Object descriptor: `{id, name, path, indexPath, type:"BOX", typeId:1, family:5, childCount, tagCount, visible?}`; `path` = `/A/B` (names escaped: `\/` for `/`, `\\` for `\`). Duplicate names do not change `path`; refs by path that match >1 object ⇒ `AMBIGUOUS` with `details.candidates:[descriptor...]`.
* Type names: strings from capabilities (`BOX`, `CAMERA`, `LIGHT`, tag names `SHADERTAG`…); unknown ids → `TYPE_<n>`.
* Rotation is in **degrees**, order = object `rotorder` (default 6 = HPB).

## 5. Ops
Args schemas: `contracts/ops.json`. Result shapes (all `ok:true` results are plain JSON objects):

| op | result |
|---|---|
| ping | `{counter, echo, runtimeVersion, now, jsc:true, stateBusy}` |
| capabilities | `{apiVersion:"8.1.3", runtimeVersion, protocol, objectTypes:{NAME:id}, tagTypes:{...}, materialTypes:["Material","Material (PBR)","Toon","Glass","Shadowmat"], nodeTypes:[...], rotationOrders:{...}, renderers:["CHEETAH","FALCON"], renderFormats:["png","jpg","tiff"], saveTypes:[...], lightTypes:{ambient:0,area:1,distant:2,point:3,spot:4}, interpolation:{...}, jsFeatures:{...}, limits:{drainRequests:25,drainSeconds:8}}` |
| getLog | `{lines:[...]}` |
| getDocumentInfo | `{fileName|null, fps, time, end, takeCount, currentTake, renderer, editMode, activeCamera:{id,name}, objectCount, materialCount, marker|null}` |
| setMarker | `{marker, created}` |
| saveTo | `{path, type, size}` (verifies the file exists after) |
| setTime / setFps | `{time}` / `{fps}` |
| takes | list: `{takes:[{name,length}], current}`; others `{takes,current}` |
| listScene | `{items:[descriptor+{depth, position?, rotation?, scale?, tags?:[...]}], total, nextOffset}` |
| getObject | descriptor + requested `include` sections |
| createObject | `{ref:{id}, ...descriptor}` (actual name) |
| deleteObjects | `{removed:N, ids:[...]}` — each ref removed from its parent; children go with it |
| reparent / rename / setTransform | updated descriptor (+ `transform` for setTransform) |
| getParameters | `{ref, parameters:[{name,type,value}]}` |
| setParameters | `{applied:[names], errors:[{name,code,message}]}` (partial success allowed; `ok:true` iff no errors) |
| select | `{previous:[descriptor...], selected:[descriptor...]}` |
| addTag / removeTag | `{tagIndex, type, tags:[{index,type}]}` |
| createMesh | `{ref, vertexCount, polygonCount, ...descriptor}` |
| getMesh | `{vertices:[[x,y,z]...], polygons:[[...]...], uvs?, vertexCount, polygonCount, nextVertexOffset, nextPolygonOffset}` |
| editMesh | `{vertexCount, polygonCount}` |
| createSpline | `{ref, pathCount, ...descriptor}` |
| listMaterials | `{materials:[{index,name,rootNodeType,nodeCount}]}` |
| createMaterial | `{index, name (actual), rootNodeType, rootNodeId}` |
| setMaterialParams | `{applied, errors}` |
| addMaterialNode | `{nodeId, type, inputs:[names], outputs:[names]}` |
| connectNodes | `{connected:true}` |
| getMaterialGraph | `{name, nodes:[{id,type,params:[{name,type,value}],inputs,outputs}], connections:[...]|"unavailable"}` |
| assignMaterial | `{tagIndex, material}`; with `polygons`: `{tagIndex, material, slot, polygons}` |
| setTexture / removeMaterial | `{path}` / `{removed:true}` |
| setActiveCamera | `{activeCamera:{id,name}}` |
| setKeyframes | `{param, components:[{index,keyCount}], take}` |
| getKeyframes | `{param, take, components:[{index, keys:[{time,value,interpolation}]}]}` |
| removeKeyframes | `{removed:N}` |
| setRenderSettings | `{renderer, resolution:{x,y}, applied, errors}` |
| render | `{path, exists, size, width, height}` (width/height from renderer resolution) |
| run | `{value, log:[...], returned:"json-able"|null}`; errors → `SCRIPT_ERROR` with `details:{message,line,stack?}` |

Write ops that change geometry/scene call `update()` on touched objects.
Mesh validation (createMesh): all numbers finite, every index integer in `[0,vertexCount)`, polygon size in `[3,64]`, no duplicate index within a polygon; violation ⇒ `INVALID_ARGUMENT` with `details.polygon`.

## 6. Helper IPC (`helper.sock`, JSON lines; schema `contracts/helper-ipc.schema.json`)
Commands and `result` shapes:
* `ping` → `{version, pid}`; `status` → `{cheetah:{running,pid,frontmost,version,responsive}, bridgeMenuPresent, modal|null, windows:[...], permissions}`.
* `permissions` → `{accessibility:bool, screenRecording:bool}`.
* `windows` → `[{title, role, subrole, main, focused, minimized, document?}]`.
* `modalState` → `{open:bool, dialogs:[{title, text, buttons:[...] , own:bool}]}`.
* `raiseWindow {title}`; `newDocument` → `{title}`; `launchApp` → `{pid}` (waits ≤30 s for AX menu bar).
* `pressBridge {requireDocTitle?, timeoutMs, menuPath?:[...]}` → performs the §2.1 sequence; `{pressed:true, activatedMs}` or error `TRIGGER_FAILED|BLOCKED_BY_MODAL|APP_NOT_RUNNING|PERMISSION_MISSING` (details = AX facts).
* `pressMenu {path:[...], timeoutMs}` → same sequence for any menu path.
* `listMenus` → menu tree (as research/raw/menus.json).
* `captureWindow {title?, outPath, crop?}` (ScreenCaptureKit); `analyzeImage {path}` → `{width,height,blank,meanLuma,histogram:[...]}` (ImageIO/CoreGraphics luma statistics; no Vision); `downscaleImage {path,outPath,maxDim,maxBytes}` (ImageIO; keeps PNG, falls back to JPEG).
* `dismissOwnModal {text}` clicks OK only on a dialog whose text contains `text` and which the helper registered as its own.
Helper sets AX messaging timeout 1 s; `kAXErrorCannotComplete` after a press ⇒ treated as dispatched.

## 7. Server internals contract (TypeScript)
```ts
interface BridgeClient {
  run(ops: {op:string; args?:object; as?:string}[], opts?: {expectDocument?:ExpectDoc; deadlineMs?:number; signal?:AbortSignal; onProgress?:(m:string)=>void}): Promise<BridgeResponse>; // throws BridgeError(code,...) for request-level failures
  one<T=any>(op:string, args?:object, opts?): Promise<T>;   // run single op; throws BridgeError if op failed
}
```
Tool handlers never touch files/sockets directly. A `FakeBridge` (tests) implements `BridgeClient` with canned results.

## 8. Versioning
`protocol` = 1. `runtimeVersion` semver from `bridge/runtime/VERSION`; the server refuses a mismatch of **major**; minor/patch skew gives a warning in `c3d_doctor`.
