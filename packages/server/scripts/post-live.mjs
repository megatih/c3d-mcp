import { connect } from './live-driver.mjs';
const { call, close } = await connect();
const r = await call('c3d_postprocess_image', { path: 'newtools_bg.png', out_path: `post_${Date.now()}.png`, bloom: { threshold: 0.6, radius: 12, intensity: 0.6 }, outline: { strength: 0.8, width: 1.5 }, vignette: { intensity: 0.5, radius: 1 }, grade: { saturation: 1.2 }, include_image: false });
console.log(r.isError ? 'ERR ' + JSON.stringify(r.sc) : JSON.stringify(r.sc).slice(0, 500));
await close();
