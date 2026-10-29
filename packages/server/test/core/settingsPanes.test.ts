import { describe, expect, it } from 'vitest';
import { PRIVACY_ROOT, manualPath, openPane, paneCandidates, paneTitleMatches, parseMacOSMajor, systemFrontWindowTitle } from '../../src/core/settingsPanes.js';

function deps(titles: (string | undefined)[], major?: number) {
  const opened: string[] = [];
  let n = 0;
  const slept: number[] = [];
  return {
    opened,
    slept,
    d: {
      open: (u: string) => { opened.push(u); return Promise.resolve(); },
      frontWindowTitle: () => Promise.resolve(titles[Math.min(n++, titles.length - 1)]),
      sleep: (ms: number) => { slept.push(ms); return Promise.resolve(); },
      macosMajor: major,
    },
  };
}

describe('settingsPanes', () => {
  it('parses macOS versions', () => {
    expect(parseMacOSMajor('14.7.1')).toBe(14);
    expect(parseMacOSMajor('15.4\n')).toBe(15);
    expect(parseMacOSMajor('26.0')).toBe(26);
    expect(parseMacOSMajor('27')).toBe(27);
    expect(parseMacOSMajor('')).toBeUndefined();
    expect(parseMacOSMajor('abc')).toBeUndefined();
    expect(parseMacOSMajor(undefined)).toBeUndefined();
  });

  it('orders candidates per macOS major and always ends with the root', () => {
    const a14 = paneCandidates('accessibility', 14);
    expect(a14[0]).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    expect(a14[1]).toBe('x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility');
    expect(a14.at(-1)).toBe(PRIVACY_ROOT);
    for (const major of [26, 27, undefined, 99]) expect(paneCandidates('accessibility', major)[0]).toContain('PrivacySecurity.extension?Privacy_Accessibility');
    expect(paneCandidates('accessibility', 15)).toEqual(a14);
    const s15 = paneCandidates('screenRecording', 15);
    expect(s15[0]).toMatch(/preference\.security\?Privacy_ScreenCapture$/);
    expect(s15.some((u) => u.endsWith('?Privacy_ScreenRecording'))).toBe(true);
    expect(s15.at(-1)).toBe(PRIVACY_ROOT);
    expect(paneCandidates('screenRecording', 26)[0]).toMatch(/extension\?Privacy_ScreenCapture$/);
  });

  it('matches titles tolerantly', () => {
    expect(paneTitleMatches('accessibility', 'Accessibility')).toBe(true);
    expect(paneTitleMatches('accessibility', 'ACCESSIBILITY ')).toBe(true);
    expect(paneTitleMatches('accessibility', 'Privacy & Security')).toBe(false);
    expect(paneTitleMatches('accessibility', undefined)).toBe(false);
    expect(paneTitleMatches('screenRecording', 'Screen & System Audio Recording')).toBe(true);
    expect(paneTitleMatches('screenRecording', 'Screen Recording')).toBe(true);
    expect(paneTitleMatches('screenRecording', 'Screen Time')).toBe(false);
  });

  it('returns the first candidate whose title matches', async () => {
    const t = deps(['Accessibility'], 26);
    const r = await openPane('accessibility', t.d);
    expect(r).toMatchObject({ ok: true, verified: true, title: 'Accessibility' });
    expect(r.candidate).toBe(t.opened[0]);
    expect(t.opened).toHaveLength(1);
    expect(t.slept).toEqual([1500]);
  });

  it('falls through candidates on a title mismatch', async () => {
    const t = deps(['Privacy & Security', 'Screen & System Audio Recording'], 15);
    const r = await openPane('screenRecording', t.d);
    expect(r.ok).toBe(true);
    expect(t.opened).toHaveLength(2);
    expect(r.candidate).toBe(t.opened[1]);
  });

  it('gives the manual click path and opens the root when nothing matches', async () => {
    const t = deps(['General'], 27);
    const r = await openPane('accessibility', t.d);
    expect(r.ok).toBe(false);
    expect(r.manualPath).toBe('System Settings > Privacy & Security > Device Control and Data Access (the former Accessibility list)');
    expect(t.opened.at(-1)).toBe(PRIVACY_ROOT);
    expect(r.tried.length).toBe(paneCandidates('accessibility', 27).length - 1);
    expect(manualPath('screenRecording', 15)).toBe('System Settings > Privacy & Security > Screen & System Audio Recording');
    expect(manualPath('screenRecording', 14)).toBe('System Settings > Privacy & Security > Screen Recording');
  });

  it('assumes the first link worked, unverified, when no title can be read; unknown versions use the extension scheme first', async () => {
    const t = deps([undefined], undefined);
    const r = await openPane('accessibility', t.d);
    expect(r).toMatchObject({ ok: true, verified: false });
    expect(t.opened[0]).toContain('PrivacySecurity.extension');
  });

  it('reads the title through a read-only osascript call', async () => {
    const calls: string[][] = [];
    const ok = systemFrontWindowTitle((_c, a) => { calls.push(a); return Promise.resolve({ code: 0, stdout: 'Accessibility\n', stderr: '' }); });
    expect(await ok()).toBe('Accessibility');
    expect(calls[0]?.[1]).not.toMatch(/click|keystroke|set /);
    const bad = systemFrontWindowTitle(() => Promise.resolve({ code: 1, stdout: '', stderr: 'denied' }));
    expect(await bad()).toBeUndefined();
  });

  it('recognises the macOS 27 title of the Accessibility pane', () => {
    expect(paneTitleMatches('accessibility', 'Device Control and Data Access')).toBe(true);
    expect(paneTitleMatches('screenRecording', 'Device Control and Data Access')).toBe(false);
    expect(manualPath('accessibility', 27)).toContain('Device Control and Data Access');
    expect(manualPath('accessibility', 15)).toBe('System Settings > Privacy & Security > Accessibility');
  });
});
