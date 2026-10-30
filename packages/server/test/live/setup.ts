// Vitest globalSetup for the live suites: start from a clean Cheetah3D (no leftover dialogs/panels) and clean up afterwards.
import { trackWindows } from '../../scripts/window-cleanup.mjs';
import { dismissTestDialogs } from './cleanup.js';

export default async function setup(): Promise<() => Promise<void>> {
  const live = process.env['C3D_LIVE'] === '1';
  if (live) await dismissTestDialogs();
  const cleanup = live ? trackWindows() : () => [];
  return async () => {
    if (!live) return;
    await dismissTestDialogs();
    cleanup(); // closes every document window the run opened (Don't Save); earlier windows stay
    await dismissTestDialogs();
  };
}
