/* params: typed parameter get/set keyed by the parameterInfo() type strings (P16). */
C3D.params = (function () {
  var U = C3D.util;
  var VEC_SIZE = { Vec2D: 2, Vec3D: 3, Vec4D: 4 };
  var AXES = ['x', 'y', 'z', 'w'];
  var COLOR_AXES = ['r', 'g', 'b', 'a'];

  // The renderer reports its Vec2D "resolution" as type "unknown".
  function effectiveType(name, type) { return (type === 'unknown' && name === 'resolution') ? 'Vec2D' : type; }

  function typeMap(base) {
    var info = base.parameterInfo(), map = {}, order = [], i;
    for (i = 0; i < info.length; i++) {
      map[info[i][0]] = effectiveType(info[i][0], info[i][1]);
      order.push(info[i][0]);
    }
    return { types: map, names: order };
  }

  function readVec(v, n) {
    var out = {}, i;
    for (i = 0; i < n; i++) { out[AXES[i]] = v[AXES[i]]; }
    return out;
  }

  function nameOf(v) {
    try { return v.getParameter('name'); } catch (e) { return null; }
  }

  function readLink(v) {
    var out;
    if (v === undefined || v === null) { return null; }
    out = { name: nameOf(v) };
    try { if (typeof v.id === 'function') { out.id = v.id(); } } catch (e) { /* materials may not expose id() */ }
    return out;
  }

  function fromNative(type, v) {
    if (VEC_SIZE[type]) { return readVec(v, VEC_SIZE[type]); }
    switch (type) {
      case 'String': return String(v);
      case 'Bool': return !!v;
      case 'Int':
      case 'Float': return v;
      case 'Texture': return (v === undefined || v === null) ? '' : String(v);
      case 'Link': return readLink(v);
      default: return { unsupported: true };
    }
  }

  function readParam(base, name, type) {
    try { return { name: name, type: type, value: fromNative(type, base.getParameter(name)) }; }
    catch (e) { return { name: name, type: type, value: null, unreadable: true }; }
  }

  function readAll(base, names) {
    var tm = typeMap(base), list = names || tm.names, out = [], i;
    for (i = 0; i < list.length; i++) {
      if (!U.hasOwn(tm.types, list[i])) { U.fail('NOT_FOUND', 'no parameter called ' + list[i], { name: list[i] }); }
      out.push(readParam(base, list[i], tm.types[list[i]]));
    }
    return out;
  }

  function numbers(value, n, what) {
    var out = [], i, src;
    if (Array.isArray(value)) { src = value; }
    else if (U.isObject(value)) {
      src = [];
      if (value.r !== undefined && value.x === undefined) {
        for (i = 0; i < n; i++) { src.push(i === 3 && value.a === undefined ? 1 : value[COLOR_AXES[i]]); }
      } else {
        for (i = 0; i < n; i++) { src.push(value[AXES[i]]); }
      }
    } else { U.fail('INVALID_ARGUMENT', what + ' expects ' + n + ' numbers as array or object'); }
    if (n === 4 && src.length === 3) { src = src.concat([1]); }
    if (src.length !== n) { U.fail('INVALID_ARGUMENT', what + ' expects ' + n + ' numbers'); }
    for (i = 0; i < n; i++) {
      if (!U.isNumber(src[i])) { U.fail('INVALID_ARGUMENT', what + ' component ' + i + ' is not a finite number'); }
      out.push(src[i]);
    }
    return out;
  }

  function makeVec(n, c) {
    if (n === 2) { return new Vec2D(c[0], c[1]); }
    if (n === 3) { return new Vec3D(c[0], c[1], c[2]); }
    return new Vec4D(c[0], c[1], c[2], c[3]);
  }

  function toNative(ctx, type, value, name) {
    var n = VEC_SIZE[type], ref;
    if (n) { return makeVec(n, numbers(value, n, name + ' (' + type + ')')); }
    switch (type) {
      case 'String':
        if (typeof value !== 'string') { U.fail('INVALID_ARGUMENT', name + ' expects a string'); }
        return value;
      case 'Bool':
        if (typeof value === 'boolean') { return value ? 1 : 0; }
        if (value === 0 || value === 1) { return value; }
        return U.fail('INVALID_ARGUMENT', name + ' expects a boolean');
      case 'Int':
        if (!U.isInt(value)) { U.fail('INVALID_ARGUMENT', name + ' expects an integer'); }
        return value;
      case 'Float':
        if (!U.isNumber(value)) { U.fail('INVALID_ARGUMENT', name + ' expects a finite number'); }
        return value;
      case 'Texture':
        if (U.isObject(value) && typeof value.path === 'string') { return value.path; }
        if (typeof value !== 'string') { U.fail('INVALID_ARGUMENT', name + ' expects a path string or {path}'); }
        return value;
      case 'Link':
        if (value === null) { return null; }
        if (!U.isObject(value)) { U.fail('INVALID_ARGUMENT', name + ' expects {ref}, {material} or null'); }
        if (value.material !== undefined) { return C3D.materials.resolve(ctx, value.material); }
        ref = value.ref !== undefined ? value.ref : value;
        return C3D.scene.resolve(ctx, ref).obj;
      default:
        return U.fail('UNSUPPORTED', name + ' has unsupported type ' + type, { type: type });
    }
  }

  // Applies params one by one; failures are collected per key (partial success allowed).
  function apply(ctx, base, params) {
    var tm = typeMap(base), applied = [], errors = [], k, e;
    for (k in params) {
      if (!U.hasOwn(params, k)) { continue; }
      try {
        if (!U.hasOwn(tm.types, k)) { U.fail('NOT_FOUND', 'no parameter called ' + k, undefined, 'use getParameters to list names'); }
        base.setParameter(k, toNative(ctx, tm.types[k], params[k], k));
        applied.push(k);
      } catch (ex) {
        e = C3D.core.errorOf(ex);
        errors.push({ name: k, code: (ex && ex.isC3D) ? e.code : 'INVALID_ARGUMENT', message: e.message });
      }
    }
    return { applied: applied, errors: errors };
  }

  function vec3(value, name) { return makeVec(3, numbers(value, 3, name)); }

  return { typeMap: typeMap, readParam: readParam, readAll: readAll, apply: apply, toNative: toNative, numbers: numbers, makeVec: makeVec, vec3: vec3, readVec: readVec, nameOf: nameOf };
})();
