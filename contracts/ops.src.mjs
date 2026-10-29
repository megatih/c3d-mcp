// Source of truth for bridge op argument schemas. `node scripts/gen-contracts.mjs` writes contracts/ops.json.
// Semantics live in docs/PROTOCOL.md §5. Every op: args validated by TS (ajv) before sending and again by the runtime (minimal).

const num = { type: 'number' };
const int = { type: 'integer' };
const str = { type: 'string' };
const bool = { type: 'boolean' };
const vec3 = {
  oneOf: [
    { type: 'object', properties: { x: num, y: num, z: num }, required: ['x', 'y', 'z'], additionalProperties: false },
    { type: 'array', items: num, minItems: 3, maxItems: 3 },
  ],
};
const vec4 = {
  oneOf: [
    { type: 'object', properties: { x: num, y: num, z: num, w: num }, required: ['x', 'y', 'z', 'w'], additionalProperties: false },
    { type: 'object', properties: { r: num, g: num, b: num, a: num }, required: ['r', 'g', 'b'], additionalProperties: false },
    { type: 'array', items: num, minItems: 4, maxItems: 4 },
  ],
};
// An object reference: by session id, path, index path, current selection, or "$alias" of an earlier op in the same batch.
const ref = {
  oneOf: [
    { type: 'object', properties: { id: int }, required: ['id'], additionalProperties: false },
    { type: 'object', properties: { path: str }, required: ['path'], additionalProperties: false },
    { type: 'object', properties: { indexPath: { type: 'array', items: int } }, required: ['indexPath'], additionalProperties: false },
    { type: 'object', properties: { selected: { const: true } }, required: ['selected'], additionalProperties: false },
    { type: 'string', pattern: '^\\$[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z0-9_.]+)?$' },
  ],
};
const refList = { type: 'array', items: ref, minItems: 1, maxItems: 1000 };
const paramValue = { description: 'number | string | boolean | {x,y[,z[,w]]} | {r,g,b,a} | [numbers] | {path} for Texture | {ref} / null for Link' };
const paramMap = { type: 'object', additionalProperties: paramValue };
const transform = {
  type: 'object',
  properties: { position: vec3, rotation: vec3, scale: vec3, space: { enum: ['local', 'world'] } },
  additionalProperties: false,
};
const matRef = {
  oneOf: [
    { type: 'object', properties: { name: str }, required: ['name'], additionalProperties: false },
    { type: 'object', properties: { index: int }, required: ['index'], additionalProperties: false },
    { type: 'string', pattern: '^\\$[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z0-9_.]+)?$' },
  ],
};
const path = { type: 'string', minLength: 1, maxLength: 1024 };

const o = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const ops = {
  // ---- core ----
  ping: { rw: 'R', args: o({ counter: int, echo: str }), summary: 'Echo counter/echo; returns runtime version and timestamps.' },
  capabilities: { rw: 'R', args: o({}), summary: 'Type map (objectTypes, tagTypes, materialTypes, nodeTypes, rotationOrders, renderers, jsFeatures, apiVersion, limits).' },
  getLog: { rw: 'R', args: o({ tail: int, clear: bool }), summary: 'Runtime log ring buffer.' },

  // ---- document ----
  getDocumentInfo: { rw: 'R', args: o({}), summary: 'fileName, fps, time, end, takes, currentTake, renderer, editMode, activeCamera, counts, marker.' },
  setMarker: { rw: 'W', args: o({ uuid: { type: 'string', pattern: '^[0-9a-f-]{36}$' } }, ['uuid']), summary: 'Ensure root-level folder __c3d_mcp_session_<uuid> exists (session marker for untitled docs).' },
  saveTo: { rw: 'W', args: o({ path, type: { enum: ['jas', 'obj', 'fbx', 'dae', 'stl', '3ds', 'usdz', 'gltf', 'glb', 'dxf'] } }, ['path', 'type']), summary: 'doc.saveToFile (copy semantics, does not re-point the document; verified P07).' },
  setTime: { rw: 'W', args: o({ time: num }, ['time']), summary: 'setAnimPosition seconds.' },
  setFps: { rw: 'W', args: o({ fps: { type: 'number', minimum: 1, maximum: 240 } }, ['fps']), summary: 'setAnimationFPS.' },
  takes: {
    rw: 'W',
    args: o({ action: { enum: ['list', 'add', 'rename', 'remove', 'select'] }, name: str, newName: str }, ['action']),
    summary: 'Take management.',
  },

  // ---- scene ----
  sceneStats: { rw: 'R', args: o({ root: ref }), summary: 'Counts: objects by type, polygon/vertex/triangle totals (via core() of every polygon-capable object), materials, tags, folders, lights, cameras. Optional root limits to a subtree.' },
  listScene: {
    rw: 'R',
    args: o({ root: ref, depth: { type: 'integer', minimum: 0, maximum: 32 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 2000 }, detail: { enum: ['concise', 'detailed'] } }),
    summary: 'Paged depth-first tree walk. Returns {items:[descriptor...], total, nextOffset|null}.',
  },
  getObject: { rw: 'R', args: o({ ref, include: { type: 'array', items: { enum: ['parameters', 'tags', 'children', 'bbox', 'worldMatrix', 'materials'] } } }, ['ref']), summary: 'Object detail.' },
  createObject: {
    rw: 'W',
    args: o({ type: str, name: str, parent: ref, transform, params: paramMap, lightType: { type: 'integer', minimum: 0, maximum: 4 }, select: bool }, ['type']),
    summary: 'doc.addObject(type) (+ reparent, rename, transform, params). Returns descriptor with the ACTUAL name.',
  },
  deleteObjects: { rw: 'W', args: o({ refs: refList }, ['refs']), summary: 'root-level or parent.removeChild for each ref (detach).' },
  reparent: { rw: 'W', args: o({ ref, parent: ref, index: int, keepWorld: bool }, ['ref', 'parent']), summary: 'addChildAtIndex.' },
  rename: { rw: 'W', args: o({ ref, name: { type: 'string', minLength: 1, maxLength: 255 } }, ['ref', 'name']), summary: 'Set name parameter. Returns actual name.' },
  setTransform: { rw: 'W', args: o({ ref, ...transform.properties }, ['ref']), summary: 'Set local position/rotation(deg)/scale. world space: position only.' },
  getParameters: { rw: 'R', args: o({ ref, tag: o({ index: int, type: str }), names: { type: 'array', items: str } }, ['ref']), summary: 'Typed parameter read for object (or tag via tag:{index}).' },
  setParameters: {
    rw: 'W',
    args: o({ ref, tag: o({ index: int, type: str }), params: paramMap }, ['ref', 'params']),
    summary: 'Typed parameter write for object or one of its tags; unknown parameter -> per-key error list.',
  },
  select: { rw: 'W', args: o({ refs: { type: 'array', items: ref }, extend: bool, restore: bool }, ['refs']), summary: 'selectObject; returns previous selection descriptors.' },

  // ---- tags ----
  addTag: { rw: 'W', args: o({ ref, type: str, params: paramMap }, ['ref', 'type']), summary: 'addTagOfType.' },
  removeTag: { rw: 'W', args: o({ ref, index: int }, ['ref', 'index']), summary: 'removeTag at index.' },

  // ---- geometry ----
  createMesh: {
    rw: 'W',
    args: o(
      {
        name: str,
        parent: ref,
        transform,
        vertices: { type: 'array', items: vec3, minItems: 1, maxItems: 200000 },
        polygons: { type: 'array', items: { type: 'array', items: int, minItems: 3, maxItems: 64 }, minItems: 1, maxItems: 200000 },
        uvs: { type: 'array', items: { type: 'array', items: { type: 'array', items: num, minItems: 2, maxItems: 2 } } },
        material: matRef,
        append: o({ ref }, ['ref']),
      },
      ['vertices', 'polygons'],
    ),
    summary: 'POLYGONOBJ + PolyCore fill with strict validation (finite coords, indices in range, polygon size>=3) BEFORE any addIndexPolygon. `append` continues a chunked build.',
  },
  getMesh: { rw: 'R', args: o({ ref, vertexOffset: int, vertexLimit: int, polygonOffset: int, polygonLimit: int }, ['ref']), summary: 'Paged vertices/polygons/uvs from core().' },
  editMesh: {
    rw: 'W',
    args: o(
      {
        ref,
        setVertices: { type: 'array', items: o({ index: int, position: vec3 }, ['index', 'position']) },
        deletePolygons: { type: 'array', items: int },
        flipWinding: { type: 'array', items: int },
        mergeVertices: num,
      },
      ['ref'],
    ),
    summary: 'In-place edits on an editable polygon object.',
  },
  createSpline: {
    rw: 'W',
    args: o(
      {
        name: str,
        parent: ref,
        transform,
        paths: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              points: { type: 'array', items: { type: 'object', properties: { p: vec3, c1: vec3, c2: vec3 }, required: ['p'], additionalProperties: false } },
              closed: bool,
            },
            required: ['points'],
            additionalProperties: false,
          },
        },
      },
      ['paths'],
    ),
    summary: 'SPLINE object via SplineCore move/line/curve/close.',
  },

  // ---- materials ----
  listMaterials: { rw: 'R', args: o({}), summary: 'Materials with root node type.' },
  createMaterial: { rw: 'W', args: o({ name: str, type: str, params: paramMap }, ['name']), summary: 'addMaterial(type||"Material", name); params applied to rootNode.' },
  setMaterialParams: { rw: 'W', args: o({ material: matRef, node: { type: ['integer', 'null'] }, params: paramMap }, ['material', 'params']), summary: 'Set parameters on a material node (default root).' },
  addMaterialNode: { rw: 'W', args: o({ material: matRef, type: str, params: paramMap }, ['material', 'type']), summary: 'addNodeOfType. Returns node id + io names.' },
  connectNodes: { rw: 'W', args: o({ material: matRef, fromNode: int, fromPara: str, toNode: int, toPara: str }, ['material', 'fromNode', 'fromPara', 'toNode', 'toPara']), summary: 'addConnection(fromID,fromPara,toID,toPara).' },
  getMaterialGraph: { rw: 'R', args: o({ material: matRef }, ['material']), summary: 'Nodes, params, connections.' },
  assignMaterial: { rw: 'W', args: o({ ref, material: matRef, replaceExisting: bool, polygons: { type: 'array', items: int, minItems: 1, maxItems: 200000 }, slot: { type: 'integer', minimum: 1, maximum: 24 } }, ['ref', 'material']), summary: 'SHADERTAG + material link: whole object, or only `polygons` (an editable polygon object; uses polygon-selection slot 1..24 and shadeSelection = slot+1).' },
  setTexture: { rw: 'W', args: o({ material: matRef, node: int, param: str, path }, ['material', 'param', 'path']), summary: 'setParameter(texture param, absolute path).' },
  removeMaterial: { rw: 'W', args: o({ material: matRef }, ['material']), summary: 'doc.removeMaterial.' },

  // ---- camera ----
  setActiveCamera: { rw: 'W', args: o({ ref }, ['ref']), summary: 'camera.setParameter("activeCamera",1) (P32).' },

  // ---- animation ----
  setKeyframes: {
    rw: 'W',
    args: o(
      {
        ref,
        param: str,
        take: str,
        replace: bool,
        keys: {
          type: 'array',
          items: o({ time: num, value: { oneOf: [num, vec3, vec4] }, interpolation: { enum: ['linear', 'soft', 'spline', 'flat', 'const'] } }, ['time', 'value']),
          minItems: 1,
        },
      },
      ['ref', 'param', 'keys'],
    ),
    summary: 'FCurve recipe (P14): one FCurve per component; update() always.',
  },
  getKeyframes: { rw: 'R', args: o({ ref, param: str, take: str }, ['ref', 'param']), summary: 'Per-component keys.' },
  removeKeyframes: { rw: 'W', args: o({ ref, param: str, take: str }, ['ref', 'param']), summary: 'removeAllKeys on every component.' },

  // ---- render ----
  setRenderSettings: {
    rw: 'W',
    args: o({ renderer: { enum: ['CHEETAH', 'FALCON'] }, width: int, height: int, params: paramMap }),
    summary: 'currentRenderer().setParameter (resolution via Vec2D). Returns resulting values.',
  },
  render: {
    rw: 'W',
    args: o({ path: { type: 'string', pattern: '\\.(png|jpg|tiff)$' }, time: num }, ['path']),
    summary: 'doc.render(path); extension MUST be png/jpg/tiff (anything else raises a blocking modal).',
  },

  // ---- exec ----
  run: {
    rw: 'W',
    args: o({ code: { type: 'string', maxLength: 200000 }, allowShellToken: str, allowFiles: { type: 'array', items: path } }, ['code']),
    summary: 'Sandboxed user JS (PRD §4 exec). print() output returned.',
  },
};

export const errorCodes = {
  APP_NOT_RUNNING: 'Cheetah3D is not running.',
  APP_CRASHED: 'Cheetah3D exited while a request was in flight.',
  APP_BUSY: 'Cheetah3D is busy (long operation); retry later.',
  TRIGGER_FAILED: 'The bridge macro could not be triggered (menu disabled, modal open, bridge not installed or menu not refreshed).',
  BLOCKED_BY_MODAL: 'A dialog is open in Cheetah3D.',
  WRONG_DOCUMENT: 'The front document is not the expected one.',
  VERSION_SKEW: 'Protocol/runtime version mismatch; run `c3d-mcp install`.',
  BRIDGE_NOT_INSTALLED: 'Bridge macro/runtime not installed.',
  PERMISSION_MISSING: 'Accessibility or Screen Recording permission missing.',
  NOT_FOUND: 'Object/material/node/parameter not found.',
  AMBIGUOUS: 'Reference matches several objects; use id.',
  INVALID_ARGUMENT: 'Argument failed validation.',
  UNSUPPORTED: 'Not supported by Cheetah3D 8.1.3 or not yet verified.',
  SCRIPT_ERROR: 'JavaScript error inside Cheetah3D.',
  LINT_BLOCKED: 'Script blocked by lint rules.',
  CONFIRMATION_REQUIRED: 'Destructive action needs confirm:true or user elicitation.',
  TIMEOUT: 'Request deadline exceeded.',
  CANCELLED: 'Request cancelled.',
  RUNTIME_STUCK: 'Runtime reports busy for too long while the app responds.',
  DEPENDENCY_FAILED: 'An earlier op this op depends on failed.',
  NOT_AVAILABLE_IN_PROFILE: 'Tool disabled in the active profile.',
  PARSE_ERROR: 'Malformed JSON from the bridge.',
  INTERNAL: 'Unexpected internal error.',
};
