// Used when the app is unreachable at schema time (requirements section 4). Values come from M0 probes P16/P17 (research/raw/param_dumps).
export const FALLBACK_CAPABILITIES = {
  fallback: true,
  apiVersion: '8.1.3',
  objectTypes: {
    BALL: 0, BOX: 1, DISC: 37, CONE: 3, CAPSULE: 87, CYLINDER: 4, PLANE: 7, POLYHEDRA: 39, TORUS: 10, TUBE: 35, STAIR: 32, POLYGONOBJ: 36,
    CIRCLE: 20, COG: 26, FLOWER: 27, HELIX: 28, LINE: 86, NEDGE: 29, RECT: 24, SPLINE: 19, STAR: 30, BLUEPRINT: 65, CAMERA: 2, FOLDER: 11,
    BOOLEAN: 34, CHAIN: 38, EXTRUDE: 21, ISOSURFACE: 84, LATHE: 22, POLYPLANE: 31, RELIEF: 33, SUBDIV: 9, SWEEP: 23, SYMMETRY: 14, PARTICLE: 57,
    PARTICLEEMITTER: 67, PARTICLEARRAY: 68, PARTICLEMESH: 69, PARTICLESPLINE: 70, ORIENTATIONEFF: 79, LIGHT: 5, JOINT: 45, SMARTFOLDER: 64,
    LOFT: 93, BACKGROUND: 94, TRIANGULATEMOD: 91, WIREFRAMEMOD: 92, ENVIRONMENTLIGHT: 89,
  } as Record<string, number>,
  tagTypes: {
    ANCHORTAG: 132, IKHANDLETAG: 117, IKCONSTRAINTTAG: 120, METABALLTAG: 128, MODETAG: 103, MORPHTAG: 119, ORIENTCONSTRAINTTAG: 122,
    PARENTCONSTRAINTTAG: 126, PARTICLETAG: 125, POINTCONSTRAINTTAG: 121, POSETAG: 124, RIGIDBODYTAG: 129, ROPETAG: 131, SKELETONTAG: 118,
    SOFTBODYTAG: 130, SPLINEIKTAG: 127, SHADERTAG: 102, FOGTAG: 107, RADIOSITYTAG: 108, HDRITAG: 109, DOFTAG: 110, RENDERTAG: 114,
    CAUSTICTAG: 116, SPLINETRACKINGTAG: 112, TARGETTAG: 111,
  } as Record<string, number>,
  materialTypes: ['Material', 'Material (PBR)', 'Toon', 'Glass', 'Shadowmat'],
  lightTypeRange: [0, 4],
  // Inferred from the manual's alphabetical list (Ambient, Area, Distant, Point, Spot) and kb spot=4; verify visually.
  lightTypes: { ambient: 0, area: 1, distant: 2, point: 3, spot: 4 },
  renderers: ['CHEETAH', 'FALCON'],
  renderFormats: ['png', 'jpg', 'tiff'],
  saveTypes: ['jas', 'obj', 'fbx', 'dae', 'stl', '3ds', 'usdz', 'gltf', 'glb', 'dxf'],
  limits: { drainRequests: 25, drainSeconds: 8 },
} as const;
