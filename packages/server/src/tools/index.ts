// Registry of all non-health tools, prompts and resources.
import { allPromptDefs } from '../prompts.js';
import { allResourceDefs } from '../resources.js';
import type { PromptDef, ResourceDef, ToolDef } from '../toolkit.js';
import { animationTools } from './animation.js';
import { assetTools } from './assets.js';
import { cameraLightTools } from './cameraLight.js';
import { docsTools } from './docs.js';
import { documentTools } from './document.js';
import { execTools } from './exec.js';
import { fileTools } from './files.js';
import { geometryTools } from './geometry.js';
import { materialTools } from './materials.js';
import { renderTools } from './render.js';
import { sceneTools } from './scene.js';
import { tagTools } from './tags.js';

export const allTools: ToolDef[] = [
  ...docsTools, ...documentTools, ...sceneTools, ...geometryTools, ...materialTools, ...tagTools,
  ...cameraLightTools, ...animationTools, ...renderTools, ...assetTools, ...fileTools, ...execTools,
];
export const allPrompts: PromptDef[] = allPromptDefs;
export const allResources: ResourceDef[] = allResourceDefs;
