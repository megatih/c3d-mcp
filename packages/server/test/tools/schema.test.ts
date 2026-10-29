/* eslint-disable @typescript-eslint/no-unused-expressions -- loosely typed runtime data; indices are bounds-checked by construction */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { allPrompts, allResources, allTools } from '../../src/tools/index.js';

const PRD_TOOLS = [
  'c3d_search_api_docs', 'c3d_get_document_info', 'c3d_open_document', 'c3d_new_document', 'c3d_save_document', 'c3d_export', 'c3d_checkpoint', 'c3d_restore_checkpoint', 'c3d_use_document',
  'c3d_list_scene', 'c3d_get_object', 'c3d_create_object', 'c3d_delete_objects', 'c3d_reparent', 'c3d_rename', 'c3d_duplicate', 'c3d_set_transform', 'c3d_get_parameters', 'c3d_set_parameters', 'c3d_select', 'c3d_look_at',
  'c3d_create_mesh', 'c3d_get_mesh', 'c3d_edit_mesh', 'c3d_create_spline', 'c3d_make_editable',
  'c3d_list_materials', 'c3d_create_material', 'c3d_set_material_params', 'c3d_add_material_node', 'c3d_connect_nodes', 'c3d_get_material_graph', 'c3d_assign_material', 'c3d_set_texture',
  'c3d_add_tag', 'c3d_set_tag_params', 'c3d_remove_tag', 'c3d_set_camera', 'c3d_set_light',
  'c3d_set_time', 'c3d_set_fps', 'c3d_takes', 'c3d_set_keyframes', 'c3d_get_keyframes',
  'c3d_set_render_settings', 'c3d_render_image', 'c3d_render_sequence', 'c3d_job_status', 'c3d_job_cancel', 'c3d_capture_viewport',
  'c3d_get_scene_stats', 'c3d_set_background', 'c3d_create_pipe', 'c3d_postprocess_image',
  'c3d_search_assets', 'c3d_import_asset', 'c3d_merge_file', 'c3d_run_script', 'c3d_lint_script', 'c3d_get_console',
];

describe('tool registry', () => {
  it('contains every PRD tool exactly once with c3d_ names', () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...PRD_TOOLS].sort());
    for (const n of names) expect(n).toMatch(/^c3d_[a-z0-9_]+$/);
  });

  it.each(allTools.map((t) => [t.name, t] as const))('%s has valid schemas and metadata', (_n, t) => {
    const input = z.toJSONSchema(t.inputSchema, { io: 'input' }) as any;
    const output = z.toJSONSchema(t.outputSchema, { io: 'output' }) as any;
    expect(input.type).toBe('object');
    expect(input.additionalProperties).toBe(false);
    expect(output.type).toBe('object');
    expect(t.title.length).toBeGreaterThan(3);
    expect(t.description.length).toBeGreaterThan(40);
    expect(t.description.length).toBeLessThanOrEqual(1000);
    for (const [k, v] of Object.entries<any>(input.properties ?? {})) expect(v.description, `${t.name}.${k} needs a description`).toBeTruthy();
    expect(t.profiles.length).toBeGreaterThan(0);
    expect(t.profiles).toContain('full');
    if (t.destructive) expect(t.mutating).toBe(true);
    if (t.profiles.includes('local')) expect((t.localDescription ?? '').length).toBeGreaterThan(5), expect(t.localDescription!.length).toBeLessThanOrEqual(260);
    expect(t.profiles.includes('readonly')).toBe(!t.mutating);
  });

  it('keeps the local profile small and free of exec/assets', () => {
    const local = allTools.filter((t) => t.profiles.includes('local'));
    expect(local.length).toBeLessThanOrEqual(23);
    for (const t of local) expect(['exec', 'assets', 'files']).not.toContain(t.group);
  });

  it('marks only non-mutating tools as readonly', () => {
    for (const t of allTools.filter((x) => x.profiles.includes('readonly'))) expect(t.mutating).toBe(false);
  });

  it('exposes prompts and resources', () => {
    expect(allPrompts.map((p) => p.name)).toEqual(['build_scene_from_description', 'turntable_render', 'material_study', 'debug_script']);
    expect(allResources.map((r) => r.uri)).toEqual(['c3d://api/short', 'c3d://api/full', 'c3d://gotchas', 'c3d://templates/macro', 'c3d://templates/polygon-script', 'c3d://scene']);
    for (const p of allPrompts) expect(p.build({ description: 'x', script: 'y', material: 'z' })).toMatch(/c3d_/);
  });
});
