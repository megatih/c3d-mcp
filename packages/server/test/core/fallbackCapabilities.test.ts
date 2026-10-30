import { describe, expect, it } from 'vitest';
import { FALLBACK_CAPABILITIES } from '../../src/core/fallbackCapabilities.js';
import { createMaterial } from '../../src/tools/materials.js';

describe('fallback capabilities', () => {
  it('lists every material type that c3d_create_material accepts', () => {
    const accepted = (createMaterial.inputSchema.shape.type.unwrap() as unknown as { options: string[] }).options;
    expect(FALLBACK_CAPABILITIES.materialTypes).toEqual(expect.arrayContaining(accepted));
  });
});
