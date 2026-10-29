/* geometry: polygon meshes (strict validation BEFORE any PolyCore call, P13) and splines. */
(function () {
  var U = C3D.util, P = C3D.params, CAP = C3D.capabilities, S = C3D.scene;
  var MAX_POLY_SIZE = 64;
  var DEFAULT_PAGE = 5000;

  function point(v, what) { return P.numbers(v, 3, what); }

  function validateMesh(a, baseCount) {
    var verts = [], polys = a.polygons, total, i, j, p, seen, uvs = [];
    if (!Array.isArray(a.vertices) || !a.vertices.length) { U.fail('INVALID_ARGUMENT', 'vertices must be a non-empty array'); }
    if (!Array.isArray(polys) || !polys.length) { U.fail('INVALID_ARGUMENT', 'polygons must be a non-empty array'); }
    for (i = 0; i < a.vertices.length; i++) { verts.push(point(a.vertices[i], 'vertices[' + i + ']')); }
    total = baseCount + verts.length;
    for (i = 0; i < polys.length; i++) {
      p = polys[i];
      if (!Array.isArray(p) || p.length < 3 || p.length > MAX_POLY_SIZE) {
        U.fail('INVALID_ARGUMENT', 'polygon ' + i + ' must have between 3 and ' + MAX_POLY_SIZE + ' indices', { polygon: i });
      }
      seen = {};
      for (j = 0; j < p.length; j++) {
        if (!U.isInt(p[j]) || p[j] < 0 || p[j] >= total) {
          U.fail('INVALID_ARGUMENT', 'polygon ' + i + ' has index ' + p[j] + ' outside [0,' + total + ')', { polygon: i, index: p[j], vertexCount: total });
        }
        if (seen[p[j]]) { U.fail('INVALID_ARGUMENT', 'polygon ' + i + ' repeats vertex index ' + p[j], { polygon: i, index: p[j] }); }
        seen[p[j]] = true;
      }
    }
    if (a.uvs !== undefined) {
      if (!Array.isArray(a.uvs) || a.uvs.length !== polys.length) { U.fail('INVALID_ARGUMENT', 'uvs needs one entry per polygon'); }
      for (i = 0; i < polys.length; i++) {
        if (!Array.isArray(a.uvs[i]) || a.uvs[i].length !== polys[i].length) { U.fail('INVALID_ARGUMENT', 'uvs[' + i + '] needs one [u,v] per polygon corner', { polygon: i }); }
        uvs.push([]);
        for (j = 0; j < a.uvs[i].length; j++) { uvs[i].push(P.numbers(a.uvs[i][j], 2, 'uvs[' + i + '][' + j + ']')); }
      }
    }
    return { verts: verts, polys: polys, uvs: a.uvs === undefined ? null : uvs };
  }

  function coreOf(obj, what) {
    var core;
    try { core = obj.core(); } catch (e) { core = null; }
    if (!core || typeof core.vertexCount !== 'function') { U.fail('INVALID_ARGUMENT', what + ' has no polygon mesh', undefined, 'use a POLYGONOBJ or a polygon primitive'); }
    return core;
  }

  function fill(core, v, base) {
    var i, j, idx, uv;
    for (i = 0; i < v.verts.length; i++) {
      idx = core.addVertex(false, new Vec3D(v.verts[i][0], v.verts[i][1], v.verts[i][2]));
      if (idx !== base + i) { U.fail('INTERNAL', 'addVertex returned index ' + idx + ', expected ' + (base + i), { index: idx }); }
    }
    for (i = 0; i < v.polys.length; i++) {
      if (v.uvs) {
        uv = [];
        for (j = 0; j < v.uvs[i].length; j++) { uv.push(new Vec2D(v.uvs[i][j][0], v.uvs[i][j][1])); }
        core.addIndexPolygon(v.polys[i].length, v.polys[i], uv);
      } else {
        core.addIndexPolygon(v.polys[i].length, v.polys[i]);
      }
    }
  }

  // Removes a half-built object from the parent it was attached to (falling back to the root, where addObject may have left it).
  function discard(ctx, obj, parentEntry, what) {
    var rootObj = ctx.doc.root(), removed = false;
    try { parentEntry.obj.removeChild(obj); removed = true; } catch (e1) { /* maybe it sits under the root instead */ }
    if (!removed) {
      try { rootObj.removeChild(obj); removed = true; } catch (e2) { C3D.core.log('cleanup after failed ' + what + ' failed: ' + e2.message); }
    }
    S.invalidate(ctx);
  }

  C3D.core.define('createMesh', 'W', function (ctx, a) {
    var appendTo = null, obj, core, base = 0, v, parentEntry, result, created = false;
    if (a.append) {
      appendTo = S.resolve(ctx, a.append.ref);
      if (appendTo.obj.type() !== CAP.constant('POLYGONOBJ')) { U.fail('INVALID_ARGUMENT', 'append target must be a POLYGONOBJ'); }
      base = coreOf(appendTo.obj, 'append target').vertexCount();
    } else {
      parentEntry = S.parentOrRoot(ctx, a.parent);
      if (a.name !== undefined) { S.checkName(a.name, 'name'); }
    }
    v = validateMesh(a, base);
    if (a.material !== undefined) { C3D.materials.resolve(ctx, a.material); }
    if (appendTo) {
      obj = appendTo.obj;
    } else {
      obj = S.create(ctx, CAP.constant('POLYGONOBJ'), a.name, parentEntry, a);
      created = true;
    }
    try {
      core = coreOf(obj, 'mesh object');
      fill(core, v, base);
    } catch (e) {
      if (created) { discard(ctx, obj, parentEntry, 'createMesh'); }
      throw e;
    }
    obj.update();
    if (a.material !== undefined) { C3D.materials.assign(ctx, obj, C3D.materials.resolve(ctx, a.material), true); }
    result = S.describe(ctx, obj);
    result.ref = { id: result.id };
    result.vertexCount = core.vertexCount();
    result.polygonCount = core.polygonCount();
    return result;
  });

  function page(a, key, total) {
    var off = a[key + 'Offset'] === undefined ? 0 : a[key + 'Offset'], lim = a[key + 'Limit'] === undefined ? DEFAULT_PAGE : a[key + 'Limit'];
    if (!U.isInt(off) || off < 0 || !U.isInt(lim) || lim < 0) { U.fail('INVALID_ARGUMENT', key + 'Offset/' + key + 'Limit must be non-negative integers'); }
    return { from: Math.min(off, total), to: Math.min(off + lim, total) };
  }

  C3D.core.define('getMesh', 'R', function (ctx, a) {
    var e = S.resolve(ctx, a.ref), core = coreOf(e.obj, 'object'), nv = core.vertexCount(), np = core.polygonCount();
    var vp = page(a, 'vertex', nv), pp = page(a, 'polygon', np), verts = [], polys = [], uvs = [], i, j, n, v, row, uvRow, hasUV = true, uv;
    for (i = vp.from; i < vp.to; i++) { v = core.vertex(i); verts.push([v.x, v.y, v.z]); }
    for (i = pp.from; i < pp.to; i++) {
      n = core.polygonSize(i);
      row = []; uvRow = [];
      for (j = 0; j < n; j++) {
        row.push(core.vertexIndex(i, j));
        if (hasUV) {
          try { uv = core.uvCoord(i, j); uvRow.push([uv.x, uv.y]); } catch (ex) { hasUV = false; }
        }
      }
      polys.push(row);
      uvs.push(uvRow);
    }
    var out = { vertices: verts, polygons: polys, vertexCount: nv, polygonCount: np, nextVertexOffset: vp.to < nv ? vp.to : null, nextPolygonOffset: pp.to < np ? pp.to : null };
    if (hasUV && polys.length) { out.uvs = uvs; }
    return out;
  });

  C3D.core.define('editMesh', 'W', function (ctx, a) {
    var e = S.resolve(ctx, a.ref), core, nv, np, i, del, sv, flip;
    if (e.obj.type() !== CAP.constant('POLYGONOBJ')) {
      U.fail('INVALID_ARGUMENT', 'only POLYGONOBJ meshes can be edited', undefined, 'make the object editable first');
    }
    core = coreOf(e.obj, 'object'); nv = core.vertexCount(); np = core.polygonCount();
    sv = a.setVertices || []; flip = a.flipWinding || []; del = a.deletePolygons || [];
    for (i = 0; i < sv.length; i++) {
      if (!U.isInt(sv[i].index) || sv[i].index < 0 || sv[i].index >= nv) { U.fail('INVALID_ARGUMENT', 'setVertices[' + i + '].index out of range', { vertexCount: nv }); }
      point(sv[i].position, 'setVertices[' + i + '].position');
    }
    for (i = 0; i < flip.length + del.length; i++) {
      var pi = i < flip.length ? flip[i] : del[i - flip.length];
      if (!U.isInt(pi) || pi < 0 || pi >= np) { U.fail('INVALID_ARGUMENT', 'polygon index ' + pi + ' out of range', { polygonCount: np }); }
    }
    if (a.mergeVertices !== undefined && (!U.isNumber(a.mergeVertices) || a.mergeVertices < 0)) { U.fail('INVALID_ARGUMENT', 'mergeVertices must be a tolerance >= 0'); }
    for (i = 0; i < sv.length; i++) { core.setVertex(sv[i].index, P.makeVec(3, point(sv[i].position, 'position'))); }
    for (i = 0; i < flip.length; i++) { core.flipWinding(flip[i]); }
    del = del.slice().sort(function (x, y) { return y - x; });
    for (i = 0; i < del.length; i++) { if (i === 0 || del[i] !== del[i - 1]) { core.deletePolygon(del[i]); } }
    if (a.mergeVertices !== undefined) { core.mergeVertices(a.mergeVertices); }
    e.obj.update();
    return { vertexCount: core.vertexCount(), polygonCount: core.polygonCount() };
  });

  function validatePaths(paths) {
    var i, j, pt;
    for (i = 0; i < paths.length; i++) {
      if (!U.isObject(paths[i]) || !Array.isArray(paths[i].points) || !paths[i].points.length) { U.fail('INVALID_ARGUMENT', 'paths[' + i + '].points must be a non-empty array'); }
      for (j = 0; j < paths[i].points.length; j++) {
        pt = paths[i].points[j];
        point(pt.p, 'paths[' + i + '].points[' + j + '].p');
        if (pt.c1 !== undefined) { point(pt.c1, 'c1'); }
        if (pt.c2 !== undefined) { point(pt.c2, 'c2'); }
      }
    }
  }

  function vec(v) { return P.makeVec(3, point(v, 'point')); }

  // Segment A->B: A's outgoing handle c2 and B's incoming handle c1 (absolute coordinates); no handles -> straight line.
  function segment(core, A, B) {
    if (A.c2 === undefined && B.c1 === undefined) { core.line(vec(B.p)); }
    else { core.curve(vec(A.c2 !== undefined ? A.c2 : A.p), vec(B.c1 !== undefined ? B.c1 : B.p), vec(B.p)); }
  }

  C3D.core.define('createSpline', 'W', function (ctx, a) {
    var parentEntry = S.parentOrRoot(ctx, a.parent), obj, core, i, j, pts, result;
    if (!Array.isArray(a.paths) || !a.paths.length) { U.fail('INVALID_ARGUMENT', 'paths must be a non-empty array'); }
    validatePaths(a.paths);
    if (a.name !== undefined) { S.checkName(a.name, 'name'); }
    obj = S.create(ctx, CAP.constant('SPLINE'), a.name, parentEntry, a);
    try {
      core = obj.core();
      for (i = 0; i < a.paths.length; i++) {
        pts = a.paths[i].points;
        core.move(vec(pts[0].p));
        for (j = 1; j < pts.length; j++) { segment(core, pts[j - 1], pts[j]); }
        if (a.paths[i].closed) {
          if (pts.length > 2 && (pts[pts.length - 1].c2 !== undefined || pts[0].c1 !== undefined)) { segment(core, pts[pts.length - 1], pts[0]); }
          core.close();
        }
      }
    } catch (e) {
      discard(ctx, obj, parentEntry, 'createSpline');
      throw e;
    }
    obj.update();
    result = S.describe(ctx, obj);
    result.ref = { id: result.id };
    result.pathCount = core.pathCount();
    return result;
  });
})();
