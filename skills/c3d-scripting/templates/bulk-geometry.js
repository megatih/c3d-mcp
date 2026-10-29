// Parametric bulk geometry: N varied planks (boxes) in a named folder, explicit parenting.
// As a macro: save in Scripts/Macro/. With c3d_run_script: drop `main` and end with `return bulkMain(doc);`.
// ES5, ASCII only. Edit CONFIG, nothing else.

var CONFIG = {
  folderName: 'Planks',
  count: 24,            // number of planks
  plankLength: 2.0,     // metres
  plankWidth: 0.18,
  plankThickness: 0.04,
  gap: 0.01,
  seed: 4242,
  colors: [[0.45, 0.28, 0.12, 1], [0.38, 0.22, 0.09, 1], [0.52, 0.34, 0.16, 1]]
};

function bulkMain(doc) {
  var cfg = CONFIG, i, k, c, o, mat, mats = [], parent, x, len, shade, rnd;
  var s = cfg.seed;
  rnd = function () { s = (s * 16807) % 2147483647; return s / 2147483647; };

  function findNode(p, name) {
    var j, c;
    for (j = 0; j < p.childCount(); j++) {
      c = p.childAtIndex(j);
      if (c.getParameter('name') === name) { return c; }
    }
    return null;
  }

  parent = findNode(doc.root(), cfg.folderName);
  if (!parent) {
    parent = doc.addObject(FOLDER);
    parent.setParameter('name', cfg.folderName);
    doc.root().addChildAtIndex(parent, doc.root().childCount());
  }

  for (k = 0; k < cfg.colors.length; k++) {
    mat = doc.addMaterial('Material', 'PlankMat' + k);
    c = cfg.colors[k];
    mat.rootNode().setParameter('diffColor', new Vec4D(c[0], c[1], c[2], c[3]));
    mats.push(mat);
  }

  doc.retainRedrawLock();
  try {
    for (i = 0; i < cfg.count; i++) {
      len = cfg.plankLength * (0.85 + 0.3 * rnd());
      x = i * (cfg.plankWidth + cfg.gap);
      o = doc.addObject(BOX);
      o.setParameter('name', 'Plank_' + i);
      o.setParameter('sizeX', cfg.plankWidth);
      o.setParameter('sizeY', cfg.plankThickness);
      o.setParameter('sizeZ', len);
      o.setParameter('position', new Vec3D(x, cfg.plankThickness / 2, 0));
      o.setParameter('rotation', new Vec3D((rnd() - 0.5) * 2, 0, 0));
      shade = Math.floor(rnd() * mats.length);
      if (shade >= mats.length) { shade = mats.length - 1; }
      o.addTagOfType(SHADERTAG).setParameter('material', mats[shade]);
      parent.addChildAtIndex(o, parent.childCount());
      o.update();
    }
    parent.update();
  } finally {
    doc.releaseRedrawLock();
  }
  return { folder: cfg.folderName, planks: cfg.count, materials: mats.length };
}

// Macro entry point (Cheetah3D calls main(doc)).
function main(doc) {
  var r = bulkMain(doc);
  print('bulk-geometry: ' + r.planks + ' planks in ' + r.folder);
}

// c3d_run_script: delete the `main` function above and end the script with:
// return bulkMain(doc);
