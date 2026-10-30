import { z } from 'zod';
import { defineTool } from '../toolkit.js';
import { assertNotScriptType } from '../lib/scriptTypes.js';
import { autoCheckpoint, checkpointFields } from '../lib/checkpoints.js';
import { applyText, runApply } from '../lib/ops.js';
import { clean, ok } from '../lib/result.js';
import { ObjectRef, ParamMap, normParams, normRef } from '../lib/schemas.js';

const TagList = z.array(z.looseObject({ index: z.number().int(), type: z.string() }));

export const addTag = defineTool({
  name: 'c3d_add_tag',
  title: 'Add tag',
  description: 'Adds a tag to an object by tag type (e.g. SHADERTAG, TARGETTAG, RIGIDBODYTAG, SOFTBODYTAG, RENDERTAG, SPLINETRACKINGTAG - see c3d_capabilities tagTypes; HDRITAG, DOFTAG, RADIOSITYTAG, FOGTAG and CAUSTICTAG are legacy tags whose effect in 8.x is unverified: prefer an ENVIRONMENTLIGHT object, the dofOn renderer parameter and the renderer settings). At most 24 SHADERTAGs per object (more crashed Cheetah3D 8.1.3). For materials prefer c3d_assign_material. Do not add BAKETAG to non-polygon objects (opens a modal). Returns tag index for c3d_set_tag_params.',
  group: 'tags',
  inputSchema: z.strictObject({ ref: ObjectRef, type: z.string().min(3).max(40).describe('Tag type name, e.g. "TARGETTAG".'), params: ParamMap.optional().describe('Initial tag parameters.') }),
  outputSchema: z.looseObject({ tagIndex: z.number().int(), type: z.string(), tags: TagList }),
  mutating: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    assertNotScriptType(i.type);
    const r = await ctx.bridge.one<Record<string, any>>('addTag', clean({ ref: normRef(i.ref), type: i.type.toUpperCase(), params: i.params === undefined ? undefined : normParams(i.params) }));
    return ok({ tagIndex: r.tagIndex, type: r.type ?? i.type, tags: r.tags ?? [] }, `Added ${r.type ?? i.type} at tag index ${r.tagIndex}.`);
  },
});

export const setTagParams = defineTool({
  name: 'c3d_set_tag_params',
  title: 'Set tag parameters',
  description: 'Writes parameters on one tag of an object (tag_index from c3d_get_object tags). Same value encodings as c3d_set_parameters (including {ref} Link values); partial success reported per name.',
  group: 'tags',
  inputSchema: z.strictObject({ ref: ObjectRef, tag_index: z.number().int().min(0).describe('Tag index from c3d_get_object.'), params: ParamMap.describe('Tag parameters to set.') }),
  outputSchema: z.looseObject({ applied: z.array(z.string()), errors: z.array(z.looseObject({ name: z.string() })) }),
  mutating: true,
  idempotent: true,
  profiles: ['full'],
  async handler(i, ctx) {
    const r = await runApply(ctx, 'setParameters', { ref: normRef(i.ref), tag: { index: i.tag_index }, params: normParams(i.params) });
    return ok({ applied: r.applied, errors: r.errors }, applyText(`Tag ${i.tag_index}`, r));
  },
});

export const removeTag = defineTool({
  name: 'c3d_remove_tag',
  title: 'Remove tag',
  description: 'Removes the tag at tag_index from an object. Indices of later tags shift down by one: re-read with c3d_get_object before removing several. A checkpoint is taken first (returned as checkpoint).',
  group: 'tags',
  inputSchema: z.strictObject({ ref: ObjectRef, tag_index: z.number().int().min(0).describe('Index of the tag to remove.') }),
  outputSchema: z.looseObject({ tags: TagList }),
  mutating: true,
  destructive: true,
  idempotent: false,
  profiles: ['full'],
  async handler(i, ctx) {
    const cp = await autoCheckpoint(ctx, 'remove-tag');
    const r = await ctx.bridge.one<Record<string, any>>('removeTag', { ref: normRef(i.ref), index: i.tag_index });
    return ok({ tags: r.tags ?? [], ...checkpointFields(cp) }, `Removed tag ${i.tag_index}; ${(r.tags ?? []).length} tag(s) remain.${cp.warning ? ` WARNING: ${cp.warning}` : ''}`);
  },
});

export const tagTools = [addTag, setTagParams, removeTag];
