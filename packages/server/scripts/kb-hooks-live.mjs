// Instantiates the official example scripts through Tools > Script > <Type> Script (already installed, no restart needed) and reports what appeared.
// Tests the real hook machinery (buildUI/buildObject/performExpression) incl. Menger.js, which calls addParameterBool with 4 arguments.
import { connect } from './live-driver.mjs';
import { execFileSync } from 'node:child_process';
const press = (type, file) => {
  const as = `tell application "Cheetah3D" to activate\ndelay 0.4\ntell application "System Events" to tell process "Cheetah3D" to click menu item "${file}" of menu 1 of menu item "${type}" of menu 1 of menu item "Script" of menu 1 of menu bar item "Tools" of menu bar 1`;
  try { execFileSync('osascript', ['-e', as], { timeout: 20000 }); return 'clicked'; } catch (e) { return 'ERR ' + String(e.stderr || e).slice(0, 160); }
};
const { call, close } = await connect({ C3D_MCP_AUTO_CONFIRM: '1' });
const out = {};
const snap = async () => (await call('c3d_run_script', { code: 'const r=doc.root(); const a=[]; for(let i=0;i<r.childCount();i++){const c=r.childAtIndex(i); let pc=null; try{ pc=c.core().polygonCount(); }catch(e){} a.push({name:c.getParameter("name"),type:c.type(),tags:c.tagCount(),polys:pc,kids:c.childCount()});} return a;', force: true, confirm: true })).sc?.value;
for (const [type, file] of [['Polygon Script', 'Menger.js'], ['Polygon Script', 'Grassy Knoll.js'], ['Spline Script', 'Sinecircle.js'], ['Spline Script', 'RoundedRectangular.js'], ['Particle Script', 'Particle Menger.js']]) {
  await call('c3d_new_document', {});
  const before = await snap();
  const r = press(type, file);
  await new Promise((res) => setTimeout(res, 2500));
  let after;
  try { after = await snap(); } catch (e) { after = 'SNAPSHOT FAILED ' + String(e).slice(0, 120); }
  const alive = (() => { try { return execFileSync('pgrep', ['-x', 'Cheetah3D']).toString().trim(); } catch { return null; } })();
  out[`${type}/${file}`] = { click: r, before: before?.length, after, appAlive: !!alive };
  console.log(`${type}/${file}`, JSON.stringify(out[`${type}/${file}`]).slice(0, 500));
  if (!alive) { console.log('APP DIED'); break; }
}
await close();
