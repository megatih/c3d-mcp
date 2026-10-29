import { describe, it } from 'vitest';
import { createObject } from '../../src/tools/scene.js';
import { addTag } from '../../src/tools/tags.js';
import { expectCode, makeCtx, runTool } from '../helpers/fakeBridge.js';

describe('script-type guard (security review M4)', () => {
  it('refuses SCRIPTTAG and script object types', async () => {
    const t = makeCtx();
    await expectCode(runTool(addTag, { ref: { id: 1 }, type: 'SCRIPTTAG' }, t.ctx), 'UNSUPPORTED');
    await expectCode(runTool(createObject, { type: 'SCRIPTPOLY' }, t.ctx), 'UNSUPPORTED');
    await expectCode(runTool(createObject, { type: 'PARTICLESCRIPT' }, t.ctx), 'UNSUPPORTED');
  });
});
