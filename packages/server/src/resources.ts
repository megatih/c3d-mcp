import { listKb, readKb, readResearch } from './services/kb.js';
import type { ResourceDef } from './toolkit.js';

const MISSING = 'Knowledge base not found. Reinstall c3d-mcp (assets/kb missing) or run from the repository checkout.';
const md = (uri: string, name: string, description: string, rel: string): ResourceDef => ({ uri, name, description, mimeType: 'text/markdown', read: () => Promise.resolve(readKb(rel) ?? MISSING) });

export const MACRO_TEMPLATE = `// Cheetah3D Macro script (Tools > Script > Macro Script). ES5 style.
function main(doc) {
  var root = doc.root();
  doc.retainRedrawLock();
  try {
    var box = new Object();           // placeholder: create objects with doc.addObject(BOX)
    box = doc.addObject(BOX);
    box.setParameter("name", "Example");
    box.setParameter("position", new Vec3D(0, 0.5, 0));
    box.update();
  } finally {
    doc.releaseRedrawLock();
  }
  print("done");
}
`;

export const POLYGON_TEMPLATE = `// Polygon-object script (Scripts/Polygonobj). buildUI declares parameters, buildObject generates geometry.
function buildUI(base) {
  base.addParameterFloat("size", 1.0, 0.01, 100.0, true, true);
}
function buildObject(base, core) {
  var s = base.getParameter("size");
  core.addVertex(false, new Vec3D(-s, 0, -s));
  core.addVertex(false, new Vec3D(s, 0, -s));
  core.addVertex(false, new Vec3D(s, 0, s));
  core.addVertex(false, new Vec3D(-s, 0, s));
  core.addIndexPolygon(4, [0, 1, 2, 3]);   // indices must be valid or Cheetah3D crashes; clockwise seen from outside = front face
}
`;

const apiReference = (): string => listKb('reference/api', '.md').map((f) => readKb(`reference/api/${f}`) ?? '').join('\n\n---\n\n') || MISSING;

export const allResourceDefs: ResourceDef[] = [
  md('c3d://api/short', 'Cheetah3D API (short)', 'Condensed Cheetah3D JavaScript API cheat sheet and rules. Forum-derived and written for 8.1.1: check c3d://verified for what 8.1.3 refuted.', 'dist/c3d-context-short.md'),
  md('c3d://api/full', 'Cheetah3D API (full)', 'Complete Cheetah3D 8.x JavaScript API reference with gotchas (large). Forum-derived: check c3d://verified for what 8.1.3 refuted.', 'dist/c3d-context-full.md'),
  md('c3d://gotchas', 'Cheetah3D scripting gotchas', 'Known crashes, quirks and workarounds when scripting Cheetah3D. Forum-derived: some entries are wrong for 8.1.3, see c3d://verified.', 'knowledge/gotchas.md'),
  md('c3d://patterns', 'Cheetah3D script patterns', 'Script skeletons and common tasks per script type (macro, tool, tag, polygon, spline, particle). Forum-derived: check c3d://verified.', 'knowledge/patterns.md'),
  { uri: 'c3d://api/reference', name: 'Cheetah3D API reference (per class)', description: 'Official per-class method reference converted from the Cheetah3D help, with descriptions (names verified against 8.1.3; some documented constants and methods do not exist at runtime, see c3d://verified).', mimeType: 'text/markdown', read: () => Promise.resolve(apiReference()) },
  { uri: 'c3d://verified', name: 'Verified in Cheetah3D 8.1.3', description: 'Which claims of the scripting knowledge base and the book "Learn 3D with Cheetah 3D" were measured in the running app: confirmed, refined, refuted, not tested.', mimeType: 'text/markdown', read: () => Promise.resolve(readResearch('10-kb-verification-8.1.3.md') ?? MISSING) },
  { uri: 'c3d://templates/macro', name: 'Macro script template', description: 'Starter Macro script with redraw lock handling.', mimeType: 'text/javascript', read: () => Promise.resolve(MACRO_TEMPLATE) },
  { uri: 'c3d://templates/polygon-script', name: 'Polygon script template', description: 'Starter Polygon-object script (buildUI/buildObject).', mimeType: 'text/javascript', read: () => Promise.resolve(POLYGON_TEMPLATE) },
  {
    uri: 'c3d://scene',
    name: 'Live scene summary',
    description: 'Current document and object tree (depth 3, first 200 objects).',
    mimeType: 'application/json',
    read: async (ctx) => {
      const [document, scene] = await Promise.all([ctx.bridge.one('getDocumentInfo'), ctx.bridge.one<{ items: Array<Record<string, any>>; total: number }>('listScene', { depth: 3, limit: 200, detail: 'concise' })]);
      return JSON.stringify({ document, total: scene.total, objects: scene.items.map((o) => ({ id: o.id, name: o.name, type: o.type, depth: o.depth })) }, null, 1);
    },
  },
];
