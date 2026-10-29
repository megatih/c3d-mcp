// Builds the eval fixtures live through the MCP server (never overwrites an existing fixture).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from '../packages/server/scripts/live-driver.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { call, close } = await connect();
const must = async (name, a) => { const r = await call(name, a); if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.sc)}`); return r; };
const make = async (file, build) => {
  const path = join(repo, 'fixtures', file);
  if (existsSync(path)) { console.log('exists', file); return; }
  await must('c3d_new_document', {});
  await build();
  await must('c3d_save_document', { path });
  console.log('created', file);
};
const box = (name, position = [0, 0, 0], extra = {}) => must('c3d_create_object', { type: 'BOX', name, position, ...extra });

await make('one_box.jas', () => box('Box'));
await make('selected_cube.jas', () => box('Model'));
await make('target_ball.jas', () => must('c3d_create_object', { type: 'BALL', name: 'Target', position: [0, 1, 0] }));
await make('lamp.jas', () => must('c3d_create_object', { type: 'LIGHT', name: 'Lamp', position: [2, 3, 2] }));
await make('tmp_objects.jas', async () => {
  const t2 = await box('Tmp2');
  for (const n of ['Tmp2A', 'Tmp2B']) { const c = await box(n); await must('c3d_reparent', { ref: { id: c.sc.object.id }, parent: { id: t2.sc.object.id } }); }
  await box('Tmp1');
  for (let i = 3; i <= 7; i++) await box(`Tmp${i}`);
  await box('Keep1');
});
await make('pyramid.jas', () => must('c3d_create_mesh', {
  name: 'Pyramid',
  vertices: [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [0, 1.5, 0]],
  polygons: [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
}));
await close();
