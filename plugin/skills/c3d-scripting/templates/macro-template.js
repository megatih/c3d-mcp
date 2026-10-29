// Cheetah3D macro template (ES5, ASCII only).
// Save in ~/Library/Application Support/Cheetah3D/Scripts/Macro/, restart Cheetah3D once,
// run via Tools > Script > Macro Script. Run it in a scratch document.

function V3(x, y, z) { return new Vec3D(x, y, z); }
function C4(c) { return new Vec4D(c[0], c[1], c[2], c.length > 3 ? c[3] : 1); }

function findNode(parent, name) {
  var i, c;
  for (i = 0; i < parent.childCount(); i++) {
    c = parent.childAtIndex(i);
    if (c.getParameter('name') === name) { return c; }
  }
  return null;
}

function folder(doc, name) {
  var f = findNode(doc.root(), name);
  if (f) { return f; }
  f = doc.addObject(FOLDER);
  f.setParameter('name', name);
  doc.root().addChildAtIndex(f, doc.root().childCount());
  return f;
}

function makeMaterial(doc, name, rgb) {
  var m = doc.addMaterial('Material', name);
  m.rootNode().setParameter('diffColor', C4(rgb));
  return m;
}

function main(doc) {
  var made = 0;
  doc.retainRedrawLock();
  try {
    var parent = folder(doc, 'MacroOutput');
    var mat = makeMaterial(doc, 'MacroRed', [0.8, 0.1, 0.1, 1]);
    var o = doc.addObject(BOX);
    o.setParameter('name', 'MacroBox');
    o.setParameter('sizeX', 1); o.setParameter('sizeY', 1); o.setParameter('sizeZ', 1);
    o.setParameter('position', V3(0, 0.5, 0));
    o.addTagOfType(SHADERTAG).setParameter('material', mat);
    parent.addChildAtIndex(o, parent.childCount());
    o.update();
    parent.update();
    made++;
  } finally {
    doc.releaseRedrawLock();
  }
  print('MacroOutput: created ' + made + ' object(s)');
}
