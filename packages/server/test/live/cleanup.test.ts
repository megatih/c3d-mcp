import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dismissTestDialogs } from './cleanup.js';
import { closeNewWindows, windowTitles } from '../../scripts/window-cleanup.mjs';
import { LIVE, liveRuntime, newScratch } from './live.js';

const names = (): string => execFileSync('osascript', ['-e', 'tell application "System Events" to tell process "Cheetah3D" to get name of every window'], { encoding: 'utf8' });

describe.skipIf(!LIVE)('cleanup helper', () => {
  it('cancels a leftover Open panel even when another app is frontmost', async () => {
    execFileSync('osascript', ['-e', 'tell application "System Events" to tell process "Cheetah3D" to click menu item "Open..." of menu 1 of menu bar item "File" of menu bar 1']);
    await new Promise((r) => setTimeout(r, 1500));
    expect(names()).toContain('Open');
    expect(await dismissTestDialogs()).toBeGreaterThan(0);
    expect(names()).not.toMatch(/(^|, )Open(,|$)/);
  });

  it('closes edited untitled scratch documents (the "keep this new document?" sheet) and leaves earlier windows alone', async () => {
    const before = windowTitles();
    const rt = liveRuntime();
    for (let i = 0; i < 2; i++) {
      await newScratch(rt);
      await rt.bridge.one('createObject', { type: 'BOX', name: `CleanupProbe${i}` });
    }
    expect(windowTitles().length).toBe(before.length + 2);
    const closed = closeNewWindows(before);
    expect(closed).toHaveLength(2);
    expect(windowTitles()).toEqual(before);
  });
});
