// Facts about Cheetah3D 8.1.3 that were MEASURED in the running app (research/10-kb-verification-8.1.3.md, probes in
// packages/server/scripts/kb-*.mjs). Used to annotate knowledge-base search hits and to keep the linter honest.
// VERIFIED_CONSTANTS is generated (scripts/gen-kb-constants.mjs) from research/raw/kb-constants-8.1.3.json.

export const VERIFIED_ON = 'Cheetah3D 8.1.3';

export { VERIFIED_CONSTANTS } from './kbConstants.generated.js';

/** Names the docs or the knowledge base mention but that are undefined at runtime (using one throws ReferenceError). */
export const ABSENT_CONSTANTS: readonly string[] = ["AREALIGHT","DISTANTLIGHT","SPOTLIGHT","UVTAG","TONEMAPPINGTAG","BIG_ENDIAM","LITTLE_ENDIA","SKYLIGHT","SUBDIVMOD","IDENTITY"];

/** Methods that exist at runtime although the reference does not list them. */
export const VERIFIED_METHODS: readonly string[] = ['id', 'animationTime', 'animationFPS', 'setAnimationFPS', 'setAnimationTime', 'isAnimatable'];

/** Methods that are documented or widely quoted but do not exist in 8.1.3. */
export const ABSENT_METHODS: Readonly<Record<string, string>> = {
  parent: 'Object has no parent(); use owner().',
  rib: 'Material.rib() is documented but removed.',
};

export type NoteStatus = 'confirmed' | 'refined' | 'refuted';
export interface KbNote { any: string[]; status: NoteStatus; text: string }

/** Annotations attached to search hits whose text contains one of the (lower-case) tokens. */
export const KB_NOTES: readonly KbNote[] = [
  { any: ['selectedobject'], status: 'refined', text: 'Measured in 8.1.3: doc.selectedObject() returns undefined (not null) after selectObject(root); a new document starts with a non-root object selected. Test !obj or == null, never === null.' },
  { any: ['pointlight', 'spotlight', 'distantlight', 'arealight', 'skylight'], status: 'refined', text: 'Measured in 8.1.3: POINTLIGHT=15 exists but doc.addObject(POINTLIGHT) creates a non-light object (type 0, no lightType). SPOTLIGHT, DISTANTLIGHT, AREALIGHT and SKYLIGHT are undefined. Create lights with doc.addObject(LIGHT) and set the lightType parameter (0 ambient, 1 area, 2 distant, 3 point, 4 spot).' },
  { any: ['flat_interpol', 'const_interpol', 'soft_interpol', 'linear_interpol', 'spline_interpol'], status: 'refuted', text: 'Measured in 8.1.3: SOFT_INTERPOL=0, LINEAR_INTERPOL=1, SPLINE_INTERPOL=2, FLAT_INTERPOL=2, CONST_INTERPOL=3 (FLAT=3 in the knowledge base is wrong). CONST holds the previous value; LINEAR interpolates.' },
  { any: ['isequal'], status: 'confirmed', text: 'Measured in 8.1.3: Vec4D.isEqual() throws "Wrong number or type of arguments" even for identical vectors; Vec3D.isEqual() works. Compare components.' },
  { any: ['rib'], status: 'refuted', text: 'Measured in 8.1.3: Material.rib() does not exist although the reference lists it.' },
  { any: ['big_endiam', 'little_endia'], status: 'refuted', text: 'Typos in the official reference. The constants are BIG_ENDIAN (2) and LITTLE_ENDIAN (3); READ_MODE=0, WRITE_MODE=1, SEEK_SET/CUR/END=0/1/2.' },
  { any: ['flipwinding', 'winding', 'anticlockwise'], status: 'refuted', text: 'Measured in 8.1.3: Cheetah3D treats CLOCKWISE (seen from outside) as the front face. A quad (0,0,0)(1,0,0)(1,1,0)(0,1,0), counter-clockwise seen from +Z, has core.normal() = (0,0,-1); a native BOX has outward normals. flipWinding(p) reverses the normal. (c3d_create_mesh converts counter-clockwise input for you.)' },
  { any: ['instanceof'], status: 'confirmed', text: 'Measured in 8.1.3: (new Vec3D(1,2,3)) instanceof Vec3D is false; native classes cannot be tested with instanceof.' },
  { any: ['recordparametersforundo', 'recordgeometryforundo'], status: 'refined', text: 'Measured in 8.1.3: callable from a macro without error, but Edit > Undo still does not revert script changes (research/08 P11); use c3d checkpoints.' },
  { any: ['update menu'], status: 'refuted', text: 'Measured in 8.1.3: Tools > Script has no "Update Menu" item; restart Cheetah3D to pick up NEW script files (research/08 P02).' },
  { any: ['shadertag'], status: 'refined', text: 'Measured in 8.1.3: 30 material (SHADERTAG) tags on one object crashed Cheetah3D (stack-smash abort in buildMaterialArray); 24 were fine. c3d tools allow at most 24 per object.' },
  { any: ['readint'], status: 'refuted', text: 'Measured in 8.1.3: File instances in the c3d_run_script sandbox have no readInt(); documented readFloat/readShort/readUInt exist.' },
];
