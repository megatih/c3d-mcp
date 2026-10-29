// Constants exactly as measured in probe PA (research/raw/probe_PA_files_env.json); the "missing" names stay undefined.
(function (G) {
  var c = __PARAMDATA.consts, k;
  for (k in c) { G[k] = c[k]; }
  G.LINEAR_INTERPOL = 1;
  G.SOFT_INTERPOL = 0;
  G.SPLINE_INTERPOL = 2;
  G.FLAT_INTERPOL = 2;
  G.CONST_INTERPOL = 3;
  G.version = function () { return '8.1.3'; };
  G.print = function (s) { __app.console.push(String(s)); };
  G.clearConsole = function () { __app.console = []; };
  G.Texture = {};
})(this);
