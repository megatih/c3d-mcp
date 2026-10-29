/* anim: time, fps, takes and keyframes (FCurve recipe verified by P14). */
(function () {
  var U = C3D.util, P = C3D.params, CAP = C3D.capabilities, S = C3D.scene;
  var COMPONENTS = { Float: 1, Int: 1, Bool: 1, Vec2D: 2, Vec3D: 3, Vec4D: 4 };

  function def(name, rw, fn) { C3D.core.define(name, rw, fn); }

  function need(doc, method) {
    if (typeof doc[method] !== 'function') { U.fail('UNSUPPORTED', 'doc.' + method + ' is not available in this Cheetah3D build'); }
  }

  function takeInfo(t) { return { name: t.name, length: t.length }; }

  function takeList(doc) {
    var out = [], i;
    for (i = 0; i < doc.takeCount(); i++) { out.push(takeInfo(doc.takeAtIndex(i))); }
    return out;
  }

  function takeNamed(doc, name) {
    var t;
    try { t = doc.takeWithName(name); } catch (e) { t = null; }
    return t || null;
  }

  function takesState(doc) { return { takes: takeList(doc), current: doc.currentTake().name }; }

  def('setTime', 'W', function (ctx, a) {
    if (!U.isNumber(a.time)) { U.fail('INVALID_ARGUMENT', 'time must be a finite number'); }
    ctx.doc.setAnimPosition(a.time);
    return { time: ctx.doc.animPosition() };
  });

  def('setFps', 'W', function (ctx, a) {
    if (!U.isNumber(a.fps) || a.fps < 1 || a.fps > 240) { U.fail('INVALID_ARGUMENT', 'fps must be between 1 and 240'); }
    need(ctx.doc, 'setAnimationFPS');
    ctx.doc.setAnimationFPS(a.fps);
    return { fps: ctx.doc.animationFPS() };
  });

  def('takes', 'W', function (ctx, a) {
    var doc = ctx.doc, name = a.name;
    if (a.action === 'list') { return takesState(doc); }
    if (typeof name !== 'string' || name === '') { U.fail('INVALID_ARGUMENT', 'name is required for ' + a.action); }
    if (a.action === 'add') {
      if (takeNamed(doc, name)) { U.fail('INVALID_ARGUMENT', 'take ' + name + ' already exists'); }
      doc.addTake(name);
    } else if (a.action === 'rename' || a.action === 'remove' || a.action === 'select') {
      if (!takeNamed(doc, name)) { U.fail('NOT_FOUND', 'no take named ' + name, { name: name }); }
      if (a.action === 'rename') {
        if (typeof a.newName !== 'string' || a.newName === '') { U.fail('INVALID_ARGUMENT', 'newName is required for rename'); }
        if (takeNamed(doc, a.newName)) { U.fail('INVALID_ARGUMENT', 'take ' + a.newName + ' already exists'); }
        doc.renameTake(name, a.newName);
      } else if (a.action === 'remove') {
        if (doc.takeCount() <= 1) { U.fail('INVALID_ARGUMENT', 'the last take cannot be removed'); }
        doc.removeTake(name);
      } else { doc.setCurrentTake(name); }
    } else { U.fail('INVALID_ARGUMENT', 'unknown take action ' + a.action); }
    return takesState(doc);
  });

  // ---- keyframes ----
  function animParam(e, name) {
    var prm, ok;
    try { prm = e.obj.parameterWithName(name); } catch (ex) { prm = null; }
    if (!prm) { U.fail('NOT_FOUND', 'no parameter called ' + name, { name: name }); }
    ok = typeof prm.isAnimatable === 'function' ? prm.isAnimatable() : prm.isAnimateable();
    if (!ok) { U.fail('INVALID_ARGUMENT', name + ' is not animatable'); }
    return prm;
  }

  function takeFor(doc, name) {
    var t = name === undefined ? doc.currentTake() : takeNamed(doc, name);
    if (!t) { U.fail('NOT_FOUND', 'no take named ' + name, { name: name }); }
    return t;
  }

  function componentCount(e, name) {
    var type = P.typeMap(e.obj).types[name], n = COMPONENTS[type];
    if (!n) { U.fail('INVALID_ARGUMENT', name + ' has type ' + type + ' which cannot be keyframed'); }
    return n;
  }

  function interpValue(name) {
    var v;
    if (name === undefined) { return null; }
    v = CAP.interpolationMap()[name];
    if (v === undefined) { U.fail('UNSUPPORTED', 'interpolation "' + name + '" is not available in this Cheetah3D build', { available: Object.keys(CAP.interpolationMap()) }); }
    return v;
  }

  function keyComponents(value, n, idx) {
    if (n === 1) {
      if (!U.isNumber(value)) { U.fail('INVALID_ARGUMENT', 'keys[' + idx + '].value must be a number'); }
      return [value];
    }
    return P.numbers(value, n, 'keys[' + idx + '].value');
  }

  def('setKeyframes', 'W', function (ctx, a) {
    var e = S.resolve(ctx, a.ref), prm = animParam(e, a.param), take = takeFor(ctx.doc, a.take), n = componentCount(e, a.param);
    var keys = [], i, c, fc, tn, k, comps = [], j, interp;
    if (!Array.isArray(a.keys) || !a.keys.length) { U.fail('INVALID_ARGUMENT', 'keys must be a non-empty array'); }
    for (i = 0; i < a.keys.length; i++) {
      if (!U.isNumber(a.keys[i].time)) { U.fail('INVALID_ARGUMENT', 'keys[' + i + '].time must be a finite number'); }
      keys.push({ time: a.keys[i].time, values: keyComponents(a.keys[i].value, n, i), interp: interpValue(a.keys[i].interpolation) });
    }
    keys.sort(function (x, y) { return x.time - y.time; });
    tn = prm.takeNodeWithName(take.name) || prm.addTakeNode(take.name);
    for (c = 0; c < n; c++) {
      fc = tn.fCurveAtIndex(c);
      if (a.replace) { fc.removeAllKeys(); }
      for (i = 0; i < keys.length; i++) {
        if (!a.replace) {
          for (j = fc.keyCount() - 1; j >= 0; j--) { if (Math.abs(fc.keyAtIndex(j).time - keys[i].time) < 1e-9) { fc.removeKeyAtIndex(j); } }
        }
        k = new FCurveKey();
        k.time = keys[i].time;
        k.value = keys[i].values[c];
        interp = keys[i].interp;
        if (interp !== null) { k.left_type = interp; k.right_type = interp; }
        fc.addKey(k);
      }
      fc.update();
      comps.push({ index: c, keyCount: fc.keyCount() });
    }
    e.obj.update();
    return { param: a.param, components: comps, take: take.name };
  });

  def('getKeyframes', 'R', function (ctx, a) {
    var e = S.resolve(ctx, a.ref), prm = animParam(e, a.param), take = takeFor(ctx.doc, a.take), tn = prm.takeNodeWithName(take.name);
    var comps = [], c, i, fc, keys, k;
    if (tn) {
      for (c = 0; c < tn.fCurveCount(); c++) {
        fc = tn.fCurveAtIndex(c);
        keys = [];
        for (i = 0; i < fc.keyCount(); i++) {
          k = fc.keyAtIndex(i);
          keys.push({ time: k.time, value: k.value, interpolation: CAP.interpolationName(k.right_type) });
        }
        comps.push({ index: c, keys: keys });
      }
    }
    return { param: a.param, take: take.name, components: comps };
  });

  def('removeKeyframes', 'W', function (ctx, a) {
    var e = S.resolve(ctx, a.ref), prm = animParam(e, a.param), take = takeFor(ctx.doc, a.take), tn = prm.takeNodeWithName(take.name), removed = 0, c, fc;
    if (tn) {
      for (c = 0; c < tn.fCurveCount(); c++) {
        fc = tn.fCurveAtIndex(c);
        removed += fc.keyCount();
        fc.removeAllKeys();
        fc.update();
      }
      e.obj.update();
    }
    return { removed: removed };
  });
})();
