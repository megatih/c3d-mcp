import { connect } from './live-driver.mjs';
import { mkdtempSync, copyFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const { call, close } = await connect();
const tmp = mkdtempSync(join(tmpdir(), 'c3dl3-'));
const step = async (label, name, args = {}) => { const r = await call(name, args); console.log(`${r.isError ? 'FAIL' : 'ok  '} ${label} [${name}] ${r.ms}ms ${JSON.stringify(r.sc ?? r.text).slice(0, 700)}`); return r; };
const what = process.argv[2];
if (what === 'open') {
  const copy = join(tmp, 'copy.jas'); copyFileSync(new URL('../../../fixtures/empty.jas', import.meta.url), copy);
  await step('open', 'c3d_open_document', { path: copy });
  await step('info', 'c3d_get_document_info');
  await step('create', 'c3d_create_object', { type: 'BOX', name: 'InCopy' });
  await step('save', 'c3d_save_document', { path: copy, confirm: true });
}
if (what === 'import') {
  await step('new', 'c3d_new_document');
  await step('import', 'c3d_import_asset', { id: 'ArmChair_01', resolution: '1k', open: true });
  await step('info', 'c3d_get_document_info');
  await step('list', 'c3d_list_scene', { depth: 3, limit: 20 });
}
if (what === 'merge') {
  await step('new', 'c3d_new_document');
  await step('box', 'c3d_create_object', { type: 'BOX', name: 'Host' });
  const exp = await step('export', 'c3d_export', { path: join(tmp, 'm.obj'), format: 'obj' });
  void exp;
}
await close(); console.log(tmp);
