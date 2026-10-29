/* capabilities: type maps built with typeof checks (research/02 section 3: never reference a constant bare). */
C3D.capabilities = (function () {
  var U = C3D.util;
  // Candidate names; only those defined at runtime are reported. POINTLIGHT/MATERIAL are deliberately absent:
  // addObject(POINTLIGHT) throws (P17), lights use LIGHT + lightType.
  var OBJECT_NAMES = ['BALL', 'BOX', 'DISC', 'CONE', 'CAPSULE', 'CYLINDER', 'FRACTAL', 'PLANE', 'POLYGONOBJ', 'POLYHEDRA', 'TORUS', 'TUBE',
    'SCRIPTPOLY', 'STAIR', 'CIRCLE', 'COG', 'FLOWER', 'HELIX', 'LINE', 'NEDGE', 'RECT', 'SCRIPTSPLINE', 'SPLINE', 'STAR', 'TEXT',
    'BLUEPRINT', 'CAMERA', 'FOLDER', 'BOOLEAN', 'CHAIN', 'EXTRUDE', 'ISOSURFACE', 'LATHE', 'POLYPLANE', 'RELIEF', 'SUBDIV', 'SWEEP', 'SYMMETRY',
    'PARTICLE', 'PARTICLEEMITTER', 'PARTICLEARRAY', 'PARTICLEMESH', 'PARTICLESPLINE', 'PARTICLESCRIPT', 'ORIENTATIONEFF', 'LIGHT',
    'ENVIRONMENTLIGHT', 'SKYLIGHT', 'JOINT', 'SMARTFOLDER', 'LOFT', 'BACKGROUND', 'SUBDIVMOD', 'TRIANGULATEMOD', 'WIREFRAMEMOD',
    'ARRAYMOD', 'BENDMOD', 'BOOLEANMOD', 'BUILDMOD', 'BULGEMOD', 'CRUMPLEMOD', 'DISPLACEMENTMOD', 'RINGMOD', 'SHEARMOD', 'SHELLMOD',
    'SMOOTHMOD', 'SPHERIFYMOD', 'SYMMETRYMOD', 'TAPERMOD', 'TRANSFORMMOD', 'TWISTMOD', 'WARPMOD',
    'ATTRACTIONFORCE', 'DEFLECTORFORCE', 'DRAGFORCE', 'GRAVITYFORCE', 'RADIALFORCE', 'WINDFORCE'];
  var TAG_NAMES = ['ANCHORTAG', 'BAKETAG', 'IKHANDLETAG', 'IKCONSTRAINTTAG', 'METABALLTAG', 'MODETAG', 'MORPHTAG', 'ORIENTCONSTRAINTTAG',
    'PARENTCONSTRAINTTAG', 'PARTICLETAG', 'POINTCONSTRAINTTAG', 'POSETAG', 'PROPWINTAG', 'RIGIDBODYTAG', 'ROPETAG', 'SKELETONTAG',
    'SOFTBODYTAG', 'SPLINEIKTAG', 'UVTAG', 'SCRIPTTAG', 'SHADERTAG', 'FOGTAG', 'RADIOSITYTAG', 'HDRITAG', 'DOFTAG', 'RENDERTAG',
    'CAUSTICTAG', 'SPLINETRACKINGTAG', 'TARGETTAG'];
  var ROT_NAMES = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX', 'HPB'];
  var EDIT_MODES = ['POINT_MODE', 'EDGE_MODE', 'POLY_MODE', 'OBJECT_MODE', 'PIVOT_MODE'];
  var INTERP_NAMES = { linear: 'LINEAR_INTERPOL', soft: 'SOFT_INTERPOL', spline: 'SPLINE_INTERPOL', flat: 'FLAT_INTERPOL', 'const': 'CONST_INTERPOL' };
  var MATERIAL_TYPES = ['Material', 'Material (PBR)', 'Toon', 'Glass']; // P19
  var NODE_TYPES = ['carpaint', 'dielectric', 'material', 'membrane', 'metal', 'pbrmetal', 'shadow', 'solid', 'toon', 'velvet', 'brick',
    'cellnoise', 'checkerboard', 'directional', 'dots', 'fractal', 'image', 'marble', 'noise', 'reptile', 'turbulence', 'voronoi', 'wireframe',
    'wood', 'abs', 'add', 'cosine', 'crossprod', 'divide', 'dotprod', 'float2vec', 'mix', 'modulo', 'multiply', 'multiplyadd', 'norm', 'power',
    'pulse', 'pulsetrain', 'sine', 'squareroot', 'step', 'subtract', 'tangent', 'vec2float', 'composite', 'gradient', 'hsv2rgb', 'rgb2hsv',
    'color', 'number', 'vector', 'instancestate', 'state'];
  var SAVE_TYPES = ['jas', 'obj', 'fbx', 'dae', 'stl', '3ds', 'usdz', 'gltf', 'glb', 'dxf'];
  var RENDER_FORMATS = ['png', 'jpg', 'tiff'];
  var RENDERERS = ['CHEETAH', 'FALCON'];

  function constant(name) { return U.typeofGlobal(name) === 'number' ? U.globalValue(name) : null; }

  function pick(names) {
    var out = {}, i, v;
    for (i = 0; i < names.length; i++) { v = constant(names[i]); if (v !== null) { out[names[i]] = v; } }
    return out;
  }

  function reverse(map) {
    var out = {}, k;
    for (k in map) { if (U.hasOwn(map, k) && !U.hasOwn(out, map[k])) { out[map[k]] = k; } }
    return out;
  }

  var cache = null;
  function maps() {
    if (!cache) {
      cache = { objects: pick(OBJECT_NAMES), tags: pick(TAG_NAMES) };
      cache.objectNames = reverse(cache.objects);
      cache.tagNames = reverse(cache.tags);
    }
    return cache;
  }

  function objectTypeName(id) { var n = maps().objectNames[id]; return n || 'TYPE_' + id; }
  function tagTypeName(id) { var n = maps().tagNames[id]; return n || 'TYPE_' + id; }

  function lookup(table, name, what) {
    var key = typeof name === 'string' ? name.toUpperCase() : '';
    if (!U.hasOwn(table, key)) { U.fail('INVALID_ARGUMENT', 'unknown ' + what + ' type: ' + name, { type: name, known: Object.keys(table) }, 'see the capabilities op for valid types'); }
    return table[key];
  }
  function objectTypeId(name) { return lookup(maps().objects, name, 'object'); }
  function tagTypeId(name) { return lookup(maps().tags, name, 'tag'); }

  function rotationOrders() {
    var out = {}, i, v;
    for (i = 0; i < ROT_NAMES.length; i++) { v = constant('ROT_' + ROT_NAMES[i]); if (v !== null) { out[ROT_NAMES[i]] = v; } }
    return out;
  }

  function editModeName(v) {
    var i;
    for (i = 0; i < EDIT_MODES.length; i++) { if (constant(EDIT_MODES[i]) === v) { return EDIT_MODES[i]; } }
    return v === undefined ? null : v;
  }

  function interpolationMap() {
    var out = {}, k, v;
    for (k in INTERP_NAMES) { if (U.hasOwn(INTERP_NAMES, k)) { v = constant(INTERP_NAMES[k]); if (v !== null) { out[k] = v; } } }
    return out;
  }

  // 2 is both SPLINE and FLAT; spline wins on read-back.
  function interpolationName(v) {
    var order = ['linear', 'soft', 'spline', 'const', 'flat'], m = interpolationMap(), i;
    for (i = 0; i < order.length; i++) { if (m[order[i]] === v) { return order[i]; } }
    return v;
  }

  function jsFeatures() {
    var g = U.GLOBAL, out = { geval: typeof g.geval, setTimeout: typeof g.setTimeout, require: typeof g.require, console: typeof g.console, JSON: typeof g.JSON };
    out.es6 = {};
    try { out.es6.letConst = new Function('let a = 1; const b = 2; return a + b')() === 3; } catch (e) { out.es6.letConst = false; }
    try { out.es6.arrow = new Function('return (function () { return (() => 1)(); })()')() === 1; } catch (e2) { out.es6.arrow = false; }
    return out;
  }

  function rendererName(r, doc) {
    var i, t = r.type();
    for (i = 0; i < RENDERERS.length; i++) { if (constant(RENDERERS[i]) === t) { return RENDERERS[i]; } }
    for (i = 0; i < doc.rendererCount(); i++) { if (doc.rendererAtIndex(i) === r) { return RENDERERS[i] || 'RENDERER_' + i; } }
    return 'RENDERER_' + t;
  }

  function rendererIndex(doc, name) {
    var i, want = constant(name);
    for (i = 0; i < doc.rendererCount(); i++) { if (want !== null && doc.rendererAtIndex(i).type() === want) { return i; } }
    U.fail('UNSUPPORTED', 'renderer ' + name + ' is not available');
  }

  C3D.core.define('capabilities', 'R', function () {
    var m = maps();
    return {
      apiVersion: typeof version === 'function' ? String(version()) : '8.1.3', runtimeVersion: U.VERSION, protocol: C3D.core.PROTOCOL,
      objectTypes: m.objects, tagTypes: m.tags, materialTypes: MATERIAL_TYPES.slice(), nodeTypes: NODE_TYPES.slice(),
      rotationOrders: rotationOrders(), renderers: RENDERERS.slice(), renderFormats: RENDER_FORMATS.slice(), saveTypes: SAVE_TYPES.slice(),
      lightTypes: { ambient: 0, area: 1, distant: 2, point: 3, spot: 4 }, interpolation: interpolationMap(), jsFeatures: jsFeatures(),
      limits: { drainRequests: C3D.core.DRAIN_REQUESTS, drainSeconds: C3D.core.DRAIN_MS / 1000 }
    };
  });

  return {
    constant: constant, objectTypeName: objectTypeName, tagTypeName: tagTypeName, objectTypeId: objectTypeId, tagTypeId: tagTypeId,
    editModeName: editModeName, interpolationMap: interpolationMap, interpolationName: interpolationName, rendererName: rendererName,
    rendererIndex: rendererIndex, SAVE_TYPES: SAVE_TYPES, RENDER_FORMATS: RENDER_FORMATS, RENDERERS: RENDERERS
  };
})();
