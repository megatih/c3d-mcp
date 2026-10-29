/* util: errors, ASCII JSON, checksums, file helpers. */
var C3D = {};
C3D.util = (function () {
  var RealFile = File;
  var GLOBAL = (function () { return this; })();
  var VERSION = '__C3D_RUNTIME_VERSION__';

  function C3DError(code, message, details, hint) {
    this.isC3D = true;
    this.code = code;
    this.message = message;
    if (details !== undefined) { this.details = details; }
    if (hint) { this.hint = hint; }
  }

  function fail(code, message, details, hint) {
    throw new C3DError(code, message, details, hint);
  }

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNumber(v) { return typeof v === 'number' && isFinite(v); }
  function isInt(v) { return isNumber(v) && Math.floor(v) === v; }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function pad(s, n) {
    s = String(s);
    while (s.length < n) { s = '0' + s; }
    return s;
  }

  // P05: File.write truncates non-ASCII and File.read counts bytes, so every file is ASCII with \uXXXX escapes.
  function asciiEscape(text) {
    return text.replace(/[\u007f-\uffff]/g, function (c) { return '\\u' + pad(c.charCodeAt(0).toString(16), 4); });
  }

  function toJSON(value) { return asciiEscape(JSON.stringify(value)); }

  function adler32(text) {
    var a = 1, b = 0, i;
    for (i = 0; i < text.length; i++) {
      a = (a + (text.charCodeAt(i) & 255)) % 65521;
      b = (b + a) % 65521;
    }
    return pad(((b * 65536) + a).toString(16), 8);
  }

  function escapeName(name) { return String(name).replace(/\\/g, '\\\\').replace(/\//g, '\\/'); }

  // "/A/B\/C" -> ["A", "B/C"]; "/" -> []
  function splitPath(path) {
    var parts = [], cur = '', i, c;
    if (typeof path !== 'string' || path.charAt(0) !== '/') { fail('INVALID_ARGUMENT', 'path must start with "/"', { path: path }); }
    for (i = 1; i < path.length; i++) {
      c = path.charAt(i);
      if (c === '\\' && i + 1 < path.length) { cur += path.charAt(++i); }
      else if (c === '/') { parts.push(cur); cur = ''; }
      else { cur += c; }
    }
    if (cur !== '') { parts.push(cur); }
    return parts;
  }

  function readText(path) {
    var f = new RealFile(path), text;
    if (!f.exist()) { return null; }
    f.open(READ_MODE);
    if (!f.isOpen()) { return null; }
    var size = f.size();
    text = size > 0 ? f.read(size) : '';
    f.close();
    return text;
  }

  function writeText(path, text) {
    var f = new RealFile(path);
    f.open(WRITE_MODE);
    if (!f.isOpen()) { fail('INTERNAL', 'cannot open for writing: ' + path); }
    f.write(text);
    f.close();
  }

  function exists(path) { return new RealFile(path).exist(); }
  function isDir(path) { return new RealFile(path).isDir(); }
  function fileSize(path) { return new RealFile(path).size(); }
  function listDir(path) {
    var names = new RealFile(path).contentOfDir(), out = [], i;
    if (!names) { return out; }
    for (i = 0; i < names.length; i++) { out.push(names[i]); }
    return out;
  }

  function startsWith(s, p) { return s.substring(0, p.length) === p; }
  function endsWith(s, p) { return s.length >= p.length && s.substring(s.length - p.length) === p; }

  function typeofGlobal(name) { return typeof GLOBAL[name]; }
  function globalValue(name) { return GLOBAL[name]; }

  return {
    VERSION: VERSION, GLOBAL: GLOBAL, RealFile: RealFile, C3DError: C3DError, fail: fail,
    isObject: isObject, isNumber: isNumber, isInt: isInt, hasOwn: hasOwn, pad: pad,
    asciiEscape: asciiEscape, toJSON: toJSON, adler32: adler32, escapeName: escapeName, splitPath: splitPath,
    readText: readText, writeText: writeText, exists: exists, isDir: isDir, fileSize: fileSize, listDir: listDir,
    startsWith: startsWith, endsWith: endsWith, typeofGlobal: typeofGlobal, globalValue: globalValue
  };
})();
