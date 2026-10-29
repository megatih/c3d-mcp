/* exec: best-effort sandbox for user JavaScript (PRD section 4). Same-user threat model, NOT a security boundary. */
(function () {
  var U = C3D.util, S = C3D.scene;
  var RealFunction = Function;
  var RealOS = OS;
  var FILE_METHODS = ['close', 'contentOfDir', 'copyTo', 'directory', 'exist', 'extension', 'getpos', 'isDir', 'isOpen', 'lastPathComponent', 'mkDir',
    'open', 'read', 'readFloat', 'readShort', 'readUInt', 'readln', 'seek', 'setpos', 'size', 'write', 'writeFloat', 'writeInt', 'writeShort', 'writeUInt', 'writeln'];
  var WRITE_METHODS = ['write', 'writeFloat', 'writeInt', 'writeShort', 'writeUInt', 'writeln'];
  var NOT_JSON = {};

  function blocked(what) { return function () { throw new Error('C3D sandbox: ' + what + ' is not allowed'); }; }

  function isWritable(path, roots) {
    var i, r;
    if (typeof path !== 'string' || path.charAt(0) !== '/' || path.indexOf('/../') >= 0 || U.endsWith(path, '/..')) { return false; }
    for (i = 0; i < roots.length; i++) {
      r = roots[i];
      if (path === r || U.startsWith(path, r.charAt(r.length - 1) === '/' ? r : r + '/')) { return true; }
    }
    return false;
  }

  var READ = READ_MODE; // captured at load: a script must not be able to loosen the write check by reassigning the global

  function guardedOS(shellAllowed) {
    var os = { beep: function () { return RealOS.beep(); } };
    os.messageBox = blocked('OS.messageBox');
    os.runOpenPanel = blocked('OS.runOpenPanel');
    os.runSavePanel = blocked('OS.runSavePanel');
    os.system = shellAllowed ? function (cmd) { return RealOS.system(cmd); } : blocked('OS.system');
    return os;
  }

  // Reads anywhere; writes only below the roots (MCP tmp dir + allowFiles); mkDir always throws (it deletes existing paths).
  function guardedFile(roots) {
    function GuardedFile(path) {
      var real = new U.RealFile(path), self = this, i;
      function delegate(name) { self[name] = function () { return real[name].apply(real, arguments); }; }
      for (i = 0; i < FILE_METHODS.length; i++) { delegate(FILE_METHODS[i]); }
      self.mkDir = blocked('File.mkDir');
      self.open = function (mode, endian) {
        if (mode !== READ && !isWritable(path, roots)) { blocked('writing ' + path)(); }
        if (mode === READ && /\/MCP\/secret$/.test(String(path))) { blocked('reading the bridge secret')(); }
        return endian === undefined ? real.open(mode) : real.open(mode, endian);
      };
      self.copyTo = function (to) {
        if (!isWritable(to, roots)) { blocked('copying to ' + to)(); }
        return real.copyTo(to);
      };
      for (i = 0; i < WRITE_METHODS.length; i++) { (function (m) { self[m] = function () { return real[m].apply(real, arguments); }; })(WRITE_METHODS[i]); }
    }
    GuardedFile.mkDir = blocked('File.mkDir');
    return GuardedFile;
  }

  // Function.prototype.constructor (and the async/generator variants) is a route to the real Function constructor.
  function neutralizeConstructors() {
    var protos = [RealFunction.prototype], saved = [], stub = blocked('the Function constructor'), srcs = ['return async function () {}', 'return function* () {}', 'return async function* () {}'], i, p;
    for (i = 0; i < srcs.length; i++) {
      try { p = Object.getPrototypeOf(new RealFunction(srcs[i])()); if (protos.indexOf(p) < 0) { protos.push(p); } } catch (e) { /* engine lacks this function kind */ }
    }
    for (i = 0; i < protos.length; i++) {
      saved.push(Object.getOwnPropertyDescriptor(protos[i], 'constructor'));
      Object.defineProperty(protos[i], 'constructor', { value: stub, writable: true, configurable: true, enumerable: false });
    }
    return function () {
      for (var j = 0; j < protos.length; j++) {
        if (saved[j]) { Object.defineProperty(protos[j], 'constructor', saved[j]); } else { delete protos[j].constructor; }
      }
    };
  }

  // Only own data properties are read: a getter would run user code (possibly after teardown, historically a sandbox escape).
  function dataProp(v, key) {
    var d = Object.getOwnPropertyDescriptor(v, key);
    if (!d || d.get || d.set) { throw NOT_JSON; }
    return d.value;
  }

  function plain(v, depth) {
    var out, i, keys;
    if (depth > 20) { throw NOT_JSON; }
    if (v === null || v === undefined) { return null; }
    if (typeof v === 'boolean' || typeof v === 'string') { return v; }
    if (typeof v === 'number') { if (!isFinite(v)) { throw NOT_JSON; } return v; }
    if (Array.isArray(v)) { out = []; for (i = 0; i < v.length; i++) { out.push(plain(dataProp(v, String(i)), depth + 1)); } return out; }
    if (typeof v === 'object') {
      if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) {
        out = {}; keys = Object.keys(v);
        for (i = 0; i < keys.length; i++) { out[keys[i]] = plain(dataProp(v, keys[i]), depth + 1); }
        return out;
      }
      if (typeof v.x === 'number' && typeof v.y === 'number') {
        out = { x: v.x, y: v.y };
        if (typeof v.z === 'number') { out.z = v.z; }
        if (typeof v.w === 'number') { out.w = v.w; }
        return out;
      }
    }
    throw NOT_JSON;
  }

  function describeResult(v) {
    try { return { value: plain(v, 0), returned: 'json-able' }; }
    catch (e) {
      if (e !== NOT_JSON) { throw e; }
      try { return { value: String(v), returned: null }; } catch (e2) { return { value: null, returned: null }; }
    }
  }

  // Live finding (crash #2): doc.removeMaterial on a material created in the same macro run crashes Cheetah3D 8.1.3 at idle
  // (dangling wrapper release). Removing a material from an earlier run is fine. Scripts get a doc whose removeMaterial refuses
  // the unsafe case; every other member passes through bound to the real document.
  function guardedDoc(realDoc) {
    var startCount, added = false;
    if (typeof Proxy !== 'function') { return realDoc; }
    try { startCount = realDoc.materialCount(); } catch (e) { return realDoc; }
    return new Proxy(realDoc, {
      get: function (target, key) {
        var v = target[key];
        if (key === 'addMaterial') { return function () { added = true; return v.apply(target, arguments); }; }
        if (key === 'removeMaterial') {
          return function (arg) {
            if (added && (typeof arg !== 'number' || arg >= startCount)) {
              U.fail('UNSUPPORTED', 'doc.removeMaterial on a material created in the same script run crashes Cheetah3D 8.1.3. Create the material in one c3d call and remove it in a later one (c3d_run_script or the removeMaterial op), or leave it unused.');
            }
            return v.apply(target, arguments);
          };
        }
        return typeof v === 'function' ? function () { return v.apply(target, arguments); } : v;
      },
      set: function (target, key, value) { target[key] = value; return true; }
    });
  }

  C3D.core.define('run', 'W', function (ctx, a) {
    var lines = [], roots = [ctx.dir + 'tmp'], i, fn, body, os, file, facade, restoreCtor, value, docFacade, G = U.GLOBAL, realOS = G.OS, realFile = G.File, done = false, res;
    if (typeof a.code !== 'string') { U.fail('INVALID_ARGUMENT', 'code must be a string'); }
    if (a.allowFiles !== undefined) {
      if (!Array.isArray(a.allowFiles)) { U.fail('INVALID_ARGUMENT', 'allowFiles must be an array of absolute paths'); }
      for (i = 0; i < a.allowFiles.length; i++) {
        if (typeof a.allowFiles[i] !== 'string' || a.allowFiles[i].charAt(0) !== '/') { U.fail('INVALID_ARGUMENT', 'allowFiles entries must be absolute paths'); }
        roots.push(a.allowFiles[i]);
      }
    }
    function print() {
      var parts = [], j, line;
      for (j = 0; j < arguments.length; j++) { parts.push(String(arguments[j])); }
      line = parts.join(' ');
      lines.push(line);
      C3D.core.log('print: ' + line);
    }
    os = guardedOS(a.allowShellToken === 'OS.system');
    file = guardedFile(roots);
    facade = {
      runtimeVersion: U.VERSION,
      find: function (ref) { S.invalidate(ctx); return S.resolveObject(ctx, ref); }
    };
    // "use strict" forbids a parameter named eval, so the strict user body lives in an inner function. The standalone parse
    // first guarantees the body cannot close the wrapper (an unbalanced "}" is a syntax error on its own).
    docFacade = guardedDoc(ctx.doc);
    body = "'use strict';\n" + a.code;
    try {
      new RealFunction(body);
      fn = new RealFunction('doc', 'OS', 'File', 'C3D', 'print', 'eval', 'Function', 'geval', 'globalThis', 'return (function () {\n' + body + '\n}).call(undefined);');
    } catch (e) {
      U.fail('SCRIPT_ERROR', e.message, { message: e.message, line: e.line });
    }
    restoreCtor = neutralizeConstructors();
    try {
      // Live finding: in the real app OS and File are non-writable, non-configurable globals, so this shadowing is a no-op there.
      // Containment relies on the strict inner function (this === undefined), the shadowed parameters and the neutralized constructors.
      try { G.OS = os; G.File = file; } catch (e3) { /* read-only global */ }
      value = fn.call(undefined, docFacade, os, file, facade, print, blocked('eval'), blocked('Function'), blocked('geval'), undefined);
      done = true;
      // Serialize while the containment is still in place: String()/JSON conversion can call user-defined code.
      res = describeResult(value);
    } catch (e2) {
      if (e2 && e2.isC3D) { throw e2; }
      throw new U.C3DError('SCRIPT_ERROR', String(e2 && e2.message !== undefined ? e2.message : e2), {
        message: String(e2 && e2.message !== undefined ? e2.message : e2), line: e2 ? e2.line : undefined, stack: e2 && e2.stack ? String(e2.stack).substring(0, 2000) : undefined, log: lines
      });
    } finally {
      G.OS = realOS;
      G.File = realFile;
      restoreCtor();
    }
    if (!done) { res = describeResult(undefined); }
    return { value: res.value, log: lines, returned: res.returned };
  });
})();
