import { BridgeError } from '../toolkit.js';

/** Script-type objects/tags execute arbitrary JavaScript inside Cheetah3D without the c3d_run_script sandbox or its confirmation. */
const SCRIPT_TYPE = /^(SCRIPT\w*|\w*SCRIPT)$/i;

export function assertNotScriptType(type: string): void {
  if (SCRIPT_TYPE.test(type.trim()))
    throw new BridgeError('UNSUPPORTED', `${type.toUpperCase()} runs user JavaScript without the sandbox and is not creatable through this tool.`, 'Use c3d_run_script (sandboxed, with confirmation) or create the script object by hand in Cheetah3D.');
}
