/* materials: material list/create/params, node graph, assignment via SHADERTAG, textures. */
C3D.materials = (function () {
  var U = C3D.util, P = C3D.params, CAP = C3D.capabilities, S = C3D.scene;

  function matName(m) { return P.nameOf(m); }

  function resolve(ctx, ref) {
    var doc = ctx.doc, n = doc.materialCount(), i;
    if (typeof ref === 'string') { U.fail('INVALID_ARGUMENT', 'unresolved reference ' + ref + ' (no earlier op with that alias)'); }
    if (!U.isObject(ref)) { U.fail('INVALID_ARGUMENT', 'material reference must be {name} or {index}'); }
    if (U.isInt(ref.index)) {
      if (ref.index < 0 || ref.index >= n) { U.fail('NOT_FOUND', 'no material at index ' + ref.index, { materialCount: n }); }
      return doc.materialAtIndex(ref.index);
    }
    if (typeof ref.name === 'string') {
      for (i = 0; i < n; i++) { if (matName(doc.materialAtIndex(i)) === ref.name) { return doc.materialAtIndex(i); } }
      U.fail('NOT_FOUND', 'no material named ' + ref.name, { name: ref.name });
    }
    return U.fail('INVALID_ARGUMENT', 'material reference must be {name} or {index}');
  }

  function node(mat, id) {
    var n;
    if (id === undefined || id === null) { return mat.rootNode(); }
    if (!U.isInt(id)) { U.fail('INVALID_ARGUMENT', 'node must be an integer node id or null'); }
    try { n = mat.nodeWithID(id); } catch (e) { n = null; }
    if (!n) { U.fail('NOT_FOUND', 'no node with id ' + id, { node: id }); }
    return n;
  }

  function ioNames(n, kind) {
    var count = n[kind + 'Count'](), out = [], i, p;
    for (i = 0; i < count; i++) {
      p = n[kind + 'AtIndex'](i);
      out.push(typeof p.name === 'function' ? p.name() : p.name);
    }
    return out;
  }

  // Cheetah3D 8.1.3 aborts (stack smash in buildMaterialArray) with many material tags on one object: 24 were fine, 30 crashed
  // (research/10 B23). Refuse to add more than 24 SHADERTAGs to an object.
  var MAX_SHADER_TAGS = 24;
  function guardShaderTagCount(obj) {
    var n = 0, i, t = CAP.constant('SHADERTAG');
    for (i = 0; i < obj.tagCount(); i++) { if (obj.tagAtIndex(i).type() === t) { n++; } }
    if (n >= MAX_SHADER_TAGS) { U.fail('UNSUPPORTED', 'this object already has ' + n + ' material tags; Cheetah3D 8.1.3 crashes with many more (tested up to 24)', { shaderTags: n, max: MAX_SHADER_TAGS }, 'reuse materials, split the object, or remove material tags first'); }
  }

  // Whole-object shader tag: reuse the first one when replacing, else append a new tag.
  function assign(ctx, obj, mat, replace) {
    var tag = null, index = -1, i, t = CAP.constant('SHADERTAG');
    if (replace) {
      for (i = 0; i < obj.tagCount() && !tag; i++) {
        if (obj.tagAtIndex(i).type() === t && !obj.tagAtIndex(i).getParameter('shadeSelection')) { tag = obj.tagAtIndex(i); index = i; }
      }
    }
    if (!tag) { guardShaderTagCount(obj); tag = obj.addTagOfType(t); index = obj.tagCount() - 1; }
    tag.setParameter('material', mat);
    tag.update();
    obj.update();
    return index;
  }

  // Per-polygon material (live probe P31, verified by render): a SHADERTAG whose shadeSelection is N applies to the polygons of
  // polygon-selection slot N-1 (0 = whole object). Slot 0 is left to the user, so slots 1..24 (shadeSelection 2..25) are allocated here.
  function assignPolygons(ctx, obj, mat, polys, wantedSlot) {
    var core, n, set = {}, i, slot, p, empty, tag, t = CAP.constant('SHADERTAG');
    try { core = obj.core(); n = core.polygonCount(); } catch (e) { n = 0; }
    if (!n) { U.fail('UNSUPPORTED', 'per-polygon materials need an editable polygon object', undefined, 'run c3d_make_editable first or build the object with c3d_create_mesh'); }
    if (!Array.isArray(polys) || !polys.length) { U.fail('INVALID_ARGUMENT', 'polygons must be a non-empty array of polygon indices'); }
    for (i = 0; i < polys.length; i++) {
      if (typeof polys[i] !== 'number' || polys[i] !== Math.floor(polys[i]) || polys[i] < 0 || polys[i] >= n) { U.fail('INVALID_ARGUMENT', 'polygon index out of range', { index: polys[i], polygonCount: n }); }
      set[polys[i]] = true;
    }
    if (wantedSlot !== undefined) { slot = wantedSlot; }
    else {
      for (slot = 1; slot <= 24; slot++) {
        core.setActivePolygonSelection(slot); empty = true;
        for (p = 0; p < n && empty; p++) { if (core.polygonSelection(p)) { empty = false; } }
        if (empty) { break; }
      }
      if (slot > 24) { core.setActivePolygonSelection(0); U.fail('UNSUPPORTED', 'all 24 polygon-selection slots of this object are in use'); }
    }
    if (typeof slot !== 'number' || slot < 1 || slot > 24 || slot !== Math.floor(slot)) { U.fail('INVALID_ARGUMENT', 'slot must be an integer 1..24'); }
    core.setActivePolygonSelection(slot);
    for (p = 0; p < n; p++) { core.setPolygonSelection(p, !!set[p]); }
    core.setActivePolygonSelection(0);
    guardShaderTagCount(obj);
    tag = obj.addTagOfType(t);
    tag.setParameter('material', mat);
    tag.setParameter('shadeSelection', slot + 1);
    tag.update();
    obj.update();
    return { tagIndex: obj.tagCount() - 1, slot: slot, polygons: polys.length };
  }

  function def(name, rw, fn) { C3D.core.define(name, rw, fn); }

  def('listMaterials', 'R', function (ctx) {
    var out = [], n = ctx.doc.materialCount(), i, mat;
    for (i = 0; i < n; i++) {
      mat = ctx.doc.materialAtIndex(i);
      out.push({ index: i, name: matName(mat), rootNodeType: mat.rootNode().nodeType(), nodeCount: mat.nodeCount() });
    }
    return { materials: out };
  });

  def('createMaterial', 'W', function (ctx, a) {
    var mat, root, outcome = { errors: [] };
    S.checkName(a.name, 'name');
    mat = ctx.doc.addMaterial(a.type === undefined ? 'Material' : a.type, a.name);
    root = mat.rootNode();
    if (a.params) { outcome = P.apply(ctx, root, a.params); root.update(); }
    return S.paramErrors({ index: ctx.doc.materialCount() - 1, name: matName(mat), rootNodeType: root.nodeType(), rootNodeId: root.id() }, outcome);
  });

  def('setMaterialParams', 'W', function (ctx, a) {
    var n = node(resolve(ctx, a.material), a.node), outcome = P.apply(ctx, n, a.params);
    n.update();
    if (outcome.errors.length) { C3D.core.partial(outcome, outcome.errors, Object.keys(a.params).length + ' parameters'); }
    return outcome;
  });

  def('addMaterialNode', 'W', function (ctx, a) {
    var mat = resolve(ctx, a.material), n, outcome = { errors: [] };
    if (typeof a.type !== 'string' || a.type === '') { U.fail('INVALID_ARGUMENT', 'type must be a node type string'); }
    try { n = mat.addNodeOfType(a.type); } catch (e) { n = null; }
    if (!n) { U.fail('INVALID_ARGUMENT', 'cannot create node of type ' + a.type, undefined, 'see capabilities.nodeTypes'); }
    if (a.params) { outcome = P.apply(ctx, n, a.params); n.update(); }
    return S.paramErrors({ nodeId: n.id(), type: n.nodeType(), inputs: ioNames(n, 'input'), outputs: ioNames(n, 'output') }, outcome);
  });

  def('connectNodes', 'W', function (ctx, a) {
    var mat = resolve(ctx, a.material);
    node(mat, a.fromNode);
    node(mat, a.toNode);
    if (mat.addConnection(a.fromNode, a.fromPara, a.toNode, a.toPara) === false) {
      U.fail('INVALID_ARGUMENT', 'Cheetah3D refused the connection', { fromNode: a.fromNode, fromPara: a.fromPara, toNode: a.toNode, toPara: a.toPara });
    }
    mat.rootNode().update();
    return { connected: true };
  });

  // Connection listing relies on Parameter.connected*() which is not probed (research/02); degrade to "unavailable".
  function connectionsOf(mat) {
    var out = [], count = mat.nodeCount(), i, j, n, inp;
    try {
      for (i = 0; i < count; i++) {
        n = mat.nodeAtIndex(i);
        for (j = 0; j < n.inputCount(); j++) {
          inp = n.inputAtIndex(j);
          if (inp.connected()) { out.push({ fromNode: inp.connectedWithID(), fromPara: inp.connectedWithParameter(), toNode: n.id(), toPara: inp.name() }); }
        }
      }
    } catch (e) { return 'unavailable'; }
    return out;
  }

  def('getMaterialGraph', 'R', function (ctx, a) {
    var mat = resolve(ctx, a.material), nodes = [], i, n;
    for (i = 0; i < mat.nodeCount(); i++) {
      n = mat.nodeAtIndex(i);
      nodes.push({ id: n.id(), type: n.nodeType(), params: P.readAll(n), inputs: ioNames(n, 'input'), outputs: ioNames(n, 'output') });
    }
    return { name: matName(mat), nodes: nodes, connections: connectionsOf(mat) };
  });

  def('assignMaterial', 'W', function (ctx, a) {
    var e = S.notRoot(ctx, S.resolve(ctx, a.ref)), mat = resolve(ctx, a.material), r;
    if (a.polygons !== undefined) {
      r = assignPolygons(ctx, e.obj, mat, a.polygons, a.slot);
      return { tagIndex: r.tagIndex, material: matName(mat), slot: r.slot, polygons: r.polygons };
    }
    return { tagIndex: assign(ctx, e.obj, mat, a.replaceExisting !== false), material: matName(mat) };
  });

  def('setTexture', 'W', function (ctx, a) {
    var n = node(resolve(ctx, a.material), a.node), tm = P.typeMap(n);
    if (!U.hasOwn(tm.types, a.param)) { U.fail('NOT_FOUND', 'node has no parameter ' + a.param, { param: a.param }); }
    if (tm.types[a.param] !== 'Texture') { U.fail('INVALID_ARGUMENT', a.param + ' is a ' + tm.types[a.param] + ' parameter, not a Texture'); }
    if (typeof a.path !== 'string' || a.path.charAt(0) !== '/') { U.fail('INVALID_ARGUMENT', 'path must be an absolute path'); }
    if (!U.exists(a.path)) { U.fail('NOT_FOUND', 'texture file does not exist: ' + a.path); }
    n.setParameter(a.param, a.path);
    n.update();
    return { path: String(n.getParameter(a.param)) };
  });

  def('removeMaterial', 'W', function (ctx, a) {
    ctx.doc.removeMaterial(resolve(ctx, a.material));
    return { removed: true };
  });

  return { resolve: resolve, assign: assign };
})();
