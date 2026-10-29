import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dismissTestDialogs } from './cleanup.js';
import { LIVE } from './live.js';

const names = (): string => execFileSync('osascript', ['-e', 'tell application "System Events" to tell process "Cheetah3D" to get name of every window'], { encoding: 'utf8' });

describe.skipIf(!LIVE)('cleanup helper', () => {
  it('cancels a leftover Open panel even when another app is frontmost', async () => {
    execFileSync('osascript', ['-e', 'tell application "System Events" to tell process "Cheetah3D" to click menu item "Open..." of menu 1 of menu bar item "File" of menu bar 1']);
    await new Promise((r) => setTimeout(r, 1500));
    expect(names()).toContain('Open');
    expect(await dismissTestDialogs()).toBeGreaterThan(0);
    expect(names()).not.toMatch(/(^|, )Open(,|$)/);
  });
});
