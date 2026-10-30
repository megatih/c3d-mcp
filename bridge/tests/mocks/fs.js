// File/OS mocks over native byte-exact helpers (__native). Reproduces P05/P06: non-ASCII write truncation, byte-counting read,
// sorted contentOfDir incl. dotfiles, WRITE_MODE truncation, mkDir wiping an existing path.
function File(path) {
  if (!new.target) { throw new TypeError('File constructor requires new'); }
  if (typeof path !== 'string') { __badArgs(); }
  __hide(this, '_p', path);
  __hide(this, '_open', false);
  __hide(this, '_mode', null);
  __hide(this, '_data', '');
  __hide(this, '_pos', 0);
}
File.prototype.open = function (mode) {
  if (mode === READ_MODE) {
    if (!__native.exists(this._p)) { return null; }
    this._data = __native.readLatin1(this._p);
    this._pos = 0;
  } else if (mode === WRITE_MODE) {
    if (!__native.writeLatin1(this._p, '', false)) { return null; }
  } else { __badArgs(); }
  this._open = true;
  this._mode = mode;
};
File.prototype.close = function () { this._open = false; };
File.prototype.isOpen = function () { return this._open; };
File.prototype.exist = function () { return __native.exists(this._p); };
File.prototype.isDir = function () { return __native.isDir(this._p); };
File.prototype.size = function () { return __native.size(this._p); };
File.prototype.extension = function () { var m = /\.([^./]*)$/.exec(this._p); return m ? m[1] : ''; };
File.prototype.lastPathComponent = function () { return this._p.substring(this._p.lastIndexOf('/') + 1); };
File.prototype.directory = function () { return this._p.substring(0, this._p.lastIndexOf('/')); };
File.prototype.contentOfDir = function () { return __native.list(this._p); };
File.prototype.copyTo = function (to) { return __native.copy(this._p, to); };
File.prototype.mkDir = function () { __stats.mkDirCalls++; return __native.mkdirWipe(this._p); };
File.prototype.read = function (n) {
  if (!this._open || this._mode !== READ_MODE) { throw new Error('File.read() file is not open for reading'); }
  var s = this._data.substr(this._pos, n);
  this._pos += s.length;
  return s;
};
File.prototype.readln = function () {
  if (!this._open || this._mode !== READ_MODE) { throw new Error('File.readln() file is not open for reading'); }
  var i = this._data.indexOf('\n', this._pos), s;
  if (i < 0) { s = this._data.substr(this._pos); this._pos = this._data.length; } else { s = this._data.substring(this._pos, i); this._pos = i + 1; }
  return s;
};
File.prototype.write = function (str) {
  if (!this._open || this._mode !== WRITE_MODE) { throw new Error('File.write() file is not open for writing'); }
  var bytes = unescape(encodeURIComponent(String(str)));
  __native.writeLatin1(this._p, bytes.substr(0, String(str).length), true);
};
File.prototype.writeln = function (str) { this.write(String(str) + '\n'); };
File.prototype.getpos = function () { return this._pos; };
File.prototype.setpos = function (p) { this._pos = p; };
File.prototype.seek = function (off, basis) { this._pos = basis === SEEK_SET ? off : (basis === SEEK_CUR ? this._pos + off : this._data.length + off); };
['readFloat', 'readInt', 'readShort', 'readUInt', 'writeFloat', 'writeInt', 'writeShort', 'writeUInt'].forEach(function (m) {
  File.prototype[m] = function () { throw new Error('mock: File.' + m + ' is not implemented'); };
});

var OS = {
  beep: function () { __stats.beeps++; },
  messageBox: function () { __stats.dialogCalls++; __app.modal = 'OS.messageBox'; return 1; },
  runOpenPanel: function () { __stats.dialogCalls++; __app.modal = 'OS.runOpenPanel'; return ''; },
  runSavePanel: function () { __stats.dialogCalls++; __app.modal = 'OS.runSavePanel'; return ''; },
  system: function (cmd) { __stats.sysCalls.push(String(cmd)); return 0; }
};
