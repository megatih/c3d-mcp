/* render: renderer settings and doc.render (png/jpg/tiff only, otherwise a blocking modal appears, P08). */
(function () {
  var U = C3D.util, P = C3D.params, CAP = C3D.capabilities;
  var RENDER_EXT = /\.(png|jpg|tiff)$/;

  function resolutionOf(r) {
    var v = r.getParameter('resolution');
    return { x: v.x, y: v.y };
  }

  C3D.core.define('setRenderSettings', 'W', function (ctx, a) {
    var doc = ctx.doc, r, applied = [], errors = [], cur, extra, result;
    if (a.renderer !== undefined) {
      if (CAP.RENDERERS.indexOf(a.renderer) < 0) { U.fail('INVALID_ARGUMENT', 'renderer must be one of ' + CAP.RENDERERS.join(', ')); }
      doc.setCurrentRenderer(CAP.rendererIndex(doc, a.renderer));
    }
    r = doc.currentRenderer();
    if (a.width !== undefined || a.height !== undefined) {
      cur = resolutionOf(r);
      if ((a.width !== undefined && (!U.isInt(a.width) || a.width < 1)) || (a.height !== undefined && (!U.isInt(a.height) || a.height < 1))) {
        U.fail('INVALID_ARGUMENT', 'width and height must be positive integers');
      }
      r.setParameter('resolution', new Vec2D(a.width === undefined ? cur.x : a.width, a.height === undefined ? cur.y : a.height));
      applied.push('resolution');
    }
    if (a.params) {
      extra = P.apply(ctx, r, a.params);
      applied = applied.concat(extra.applied);
      errors = extra.errors;
    }
    result = { renderer: CAP.rendererName(r, doc), resolution: resolutionOf(r), applied: applied, errors: errors };
    if (errors.length) { C3D.core.partial(result, errors, 'renderer parameters'); }
    return result;
  });

  C3D.core.define('render', 'W', function (ctx, a) {
    var doc = ctx.doc, previous = null, res, slash, exists, size;
    if (typeof a.path !== 'string' || a.path.charAt(0) !== '/') { U.fail('INVALID_ARGUMENT', 'path must be absolute'); }
    if (!RENDER_EXT.test(a.path)) { U.fail('INVALID_ARGUMENT', 'render path must end in .png, .jpg or .tiff', { path: a.path }, 'any other extension opens a blocking dialog in Cheetah3D'); }
    slash = a.path.lastIndexOf('/');
    if (!U.isDir(slash === 0 ? '/' : a.path.substring(0, slash))) { U.fail('INVALID_ARGUMENT', 'output directory does not exist', { directory: a.path.substring(0, slash) }); }
    if (a.time !== undefined) {
      if (!U.isNumber(a.time)) { U.fail('INVALID_ARGUMENT', 'time must be a finite number'); }
      previous = doc.animPosition();
      doc.setAnimPosition(a.time);
    }
    try { doc.render(a.path); }
    finally { if (previous !== null) { doc.setAnimPosition(previous); } }
    res = resolutionOf(doc.currentRenderer());
    exists = U.exists(a.path);
    size = exists ? U.fileSize(a.path) : 0;
    return { path: a.path, exists: exists, size: size, width: res.x, height: res.y };
  });
})();
