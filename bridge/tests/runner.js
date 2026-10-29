// Case runner executed inside the JSContext that hosts the mocks and the runtime. Swift supplies the temp mcpDir.
var __h = (function () {
  var origOS = OS, origFile = File;
  var BASE_SEQ = 1800000000000000;
  var DEFAULT_SECRET = 'test-secret-0123456789abcdef';

  function pad(s, n) { s = String(s); while (s.length < n) { s = '0' + s; } return s; }
  function ascii(t) { return t.replace(/[\u007f-￿]/g, function (c) { return '\\u' + pad(c.charCodeAt(0).toString(16), 4); }); }
  function adler32(t) {
    var a = 1, b = 0, i;
    for (i = 0; i < t.length; i++) { a = (a + t.charCodeAt(i)) % 65521; b = (b + a) % 65521; }
    return pad(((b * 65536) + a).toString(16), 8);
  }
  function uuid(n) { return pad(n.toString(16), 8) + '-0000-4000-8000-' + pad(n.toString(16), 12); }
  function write(path, text) { if (!__native.writeLatin1(path, text, false)) { throw new Error('harness cannot write ' + path); } }
  function read(path) { return __native.exists(path) ? __native.readLatin1(path) : null; }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  function subst(v, i) {
    var k, out;
    if (typeof v === 'string') { return v === '{i}' ? i : v.split('{i}').join(String(i)); }
    if (Array.isArray(v)) { return v.map(function (x) { return subst(x, i); }); }
    if (v && typeof v === 'object') { out = {}; for (k in v) { out[k] = subst(v[k], i); } return out; }
    return v;
  }

  // Subset matcher with $-operators: $any $re $type $gte $lte $len $has $prefix $absent.
  function match(exp, act, path, errs) {
    var k, i, found, ops;
    if (exp !== null && typeof exp === 'object' && !Array.isArray(exp)) {
      ops = Object.keys(exp).filter(function (x) { return x.charAt(0) === '$'; });
      if (ops.length) {
        for (i = 0; i < ops.length; i++) {
          k = ops[i];
          if (k === '$any') { if (act === undefined) { errs.push(path + ': missing'); } }
          else if (k === '$absent') { if (act !== undefined) { errs.push(path + ': expected absent, got ' + JSON.stringify(act)); } }
          else if (k === '$re') { if (typeof act !== 'string' || !new RegExp(exp.$re).test(act)) { errs.push(path + ': ' + JSON.stringify(act) + ' !~ /' + exp.$re + '/'); } }
          else if (k === '$type') {
            var t = act === null ? 'null' : (Array.isArray(act) ? 'array' : typeof act);
            if (t !== exp.$type) { errs.push(path + ': type ' + t + ' != ' + exp.$type); }
          }
          else if (k === '$gte') { if (!(act >= exp.$gte)) { errs.push(path + ': ' + act + ' < ' + exp.$gte); } }
          else if (k === '$lte') { if (!(act <= exp.$lte)) { errs.push(path + ': ' + act + ' > ' + exp.$lte); } }
          else if (k === '$len') { if (!act || act.length !== exp.$len) { errs.push(path + ': length ' + (act && act.length) + ' != ' + exp.$len); } }
          else if (k === '$has') {
            found = Array.isArray(act) && act.some(function (el) { var e = []; match(exp.$has, el, path, e); return !e.length; });
            if (!found) { errs.push(path + ': no element matches ' + JSON.stringify(exp.$has)); }
          }
          else if (k === '$prefix') {
            if (!Array.isArray(act) || act.length < exp.$prefix.length) { errs.push(path + ': array shorter than prefix'); }
            else { exp.$prefix.forEach(function (e, j) { match(e, act[j], path + '[' + j + ']', errs); }); }
          }
          else { errs.push(path + ': unknown operator ' + k); }
        }
        return;
      }
      if (act === null || typeof act !== 'object' || Array.isArray(act)) { errs.push(path + ': expected object, got ' + JSON.stringify(act)); return; }
      for (k in exp) { match(exp[k], act[k], path + '.' + k, errs); }
      return;
    }
    if (Array.isArray(exp)) {
      if (!Array.isArray(act) || act.length !== exp.length) { errs.push(path + ': expected array of ' + exp.length + ', got ' + JSON.stringify(act)); return; }
      exp.forEach(function (e, j) { match(e, act[j], path + '[' + j + ']', errs); });
      return;
    }
    if (exp !== act) { errs.push(path + ': expected ' + JSON.stringify(exp) + ', got ' + JSON.stringify(act)); }
  }

  function runCase(c, env) {
    c = JSON.parse(JSON.stringify(c).split('{MCP}').join(env.mcpDir));
    var dir = env.mcpDir + '/', failures = [], dumps = [], reqs = {}, counter = 0, executed = 0, aborted = false, macro = env.macroSource;
    var ev = eval, geval = function (s) { return (0, ev)(s); };

    function fail(msg) { failures.push(msg); }
    function check(what, exp, act) { var errs = []; match(exp, act, what, errs); errs.forEach(fail); }

    function evalJs(code) {
      try { return geval(code); } catch (e) { fail('js "' + code + '" threw ' + e); return undefined; }
    }

    function buildRequest(spec, i) {
      var label = spec.label.split('{i}').join(String(i)), n = ++counter, r, k;
      r = {
        protocol: 1, id: spec.id || uuid(n), seq: spec.seq || pad(BASE_SEQ + n * 100, 16), secret: DEFAULT_SECRET,
        deadlineAt: Date.now() + (spec.deadlineMs === undefined ? 60000 : spec.deadlineMs), ops: subst(spec.ops, i)
      };
      if (spec.expectDocument) { r.expectDocument = spec.expectDocument; }
      for (k in (spec.extra || {})) { r[k] = spec.extra[k]; }
      (spec.omit || []).forEach(function (f) { delete r[f]; });
      reqs[label] = { id: r.id, seq: r.seq, spec: spec, request: r };
      write(dir + 'inbox/' + r.seq + '-' + r.id + '.json', ascii(JSON.stringify(r)));
      if (spec.cancel) { write(dir + 'cancel/' + r.id, ''); }
      if (spec.preDone) { write(dir + 'outbox/' + r.id + '.done', '{"bytes":0,"checksum":"00000000"}'); }
      return label;
    }

    function readResponse(label) {
      var q = reqs[label], text = read(dir + 'outbox/' + q.id + '.json'), done = read(dir + 'outbox/' + q.id + '.done'), d, resp;
      if (text === null) { return null; }
      if (done === null) { fail(label + ': response written without .done marker'); }
      else {
        d = JSON.parse(done);
        if (d.bytes !== text.length || d.checksum !== adler32(text)) { fail(label + ': .done does not match response (' + done + ')'); }
      }
      if (/[^\x00-\x7f]/.test(text)) { fail(label + ': response is not ASCII'); }
      resp = JSON.parse(text);
      return { text: text, resp: resp };
    }

    function pressOnce(press, pi) {
      var labels = [], times, i, spec, mac = macro, name, r, ex = press.expect || {}, st, stText, k, got, errs;
      if (press.js) { evalJs(press.js); }
      if (press.state) { write(dir + 'state.json', JSON.stringify(press.state)); }
      for (k in (press.files || {})) { write(dir + k, press.files[k]); }
      (press.requests || []).forEach(function (s) {
        times = s.times || 1;
        for (i = 0; i < times; i++) { labels.push(buildRequest(s, i)); }
      });
      if (press.runtimeSource !== undefined) {
        write(dir + 'runtime/override.js', ascii(press.runtimeSource));
        mac = macro.split(env.runtimePath).join(dir + 'runtime/override.js');
      } else if (press.runtimeMissing) {
        mac = macro.split(env.runtimePath).join(dir + 'runtime/missing.js');
      }
      __stats.retain = 0; __stats.release = 0;
      evalJs(mac);
      try { main(__app.doc); executed++; } catch (e) { if (!__app.fatal) { fail('press ' + pi + ': main() threw ' + e); } }

      if (__app.fatal) {
        if (ex.fatal && __app.fatal.indexOf(ex.fatal) >= 0) { aborted = true; return; }
        fail('press ' + pi + ': FATAL in mock app: ' + __app.fatal); aborted = true; return;
      }
      if (__app.modal) {
        if (!(ex.modal && __app.modal.indexOf(ex.modal) >= 0)) { fail('press ' + pi + ': modal dialog in mock app: ' + __app.modal); }
        __app.modal = null;
      } else if (ex.modal) { fail('press ' + pi + ': expected modal "' + ex.modal + '"'); }
      if (ex.fatal) { fail('press ' + pi + ': expected FATAL "' + ex.fatal + '"'); }
      if (!ex.unbalancedLock && __stats.retain !== __stats.release) { fail('press ' + pi + ': redraw lock unbalanced retain=' + __stats.retain + ' release=' + __stats.release); }
      if (OS !== origOS || File !== origFile) { fail('press ' + pi + ': global OS/File were not restored'); }

      stText = ex.noState ? null : read(dir + 'state.json');
      if (stText === null) { if (!ex.noState) { fail('press ' + pi + ': state.json missing'); } }
      else {
        try { st = JSON.parse(stText); if (st.busy !== false) { fail('press ' + pi + ': state.busy left true'); } } catch (e2) { fail('state.json is not JSON'); }
      }
      if (ex.state) { check('state', ex.state, st); }

      Object.keys(reqs).forEach(function (label) {
        if (reqs[label].response) { return; }
        var q = reqs[label], got2 = readResponse(label), suffix = q.spec.schema === false ? '.request.skip.json' : (q.spec.argsSchema === false ? '.request.noargs.json' : '.request.json');
        dumps.push({ rel: label + suffix, text: JSON.stringify(q.request, null, 1) });
        if (got2) { dumps.push({ rel: label + '.response.json', text: JSON.stringify(got2.resp, null, 1) }); q.response = got2.resp; }
      });
      for (k in (ex.responses || {})) {
        if (!reqs[k]) { fail('expectation for unknown request ' + k); continue; }
        if (!reqs[k].response) { fail(k + ': no response was written'); continue; }
        check(k, ex.responses[k], reqs[k].response);
      }
      (ex.noResponse || []).forEach(function (l) {
        if (!reqs[l]) { fail('noResponse for unknown request ' + l); }
        else if (read(dir + 'outbox/' + reqs[l].id + '.json') !== null) { fail(l + ': response exists but none expected'); }
      });
      if (ex.responseCount) {
        got = 0;
        Object.keys(reqs).forEach(function (l) { if (l.indexOf(ex.responseCount.prefix) === 0 && reqs[l].response) { got++; } });
        if (got !== ex.responseCount.count) { fail('responseCount ' + ex.responseCount.prefix + '*: ' + got + ' != ' + ex.responseCount.count); }
      }
      for (k in (ex.files || {})) {
        got = read(dir + k);
        if (got === null) { fail('file ' + k + ' missing'); continue; }
        try { got = JSON.parse(got); } catch (e3) { fail('file ' + k + ' is not JSON'); continue; }
        check(k, ex.files[k], got);
        if (/[^\x00-\x7f]/.test(read(dir + k))) { fail('file ' + k + ' is not ASCII'); }
      }
      (ex.noFiles || []).forEach(function (f) { if (read(dir + f) !== null) { fail('file ' + f + ' should not exist'); } });
      (ex.js || []).forEach(function (j) {
        var v = evalJs(j.eval);
        errs = [];
        match(j.equals !== undefined ? j.equals : j.matches, JSON.parse(JSON.stringify(v === undefined ? null : v)), 'js(' + j.eval + ')', errs);
        errs.forEach(fail);
      });
    }

    if (c.setup) {
      if (c.setup.fileName !== undefined) { __app.fileName = c.setup.fileName; }
      if (c.setup.js) { evalJs(c.setup.js); }
      if (c.setup.state) { write(dir + 'state.json', JSON.stringify(c.setup.state)); }
      for (var f in (c.setup.files || {})) { write(dir + f, c.setup.files[f]); }
    }
    (c.presses || []).forEach(function (press, pi) { if (!aborted) { pressOnce(press, pi); } });
    return { failures: failures, dumps: dumps, presses: executed };
  }

  return { runCase: runCase, DEFAULT_SECRET: DEFAULT_SECRET };
})();
