// Tool behaviour that comes from measurements in Cheetah3D 8.1.3 (research/10-kb-verification-8.1.3.md).
import { beforeEach, describe, expect, it } from 'vitest';
import { setBackground, setCamera, setLight } from '../../src/tools/cameraLight.js';
import { createMaterial } from '../../src/tools/materials.js';
import { setRenderSettings } from '../../src/tools/render.js';
import { expectCode, makeCtx, runTool, type TestCtx } from '../helpers/fakeBridge.js';

let t: TestCtx;
beforeEach(() => { t = makeCtx(); });

describe('c3d_set_light (C5, C7)', () => {
  it('maps shadow_softness to shadowSoft and visible_in_camera to geometry', async () => {
    const l = t.bridge.addObject('LIGHT', 'L');
    await runTool(setLight, { ref: { id: l.id }, shadow_softness: 2.5, visible_in_camera: true }, t.ctx);
    expect(l.params).toMatchObject({ shadowSoft: 2.5, geometry: 1 });
    await runTool(setLight, { ref: { id: l.id }, visible_in_camera: false }, t.ctx);
    expect(l.params.geometry).toBe(0);
  });
  it('rejects negative softness', () => {
    expect(() => setLight.inputSchema.parse({ shadow_softness: -1 })).toThrow();
  });
});

describe('c3d_set_camera (C8, C9)', () => {
  it('maps projection names and camera_light to the measured integers', async () => {
    const c = t.bridge.addObject('CAMERA', 'C');
    await runTool(setCamera, { ref: { id: c.id }, projection: 'orthographic', camera_light: 'off' }, t.ctx);
    expect(c.params).toMatchObject({ projection: 2, cameraLightOnOff: 0 });
    await runTool(setCamera, { ref: { id: c.id }, projection: 'perspective', camera_light: 'auto' }, t.ctx);
    expect(c.params).toMatchObject({ projection: 0, cameraLightOnOff: 2 });
    await runTool(setCamera, { ref: { id: c.id }, projection: 1, camera_light: 'on' }, t.ctx);
    expect(c.params).toMatchObject({ projection: 1, cameraLightOnOff: 1 });
  });
  it('validates', () => {
    expect(() => setCamera.inputSchema.parse({ projection: 3 })).toThrow();
    expect(() => setCamera.inputSchema.parse({ projection: 'fisheye' })).toThrow();
    expect(() => setCamera.inputSchema.parse({ camera_light: 'dim' })).toThrow();
  });
});

describe('c3d_set_background transparent (C11)', () => {
  it('sets backgroundColor alpha 0 and clears the image', async () => {
    const cam = t.bridge.addObject('CAMERA', 'Cam'); t.bridge.doc.activeCamera = cam.id;
    await runTool(setBackground, { kind: 'transparent' }, t.ctx);
    expect(cam.params.backgroundColor).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(cam.params.backgroundImage).toBe('');
    await runTool(setBackground, { kind: 'transparent', color: '#336699' }, t.ctx);
    expect(cam.params.backgroundColor).toMatchObject({ a: 0 });
    expect((cam.params.backgroundColor as { r: number }).r).toBeCloseTo(0.2, 1);
  });
});

describe('c3d_create_material Shadowmat (C14)', () => {
  it('passes the type through and uses the color parameter of the shadow root', async () => {
    await runTool(createMaterial, { name: 'Catcher', type: 'Shadowmat', color: '#000000' }, t.ctx);
    expect(t.bridge.argsOf('createMaterial')[0]).toMatchObject({ name: 'Catcher', type: 'Shadowmat', params: { color: { r: 0, g: 0, b: 0, a: 1 } } });
  });
});

describe('c3d_set_render_settings samples guard (D)', () => {
  it('refuses samples <= 0 (Falcon would refine until stopped)', async () => {
    await expectCode(runTool(setRenderSettings, { renderer: 'FALCON', params: { samples: 0 } }, t.ctx), 'INVALID_ARGUMENT');
    await expectCode(runTool(setRenderSettings, { params: { samples: -5 } }, t.ctx), 'INVALID_ARGUMENT');
    expect(t.bridge.argsOf('setRenderSettings')).toHaveLength(0);
    await runTool(setRenderSettings, { renderer: 'FALCON', params: { samples: 40 } }, t.ctx);
    expect(t.bridge.argsOf('setRenderSettings')[0]).toMatchObject({ params: { samples: 40 } });
  });
});
