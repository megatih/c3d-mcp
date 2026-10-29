// Vitest globalSetup for the live suites: start from a clean Cheetah3D (no leftover dialogs/panels) and clean up afterwards.
import { dismissTestDialogs } from './cleanup.js';

export default async function setup(): Promise<() => Promise<void>> {
  if (process.env['C3D_LIVE'] === '1') await dismissTestDialogs();
  return async () => {
    if (process.env['C3D_LIVE'] === '1') await dismissTestDialogs();
  };
}
