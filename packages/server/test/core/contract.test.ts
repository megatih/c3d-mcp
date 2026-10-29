import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from '../helpers/runtime.js';

const CONTRACTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'contracts');
const load = (f: string): object => JSON.parse(readFileSync(join(CONTRACTS, f), 'utf8')) as object;
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(load('state.schema.json'));
const request = ajv.compile(load('request.schema.json'));
const response = ajv.compile(load('response.schema.json'));
const state = ajv.getSchema('https://c3dmcp.dev/contracts/state.schema.json#/$defs/state');
const done = ajv.getSchema('https://c3dmcp.dev/contracts/state.schema.json#/$defs/done');

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});
afterEach(() => rmSync(h.env.root, { recursive: true, force: true }));

describe('contracts/*.schema.json', () => {
  it('the validators really reject bad data (so the other checks mean something)', () => {
    expect(request({ protocol: 1, id: 'nope', seq: '1', secret: 's', deadlineAt: 1, ops: [] })).toBe(false);
    expect(response({ protocol: 1 })).toBe(false);
    expect(state?.({ busy: 'yes' })).toBe(false);
    expect(done?.({ bytes: -1 })).toBe(false);
  });

  it('every request the client writes (incl. unicode document names and batch refs) validates', async () => {
    h.app.fileName = '名前.jas';
    h.app.ops.set('createObject', () => ({ ref: { id: 1 } }));
    h.app.ops.set('setTransform', () => ({}));
    h.rt.session.expectDocument = { fileName: '名前.jas' };
    await h.rt.bridge.run([{ op: 'createObject', args: { type: 'BOX', name: '箱' }, as: 'a' }, { op: 'setTransform', args: { ref: '$a', position: { x: 1, y: 2, z: 3 } } }]);
    await h.rt.bridge.one('ping', { counter: 1 }, { deadlineMs: 2000 });
    expect(h.app.contractViolations).toEqual([]);
    expect(h.app.opLog.map((o) => o.op)).toEqual(['createObject', 'setTransform', 'ping']);
  });

  it('FakeApp responses, state.json and .done markers conform; a late captured copy is re-validated', async () => {
    // keep the files: stop the client from deleting them by reading them from the app side
    const captured: unknown[] = [];
    const states: unknown[] = [];
    const doneMarkers: unknown[] = [];
    const orig = h.rt.mailbox.remove.bind(h.rt.mailbox);
    h.rt.mailbox.remove = async (seq, id) => {
      const out = h.env.paths.outbox;
      for (const f of readdirSync(out)) {
        const text = readFileSync(join(out, f), 'utf8');
        if (f === `${id}.json`) captured.push(JSON.parse(text));
        if (f === `${id}.done`) doneMarkers.push(JSON.parse(text));
      }
      states.push(JSON.parse(readFileSync(h.env.paths.state, 'utf8')));
      await orig(seq, id);
    };
    await h.rt.bridge.one('ping', { counter: 3 });
    await h.rt.bridge.run([{ op: 'boom' }]);
    expect(captured).toHaveLength(2);
    for (const r of captured) expect(response(r), JSON.stringify(response.errors)).toBe(true);
    for (const s of states) expect(state?.(s), JSON.stringify(state?.errors)).toBe(true);
    for (const d of doneMarkers) expect(done?.(d), JSON.stringify(done?.errors)).toBe(true);
    expect(h.app.contractViolations).toEqual([]);
  });
});
