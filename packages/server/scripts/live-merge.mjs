import { connect } from './live-driver.mjs';
const { call, close } = await connect();
const step = async (label, name, args = {}) => { const r = await call(name, args); console.log(`${r.isError ? 'FAIL' : 'ok  '} ${label} [${name}] ${r.ms}ms ${JSON.stringify(r.sc ?? r.text).slice(0, 700)}`); return r; };
await step('new', 'c3d_new_document');
await step('box', 'c3d_create_object', { type: 'BOX', name: 'Host' });
await step('merge', 'c3d_merge_file', { path: process.env.HOME + '/Library/Application Support/Cheetah3D/MCP/tmp/assets/ArmChair_01/ArmChair_01_1k.fbx' });
await step('list', 'c3d_list_scene', {});
await close();
