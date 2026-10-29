// Vec/Mat/FCurveKey mocks. Components are non-enumerable accessors like the host CallbackObject:
// JSON.stringify(vec) gives "{}" and String(vec) gives "[object CallbackObject]" (P05/P16).
function __hide(o, k, v) { Object.defineProperty(o, k, { value: v, writable: true, enumerable: false, configurable: true }); }
function __badArgs() { throw new Error('Wrong number or type of arguments'); }

function __makeVec(name, n) {
  var AX = ['x', 'y', 'z', 'w'].slice(0, n);
  function V() {
    var v = [], i;
    if (!(this instanceof V)) { throw new TypeError(name + ' constructor requires new'); }
    if (arguments.length !== 0 && arguments.length !== n) { __badArgs(); }
    for (i = 0; i < n; i++) {
      if (arguments.length && (typeof arguments[i] !== 'number' || isNaN(arguments[i]))) { __badArgs(); }
      v.push(arguments.length ? arguments[i] : 0);
    }
    __hide(this, '__v', v);
  }
  AX.forEach(function (k, i) {
    Object.defineProperty(V.prototype, k, { get: function () { return this.__v[i]; }, set: function (x) { this.__v[i] = x; }, enumerable: false, configurable: true });
  });
  V.prototype.toString = function () { return '[object CallbackObject]'; };
  V.prototype.copy = function () { var c = new V(); c.__v = this.__v.slice(); return c; };
  V.prototype.set = function () { var i; if (arguments.length !== n) { __badArgs(); } for (i = 0; i < n; i++) { this.__v[i] = arguments[i]; } };
  V.prototype.isEqual = function (o) { return this.__v.every(function (x, i) { return x === o.__v[i]; }); };
  V.prototype.add = function (o) { var c = this.copy(); c.__v = c.__v.map(function (x, i) { return x + o.__v[i]; }); return c; };
  V.prototype.sub = function (o) { var c = this.copy(); c.__v = c.__v.map(function (x, i) { return x - o.__v[i]; }); return c; };
  V.prototype.multiply = function (s) { var c = this.copy(); c.__v = c.__v.map(function (x) { return x * s; }); return c; };
  V.prototype.norm = function () { return Math.sqrt(this.__v.reduce(function (a, x) { return a + x * x; }, 0)); };
  V.prototype.inverse = function () { var c = this.copy(); c.__v = c.__v.map(function (x) { return -x; }); return c; };
  return V;
}

var Vec2D = __makeVec('Vec2D', 2);
var Vec3D = __makeVec('Vec3D', 3);
var Vec4D = __makeVec('Vec4D', 4);
Vec3D.prototype.dot = function (o) { return this.x * o.x + this.y * o.y + this.z * o.z; };
Vec3D.prototype.cross = function (o) { return new Vec3D(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z, this.x * o.y - this.y * o.x); };

function __makeMat(name, n) {
  function M(type, x, y, z) {
    var r, c;
    for (r = 0; r < n; r++) { for (c = 0; c < n; c++) { this['m' + r + c] = r === c ? 1 : 0; } }
    if (type === TRANSLATE && n === 4) { this.m03 = x; this.m13 = y; this.m23 = z; }
    if (type === SCALE) { this.m00 = x; this.m11 = y; this.m22 = z; }
  }
  M.prototype.copy = function () { var c = new M(); Object.keys(this).forEach(function (k) { c[k] = this[k]; }, this); return c; };
  M.prototype.multiply = function (o) {
    var out = new M(), r, c, k, s;
    for (r = 0; r < n; r++) { for (c = 0; c < n; c++) { s = 0; for (k = 0; k < n; k++) { s += this['m' + r + k] * o['m' + k + c]; } out['m' + r + c] = s; } }
    return out;
  };
  M.prototype.concat = M.prototype.multiply;
  M.prototype.transpose = function () { var out = new M(), r, c; for (r = 0; r < n; r++) { for (c = 0; c < n; c++) { out['m' + r + c] = this['m' + c + r]; } } return out; };
  ['adjoint', 'determinant', 'inverse'].forEach(function (m) { M.prototype[m] = function () { throw new Error('mock: Mat.' + m + ' is not implemented'); }; });
  return M;
}
var Mat3D = __makeMat('Mat3D', 3);
var Mat4D = __makeMat('Mat4D', 4);

function FCurveKey() {
  this.time = 0;
  this.value = 0;
  this.selected = false;
  this.left_type = 0;
  this.left_time = -0.1667;
  this.left_value = 0;
  this.right_type = 0;
  this.right_time = 0.1667;
  this.right_value = 0;
}
