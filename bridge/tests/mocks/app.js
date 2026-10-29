// Strict mock of the Cheetah3D 8.1.3 scripting API. Only methods listed in vendor/c3d-scripting-kb api-index.json (plus the
// probe-verified extras id(), animationFPS(), animationTime(), Parameter.isAnimatable()) exist; anything else is a TypeError.
var __stats = {
  retain: 0, release: 0, redraws: 0, addVertex: 0, addIndexPolygon: 0, polyCoreMutations: 0, mkDirCalls: 0, sysCalls: [],
  dialogCalls: 0, beeps: 0, renders: 0, saves: 0, setParameter: 0
};
var __app = { fatal: null, modal: null, console: [], doc: null, nextId: 1000, fileName: undefined, lastRender: null, cheetahType: null };

function __fatal(msg) { __app.fatal = msg; throw new Error(msg); }
function __modal(msg) { __app.modal = msg; throw new Error('MODAL: ' + msg); }

var __VEC = { Vec2D: Vec2D, Vec3D: Vec3D, Vec4D: Vec4D };
var __VEC_N = { Vec2D: 2, Vec3D: 3, Vec4D: 4 };
var __PTYPE = { Int: INT_PARAMETER, Float: FLOAT_PARAMETER, Bool: BOOL_PARAMETER, String: STRING_PARAMETER, Vec2D: VEC2D_PARAMETER, Vec3D: VEC3D_PARAMETER, Vec4D: VEC4D_PARAMETER, Texture: TEXTURE_PARAMETER, Link: LINK_PARAMETER };

// ---------------------------------------------------------------- Parameter / FCurve
function __comps(type) { return __VEC_N[type] || ((type === 'Float' || type === 'Int' || type === 'Bool') ? 1 : 0); }

function Key(src) { var k = new FCurveKey(), p; for (p in src) { k[p] = src[p]; } return k; }

function FCurve() { __hide(this, '_keys', []); }
FCurve.prototype.addKey = function (k) {
  if (!(k instanceof FCurveKey)) { __badArgs(); }
  this._keys.push(Key(k));
  this._keys.sort(function (a, b) { return a.time - b.time; });
};
FCurve.prototype.insertKeyAtIndex = function (k, i) { this._keys.splice(i, 0, Key(k)); };
FCurve.prototype.keyAtIndex = function (i) { if (i < 0 || i >= this._keys.length) { __badArgs(); } return Key(this._keys[i]); };
FCurve.prototype.keyCount = function () { return this._keys.length; };
FCurve.prototype.removeAllKeys = function () { this._keys.length = 0; };
FCurve.prototype.removeKeyAtIndex = function (i) { if (i < 0 || i >= this._keys.length) { __badArgs(); } this._keys.splice(i, 1); };
FCurve.prototype.setKeyAtIndex = function (k, i) { this._keys[i] = Key(k); };
FCurve.prototype.update = function () { __stats.fcurveUpdates = (__stats.fcurveUpdates || 0) + 1; };
FCurve.prototype.valueAtTime = function (t) {
  var ks = this._keys, i;
  if (!ks.length) { return 0; }
  if (t <= ks[0].time) { return ks[0].value; }
  for (i = 1; i < ks.length; i++) {
    if (t <= ks[i].time) { return ks[i - 1].value + (ks[i].value - ks[i - 1].value) * (t - ks[i - 1].time) / (ks[i].time - ks[i - 1].time); }
  }
  return ks[ks.length - 1].value;
};

function TakeNode(name, comps) {
  var i;
  __hide(this, '_name', name);
  __hide(this, '_curves', []);
  for (i = 0; i < comps; i++) { this._curves.push(new FCurve()); }
}
TakeNode.prototype.name = function () { return this._name; };
TakeNode.prototype.fCurveCount = function () { return this._curves.length; };
TakeNode.prototype.fCurveAtIndex = function (i) { if (i < 0 || i >= this._curves.length) { __badArgs(); } return this._curves[i]; };
TakeNode.prototype.totalKeyCount = function () { return this._curves.reduce(function (a, c) { return a + c.keyCount(); }, 0); };

function Parameter(rec, owner) { __hide(this, '_r', rec); __hide(this, '_o', owner); }
Parameter.prototype.name = function () { return this._r.n; };
Parameter.prototype.type = function () { return __PTYPE[this._r.t] === undefined ? -1 : __PTYPE[this._r.t]; };
Parameter.prototype.isAnimatable = function () { return __comps(this._r.t) > 0; };
Parameter.prototype.isAnimateable = Parameter.prototype.isAnimatable;
Parameter.prototype.addTakeNode = function (take) {
  var tn = new TakeNode(take, __comps(this._r.t));
  this._r.takeNodes[take] = tn;
  return tn;
};
Parameter.prototype.takeNodeCount = function () { return Object.keys(this._r.takeNodes).length; };
Parameter.prototype.takeNodeAtIndex = function (i) { return this._r.takeNodes[Object.keys(this._r.takeNodes)[i]]; };
Parameter.prototype.takeNodeWithName = function (take) { return this._r.takeNodes[take]; };
Parameter.prototype.connected = function () { return !!this._r.conn; };
Parameter.prototype.connectedWithID = function () { return this._r.conn ? this._r.conn.id : 0; };
Parameter.prototype.connectedWithParameter = function () { return this._r.conn ? this._r.conn.para : ''; };

// ---------------------------------------------------------------- Base (parameters)
function __rec(row) { return { n: row[0], t: row[1], v: __clone(row[2]), takeNodes: {}, conn: null }; }
function __clone(v) { return Array.isArray(v) ? v.slice() : (v && typeof v === 'object' ? { unreadable: v.unreadable } : v); }

function BaseProto() {}
BaseProto.prototype._init = function (cls, table, family, type) {
  __hide(this, '_cls', cls);
  __hide(this, '_family', family);
  __hide(this, '_type', type);
  __hide(this, '_params', table.map(__rec));
};
BaseProto.prototype._find = function (fn, name) {
  var i;
  for (i = 0; i < this._params.length; i++) { if (this._params[i].n === name) { return this._params[i]; } }
  throw new Error(this._cls + '.' + fn + "() couldn't find parameter called " + name);
};
BaseProto.prototype.parameterCount = function () { return this._params.length; };
BaseProto.prototype.parameterAtIndex = function (i) { if (i < 0 || i >= this._params.length) { __badArgs(); } return new Parameter(this._params[i], this); };
BaseProto.prototype.parameterWithName = function (n) { return new Parameter(this._find('parameterWithName', n), this); };
BaseProto.prototype.parameterInfo = function () { return this._params.map(function (p) { return [p.n, p.t]; }); };
BaseProto.prototype.getParameter = function (name) {
  var p = this._find('getParameter', name), n = __VEC_N[p.t], v, comps, take, tn, i, t;
  if (p.t === 'unknown' && name !== 'resolution') { throw new Error('Wrong number or type of arguments'); }
  if (p.v && p.v.unreadable) { throw new Error('Wrong number or type of arguments'); }
  take = __app.doc && __app.doc.currentTake().name;
  tn = take !== undefined ? p.takeNodes[take] : undefined;
  if (tn && tn.totalKeyCount() > 0) {
    t = __app.doc.animPosition();
    comps = []; for (i = 0; i < tn.fCurveCount(); i++) { comps.push(tn.fCurveAtIndex(i).valueAtTime(t)); }
    if (n) { v = new __VEC[p.t](); comps.forEach(function (c, j) { v.__v[j] = c; }); return v; }
    return comps[0];
  }
  if (p.t === 'unknown') { return new Vec2D(p.v[0], p.v[1]); }
  if (n) { v = new __VEC[p.t](); p.v.forEach(function (c, j) { v.__v[j] = c; }); return v; }
  if (p.t === 'Link') { return p.v === null ? undefined : p.v; }
  return p.v;
};
BaseProto.prototype.setParameter = function (name, value) {
  var p = this._find('setParameter', name), t = p.t === 'unknown' && name === 'resolution' ? 'Vec2D' : p.t, n = __VEC_N[t], me = this;
  __stats.setParameter++;
  if (arguments.length < 2 || arguments.length > 3) { __badArgs(); }
  if (n) {
    if (!(value instanceof __VEC[t])) { __badArgs(); }
    p.v = value.__v.slice();
  } else if (t === 'Float' || t === 'Int') {
    if (typeof value !== 'number' || isNaN(value)) { __badArgs(); }
    p.v = t === 'Int' ? Math.round(value) : value;
  } else if (t === 'Bool') {
    if (typeof value !== 'number' && typeof value !== 'boolean') { __badArgs(); }
    p.v = value ? 1 : 0;
  } else if (t === 'String' || t === 'Texture') {
    if (typeof value !== 'string') { __badArgs(); }
    p.v = value;
  } else if (t === 'Link') {
    if (value !== null && value !== undefined && !(value instanceof BaseProto)) { __badArgs(); }
    p.v = value === undefined ? null : value;
  } else { throw new Error('Wrong number or type of arguments'); }
  if (this._cls === 'Object' && this._type === CAMERA && name === 'activeCamera' && value) {
    __app.doc._objects().forEach(function (o) { if (o !== me && o._type === CAMERA) { o._find('setParameter', 'activeCamera').v = 0; } });
  }
};
BaseProto.prototype.family = function () { return this._family; };
BaseProto.prototype.type = function () { return this._type; };
BaseProto.prototype.document = function () { return __app.doc; };
BaseProto.prototype.owner = function () { return this._owner; };
BaseProto.prototype.selection = function () { return 0; };
BaseProto.prototype.script = function () { return ''; };
BaseProto.prototype.scriptPath = function () { return ''; };
BaseProto.prototype.modifiedHint = function () { return 0; };
BaseProto.prototype.modifiedHint2Root = function () { return 0; };
BaseProto.prototype.updateModifiedHint = function () {};
BaseProto.prototype.recordParametersForUndo = function () {};
BaseProto.prototype.recordGeometryForUndo = function () {};
['addParameterBool', 'addParameterButton', 'addParameterColor', 'addParameterFloat', 'addParameterInt', 'addParameterLink', 'addParameterSelector',
  'addParameterSeparator', 'addParameterString', 'addParameterTexture', 'addParameterVec2D', 'addParameterVec3D'].forEach(function (m) {
  BaseProto.prototype[m] = function () { throw new Error(m + '() is only valid inside buildUI'); };
});

function __derive(ctor, methods) {
  ctor.prototype = Object.create(BaseProto.prototype);
  ctor.prototype.constructor = ctor;
  var k; for (k in methods) { ctor.prototype[k] = methods[k]; }
}

// ---------------------------------------------------------------- Cores
function PolyCore() { __hide(this, '_v', []); __hide(this, '_p', []); __hide(this, '_uv', []); }
function __mutate() { __stats.polyCoreMutations++; }
PolyCore.prototype.addVertex = function (meshed, vec) {
  if (typeof meshed !== 'boolean' || !(vec instanceof Vec3D)) { __badArgs(); }
  __stats.addVertex++; __mutate();
  this._v.push([vec.x, vec.y, vec.z]);
  return this._v.length - 1;
};
PolyCore.prototype.addIndexPolygon = function (size, idx, uv) {
  var i;
  if (typeof size !== 'number' || !Array.isArray(idx) || idx.length !== size) { __badArgs(); }
  for (i = 0; i < size; i++) { if (!Number.isInteger(idx[i]) || idx[i] < 0 || idx[i] >= this._v.length) { __fatal('FATAL: bad vertex index'); } }
  if (uv !== undefined && (!Array.isArray(uv) || uv.length !== size)) { __badArgs(); }
  __stats.addIndexPolygon++; __mutate();
  this._p.push(idx.slice());
  this._uv.push(uv ? uv.map(function (u) { return [u.x, u.y]; }) : null);
  return this._p.length - 1;
};
PolyCore.prototype.addPolygon = function () { throw new Error('mock: PolyCore.addPolygon is not implemented'); };
PolyCore.prototype.vertexCount = function () { return this._v.length; };
PolyCore.prototype.polygonCount = function () { return this._p.length; };
PolyCore.prototype.triangleCount = function () { return this._p.reduce(function (a, p) { return a + p.length - 2; }, 0); };
PolyCore.prototype.cornerCount = function () { return this._p.reduce(function (a, p) { return a + p.length; }, 0); };
PolyCore.prototype.vertex = function (i) { var v = this._v[i]; if (!v) { __badArgs(); } return new Vec3D(v[0], v[1], v[2]); };
PolyCore.prototype.vertexIndex = function (p, c) { if (!this._p[p] || this._p[p][c] === undefined) { __badArgs(); } return this._p[p][c]; };
PolyCore.prototype.polygonSize = function (p) { if (!this._p[p]) { __badArgs(); } return this._p[p].length; };
PolyCore.prototype.uvCoord = function (p, c) {
  if (!this._p[p] || this._p[p][c] === undefined) { __badArgs(); }
  var uv = this._uv[p] ? this._uv[p][c] : [0, 0];
  return new Vec4D(uv[0], uv[1], 0, 0);
};
PolyCore.prototype.setVertex = function (i, vec) {
  if (!this._v[i] || !(vec instanceof Vec3D)) { __badArgs(); }
  __mutate();
  this._v[i] = [vec.x, vec.y, vec.z];
};
PolyCore.prototype.setUVCoord = function () { __mutate(); };
PolyCore.prototype.flipWinding = function (p) { if (!this._p[p]) { __badArgs(); } __mutate(); this._p[p].reverse(); if (this._uv[p]) { this._uv[p].reverse(); } };
PolyCore.prototype.deletePolygon = function (p) { if (!this._p[p]) { __badArgs(); } __mutate(); this._p.splice(p, 1); this._uv.splice(p, 1); };
PolyCore.prototype.deleteVertex = function (v) {
  var i;
  if (!this._v[v]) { __badArgs(); }
  __mutate();
  for (i = this._p.length - 1; i >= 0; i--) { if (this._p[i].indexOf(v) >= 0) { this._p.splice(i, 1); this._uv.splice(i, 1); } }
  this._v.splice(v, 1);
  this._p = this._p.map(function (p) { return p.map(function (x) { return x > v ? x - 1 : x; }); });
};
PolyCore.prototype.mergeVertices = function (tol) {
  var map = [], keep = [], i, j, d, self = this;
  __mutate();
  for (i = 0; i < this._v.length; i++) {
    map[i] = -1;
    for (j = 0; j < keep.length && map[i] < 0; j++) {
      d = Math.sqrt(Math.pow(this._v[i][0] - this._v[keep[j]][0], 2) + Math.pow(this._v[i][1] - this._v[keep[j]][1], 2) + Math.pow(this._v[i][2] - this._v[keep[j]][2], 2));
      if (d <= tol) { map[i] = j; }
    }
    if (map[i] < 0) { keep.push(i); map[i] = keep.length - 1; }
  }
  this._p = this._p.map(function (p) { return p.map(function (x) { return map[x]; }); });
  this._v = keep.map(function (i2) { return self._v[i2]; });
};
PolyCore.prototype.normal = function () { return new Vec3D(0, 0, 1); };
PolyCore.prototype.triangle = function (p, t) { var q = this._p[p]; if (!q) { __badArgs(); } return [q[0], q[t + 1], q[t + 2]]; };
PolyCore.prototype.materialTagIndex = function () { return 0; };
['vertexSelection', 'polygonSelection', 'edgeSelection'].forEach(function (m) { PolyCore.prototype[m] = function () { return false; }; });
['setVertexSelection', 'setPolygonSelection', 'setEdgeSelection', 'setActivePolygonSelection', 'buildVertexBSP', 'destroyVertexBSP'].forEach(function (m) {
  PolyCore.prototype[m] = function () {};
});

function SplineCore() { __hide(this, '_ops', []); __hide(this, '_paths', 0); __hide(this, '_cur', null); }
SplineCore.prototype.move = function (v) { if (!(v instanceof Vec3D)) { __badArgs(); } this._paths++; this._cur = v; this._ops.push(['move', v.x, v.y, v.z]); };
SplineCore.prototype.line = function (v) { if (!(v instanceof Vec3D) || !this._cur) { __badArgs(); } this._cur = v; this._ops.push(['line', v.x, v.y, v.z]); };
SplineCore.prototype.curve = function (a, b, v) {
  if (!(a instanceof Vec3D) || !(b instanceof Vec3D) || !(v instanceof Vec3D) || !this._cur) { __badArgs(); }
  this._cur = v; this._ops.push(['curve', a.x, a.y, a.z, b.x, b.y, b.z, v.x, v.y, v.z]);
};
SplineCore.prototype.close = function () { this._ops.push(['close']); };
SplineCore.prototype.currentPoint = function () { return this._cur; };
SplineCore.prototype.pathCount = function () { return this._paths; };
SplineCore.prototype.cache = function () { return []; };

function __cube(core) {
  var v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  v.forEach(function (p) { core._v.push(p); });
  [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]].forEach(function (p) { core._p.push(p); core._uv.push(null); });
}

// ---------------------------------------------------------------- Tag / Object
function Tag(typeName, owner) {
  var d = __PARAMDATA.tags[typeName] || { type: __PARAMDATA.consts[typeName], family: 6, params: __PARAMDATA.tags.MODETAG.params };
  this._init('Tag', d.params, 6, d.type);
  __hide(this, '_owner', owner);
  __hide(this, '_updates', 0);
}
__derive(Tag, {
  linkedToMaterial: function () { return 0; },
  tag2WorldMatrix: function () { return new Mat4D(); },
  update: function () { this._updates++; },
  addCluster: function () { throw new Error('mock: Tag.addCluster is not implemented'); },
  clusterAtIndex: function () { __badArgs(); },
  clusterCount: function () { return 0; },
  removeClusterAtIndex: function () { __badArgs(); }
});

var __TYPE_NAME = {};
Object.keys(__PARAMDATA.objects).forEach(function (k) { __TYPE_NAME[__PARAMDATA.objects[k].type] = k; });
var __TAG_NAME = {};
Object.keys(__PARAMDATA.consts).forEach(function (k) { if (/TAG$/.test(k)) { __TAG_NAME[__PARAMDATA.consts[k]] = k; } });

function C3DObject(typeName, isRoot) {
  var d = isRoot ? { name: 'Root', family: 0, type: FOLDER, hasCore: false, params: __PARAMDATA.objects.FOLDER.params } : __PARAMDATA.objects[typeName];
  this._init('Object', d.params, d.family, d.type);
  __hide(this, '_id', isRoot ? 1 : ++__app.nextId);
  __hide(this, '_children', []);
  __hide(this, '_tags', []);
  __hide(this, '_parent', null);
  __hide(this, '_hasCore', d.hasCore);
  __hide(this, '_core', null);
  __hide(this, '_updates', 0);
  if (!isRoot) { this._find('setParameter', 'name').v = d.name; }
}
__derive(C3DObject, {
  id: function () { return this._id; },
  childCount: function () { return this._children.length; },
  childAtIndex: function (i) { if (!Number.isInteger(i) || i < 0 || i >= this._children.length) { __badArgs(); } return this._children[i]; },
  addChildAtIndex: function (child, i) {
    var a;
    if (!(child instanceof C3DObject) || !Number.isInteger(i)) { __badArgs(); }
    for (a = this; a; a = a._parent) { if (a === child) { throw new Error('Object.addChildAtIndex() would create a cycle'); } }
    if (child._parent) { child._parent._children.splice(child._parent._children.indexOf(child), 1); }
    child._parent = this;
    this._children.splice(Math.max(0, Math.min(i, this._children.length)), 0, child);
  },
  removeChild: function (obj) {
    var i = this._children.indexOf(obj);
    if (i < 0) { throw new Error('Object.removeChild() object is not a child'); }
    this._children.splice(i, 1);
    obj._parent = null;
  },
  addTagOfType: function (type) {
    var name = __TAG_NAME[type], tag;
    if (typeof type !== 'number' || !name) { __badArgs(); }
    if (name === 'BAKETAG' && this._family !== NGONFAMILY) { __modal('Texture baking error!'); }
    tag = new Tag(name, this);
    this._tags.push(tag);
    return tag;
  },
  tagCount: function () { return this._tags.length; },
  tagAtIndex: function (i) { if (!Number.isInteger(i) || i < 0 || i >= this._tags.length) { __badArgs(); } return this._tags[i]; },
  tagOfType: function (t) { return this._tags.filter(function (x) { return x._type === t; })[0]; },
  removeTag: function (tag) {
    var i = this._tags.indexOf(tag);
    if (i < 0) { throw new Error('Object.removeTag() tag does not belong to this object'); }
    this._tags.splice(i, 1);
  },
  materialTags: function () { return this._tags.filter(function (t) { return t._type === SHADERTAG; }); },
  core: function () {
    if (!this._hasCore) { return undefined; }
    if (!this._core) {
      if (this._family === 2) { this._core = new SplineCore(); }
      else if (this._family === 5) { this._core = new PolyCore(); if (this._type !== POLYGONOBJ) { __cube(this._core); } }
    }
    return this._core;
  },
  modCore: function () { return this.core(); },
  obj2WorldMatrix: function () {
    var m = new Mat4D(), o;
    for (o = this; o && o._parent; o = o._parent) {
      m.m03 += o._find('getParameter', 'position').v[0]; m.m13 += o._find('getParameter', 'position').v[1]; m.m23 += o._find('getParameter', 'position').v[2];
    }
    return m;
  },
  objMatrix: function () { return new Mat4D(); },
  update: function () { this._updates++; },
  isCreatorObj: function () { return false; },
  setCreatorObj: function () {}
});

// ---------------------------------------------------------------- Material / Node
function Node(typeName, mat) {
  var d = typeName === __PARAMDATA.rootNode.type ? __PARAMDATA.rootNode : __PARAMDATA.nodes[typeName], names, outNames = ['color', 'val', 'vec', 'R', 'G', 'B', 'A', 'alpha'];
  this._init('Node', d.params, 10, 0);
  names = d.params.map(function (p) { return p[0]; }).filter(function (n) { return n !== 'scriptName' && n !== 'locked'; });
  __hide(this, '_id', 50000000 + (++__app.nextId) * 131);
  __hide(this, '_nodeType', typeName);
  __hide(this, '_in', names.slice(0, d.ins).map(function (n) { return new Parameter(__rec([n, 'Float', 0]), null); }));
  __hide(this, '_out', outNames.slice(0, d.outs).map(function (n) { return new Parameter(__rec([n, 'Float', 0]), null); }));
  __hide(this, '_mat', mat);
}
__derive(Node, {
  id: function () { return this._id; },
  nodeType: function () { return this._nodeType; },
  frame: function () { return new Vec4D(0, 0, 100, 100); },
  setFrame: function () {},
  update: function () { __stats.nodeUpdates = (__stats.nodeUpdates || 0) + 1; },
  inputCount: function () { return this._in.length; },
  outputCount: function () { return this._out.length; },
  inputAtIndex: function (i) { if (!this._in[i]) { __badArgs(); } return this._in[i]; },
  outputAtIndex: function (i) { if (!this._out[i]) { __badArgs(); } return this._out[i]; },
  inputWithName: function (n) { return this._in.filter(function (p) { return p.name() === n; })[0]; },
  outputWithName: function (n) { return this._out.filter(function (p) { return p.name() === n; })[0]; }
});

var __ROOT_FOR = { 'Material (PBR)': 'pbrmetal', Toon: 'toon', Glass: 'dielectric' };

function Material(name, type) {
  this._init('Material', __PARAMDATA.material, 9, 0);
  this._find('setParameter', 'name').v = name;
  __hide(this, '_nodes', []);
  this._nodes.push(new Node(__ROOT_FOR[type] || __PARAMDATA.rootNode.type, this));
}
__derive(Material, {
  rootNode: function () { return this._nodes[0]; },
  nodeCount: function () { return this._nodes.length; },
  nodeAtIndex: function (i) { if (!this._nodes[i]) { __badArgs(); } return this._nodes[i]; },
  nodeWithID: function (id) { return this._nodes.filter(function (n) { return n._id === id; })[0]; },
  addNodeOfType: function (type) {
    if (typeof type !== 'string' || !__PARAMDATA.nodes[type]) { throw new Error('Material.addNodeOfType() unknown node type ' + type); }
    var n = new Node(type, this);
    this._nodes.push(n);
    return n;
  },
  addConnection: function (fromID, fromPara, toID, toPara) {
    var from = this.nodeWithID(fromID), to = this.nodeWithID(toID), inp;
    if (!from || !to || !from.outputWithName(fromPara)) { return false; }
    inp = to.inputWithName(toPara);
    if (!inp) { return false; }
    inp._r.conn = { id: fromID, para: fromPara };
    return true;
  },
  removeConnection: function (nodeID, para) {
    var n = this.nodeWithID(nodeID), inp = n && n.inputWithName(para);
    if (!inp || !inp._r.conn) { return false; }
    inp._r.conn = null;
    return true;
  },
  color: function () { return new Vec4D(0.7, 0.7, 0.7, 1); },
  colorMap: function () { return ''; },
  emission: function () { return new Vec4D(0, 0, 0, 1); },
  reflection: function () { return new Vec4D(0, 0, 0, 1); },
  specular: function () { return new Vec4D(0, 0, 0, 1); },
  transmission: function () { return new Vec4D(0, 0, 0, 1); },
  shininess: function () { return 80; },
  rib: function () { return ''; }
});

// ---------------------------------------------------------------- Renderer / Take
function Renderer(index) {
  this._init('Renderer', __PARAMDATA.renderer, 11, index === 0 ? CHEETAH : FALCON);
}
__derive(Renderer, {});

function Take(name) { this.name = name; this.length = 10; this.previewFrom = 0; this.previewTo = 10; }

// ---------------------------------------------------------------- Document
var __SAVE_TYPES = ['jas', 'obj', 'fbx', 'dae', 'stl', '3ds', 'usdz', 'gltf', 'glb', 'dxf'];

function MockDocument() {
  __hide(this, '_root', new C3DObject(null, true));
  __hide(this, '_mats', []);
  __hide(this, '_takes', [new Take('Main')]);
  __hide(this, '_take', 0);
  __hide(this, '_renderers', [new Renderer(0), new Renderer(1)]);
  __hide(this, '_ri', 0);
  __hide(this, '_sel', []);
  __hide(this, '_time', 0);
  __hide(this, '_fps', 30);
  __hide(this, '_lock', 0);
}
MockDocument.prototype._objects = function () {
  var out = [], stack = [this._root], o;
  while (stack.length) { o = stack.pop(); out.push(o); stack = stack.concat(o._children); }
  return out;
};
MockDocument.prototype.fileName = function () { return __app.fileName; };
MockDocument.prototype.root = function () { return this._root; };
MockDocument.prototype.addObject = function (type) {
  var name = __TYPE_NAME[type], o;
  if (typeof type !== 'number' || !name) { __badArgs(); }
  o = new C3DObject(name, false);
  o._parent = this._root;
  this._root._children.push(o);
  if (type === CAMERA) { o.setParameter('activeCamera', 1); }
  return o;
};
MockDocument.prototype.selectedObject = function () { return this._sel[0]; };
MockDocument.prototype.selectedObjects = function (flat) { if (typeof flat !== 'boolean') { __badArgs(); } return this._sel.slice(); };
MockDocument.prototype.selectObject = function (obj, extend) {
  if (!(obj instanceof C3DObject) || typeof extend !== 'boolean') { __badArgs(); }
  if (obj === this._root) { if (!extend) { this._sel = []; } return; }
  if (!extend) { this._sel = [obj]; } else if (this._sel.indexOf(obj) < 0) { this._sel.push(obj); }
};
MockDocument.prototype.activeCamera = function () {
  return this._objects().filter(function (o) { return o._type === CAMERA && o._find('getParameter', 'activeCamera').v; })[0];
};
MockDocument.prototype.editMode = function () { return OBJECT_MODE; };
MockDocument.prototype.addMaterial = function (type, name) {
  var base = name, n = 2, taken = this._mats.map(function (m) { return m.getParameter('name'); });
  if (typeof type !== 'string' || typeof name !== 'string') { __badArgs(); }
  while (taken.indexOf(name) >= 0) { name = base + '.' + (n++); }
  var m = new Material(name, type);
  this._mats.push(m);
  return m;
};
MockDocument.prototype.materialCount = function () { return this._mats.length; };
MockDocument.prototype.materialAtIndex = function (i) { if (!this._mats[i]) { __badArgs(); } return this._mats[i]; };
MockDocument.prototype.removeMaterial = function (m) {
  var i = this._mats.indexOf(m);
  if (i < 0) { throw new Error('Document.removeMaterial() unknown material'); }
  this._mats.splice(i, 1);
};
MockDocument.prototype.rendererCount = function () { return this._renderers.length; };
MockDocument.prototype.rendererAtIndex = function (i) { if (!this._renderers[i]) { __badArgs(); } return this._renderers[i]; };
MockDocument.prototype.currentRenderer = function () { return this._renderers[this._ri]; };
MockDocument.prototype.setCurrentRenderer = function (i) { if (!this._renderers[i]) { __badArgs(); } this._ri = i; };
MockDocument.prototype.takeCount = function () { return this._takes.length; };
MockDocument.prototype.takeAtIndex = function (i) { if (!this._takes[i]) { __badArgs(); } return this._takes[i]; };
MockDocument.prototype.takeWithName = function (n) { return this._takes.filter(function (t) { return t.name === n; })[0]; };
MockDocument.prototype.currentTake = function () { return this._takes[this._take]; };
MockDocument.prototype.addTake = function (n) { var t = new Take(n); this._takes.push(t); return t; };
MockDocument.prototype.removeTake = function (n) {
  var t = this.takeWithName(n);
  if (!t) { throw new Error('Document.removeTake() unknown take'); }
  var cur = this.currentTake();
  this._takes.splice(this._takes.indexOf(t), 1);
  this._take = Math.max(0, this._takes.indexOf(cur));
};
MockDocument.prototype.renameTake = function (a, b) { var t = this.takeWithName(a); if (!t) { throw new Error('Document.renameTake() unknown take'); } t.name = b; };
MockDocument.prototype.setCurrentTake = function (n) { var t = this.takeWithName(n); if (!t) { throw new Error('Document.setCurrentTake() unknown take'); } this._take = this._takes.indexOf(t); };
MockDocument.prototype.animPosition = function () { return this._time; };
MockDocument.prototype.setAnimPosition = function (t) { if (typeof t !== 'number') { __badArgs(); } this._time = t; };
MockDocument.prototype.animationTime = MockDocument.prototype.animPosition;
MockDocument.prototype.setAnimationTime = MockDocument.prototype.setAnimPosition;
MockDocument.prototype.animationEnd = function () { return 10; };
MockDocument.prototype.animationFPS = function () { return this._fps; };
MockDocument.prototype.setAnimationFPS = function (n) { if (typeof n !== 'number') { __badArgs(); } this._fps = n; };
MockDocument.prototype.setWindowFrame = function () {};
MockDocument.prototype.retainRedrawLock = function () { __stats.retain++; this._lock++; };
MockDocument.prototype.releaseRedrawLock = function () { __stats.release++; if (this._lock > 0) { this._lock--; } };
MockDocument.prototype.redrawAll = function () { __stats.redraws++; };
MockDocument.prototype.render = function (path) {
  var r = this.currentRenderer(), res = r.getParameter('resolution'), m = /\.([^./]*)$/.exec(String(path)), ext = m ? m[1].toLowerCase() : '';
  if (arguments.length !== 1 || typeof path !== 'string') { __badArgs(); }
  if (ext !== 'png' && ext !== 'jpg' && ext !== 'tiff') { __modal('Fileformat .' + ext + ' is not supported. Please use either .jpg, .tiff or .png'); }
  if (!__native.writeLatin1(path, 'MOCKIMG ' + res.x + 'x' + res.y + ' t=' + this._time, false)) { throw new Error('Document.render() cannot write ' + path); }
  __stats.renders++;
  __app.lastRender = { path: path, width: res.x, height: res.y, time: this._time };
};
MockDocument.prototype.saveToFile = function (path, type) {
  if (typeof path !== 'string' || typeof type !== 'string') { __badArgs(); }
  __stats.saves++;
  if (__SAVE_TYPES.indexOf(type) < 0) { return undefined; }
  __native.writeLatin1(path, 'MOCKSAVE ' + type + ' ' + this._objects().length, false);
  if (type === 'obj') { __native.writeLatin1(path.replace(/\.obj$/, '') + '.mtl', 'MOCKMTL', false); }
  return undefined;
};

// Scene dump used by test assertions (not part of the API surface seen by the runtime).
function __dumpScene(o) {
  o = o || __app.doc.root();
  return { id: o._id, name: o._cls === 'Object' ? o._find('getParameter', 'name').v : '', type: __TYPE_NAME[o._type] || o._type, tags: o._tags.map(function (t) { return __TAG_NAME[t._type]; }), children: o._children.map(__dumpScene) };
}

__app.doc = new MockDocument();
var doc = __app.doc;
