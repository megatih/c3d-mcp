// Builds the doc-search / lint / image services consumed via ToolContext.services.
import type { BridgeClient, HelperClient, ServerConfig, ToolServices } from '../toolkit.js';
import { searchDocs } from './docsSearch.js';
import { createImageTools } from './images.js';
import { lintScript } from './lint.js';

export interface ServiceDeps { bridge: BridgeClient; helper: HelperClient; config: ServerConfig }
export type StaticServices = Pick<ToolServices, 'searchDocs' | 'lint' | 'imageTools'>;

export function createStaticServices(deps: ServiceDeps): StaticServices {
  return {
    searchDocs: (q, limit) => searchDocs(q, limit),
    lint: (code) => lintScript(code),
    imageTools: createImageTools(deps.helper),
  };
}
