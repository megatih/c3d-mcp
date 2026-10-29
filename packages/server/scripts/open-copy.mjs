import { connect } from './live-driver.mjs';
const { call, close } = await connect();
const r = await call('c3d_open_document', { path: process.argv[2] });
console.log(r.isError ? 'ERR ' + JSON.stringify(r.sc).slice(0, 300) : JSON.stringify(r.sc).slice(0, 300));
await close();
