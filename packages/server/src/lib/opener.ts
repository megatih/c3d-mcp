// Opens a file in Cheetah3D as a NEW document window (`open -a Cheetah3D <file>`). Isolated so tests can mock it.
import { execFile } from 'node:child_process';
import { BridgeError } from '../toolkit.js';

export function openWithCheetah(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', ['-a', 'Cheetah3D', file], { timeout: 15000 }, (err) => {
      if (err) reject(new BridgeError('TRIGGER_FAILED', `open -a Cheetah3D failed: ${err.message}`, 'Is Cheetah3D installed and running? Run c3d_doctor.'));
      else resolve();
    });
  });
}
