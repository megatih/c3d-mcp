/* scene: object addressing, descriptors, paged tree walk, selection, object CRUD ops. */
C3D.scene = (function () {
  var U = C3D.util, P = C3D.params, CAP = C3D.capabilities;
  var DEFAULT_LIST_LIMIT = 500;

  function invalidate(ctx) { ctx.sceneCache = null; }

  function nameOf(obj) {
    var n = obj.getParameter('name');
    return n === undefined || n === null ? '' : String(n);
  }

  function tree(ctx) {
    if (ctx.sceneCache) { return ctx.sceneCache; }
    var rootObj = ctx.doc.root(), cache = { byId: {}, list: [], root: null };
    var rootEntry = { obj: rootObj, id: rootObj.id(), parent: null, indexPath: [], depth: -1, name: '', path: '/', children: [] };
    var stack = [rootEntry], e, i, n, c, entry;
    cache.root = rootEntry;
    cache.byId[rootEntry.id] = rootEntry;
    while (stack.length) {
      e = stack.pop();
      if (e !== rootEntry) { cache.list.push(e); }
      n = e.obj.childCount();
      for (i = 0; i < n; i++) {
        c = e.obj.childAtIndex(i);
        entry = { obj: c, id: c.id(), parent: e, indexPath: e.indexPath.concat([i]), depth: e.depth + 1, name: nameOf(c), path: '', children: [] };
        entry.path = (e.path === '/' ? '' : e.path) + '/' + U.escapeName(entry.name);
        cache.byId[entry.id] = entry;
        e.children.push(entry);
      }
      for (i = e.children.length - 1; i >= 0; i--) { stack.push(e.children[i]); }
    }
    ctx.sceneCache = cache;
    return cache;
  }

  function descriptor(entry) {
    var o = entry.obj, t = o.type();
    return {
      id: entry.id, name: entry.name, path: entry.path, indexPath: entry.indexPath, type: CAP.objectTypeName(t), typeId: t,
      family: o.family(), childCount: o.childCount(), tagCount: o.tagCount()
    };
  }

  function describe(ctx, obj) {
    invalidate(ctx);
    var entry = tree(ctx).byId[obj.id()];
    if (!entry) { U.fail('INTERNAL', 'object not found in scene after creation'); }
    return descriptor(entry);
  }

  function selectedEntries(ctx) {
    var t = tree(ctx), doc = ctx.doc, raw = [], out = [], i, one, e;
    try { raw = doc.selectedObjects(false) || []; } catch (ex) { raw = []; }
    if (!raw.length) { one = doc.selectedObject(); if (one) { raw = [one]; } }
    for (i = 0; i < raw.length; i++) {
      e = t.byId[raw[i].id()];
      if (e && e !== t.root) { out.push(e); }
    }
    return out;
  }

  function candidates(entries) {
    var out = [], i;
    for (i = 0; i < entries.length; i++) { out.push(descriptor(entries[i])); }
    return out;
  }

  function byPath(t, path) {
    var parts = U.splitPath(path), level = [t.root], i, j, k, next, kids;
    for (i = 0; i < parts.length; i++) {
      next = [];
      for (j = 0; j < level.length; j++) {
        kids = level[j].children || [];
        for (k = 0; k < kids.length; k++) { if (kids[k].name === parts[i]) { next.push(kids[k]); } }
      }
      level = next;
    }
    return level;
  }

  function resolveAll(ctx, ref, allowMany) {
    var t = tree(ctx), found, cur, i, sel;
    if (typeof ref === 'string') { U.fail('INVALID_ARGUMENT', 'unresolved reference ' + ref + ' (no earlier op with that alias)'); }
    if (U.isObject(ref) && U.isObject(ref.ref) && ref.id === undefined) { ref = ref.ref; }
    if (!U.isObject(ref)) { U.fail('INVALID_ARGUMENT', 'object reference must be {id}, {path}, {indexPath} or {selected:true}'); }
    if (ref.id !== undefined) {
      if (!U.isInt(ref.id)) { U.fail('INVALID_ARGUMENT', 'ref.id must be an integer'); }
      found = t.byId[ref.id];
      if (!found) { U.fail('NOT_FOUND', 'no object with id ' + ref.id, { ref: ref }); }
      return [found];
    }
    if (ref.path !== undefined) {
      found = byPath(t, ref.path);
      if (!found.length) { U.fail('NOT_FOUND', 'no object at path ' + ref.path, { ref: ref }); }
      if (found.length > 1) { U.fail('AMBIGUOUS', found.length + ' objects match path ' + ref.path, { candidates: candidates(found) }, 'address the object by id'); }
      return found;
    }
    if (ref.indexPath !== undefined) {
      if (!Array.isArray(ref.indexPath)) { U.fail('INVALID_ARGUMENT', 'indexPath must be an array of integers'); }
      cur = t.root;
      for (i = 0; i < ref.indexPath.length; i++) {
        if (!U.isInt(ref.indexPath[i]) || ref.indexPath[i] < 0 || !cur.children || ref.indexPath[i] >= cur.children.length) {
          U.fail('NOT_FOUND', 'no object at indexPath [' + ref.indexPath.join(',') + ']', { ref: ref });
        }
        cur = cur.children[ref.indexPath[i]];
      }
      return [cur];
    }
    if (ref.selected === true) {
      sel = selectedEntries(ctx);
      if (!sel.length) { U.fail('NOT_FOUND', 'nothing is selected'); }
      if (sel.length > 1 && !allowMany) { U.fail('AMBIGUOUS', sel.length + ' objects are selected', { candidates: candidates(sel) }, 'address the object by id'); }
      return sel;
    }
    return U.fail('INVALID_ARGUMENT', 'object reference needs one of id, path, indexPath, selected');
  }

  function resolve(ctx, ref) { return resolveAll(ctx, ref, false)[0]; }

  function resolveMany(ctx, refs) {
    var out = [], i, seen = {}, list, j;
    if (!Array.isArray(refs)) { U.fail('INVALID_ARGUMENT', 'refs must be an array'); }
    for (i = 0; i < refs.length; i++) {
      list = resolveAll(ctx, refs[i], true);
      for (j = 0; j < list.length; j++) { if (!seen[list[j].id]) { seen[list[j].id] = true; out.push(list[j]); } }
    }
    return out;
  }

  function resolveObject(ctx, ref) { return resolve(ctx, ref).obj; }

  function notRoot(ctx, entry) {
    if (entry === tree(ctx).root) { U.fail('INVALID_ARGUMENT', 'the document root cannot be used here'); }
    return entry;
  }

  function parentOrRoot(ctx, ref) { return ref === undefined ? tree(ctx).root : resolve(ctx, ref); }

  function isRootChild(ctx, obj) {
    var r = ctx.doc.root(), id = obj.id(), i;
    for (i = r.childCount() - 1; i >= 0; i--) { if (r.childAtIndex(i).id() === id) { return true; } }
    return false;
  }

  function attach(ctx, obj, parentEntry, index) {
    var parent = parentEntry.obj;
    // Live finding (set_camera): addObject can drop cameras/lights under the previously created folder, so the root case is verified too.
    if (parentEntry !== tree(ctx).root || index !== undefined || !isRootChild(ctx, obj)) {
      parent.addChildAtIndex(obj, index === undefined ? parent.childCount() : index);
    }
  }

  function transformOf(obj) {
    return { position: P.readVec(obj.getParameter('position'), 3), rotation: P.readVec(obj.getParameter('rotation'), 3), scale: P.readVec(obj.getParameter('scale'), 3) };
  }

  function applyTransform(ctx, obj, parentEntry, t) {
    var keys = ['position', 'rotation', 'scale'], i;
    if (!U.isObject(t)) { U.fail('INVALID_ARGUMENT', 'transform must be an object'); }
    if (t.space === 'world' && parentEntry !== tree(ctx).root) {
      U.fail('UNSUPPORTED', 'world-space transforms are only supported for root-level objects', undefined, 'convert to local coordinates');
    }
    if (t.space === 'world' && (t.rotation !== undefined || t.scale !== undefined)) {
      U.fail('UNSUPPORTED', 'world space supports position only');
    }
    for (i = 0; i < keys.length; i++) {
      if (t[keys[i]] !== undefined) { obj.setParameter(keys[i], P.vec3(t[keys[i]], keys[i])); }
    }
    obj.update();
  }

  function create(ctx, typeId, name, parentEntry, a) {
    var obj;
    try { obj = ctx.doc.addObject(typeId); }
    catch (e) { U.fail('UNSUPPORTED', 'doc.addObject failed for type ' + typeId + ': ' + e.message); }
    attach(ctx, obj, parentEntry);
    if (name !== undefined) { obj.setParameter('name', name); }
    if (a && a.transform !== undefined) { applyTransform(ctx, obj, parentEntry, a.transform); }
    return obj;
  }

  function paramErrors(result, outcome) {
    if (outcome.errors.length) { result.paramErrors = outcome.errors; }
    return result;
  }

  function checkName(name, what) {
    if (typeof name !== 'string' || name === '') { U.fail('INVALID_ARGUMENT', what + ' must be a non-empty string'); }
  }

  function tagList(obj) {
    var out = [], i;
    for (i = 0; i < obj.tagCount(); i++) { out.push({ index: i, type: CAP.tagTypeName(obj.tagAtIndex(i).type()) }); }
    return out;
  }

  function def(name, rw, fn) { C3D.core.define(name, rw, fn); }

  def('listScene', 'R', function (ctx, a) {
    var t = tree(ctx), rootEntry = a.root === undefined ? t.root : resolve(ctx, a.root), maxDepth = a.depth === undefined ? 32 : a.depth;
    var offset = a.offset || 0, limit = a.limit || DEFAULT_LIST_LIMIT, detailed = a.detail === 'detailed', i, e, d, items = [], total = 0, base = rootEntry.depth + 1;
    for (i = 0; i < t.list.length; i++) {
      e = t.list[i];
      if (e.depth < base || !isUnder(e, rootEntry) || e.depth - base > maxDepth) { continue; }
      if (total >= offset && items.length < limit) {
        d = descriptor(e);
        d.depth = e.depth - base;
        if (detailed) {
          d.position = P.readVec(e.obj.getParameter('position'), 3);
          d.rotation = P.readVec(e.obj.getParameter('rotation'), 3);
          d.scale = P.readVec(e.obj.getParameter('scale'), 3);
          d.tags = tagList(e.obj);
        }
        items.push(d);
      }
      total++;
    }
    return { items: items, total: total, nextOffset: offset + items.length < total ? offset + items.length : null };
  });

  function isUnder(e, ancestor) {
    var cur = e.parent;
    while (cur) { if (cur === ancestor) { return true; } cur = cur.parent; }
    return false;
  }

  function bbox(obj) {
    var core, n, i, v, min = null, max = null;
    try { core = obj.core(); n = core ? core.vertexCount() : 0; } catch (e) { return null; }
    if (!n) { return null; }
    for (i = 0; i < n; i++) {
      v = core.vertex(i);
      if (!min) { min = { x: v.x, y: v.y, z: v.z }; max = { x: v.x, y: v.y, z: v.z }; continue; }
      min.x = Math.min(min.x, v.x); min.y = Math.min(min.y, v.y); min.z = Math.min(min.z, v.z);
      max.x = Math.max(max.x, v.x); max.y = Math.max(max.y, v.y); max.z = Math.max(max.z, v.z);
    }
    return { min: min, max: max };
  }

  // Rows of the 3x3 part as measured in P15; the translation sits in the LAST COLUMN m03,m13,m23 (probed live, not m30..m32).
  function worldMatrix(obj) {
    var m = obj.obj2WorldMatrix(), rows = [], r, c;
    for (r = 0; r < 3; r++) { rows.push([]); for (c = 0; c < 3; c++) { rows[r].push(m['m' + r + c]); } }
    return { rows: rows, position: { x: m.m03, y: m.m13, z: m.m23 } };
  }

  function materialsOf(obj) {
    var tags = obj.materialTags(), out = [], i, link;
    for (i = 0; i < tags.length; i++) {
      link = tags[i].getParameter('material');
      out.push({ material: link ? P.nameOf(link) : null, tagType: 'SHADERTAG' });
    }
    return out;
  }

  def('getObject', 'R', function (ctx, a) {
    var e = resolve(ctx, a.ref), inc = a.include || [], d = descriptor(e), i, kids, j;
    for (i = 0; i < inc.length; i++) {
      switch (inc[i]) {
        case 'parameters': d.parameters = P.readAll(e.obj); break;
        case 'tags': d.tags = tagList(e.obj); break;
        case 'children':
          kids = e.children || []; d.children = [];
          for (j = 0; j < kids.length; j++) { d.children.push(descriptor(kids[j])); }
          break;
        case 'bbox': d.bbox = bbox(e.obj); break;
        case 'worldMatrix': d.worldMatrix = worldMatrix(e.obj); break;
        case 'materials': d.materials = materialsOf(e.obj); break;
        default: U.fail('INVALID_ARGUMENT', 'unknown include section ' + inc[i]);
      }
    }
    return d;
  });

  def('createObject', 'W', function (ctx, a) {
    var typeId = CAP.objectTypeId(a.type), parentEntry = parentOrRoot(ctx, a.parent), obj, outcome = { errors: [] }, result;
    if (a.lightType !== undefined && typeId !== CAP.constant('LIGHT')) { U.fail('INVALID_ARGUMENT', 'lightType is only valid for LIGHT objects'); }
    if (a.name !== undefined) { checkName(a.name, 'name'); }
    obj = create(ctx, typeId, a.name, parentEntry, a);
    if (a.lightType !== undefined) { obj.setParameter('lightType', a.lightType); }
    if (a.params) { outcome = P.apply(ctx, obj, a.params); }
    obj.update();
    if (a.select) { ctx.doc.selectObject(obj, false); }
    result = describe(ctx, obj);
    result.ref = { id: result.id };
    return paramErrors(result, outcome);
  });

  def('deleteObjects', 'W', function (ctx, a) {
    var entries = resolveMany(ctx, a.refs), ids = [], i, e;
    for (i = 0; i < entries.length; i++) { notRoot(ctx, entries[i]); }
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      e.parent.obj.removeChild(e.obj);
      e.parent.obj.update();
      ids.push(e.id);
    }
    return { removed: ids.length, ids: ids };
  });

  def('reparent', 'W', function (ctx, a) {
    var e = notRoot(ctx, resolve(ctx, a.ref)), p = resolve(ctx, a.parent), t = tree(ctx);
    if (p === e || isUnder(p, e)) { U.fail('INVALID_ARGUMENT', 'cannot move an object into itself or its descendants'); }
    if (a.index !== undefined && (!U.isInt(a.index) || a.index < 0 || a.index > p.obj.childCount())) { U.fail('INVALID_ARGUMENT', 'index out of range'); }
    if (a.keepWorld && (e.parent !== t.root || p !== t.root)) {
      U.fail('UNSUPPORTED', 'keepWorld is only supported between root-level parents', undefined, 'the object keeps its local transform');
    }
    p.obj.addChildAtIndex(e.obj, a.index === undefined ? p.obj.childCount() : a.index);
    e.obj.update();
    return describe(ctx, e.obj);
  });

  def('rename', 'W', function (ctx, a) {
    var e = notRoot(ctx, resolve(ctx, a.ref));
    checkName(a.name, 'name');
    e.obj.setParameter('name', a.name);
    e.obj.update();
    return describe(ctx, e.obj);
  });

  def('setTransform', 'W', function (ctx, a) {
    var e = notRoot(ctx, resolve(ctx, a.ref)), d;
    applyTransform(ctx, e.obj, e.parent, { position: a.position, rotation: a.rotation, scale: a.scale, space: a.space });
    d = describe(ctx, e.obj);
    d.transform = transformOf(e.obj);
    return d;
  });

  def('getParameters', 'R', function (ctx, a) {
    var e = resolve(ctx, a.ref), target = e.obj;
    if (a.tag) { target = tagAt(e.obj, a.tag.index); }
    return { ref: { id: e.id }, parameters: P.readAll(target, a.names) };
  });

  function tagAt(obj, index) {
    if (!U.isInt(index) || index < 0 || index >= obj.tagCount()) { U.fail('NOT_FOUND', 'no tag at index ' + index, { tagCount: obj.tagCount() }); }
    return obj.tagAtIndex(index);
  }

  def('setParameters', 'W', function (ctx, a) {
    var e = resolve(ctx, a.ref), target = e.obj, tag, outcome;
    if (a.tag) {
      tag = tagAt(e.obj, a.tag.index);
      if (a.tag.type !== undefined && CAP.tagTypeName(tag.type()) !== String(a.tag.type).toUpperCase()) {
        U.fail('INVALID_ARGUMENT', 'tag ' + a.tag.index + ' is ' + CAP.tagTypeName(tag.type()) + ', not ' + a.tag.type);
      }
      target = tag;
    }
    outcome = P.apply(ctx, target, a.params);
    target.update();
    if (target !== e.obj) { e.obj.update(); }
    if (outcome.errors.length) { C3D.core.partial(outcome, outcome.errors, Object.keys(a.params).length + ' parameters'); }
    return outcome;
  });

  def('select', 'W', function (ctx, a) {
    var doc = ctx.doc, previous = candidates(selectedEntries(ctx)), entries = a.refs.length ? resolveMany(ctx, a.refs) : [], i;
    if (!entries.length && !a.extend) { doc.selectObject(doc.root(), false); }
    for (i = 0; i < entries.length; i++) { doc.selectObject(entries[i].obj, i === 0 ? !!a.extend : true); }
    invalidate(ctx);
    return { previous: previous, selected: candidates(selectedEntries(ctx)) };
  });

  def('addTag', 'W', function (ctx, a) {
    var e = resolve(ctx, a.ref), typeId = CAP.tagTypeId(a.type), tag, outcome = { errors: [] };
    if (typeId === CAP.constant('BAKETAG') && e.obj.family() !== CAP.constant('NGONFAMILY')) {
      U.fail('INVALID_ARGUMENT', 'BAKETAG can only be added to polygon objects', undefined, 'a BAKETAG on another object type raises a blocking modal (P24)');
    }
    tag = e.obj.addTagOfType(typeId);
    if (a.params) { outcome = P.apply(ctx, tag, a.params); }
    tag.update();
    e.obj.update();
    return paramErrors({ tagIndex: e.obj.tagCount() - 1, type: CAP.tagTypeName(typeId), tags: tagList(e.obj) }, outcome);
  });

  def('removeTag', 'W', function (ctx, a) {
    var e = resolve(ctx, a.ref), tag = tagAt(e.obj, a.index), type = CAP.tagTypeName(tag.type());
    e.obj.removeTag(tag);
    e.obj.update();
    return { tagIndex: a.index, type: type, tags: tagList(e.obj) };
  });

  return {
    invalidate: invalidate, tree: tree, descriptor: descriptor, describe: describe, resolve: resolve, resolveMany: resolveMany, resolveObject: resolveObject,
    parentOrRoot: parentOrRoot, create: create, attach: attach, selectedEntries: selectedEntries, notRoot: notRoot, isUnder: isUnder,
    checkName: checkName, tagList: tagList, paramErrors: paramErrors
  };
})();
