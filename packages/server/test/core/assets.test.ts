import { describe, expect, it } from 'vitest';
import { assetLocations, compareSemver, packageVersion, parseRuntimeVersion, renderMacroTemplate } from '../../src/core/assets.js';

describe('assets helpers', () => {
  it('renders every placeholder and escapes quotes/backslashes/non-ASCII', () => {
    const out = renderMacroTemplate('{{RUNTIME_PATH}}|{{MCP_DIR}}|{{VERSION}}|{{RUNTIME_PATH}}', { RUNTIME_PATH: `a "b" it's\\c`, MCP_DIR: '/m/名', VERSION: '1.2.3' });
    expect(out).toBe(`a \\"b\\" it\\'s\\\\c|/m/\\u540d|1.2.3|a \\"b\\" it\\'s\\\\c`);
  });
  it('parses runtime versions from several spellings', () => {
    expect(parseRuntimeVersion('var RUNTIME_VERSION = "1.2.3";')).toBe('1.2.3');
    expect(parseRuntimeVersion("C3D.runtimeVersion = '0.4.5'")).toBe('0.4.5');
    expect(parseRuntimeVersion('// c3d-mcp runtime v2.0.1')).toBe('2.0.1');
    expect(parseRuntimeVersion('nothing')).toBeUndefined();
  });
});

describe('versions', () => {
  it('compares semver and reads the package version', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.10.0', '1.9.9')).toBe(1);
    expect(compareSemver('0.9.9', '1.0.0')).toBe(-1);
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
  it('looks in the packaged assets first and the monorepo build second', () => {
    const loc = assetLocations('/pkg', '/repo');
    expect(loc.runtime).toEqual(['/pkg/assets/runtime.js', '/repo/bridge/dist/runtime.js']);
    expect(loc.macroTemplate.at(-1)).toBe('/repo/bridge/macro/C3D-MCP Bridge.js.template');
  });
});
