// Dev: builds the Cornell Box Deluxe scene through the real MCP tools (dry run of docs/benchmark/cornell-box-deluxe.prompt.md).
import { connect } from './live-driver.mjs';
import { mkdirSync } from 'node:fs';
const { call, close } = await connect();
const out = '/tmp/bench/' + Date.now(); mkdirSync(out, { recursive: true });
const must = async (label, name, args) => { const r = await call(name, args); if (r.isError) { console.log('FAIL', label, JSON.stringify(r.sc).slice(0, 400)); throw new Error(label); } return r; };
const id = (r) => r.sc.object?.id ?? r.sc.ref?.id;
await must('new', 'c3d_new_document', {});
const slab = async (name, size, pos) => id(await must(name, 'c3d_create_object', { type: 'BOX', name, position: pos, params: { sizeX: size[0], sizeY: size[1], sizeZ: size[2] } }));
const ids = {};
ids.Floor = await slab('Floor', [5, .1, 5], [0, -.05, 0]); ids.Ceiling = await slab('Ceiling', [5, .1, 5], [0, 5.05, 0]);
ids.BackWall = await slab('BackWall', [5, 5, .1], [0, 2.5, -2.55]); ids.LeftWall = await slab('LeftWall', [.1, 5, 5], [-2.55, 2.5, 0]); ids.RightWall = await slab('RightWall', [.1, 5, 5], [2.55, 2.5, 0]);
const mat = async (name, type, color, extra = {}) => (await must(name, 'c3d_create_material', { name, type, color, ...extra })).sc.material;
const assign = (obj, m) => must('assign', 'c3d_assign_material', { ref: { id: obj }, material: { name: m } });
await mat('CornellWhite', 'Material', [.725, .71, .68, 1]); await mat('CornellRed', 'Material', [.63, .065, .05, 1]); await mat('CornellGreen', 'Material', [.14, .45, .091, 1]);
for (const k of ['Floor', 'Ceiling', 'BackWall']) await assign(ids[k], 'CornellWhite'); await assign(ids.LeftWall, 'CornellRed'); await assign(ids.RightWall, 'CornellGreen');
const light = await must('light', 'c3d_set_light', { name: 'AreaLight', light_type: 'area', position: [0, 4.93, 0], look_at_point: [0, 0, 0], color: [1, 1, 1, 1], intensity: Number(process.env.LI ?? 1), params: { width: 1.4, height: 1.4, attenuation: 0 } });
console.log('light', JSON.stringify(light.sc).slice(0, 300));
ids.Panel = await slab('LampPanel', [1.4, .02, 1.4], [0, 4.98, 0]); await mat('LampEmissive', 'Material', [1, 1, 1, 1]); await must('emis', 'c3d_set_material_params', { material: { name: 'LampEmissive' }, params: { emisColor: [1, 1, 1, 1] } }); await assign(ids.Panel, 'LampEmissive');
await must('cam', 'c3d_set_camera', { name: 'Cam', position: [0, 2.5, Number(process.env.CAMZ ?? 11)], look_at_point: [0, 2.5, 0], fov: Number(process.env.FOV ?? 36), active: true });
await must('rs', 'c3d_set_render_settings', { width: 320, height: 320, params: { giOn: false, shadowsOn: true, rayDepth: 6 } });
let t = Date.now(); const r1 = await must('r1', 'c3d_render_image', { path: `${out}/phase1.png` }); console.log('phase1 render', Date.now() - t, 'ms', 'luma', r1.sc.meanLuma);

const box = async (name, size, pos, rotY) => { const i = await slab(name, size, pos); if (rotY) await must('rot', 'c3d_set_transform', { ref: { id: i }, rotation: { x: rotY, y: 0, z: 0 } }); return i; };
ids.TallBox = await box('TallBox', [1.4, 3, 1.4], [-1.1, 1.5, -1.2], 20); ids.ShortBox = await box('ShortBox', [1.4, 1.4, 1.4], [0.9, 0.7, -0.6], -18);
ids.Rug = await slab('CheckerRug', [3.6, .02, 2.2], [-.2, .011, 1.1]);
const ball = async (name, r, pos) => id(await must(name, 'c3d_create_object', { type: 'BALL', name, position: pos, params: { radius: r, sections: 48, spans: 32 } }));
ids.Marble = await ball('MarbleBall', .5, [-1.1, 3.5, -1.2]); ids.Chrome = await ball('ChromeBall', .55, [-1.2, .57, 1.1]); ids.Glass = await ball('GlassBall', .65, [.9, .67, 1.3]);
import { readFileSync } from 'node:fs';
const code = /```js\n([\s\S]*?)```/.exec(readFileSync(new URL('../../../docs/benchmark/cornell-box-deluxe.prompt.md', import.meta.url), 'utf8'))[1];
const lint = await must('lint', 'c3d_lint_script', { code }); console.log('lint', JSON.stringify(lint.sc.findings).slice(0, 300));
t = Date.now(); const vr = await must('vase', 'c3d_run_script', { code }); console.log('vase', Date.now() - t, 'ms', JSON.stringify(vr.sc.value));
ids.Vase = vr.sc.value.id;
await must('vase pos', 'c3d_set_transform', { ref: { id: ids.Vase }, position: [.9, 1.4, -.6] });
const vo = await must('vase get', 'c3d_get_object', { ref: { id: ids.Vase }, include: ['bbox'] }); console.log('vase bbox', JSON.stringify(vo.sc.object.bbox));
const vm = await must('vase mesh', 'c3d_get_mesh', { ref: { id: ids.Vase }, vertex_limit: 1, polygon_limit: 1 }); console.log('vase counts', vm.sc.vertexCount, vm.sc.polygonCount);
await assign(ids.TallBox, 'CornellWhite');
// materials with procedural nodes
const proc = async (name, nodeType, obj, nodeParams) => {
  const m = await mat(name, 'Material', [.8, .8, .8, 1]);
  const n = await must(name + ' node', 'c3d_add_material_node', { material: { name }, type: nodeType, params: nodeParams });
  await must(name + ' connect', 'c3d_connect_nodes', { material: { name }, from_node: n.sc.nodeId, from_output: 'color', to_node: m.rootNodeId, to_input: 'diffColor' });
  await assign(obj, name);
};
const S = process.env.TS ? JSON.parse(process.env.TS) : { wood: [1, 1, 1], marble: [1, 1, 1], checker: [1, 1, 1] };
await proc('WoodMat', 'wood', ids.ShortBox, { color0: [.45, .28, .12, 1], color1: [.22, .11, .04, 1], scale: S.wood });
await proc('MarbleMat', 'marble', ids.Marble, { color0: [.93, .93, .9, 1], color1: [.2, .24, .3, 1], scale: S.marble });
await proc('CheckerMat', 'checkerboard', ids.Rug, { color0: [.9, .9, .9, 1], color1: [.06, .06, .06, 1], scale: S.checker });
await mat('ChromeMat', 'Material (PBR)', [.95, .95, .97, 1], { metalness: 1, roughness: .04 }); await assign(ids.Chrome, 'ChromeMat');
await mat('GlassMat', 'Glass', [1, 1, 1, 1]); await must('eta', 'c3d_set_material_params', { material: { name: 'GlassMat' }, params: { transEta: 1.52, transAbsorption: .02 } }); await assign(ids.Glass, 'GlassMat');
await mat('GoldMat', 'Material (PBR)', [1, .78, .34, 1], { metalness: 1, roughness: .18 }); await must('clearcoat', 'c3d_set_material_params', { material: { name: 'GoldMat' }, params: { reflClearcoat: .6 } }); await assign(ids.Vase, 'GoldMat');
t = Date.now(); const r2 = await must('r2', 'c3d_render_image', { path: `${out}/phase3.png` }); console.log('phase3 render', Date.now() - t, 'ms luma', r2.sc.meanLuma);
await must('gi', 'c3d_set_render_settings', { width: 320, height: 320, params: { giOn: true, giSamples: Number(process.env.GIS ?? 150), rayDepth: 8, reflectionOn: true, refractionOn: true, shadowsOn: true, antialiasingMaxSamples: 2 } });
t = Date.now(); const r3 = await must('r3', 'c3d_render_image', { path: `${out}/phase4.png` }); console.log('phase4 GI render', Date.now() - t, 'ms luma', r3.sc.meanLuma);

if (process.env.FINAL) {
  await must('final settings', 'c3d_set_render_settings', { width: 1024, height: 1024, params: { giOn: true, giSamples: Number(process.env.FINAL), rayDepth: 10, antialiasingMaxSamples: 4 } });
  t = Date.now(); const rf = await must('final', 'c3d_render_image', { path: `${out}/final.png` }); console.log('FINAL render', Date.now() - t, 'ms luma', rf.sc.meanLuma, rf.sc.width, rf.sc.height);
}
console.log('OUT', out);
await close();
