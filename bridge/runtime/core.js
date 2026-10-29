/* core: op registry, request pipeline (PROTOCOL section 3), log ring buffer, batch refs. */
C3D.core = (function () {
  var U = C3D.util;
  var PROTOCOL = 1;
  var DRAIN_REQUESTS = 25;
  var DRAIN_MS = 8000;
  var LOG_MAX = 500;
  var REQ_NAME = /^(\d{16})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
  var REF_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)*)$/;
  var ZERO_SEQ = '0000000000000000';

  var ops = {};
  var logLines = [];

  function define(name, rw, fn) { ops[name] = { rw: rw, fn: fn }; }

  function log(line) {
    logLines.push(String(line));
    if (logLines.length > LOG_MAX) { logLines.splice(0, logLines.length - LOG_MAX); }
  }

  // An op that applied part of its work: reported as ok:false with the partial result kept.
  function PartialResult(result, error) { this.isPartial = true; this.result = result; this.error = error; }
  function partial(result, errors, what) {
    var code = errors[0].code, i;
    for (i = 1; i < errors.length; i++) { if (errors[i].code !== code) { code = 'INVALID_ARGUMENT'; } }
    throw new PartialResult(result, { code: code, message: errors.length + ' of ' + what + ' failed', details: { errors: errors } });
  }

  function errorOf(e) {
    var out;
    if (e && e.isC3D) {
      out = { code: e.code, message: e.message };
      if (e.hint) { out.hint = e.hint; }
      if (e.details !== undefined) { out.details = e.details; }
      return out;
    }
    out = { code: 'INTERNAL', message: String(e && e.message !== undefined ? e.message : e) };
    if (e && e.line !== undefined) { out.details = { line: e.line }; }
    return out;
  }

  function resolveRefs(value, aliases) {
    var m, a, i, out, k, cur, parts;
    if (typeof value === 'string') {
      m = REF_RE.exec(value);
      if (!m || !U.hasOwn(aliases, m[1])) { return value; }
      a = aliases[m[1]];
      if (!a.ok) { U.fail('DEPENDENCY_FAILED', 'op "' + m[1] + '" failed', { alias: m[1] }); }
      cur = a.result;
      parts = m[2] ? m[2].substring(1).split('.') : [];
      for (i = 0; i < parts.length; i++) {
        if (cur === null || typeof cur !== 'object' || !U.hasOwn(cur, parts[i])) {
          U.fail('INVALID_ARGUMENT', 'reference ' + value + ' does not resolve', { ref: value });
        }
        cur = cur[parts[i]];
      }
      return cur;
    }
    if (Array.isArray(value)) {
      out = [];
      for (i = 0; i < value.length; i++) { out.push(resolveRefs(value[i], aliases)); }
      return out;
    }
    if (U.isObject(value)) {
      out = {};
      for (k in value) { if (U.hasOwn(value, k)) { out[k] = resolveRefs(value[k], aliases); } }
      return out;
    }
    return value;
  }

  function execOps(ctx, req) {
    var results = [], aliases = {}, i, op, def, args, res, entry, any = false;
    for (i = 0; i < req.ops.length; i++) {
      op = req.ops[i];
      entry = { op: (op && typeof op.op === 'string') ? op.op : '?', ok: false };
      def = null;
      try {
        if (!U.isObject(op) || typeof op.op !== 'string') { U.fail('INVALID_ARGUMENT', 'op entry needs an "op" string'); }
        def = U.hasOwn(ops, op.op) ? ops[op.op] : null;
        if (!def) { U.fail('INVALID_ARGUMENT', 'Unknown op: ' + op.op); }
        args = resolveRefs(op.args === undefined ? {} : op.args, aliases);
        if (!U.isObject(args)) { U.fail('INVALID_ARGUMENT', 'args must be an object'); }
        if (def.rw === 'W') { any = true; }
        res = def.fn(ctx, args);
        entry.ok = true;
        entry.result = res === undefined ? null : res;
      } catch (e) {
        if (e && e.isPartial) { entry.result = e.result; entry.error = e.error; }
        else { entry.error = errorOf(e); log('op ' + entry.op + ' failed: ' + entry.error.code + ' ' + entry.error.message); }
      }
      if (def && def.rw === 'W') { C3D.scene.invalidate(ctx); }
      if (op && typeof op.as === 'string') { aliases[op.as] = { ok: entry.ok, result: entry.result }; }
      results.push(entry);
    }
    ctx.wrote = any;
    return results;
  }

  function checkExpectDocument(ctx, exp) {
    var doc = ctx.doc, name, root, i, found;
    if (!U.isObject(exp)) { return null; }
    if (exp.fileName !== undefined) {
      name = doc.fileName();
      if (name !== exp.fileName) {
        return { code: 'WRONG_DOCUMENT', message: 'front document is ' + (name === undefined || name === null ? '(untitled)' : name) + ', expected ' + exp.fileName };
      }
    }
    if (exp.marker !== undefined) {
      root = doc.root();
      found = false;
      for (i = 0; i < root.childCount() && !found; i++) { found = root.childAtIndex(i).getParameter('name') === exp.marker; }
      if (!found) { return { code: 'WRONG_DOCUMENT', message: 'session marker ' + exp.marker + ' not found in front document' }; }
    }
    return null;
  }

  function response(id, ok, results, startedAt, logStart, error) {
    var r = { protocol: PROTOCOL, id: id, ok: ok, runtimeVersion: U.VERSION };
    if (error) { r.error = error; }
    r.results = results;
    r.log = logLines.slice(logStart);
    r.startedAt = startedAt;
    r.finishedAt = Date.now();
    return r;
  }

  function cmpSeq(a, b) { a = U.pad(a, 16); b = U.pad(b, 16); return a < b ? -1 : (a > b ? 1 : 0); }

  function writeState(ctx, busy, reqId) {
    var doc = ctx.doc, name = null;
    try { name = doc.fileName(); } catch (e) { name = null; }
    U.writeText(ctx.dir + 'state.json', U.toJSON({
      busy: busy, reqId: reqId || null, op: null, startedAt: ctx.startedAt, runtimeVersion: U.VERSION,
      protocol: PROTOCOL, lastSeq: ctx.lastSeq, document: (name === undefined || name === null) ? null : name, updatedAt: Date.now()
    }));
  }

  function writeResponse(ctx, id, resp) {
    var text = U.toJSON(resp);
    U.writeText(ctx.dir + 'outbox/' + id + '.json', text);
    U.writeText(ctx.dir + 'outbox/' + id + '.done', JSON.stringify({ bytes: text.length, checksum: U.adler32(text) }));
  }

  function handle(ctx, name, seq, id) {
    var started = Date.now(), logStart = logLines.length, text, req, err = null, results = [], doc = ctx.doc, locked = false;
    function finish(ok, error, keepSeq) { writeResponse(ctx, id, response(id, ok, results, started, logStart, error)); if (!keepSeq) { ctx.lastSeq = seq; } }

    text = U.readText(ctx.dir + 'inbox/' + name);
    try { req = JSON.parse(text); } catch (e) { req = null; }
    if (!U.isObject(req) || !Array.isArray(req.ops)) {
      return finish(false, { code: 'PARSE_ERROR', message: 'request is not valid JSON or has no ops array' });
    }
    if (typeof req.deadlineAt === 'number' && Date.now() > req.deadlineAt) {
      return finish(false, { code: 'TIMEOUT', message: 'deadline passed before the request was picked up' });
    }
    if (U.exists(ctx.dir + 'cancel/' + id)) { return finish(false, { code: 'CANCELLED', message: 'request was cancelled' }); }
    if (typeof req.secret !== 'string' || req.secret === '' || req.secret !== ctx.secret) {
      // A request with a wrong secret must not advance lastSeq (a forged huge seq would make every later request look stale).
      return finish(false, { code: 'INTERNAL', message: 'bad secret' }, true);
    }
    if (req.protocol !== PROTOCOL) {
      return finish(false, { code: 'VERSION_SKEW', message: 'protocol ' + req.protocol + ' != ' + PROTOCOL, hint: 'run `c3d-mcp install`' });
    }
    err = checkExpectDocument(ctx, req.expectDocument);
    if (err) { return finish(false, err); }

    doc.retainRedrawLock();
    locked = true;
    ctx.sceneCache = null;
    try {
      results = execOps(ctx, req);
    } catch (e) {
      log('request pipeline failed: ' + String(e && e.message));
      err = errorOf(e);
    } finally {
      if (locked) { try { doc.releaseRedrawLock(); } catch (e2) { log('releaseRedrawLock failed: ' + String(e2 && e2.message)); } }
    }
    if (ctx.wrote) { try { doc.redrawAll(); } catch (e3) { log('redrawAll failed: ' + String(e3 && e3.message)); } }
    finish(!err, err || undefined);
  }

  function loadLog(dir) {
    var text = U.readText(dir + 'outbox/_log.json'), data;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    logLines = (data && Array.isArray(data.lines)) ? data.lines.slice(-LOG_MAX) : [];
  }

  function saveLog(dir) { U.writeText(dir + 'outbox/_log.json', U.toJSON({ runtimeVersion: U.VERSION, lines: logLines })); }

  function readState(dir) {
    var text = U.readText(dir + 'state.json'), data;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    return U.isObject(data) ? data : {};
  }

  function run(doc, mcpDir) {
    var dir = mcpDir.charAt(mcpDir.length - 1) === '/' ? mcpDir : mcpDir + '/';
    var prior = readState(dir), secretText = U.readText(dir + 'secret');
    var ctx = {
      doc: doc, dir: dir, startedAt: Date.now(), lastSeq: (typeof prior.lastSeq === 'string') ? prior.lastSeq : '0',
      secret: secretText === null ? '' : secretText.replace(/\s+$/, ''), prevBusy: prior.busy === true, sceneCache: null, wrote: false
    };
    var names = U.listDir(dir + 'inbox'), todo = [], i, m, handled = 0, t0 = Date.now(), skipped = 0;
    loadLog(dir);
    for (i = 0; i < names.length; i++) {
      m = REQ_NAME.exec(names[i]);
      if (m) { todo.push({ name: names[i], seq: m[1], id: m[2] }); }
    }
    todo.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    writeState(ctx, true, null);
    try {
      for (i = 0; i < todo.length; i++) {
        if (cmpSeq(todo[i].seq, ctx.lastSeq) <= 0 || U.exists(dir + 'outbox/' + todo[i].id + '.done')) { skipped++; continue; }
        if (handled >= DRAIN_REQUESTS || Date.now() - t0 >= DRAIN_MS) { break; }
        writeState(ctx, true, todo[i].id);
        handle(ctx, todo[i].name, todo[i].seq, todo[i].id);
        handled++;
      }
      if (skipped) { log('skipped ' + skipped + ' already-processed request(s)'); }
    } finally {
      writeState(ctx, false, null);
      saveLog(dir);
    }
    return handled;
  }

  define('ping', 'R', function (ctx, a) {
    return {
      counter: a.counter === undefined ? null : a.counter, echo: a.echo === undefined ? null : a.echo, runtimeVersion: U.VERSION,
      now: Date.now(), jsc: true, stateBusy: ctx.prevBusy
    };
  });

  define('getLog', 'R', function (ctx, a) {
    var lines = logLines.slice();
    if (a.tail !== undefined) { lines = a.tail > 0 ? lines.slice(-a.tail) : []; }
    if (a.clear) { logLines = []; }
    return { lines: lines };
  });

  return {
    PROTOCOL: PROTOCOL, DRAIN_REQUESTS: DRAIN_REQUESTS, DRAIN_MS: DRAIN_MS, ops: ops, define: define, log: log, partial: partial,
    errorOf: errorOf, run: run
  };
})();
