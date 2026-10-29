import { connect } from './live-driver.mjs';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const { call, close } = await connect(); const tmp = mkdtempSync(join(tmpdir(), 'c3dl-'));
await call('c3d_new_document');
await call('c3d_create_object', { type: 'BALL', name: 'Ball' });
const l = await call('c3d_set_light', { name: 'Key', light_type: 'point', position: [3, 4, 3], intensity: 1 });
await call('c3d_set_camera', { name: 'C', position: [0, 1, 6], look_at_point: [0, 0, 0], active: true });
await call('c3d_set_render_settings', { width: 160, height: 120 });
for (const [i, att] of [[1, 2], [40, 2], [1, 0]]) {
  await call('c3d_set_light', { ref: { id: l.sc.object.id }, intensity: i, params: { attenuation: att } });
  const r = await call('c3d_render_image', { path: join(tmp, `r${i}-${att}.png`) });
  console.log('intensity', i, 'attenuation', att, 'luma', r.sc?.meanLuma, r.isError ? JSON.stringify(r.sc) : '');
}
await close();
