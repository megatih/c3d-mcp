// Live check of the System Settings deep links on this macOS (opens System Settings; read-only title query, no clicks).
import { execFileSync } from 'node:child_process';
import { openPane, paneCandidates, parseMacOSMajor, systemFrontWindowTitle } from '../dist/core/settingsPanes.js';
const ver = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
const major = parseMacOSMajor(ver);
console.log('macOS', ver, 'major', major);
const title = systemFrontWindowTitle();
for (const pane of ['accessibility', 'screenRecording']) {
  for (const c of paneCandidates(pane, major)) {
    execFileSync('open', [c]); await new Promise((r) => setTimeout(r, 2000));
    console.log(pane, c, '=>', JSON.stringify(await title()));
  }
  const r = await openPane(pane, { open: async (u) => { execFileSync('open', [u]); }, frontWindowTitle: title, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), macosMajor: major });
  console.log(pane, 'openPane =>', JSON.stringify({ ok: r.ok, verified: r.verified, candidate: r.candidate, title: r.title }));
}
