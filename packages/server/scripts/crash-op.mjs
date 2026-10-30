import { execFileSync } from 'node:child_process';
import { loadConfig } from '../dist/config.js';
import { createRuntime } from '../dist/core/runtime.js';
import { trackWindows } from './window-cleanup.mjs';
const alive = () => { try { execFileSync('pgrep', ['-x', 'Cheetah3D']); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!alive()) { execFileSync('open', ['-a', 'Cheetah3D']); await sleep(9000); }
const rt = createRuntime(loadConfig());
process.once('exit', trackWindows());
execFileSync('osascript', ['-e', 'tell application "System Events" to tell process "Cheetah3D" to click menu item "New" of menu 1 of menu bar item "File" of menu bar 1']); await sleep(1500);
await rt.bridge.one('setMarker', { uuid: crypto.randomUUID() });
await rt.bridge.one('createMaterial', { name: 'OpProbe' });
await rt.bridge.one('removeMaterial', { material: { name: 'OpProbe' } });
await sleep(7000);
console.log('removeMaterial OP =>', alive() ? 'ALIVE' : 'CRASHED');
