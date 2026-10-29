/* document: document info, session marker, save, active camera. */
(function () {
  var U = C3D.util, P = C3D.params, CAP = C3D.capabilities, S = C3D.scene;
  var MARKER_PREFIX = '__c3d_mcp_session_';

  function def(name, rw, fn) { C3D.core.define(name, rw, fn); }

  function camInfo(doc) {
    var c = doc.activeCamera();
    return c ? { id: c.id(), name: P.nameOf(c) } : null;
  }

  function markerOf(ctx) {
    var kids = S.tree(ctx).root.children, i;
    for (i = 0; i < kids.length; i++) { if (U.startsWith(kids[i].name, MARKER_PREFIX)) { return kids[i].name; } }
    return null;
  }

  def('getDocumentInfo', 'R', function (ctx) {
    var doc = ctx.doc, name = doc.fileName();
    return {
      fileName: (name === undefined || name === null) ? null : name, fps: doc.animationFPS(), time: doc.animPosition(), end: doc.animationEnd(),
      takeCount: doc.takeCount(), currentTake: doc.currentTake().name, renderer: CAP.rendererName(doc.currentRenderer(), doc),
      editMode: CAP.editModeName(doc.editMode()), activeCamera: camInfo(doc), objectCount: S.tree(ctx).list.length,
      materialCount: doc.materialCount(), marker: markerOf(ctx)
    };
  });

  def('setMarker', 'W', function (ctx, a) {
    var marker, kids = S.tree(ctx).root.children, i;
    if (typeof a.uuid !== 'string' || !/^[0-9a-f-]{36}$/.test(a.uuid)) { U.fail('INVALID_ARGUMENT', 'uuid must be 36 lowercase hex/dash characters'); }
    marker = MARKER_PREFIX + a.uuid;
    for (i = 0; i < kids.length; i++) { if (kids[i].name === marker) { return { marker: marker, created: false }; } }
    S.create(ctx, CAP.constant('FOLDER'), marker, S.tree(ctx).root).update();
    return { marker: marker, created: true };
  });

  def('saveTo', 'W', function (ctx, a) {
    if (typeof a.path !== 'string' || a.path.charAt(0) !== '/') { U.fail('INVALID_ARGUMENT', 'path must be absolute'); }
    if (CAP.SAVE_TYPES.indexOf(a.type) < 0) { U.fail('INVALID_ARGUMENT', 'unsupported save type ' + a.type, { supported: CAP.SAVE_TYPES }); }
    ctx.doc.saveToFile(a.path, a.type);
    if (!U.exists(a.path)) { U.fail('INTERNAL', 'saveToFile produced no file at ' + a.path); }
    return { path: a.path, type: a.type, size: U.fileSize(a.path) };
  });

  def('setActiveCamera', 'W', function (ctx, a) {
    var e = S.resolve(ctx, a.ref);
    if (e.obj.type() !== CAP.constant('CAMERA')) { U.fail('INVALID_ARGUMENT', 'object ' + e.id + ' is not a camera'); }
    e.obj.setParameter('activeCamera', 1); // P32
    e.obj.update();
    return { activeCamera: camInfo(ctx.doc) };
  });
})();
