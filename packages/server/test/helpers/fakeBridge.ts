/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/restrict-plus-operands, eqeqeq -- loosely typed runtime data; indices are bounds-checked by construction */
// In-memory fake of the bridge + helper + context for tool handler tests. No Cheetah3D, no network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { z } from 'zod';
import { createStaticServices } from '../../src/services/index.js';
import { eulerToMatrix, matMul, type M3 } from '../../src/lib/lookAt.js';
import {
  BridgeError, type BridgeClient, type BridgeOp, type BridgeResponse, type HelperClient, type OpResult, type RunOpts,
  type ServerConfig, type SessionState, type ToolContext, type ToolDef, type ToolResult,
} from '../../src/toolkit.js';

export function makePng(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = pixel(x, y); raw.set(p, y * (w * 3 + 1) + 1 + x * 3); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

interface FObj {
  id: number; name: string; type: string; parent: number | null; children: number[]; params: Record<string, any>; tags: Array<{ type: string; params: Record<string, any> }>;
  mesh?: { vertices: number[][]; polygons: number[][]; uvs?: unknown };
}
interface FMat { index: number; name: string; rootNodeType: string; nodes: Array<{ id: number; type: string; params: Record<string, any> }>; connections: any[] }

const TYPE_IDS: Record<string, number> = { BALL: 0, BOX: 1, CAMERA: 2, LIGHT: 5, FOLDER: 11, POLYGONOBJ: 36, SPLINE: 20 };
const ROOT_FOR: Record<string, string> = { 'Material (PBR)': 'pbrmetal', Toon: 'toon', Glass: 'dielectric' };

export type Canned = unknown | ((args: any, bridge: FakeBridge) => unknown);

export class FakeBridge implements BridgeClient {
  calls: BridgeOp[] = [];
  requests: Array<{ ops: BridgeOp[]; opts?: RunOpts }> = [];
  canned = new Map<string, Canned>();
  failures = new Map<string, BridgeError>();
  /** Fails the n-th (1-based) call of an op once. */
  failNth = new Map<string, { n: number; count: number; err: BridgeError }>();
  objects = new Map<number, FObj>();
  rootChildren: number[] = [];
  materials: FMat[] = [];
  selection: number[] = [];
  keys = new Map<string, any[]>();
  doc = { fileName: null as string | null, fps: 30, time: 0, end: 10, marker: null as string | null, takes: [{ name: 'Main', length: 10 }], current: 'Main', activeCamera: 0 };
  logLines: string[] = [];
  blankRender = false;
  /** Artificial latency per op (ms), for job/cancel tests. */
  delayMs = 0;
  private nextId = 100;
  private nextNode = 1000;

  addObject(type: string, name: string, parent: number | null = null, params: Record<string, any> = {}): FObj {
    const o: FObj = { id: this.nextId++, name, type, parent, children: [], params: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, ...params }, tags: [] };
    this.objects.set(o.id, o);
    if (parent === null) this.rootChildren.push(o.id); else this.objects.get(parent)!.children.push(o.id);
    return o;
  }

  private pathOf(o: FObj): string { return `${o.parent === null ? '' : this.pathOf(this.objects.get(o.parent)!)}/${o.name.replace(/\\/g, '\\\\').replace(/\//g, '\\/')}`; }
  private indexPathOf(o: FObj): number[] { const sib = o.parent === null ? this.rootChildren : this.objects.get(o.parent)!.children; return [...(o.parent === null ? [] : this.indexPathOf(this.objects.get(o.parent)!)), sib.indexOf(o.id)]; }
  descriptor(o: FObj): Record<string, any> {
    return { id: o.id, name: o.name, path: this.pathOf(o), indexPath: this.indexPathOf(o), type: o.type, typeId: TYPE_IDS[o.type] ?? 99, family: o.type === 'POLYGONOBJ' ? 5 : 0, childCount: o.children.length, tagCount: o.tags.length };
  }
  private rot(o: FObj): M3 {
    const r = o.params.rotation;
    const local = eulerToMatrix(r.x, r.y, r.z);
    return o.parent === null ? local : matMul(this.rot(this.objects.get(o.parent)!), local);
  }
  private worldPos(o: FObj): [number, number, number] {
    const p = o.params.position;
    if (o.parent === null) return [p.x, p.y, p.z];
    const par = this.objects.get(o.parent)!;
    const pr = this.rot(par);
    const pp = this.worldPos(par);
    return [pr[0][0] * p.x + pr[0][1] * p.y + pr[0][2] * p.z + pp[0], pr[1][0] * p.x + pr[1][1] * p.y + pr[1][2] * p.z + pp[1], pr[2][0] * p.x + pr[2][1] * p.y + pr[2][2] * p.z + pp[2]];
  }

  resolve(ref: any): FObj {
    if (typeof ref === 'string') ref = ref.startsWith('/') ? { path: ref } : { id: Number(ref) };
    if (ref?.ref) ref = ref.ref;
    let hits: FObj[] = [];
    if (ref?.id !== undefined) hits = [this.objects.get(ref.id)].filter((x): x is FObj => !!x);
    else if (ref?.path !== undefined) hits = [...this.objects.values()].filter((o) => this.pathOf(o) === ref.path);
    else if (ref?.indexPath) { let list = this.rootChildren; let cur: FObj | undefined; for (const i of ref.indexPath as number[]) { cur = this.objects.get(list[i]!); if (!cur) break; list = cur.children; } hits = cur ? [cur] : []; }
    else if (ref?.selected) hits = this.selection.length ? [this.objects.get(this.selection[0]!)!] : [];
    if (!hits.length) throw new BridgeError('NOT_FOUND', `Object not found: ${JSON.stringify(ref)}`);
    if (hits.length > 1) throw new BridgeError('AMBIGUOUS', `Ambiguous: ${JSON.stringify(ref)}`, 'use id', { candidates: hits.map((h) => this.descriptor(h)) });
    return hits[0]!;
  }
  private mat(ref: any): FMat {
    const m = typeof ref === 'string' ? this.materials.find((x) => x.name === ref) : ref.name !== undefined ? this.materials.find((x) => x.name === ref.name) : this.materials[ref.index];
    if (!m) throw new BridgeError('NOT_FOUND', `Material not found: ${JSON.stringify(ref)}`);
    return m;
  }
  private walk(root: FObj | null, depth: number, d = 0): Array<FObj & { depth: number }> {
    const list = root ? root.children : this.rootChildren;
    return list.flatMap((id) => { const o = this.objects.get(id)!; return [{ ...o, depth: d }, ...(d < depth ? this.walk(o, depth, d + 1) : [])]; });
  }
  private applyParams(target: { params: Record<string, any> }, params: Record<string, any>): { applied: string[]; errors: any[] } {
    const applied: string[] = []; const errors: any[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (k.startsWith('bogus')) errors.push({ name: k, code: 'NOT_FOUND', message: `no parameter ${k}` }); else { target.params[k] = v; applied.push(k); }
    }
    return { applied, errors };
  }
  private rootObj(): FObj { return { id: 0, name: 'root', type: 'ROOT', parent: null, children: this.rootChildren, params: {}, tags: [] }; }

  exec(op: string, a: any): any {
    const nth = this.failNth.get(op);
    if (nth && ++nth.count === nth.n) throw nth.err;
    const injected = this.failures.get(op);
    if (injected) throw injected;
    if (this.canned.has(op)) { const c = this.canned.get(op); return typeof c === 'function' ? (c as (x: any, b: FakeBridge) => unknown)(a, this) : c; }
    switch (op) {
      case 'ping': return { counter: a.counter ?? 0, echo: a.echo, runtimeVersion: '0.1.0', now: 0, jsc: true, stateBusy: false };
      case 'capabilities': return { lightTypes: { point: 0, distant: 1, spot: 2, area: 3, sky: 4 }, objectTypes: TYPE_IDS };
      case 'getLog': return { lines: this.logLines.slice(-(a.tail ?? 100)) };
      case 'getDocumentInfo': return { fileName: this.doc.fileName, fps: this.doc.fps, time: this.doc.time, end: this.doc.end, takeCount: this.doc.takes.length, currentTake: this.doc.current, renderer: 'CHEETAH', editMode: 0, activeCamera: { id: this.doc.activeCamera, name: 'cam' }, objectCount: this.objects.size, materialCount: this.materials.length, marker: this.doc.marker };
      case 'setMarker': this.doc.marker = `__c3d_mcp_session_${a.uuid}`; return { marker: this.doc.marker, created: true };
      case 'saveTo': fs.mkdirSync(path.dirname(a.path), { recursive: true }); fs.writeFileSync(a.path, `FAKE-${a.type}`); return { path: a.path, type: a.type, size: 8 };
      case 'setTime': this.doc.time = a.time; return { time: a.time };
      case 'setFps': this.doc.fps = a.fps; return { fps: a.fps };
      case 'takes': {
        const t = this.doc.takes;
        if (a.action === 'add') t.push({ name: a.name, length: 10 });
        else if (a.action === 'remove') this.doc.takes = t.filter((x) => x.name !== a.name);
        else if (a.action === 'rename') { const x = t.find((y) => y.name === a.name); if (!x) throw new BridgeError('NOT_FOUND', 'no take'); x.name = a.newName; }
        else if (a.action === 'select') this.doc.current = a.name;
        return { takes: this.doc.takes, current: this.doc.current };
      }
      case 'listScene': {
        const root = a.root ? this.resolve(a.root) : null;
        const all = this.walk(root, a.depth ?? 4);
        const off = a.offset ?? 0; const lim = a.limit ?? 100;
        const items = all.slice(off, off + lim).map((o) => ({ ...this.descriptor(o), depth: o.depth }));
        return { items, total: all.length, nextOffset: off + lim < all.length ? off + lim : null };
      }
      case 'getObject': {
        const o = this.resolve(a.ref); const inc: string[] = a.include ?? [];
        const r: Record<string, any> = this.descriptor(o);
        if (inc.includes('parameters')) r.parameters = Object.entries(o.params).map(([name, value]) => ({ name, type: typeof value === 'number' ? 'Float' : 'Vec3D', value }));
        if (inc.includes('tags')) r.tags = o.tags.map((t, i) => ({ index: i, type: t.type }));
        if (inc.includes('children')) r.children = o.children.map((c) => this.descriptor(this.objects.get(c)!));
        if (inc.includes('worldMatrix')) r.worldMatrix = { rows: this.rot(o), position: { x: this.worldPos(o)[0], y: this.worldPos(o)[1], z: this.worldPos(o)[2] } };
        return r;
      }
      case 'createObject': {
        const parent = a.parent ? this.resolve(a.parent).id : null;
        const o = this.addObject(a.type, a.name ?? a.type[0] + a.type.slice(1).toLowerCase(), parent);
        if (a.transform?.position) o.params.position = a.transform.position;
        if (a.transform?.rotation) o.params.rotation = a.transform.rotation;
        if (a.transform?.scale) o.params.scale = a.transform.scale;
        if (a.lightType !== undefined) o.params.lightType = a.lightType;
        if (a.params) this.applyParams(o, a.params);
        if (a.type === 'CAMERA') this.doc.activeCamera = o.id;
        return { ref: { id: o.id }, ...this.descriptor(o) };
      }
      case 'deleteObjects': {
        const ids: number[] = [];
        for (const r of a.refs) { const o = this.resolve(r); const list = o.parent === null ? this.rootChildren : this.objects.get(o.parent)!.children; list.splice(list.indexOf(o.id), 1); this.objects.delete(o.id); ids.push(o.id); }
        return { removed: ids.length, ids };
      }
      case 'reparent': {
        const o = this.resolve(a.ref); const p = this.resolve(a.parent);
        const old = o.parent === null ? this.rootChildren : this.objects.get(o.parent)!.children; old.splice(old.indexOf(o.id), 1);
        o.parent = p.id; p.children.splice(a.index ?? p.children.length, 0, o.id);
        return this.descriptor(o);
      }
      case 'rename': { const o = this.resolve(a.ref); o.name = a.name; return this.descriptor(o); }
      case 'setTransform': {
        const o = this.resolve(a.ref);
        for (const k of ['position', 'rotation', 'scale']) if (a[k]) o.params[k] = a[k];
        return { ...this.descriptor(o), transform: { position: o.params.position, rotation: o.params.rotation, scale: o.params.scale } };
      }
      case 'getParameters': {
        const o = this.resolve(a.ref);
        const names: string[] | undefined = a.names;
        return { ref: { id: o.id }, parameters: [{ name: 'scriptName', type: 'String', value: '' }, ...Object.entries(o.params).filter(([k]) => !names || names.includes(k)).map(([name, value]) => ({ name, type: typeof value === 'number' ? 'Float' : 'Vec3D', value }))] };
      }
      case 'setParameters': {
        const o = this.resolve(a.ref);
        const target = a.tag ? o.tags[a.tag.index] : o;
        if (!target) throw new BridgeError('NOT_FOUND', `no tag ${a.tag.index}`);
        return this.applyParams(target, a.params);
      }
      case 'select': {
        const prev = this.selection.map((i) => this.descriptor(this.objects.get(i)!));
        this.selection = a.refs.map((r: any) => this.resolve(r).id);
        return { previous: prev, selected: this.selection.map((i) => this.descriptor(this.objects.get(i)!)) };
      }
      case 'addTag': { const o = this.resolve(a.ref); o.tags.push({ type: a.type, params: { ...(a.params ?? {}) } }); return { tagIndex: o.tags.length - 1, type: a.type, tags: o.tags.map((t, i) => ({ index: i, type: t.type })) }; }
      case 'removeTag': { const o = this.resolve(a.ref); if (!o.tags[a.index]) throw new BridgeError('NOT_FOUND', 'no such tag'); o.tags.splice(a.index, 1); return { tagIndex: a.index, type: '', tags: o.tags.map((t, i) => ({ index: i, type: t.type })) }; }
      case 'createMesh': {
        let o: FObj;
        if (a.append) { o = this.resolve(a.append.ref); const n = o.mesh!.vertices.length + a.vertices.length; for (const p of a.polygons as number[][]) if (p.some((i) => i >= n)) throw new BridgeError('INVALID_ARGUMENT', 'index out of range', undefined, { polygon: 0 }); o.mesh!.vertices.push(...a.vertices); o.mesh!.polygons.push(...a.polygons); }
        else { o = this.addObject('POLYGONOBJ', a.name ?? 'Mesh', a.parent ? this.resolve(a.parent).id : null); o.mesh = { vertices: [...a.vertices], polygons: [...a.polygons], uvs: a.uvs }; if (a.transform?.position) o.params.position = a.transform.position; if (a.material) o.tags.push({ type: 'SHADERTAG', params: { material: a.material } }); }
        return { ref: { id: o.id }, vertexCount: o.mesh!.vertices.length, polygonCount: o.mesh!.polygons.length, ...this.descriptor(o) };
      }
      case 'getMesh': {
        const o = this.resolve(a.ref); if (!o.mesh) throw new BridgeError('INVALID_ARGUMENT', 'not a polygon object', 'make editable');
        const vo = a.vertexOffset ?? 0; const vl = a.vertexLimit ?? 500; const po = a.polygonOffset ?? 0; const pl = a.polygonLimit ?? 500;
        return { vertices: o.mesh.vertices.slice(vo, vo + vl), polygons: o.mesh.polygons.slice(po, po + pl), vertexCount: o.mesh.vertices.length, polygonCount: o.mesh.polygons.length, nextVertexOffset: vo + vl < o.mesh.vertices.length ? vo + vl : null, nextPolygonOffset: po + pl < o.mesh.polygons.length ? po + pl : null };
      }
      case 'editMesh': {
        const o = this.resolve(a.ref); if (!o.mesh) throw new BridgeError('INVALID_ARGUMENT', 'not a polygon object');
        for (const s of a.setVertices ?? []) o.mesh.vertices[s.index] = [s.position.x, s.position.y, s.position.z];
        if (a.deletePolygons) o.mesh.polygons = o.mesh.polygons.filter((_, i) => !a.deletePolygons.includes(i));
        return { vertexCount: o.mesh.vertices.length, polygonCount: o.mesh.polygons.length };
      }
      case 'createSpline': { const o = this.addObject('SPLINE', a.name ?? 'Spline', a.parent ? this.resolve(a.parent).id : null); return { ref: { id: o.id }, pathCount: a.paths.length, ...this.descriptor(o) }; }
      case 'listMaterials': return { materials: this.materials.map((m) => ({ index: m.index, name: m.name, rootNodeType: m.rootNodeType, nodeCount: m.nodes.length })) };
      case 'createMaterial': {
        let name = a.name; let n = 1; while (this.materials.some((m) => m.name === name)) name = `${a.name}.${++n}`;
        const root = ROOT_FOR[a.type ?? 'Material'] ?? 'material';
        const m: FMat = { index: this.materials.length, name, rootNodeType: root, nodes: [{ id: this.nextNode++, type: root, params: {} }], connections: [] };
        if (a.params) this.applyParams(m.nodes[0]!, a.params);
        this.materials.push(m);
        return { index: m.index, name, rootNodeType: root, rootNodeId: m.nodes[0]!.id };
      }
      case 'setMaterialParams': { const m = this.mat(a.material); const node = a.node == null ? m.nodes[0]! : m.nodes.find((n) => n.id === a.node); if (!node) throw new BridgeError('NOT_FOUND', 'node'); return this.applyParams(node, a.params); }
      case 'addMaterialNode': { const m = this.mat(a.material); const n = { id: this.nextNode++, type: a.type, params: {} }; m.nodes.push(n); return { nodeId: n.id, type: a.type, inputs: ['in1'], outputs: ['color'] }; }
      case 'connectNodes': { const m = this.mat(a.material); if (!m.nodes.some((n) => n.id === a.fromNode) || !m.nodes.some((n) => n.id === a.toNode)) throw new BridgeError('NOT_FOUND', 'node'); m.connections.push(a); return { connected: true }; }
      case 'getMaterialGraph': { const m = this.mat(a.material); return { name: m.name, nodes: m.nodes.map((n) => ({ ...n, params: Object.entries(n.params).map(([name, value]) => ({ name, value })), inputs: [], outputs: [] })), connections: m.connections }; }
      case 'assignMaterial': { const o = this.resolve(a.ref); const m = this.mat(a.material); if (a.polygons) { const slot = a.slot ?? o.tags.filter((t) => t.params?.shadeSelection).length + 1; o.tags.push({ type: 'SHADERTAG', params: { material: m.name, shadeSelection: slot + 1, polygons: a.polygons } }); return { tagIndex: o.tags.length - 1, material: { name: m.name }, slot, polygons: a.polygons.length }; } if (a.replaceExisting) o.tags = o.tags.filter((t) => t.type !== 'SHADERTAG'); o.tags.push({ type: 'SHADERTAG', params: { material: m.name } }); return { tagIndex: o.tags.length - 1, material: { name: m.name } }; }
      case 'setTexture': { const m = this.mat(a.material); const node = a.node == null ? m.nodes[0]! : m.nodes.find((n) => n.id === a.node); if (!node) throw new BridgeError('NOT_FOUND', 'node'); node.params[a.param] = a.path; return { path: a.path }; }
      case 'setActiveCamera': { const o = this.resolve(a.ref); if (o.type !== 'CAMERA') throw new BridgeError('INVALID_ARGUMENT', 'not a camera'); this.doc.activeCamera = o.id; return { activeCamera: { id: o.id, name: o.name } }; }
      case 'setKeyframes': {
        const o = this.resolve(a.ref);
        const comps = typeof a.keys[0].value === 'number' ? 1 : 3;
        this.keys.set(`${o.id}:${a.param}`, a.keys);
        return { param: a.param, components: Array.from({ length: comps }, (_, index) => ({ index, keyCount: a.keys.length })), take: a.take ?? this.doc.current };
      }
      case 'getKeyframes': {
        const o = this.resolve(a.ref); const ks = this.keys.get(`${o.id}:${a.param}`) ?? [];
        const comps = ks.length && typeof ks[0].value !== 'number' ? 3 : 1;
        return { param: a.param, take: this.doc.current, components: Array.from({ length: comps }, (_, index) => ({ index, keys: ks.map((k: any) => ({ time: k.time, value: typeof k.value === 'number' ? k.value : Array.isArray(k.value) ? k.value[index] : [k.value.x, k.value.y, k.value.z][index], interpolation: k.interpolation ?? 'linear' })) })) };
      }
      case 'setRenderSettings': return { renderer: a.renderer ?? 'CHEETAH', resolution: { x: a.width ?? 320, y: a.height ?? 240 }, applied: Object.keys(a.params ?? {}), errors: [] };
      case 'render': {
        fs.mkdirSync(path.dirname(a.path), { recursive: true });
        fs.writeFileSync(a.path, makePng(64, 48, this.blankRender ? () => [10, 10, 10] : (x, y) => [x * 4, y * 5, 128]));
        return { path: a.path, exists: true, size: fs.statSync(a.path).size, width: 64, height: 48 };
      }
      case 'sceneStats': {
        const root = a.root ? this.resolve(a.root) : null;
        const list = root ? [root, ...this.walk(root, 99)] : this.walk(null, 99);
        const byType: Record<string, number> = {};
        const st = { objectCount: list.length, byType, folderCount: 0, lightCount: 0, cameraCount: 0, splineCount: 0, polygonObjectCount: 0, polygonCount: 0, vertexCount: 0, triangleCount: 0, tagCount: 0, materialCount: this.materials.length, nodeCount: this.materials.reduce((n, m) => n + m.nodes.length, 0) };
        for (const o of list) {
          byType[o.type] = (byType[o.type] ?? 0) + 1;
          st.tagCount += o.tags.length;
          if (o.type === 'FOLDER') st.folderCount++;
          if (o.type === 'LIGHT') st.lightCount++;
          if (o.type === 'CAMERA') st.cameraCount++;
          if (o.type === 'SPLINE') st.splineCount++;
          if (o.mesh) { st.polygonObjectCount++; st.polygonCount += o.mesh.polygons.length; st.vertexCount += o.mesh.vertices.length; st.triangleCount += o.mesh.polygons.reduce((n, p) => n + p.length - 2, 0); }
        }
        return st;
      }
      case 'run': return { value: a.code.includes('boom') ? undefined : 42, log: ['hello'], returned: 42 };
      default: throw new BridgeError('INTERNAL', `FakeBridge: unhandled op ${op}`);
    }
  }

  async run(ops: BridgeOp[], opts?: RunOpts): Promise<BridgeResponse> {
    this.requests.push({ ops, opts });
    const results: OpResult[] = [];
    for (const o of ops) {
      this.calls.push(o);
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      try {
        const result = this.exec(o.op, o.args ?? {});
        if (result?.errors?.length) results.push({ op: o.op, ok: false, result, error: { code: 'INVALID_ARGUMENT', message: 'some parameters were rejected' } });
        else results.push({ op: o.op, ok: true, result });
      }
      catch (e) {
        if (!(e instanceof BridgeError)) throw e;
        results.push({ op: o.op, ok: false, error: { code: e.code, message: e.message, hint: e.hint, details: e.details } });
      }
    }
    return { id: 'fake', ok: results.every((r) => r.ok), runtimeVersion: '0.1.0', results, log: [], startedAt: 0, finishedAt: 0 };
  }

  async one<T = any>(op: string, args?: Record<string, unknown>, opts?: RunOpts): Promise<T> {
    const r = (await this.run([{ op, args }], opts)).results[0]!;
    if (!r.ok) throw new BridgeError(r.error!.code, r.error!.message, r.error!.hint, r.error!.details);
    return r.result as T;
  }

  opNames(): string[] { return this.calls.map((c) => c.op); }
  argsOf(op: string): any[] { return this.calls.filter((c) => c.op === op).map((c) => c.args); }
}

export class FakeHelper implements HelperClient {
  calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  handlers = new Map<string, (args: any) => unknown>();
  on = true;
  available(): boolean { return this.on; }
  async call<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    this.calls.push({ cmd, args });
    const h = this.handlers.get(cmd);
    if (h) return h(args) as T;
    if (cmd === 'windows') return [{ title: 'Untitled', role: 'AXWindow', main: true, focused: true }] as T;
    return {} as T;
  }
}

export interface TestCtx { ctx: ToolContext; bridge: FakeBridge; helper: FakeHelper; dir: string; confirmCalls: string[]; setConfirm(v: boolean): void }

export function makeCtx(over: { config?: Partial<ServerConfig>; confirm?: boolean } = {}): TestCtx {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3d-mcp-test-'));
  const bridge = new FakeBridge();
  const helper = new FakeHelper();
  const config: ServerConfig = { profile: 'full', disableExec: false, disableAssets: false, disableShell: false, autoConfirm: false, mcpDir: dir, cheetahSupportDir: dir, logDir: dir, workDir: path.join(dir, 'work'), ...over.config };
  const session: SessionState = { ownedPaths: new Set(), scratch: new Map() };
  const confirmCalls: string[] = [];
  let answer = over.confirm ?? true;
  const st = createStaticServices({ bridge, helper, config });
  const ctx: ToolContext = {
    bridge, helper, config, session,
    services: {
      ...st,
      capabilities: async () => bridge.exec('capabilities', {}),
      confirm: async ({ message, confirmFlag }) => { confirmCalls.push(message); return confirmFlag === true || answer; },
      progress: () => undefined,
    },
  };
  return { ctx, bridge, helper, dir, confirmCalls, setConfirm: (v) => { answer = v; } };
}

/** Parses raw input through the tool's zod schema (like the server does), runs the handler, validates the output schema. */
export async function runTool(tool: ToolDef, raw: unknown, ctx: ToolContext): Promise<ToolResult> {
  const input = tool.inputSchema.parse(raw);
  const res = await tool.handler(input, ctx);
  tool.outputSchema.parse(res.structured);
  return res;
}

export async function expectCode(p: Promise<unknown>, code: string): Promise<BridgeError> {
  try { await p; } catch (e) {
    if (e instanceof BridgeError) { if (e.code !== code) throw new Error(`expected ${code}, got ${e.code}: ${e.message}`); return e; }
    throw e;
  }
  throw new Error(`expected rejection with ${code}`);
}

export { z };
