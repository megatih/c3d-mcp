import { connect } from './live-driver.mjs';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const { call, close } = await connect();
const tmp = mkdtempSync(join(tmpdir(), 'c3dl2-'));
let bad = 0;
const step = async (label, name, args = {}, { expectErr = false } = {}) => {
  let r; try { r = await call(name, args); } catch (e) { r = { ms: 0, isError: true, sc: { exception: String(e) } }; }
  const ok = expectErr ? r.isError : !r.isError; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} [${name}] ${r.ms}ms ${JSON.stringify(r.sc ?? r.text).slice(0, 420)}`); return r;
};
const only = process.argv[2];
const run = (k) => !only || only === k;
await step('new doc', 'c3d_new_document');
const b = await step('box', 'c3d_create_object', { type: 'BOX', name: 'Src', position: [0, 0.5, 0] });
const id = b.sc?.object?.id;
if (run('mesh')) {
  const m = await step('mesh', 'c3d_create_mesh', { name: 'Quad', vertices: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], polygons: [[0,1,2,3]] });
  const mid = m.sc?.object?.id;
  await step('get_mesh', 'c3d_get_mesh', { ref: { id: mid } });
  await step('edit_mesh', 'c3d_edit_mesh', { ref: { id: mid }, set_vertices: [{ index: 2, position: [2, 2, 0] }] });
  await step('get_mesh2', 'c3d_get_mesh', { ref: { id: mid } });
}
if (run('docs')) {
  await step('set_fps', 'c3d_set_fps', { fps: 24 });
  await step('takes add', 'c3d_takes', { action: 'add', name: 'T2' });
  await step('takes list', 'c3d_takes', { action: 'list' });
  await step('takes select', 'c3d_takes', { action: 'select', name: 'Take' });
  await step('takes remove', 'c3d_takes', { action: 'remove', name: 'T2' });
  await step('set_fps30', 'c3d_set_fps', { fps: 30 });
  await step('tag params', 'c3d_add_tag', { ref: { id }, type: 'SHADERTAG' });
  await step('set tag', 'c3d_set_tag_params', { ref: { id }, tag_index: 1, params: { priority: 5 } });
  await step('rm tag', 'c3d_remove_tag', { ref: { id }, tag_index: 1 });
  await step('use_document', 'c3d_use_document', {});
  await step('export dae', 'c3d_export', { path: join(tmp, 'a.dae'), format: 'dae' });
  await step('export stl', 'c3d_export', { path: join(tmp, 'a.stl'), format: 'stl' });
  await step('export usdz', 'c3d_export', { path: join(tmp, 'a.usdz'), format: 'usdz' });
}
if (run('tex')) {
  const mt = await step('mat', 'c3d_create_material', { name: 'TexMat', color: [1, 1, 1, 1] });
  const img = await step('img node', 'c3d_add_material_node', { material: { name: 'TexMat' }, type: 'image' });
  await step('set_texture', 'c3d_set_texture', { material: { name: 'TexMat' }, node: img.sc?.nodeId, path: new URL('../../../README.md', import.meta.url).pathname }, { expectErr: true });
  void mt;
}
if (run('seq')) {
  await step('settings', 'c3d_set_render_settings', { width: 120, height: 90 });
  const j = await step('sequence', 'c3d_render_sequence', { directory: join(tmp, 'seq'), prefix: 'f', format: 'png', start: 0, end: 0.2, fps: 10 });
  const jid = j.sc?.job_id;
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 1500)); const s = await call('c3d_job_status', { job_id: jid }); console.log('  job', JSON.stringify(s.sc).slice(0, 200)); if (['done', 'completed', 'failed', 'cancelled'].includes(s.sc?.status)) break; }
}
if (run('cap')) await step('capture', 'c3d_capture_viewport', {});
if (run('assets')) {
  await step('search', 'c3d_search_assets', { query: 'chair', type: 'models', limit: 3 });
}
if (run('chk')) {
  const cp = await step('checkpoint', 'c3d_checkpoint', { label: 'two' });
  await step('delete all', 'c3d_delete_objects', { refs: [{ id }], confirm: true });
  await step('restore list', 'c3d_restore_checkpoint', { list_only: true });
  await step('restore', 'c3d_restore_checkpoint', { id: cp.sc?.checkpoint?.id, confirm: true });
  await step('docinfo', 'c3d_get_document_info');
  await step('list', 'c3d_list_scene', {});
}
if (run('menu')) {
  await step('duplicate', 'c3d_duplicate', { ref: { id }, count: 1, method: 'auto' });
  await step('list', 'c3d_list_scene', {});
  await step('make_editable', 'c3d_make_editable', { ref: { id } });
  await step('list2', 'c3d_list_scene', {});
}
await close(); console.log(bad ? `${bad} FAILURES` : 'ALL OK', tmp);
