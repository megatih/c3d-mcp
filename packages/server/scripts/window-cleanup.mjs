// Closes the Cheetah3D document windows a test/script/eval run opened, answering "Delete" / "Don't Save" for them only.
// Uses Accessibility (the window's own close button, then the sheet's button). When the sheet exposes no Accessibility children
// (macOS 27 "Do you want to keep this new document?" while Cheetah3D is not the active app) it activates Cheetah3D and presses
// command-delete, never Return (= Save); the previously frontmost app is restored. Set C3D_KEEP_WINDOWS=1 to keep the windows open.
import { execFileSync } from 'node:child_process';

const osa = (script) => {
  try { return execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 20_000 }).trim(); } catch { return ''; }
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Names of all Cheetah3D windows ([] when the app is not running). */
export function windowTitles() {
  const out = osa(`tell application "System Events"
    if not (exists process "Cheetah3D") then return ""
    tell process "Cheetah3D" to get name of every window
  end tell`);
  return out.split(', ').filter(Boolean);
}

const frontmostApp = () => osa('tell application "System Events" to get name of first application process whose frontmost is true');

/** Closes one window: its close button, then the "keep this new document?" / "save changes?" sheet (Delete / Don't Save). */
function closeOne(title) {
  const win = `first window whose name is ${JSON.stringify(title)}`;
  osa(`tell application "System Events" to tell process "Cheetah3D"
    try
      set w to ${win}
      if subrole of w is "AXDialog" then error "dialog"
      perform action "AXRaise" of w
      click button 1 of w
    end try
  end tell`);
  for (let i = 0; i < 10; i++) {
    sleep(300);
    if (!windowTitles().includes(title)) return true;
    // Buttons of the sheet are reachable by name (macOS 27 asks "Do you want to keep this new document?": Delete / Cancel / Save).
    osa(`tell application "System Events" to tell process "Cheetah3D"
      try
        set s to sheet 1 of (${win})
        try
          click button "Delete" of s
        on error
          click (first button of s whose name contains "Don")
        end try
      end try
    end tell`);
    sleep(300);
    if (!windowTitles().includes(title)) return true;
  }
  // The sheet exposes no Accessibility children unless Cheetah3D is the active app: activate it and use the sheet's own shortcut
  // (command-delete = Delete / Don't Save; never Return, which would be Save). Only ever reached for windows this run opened.
  osa(`tell application "Cheetah3D" to activate
    delay 0.4
    tell application "System Events" to tell process "Cheetah3D"
      try
        set w to ${win}
        perform action "AXRaise" of w
        delay 0.3
        -- Only when the raise worked (the target is the front window) and it still shows its sheet; otherwise the key would reach another document.
        if (name of window 1) is ${JSON.stringify(title)} and (count of sheets of w) > 0 then key code 51 using {command down}
      end try
    end tell`);
  for (let i = 0; i < 6; i++) {
    sleep(300);
    if (!windowTitles().includes(title)) return true;
  }
  return false;
}

/** Closes the document windows whose title is not in `before`; returns the titles that really closed. */
export function closeNewWindows(before, { keepRenderManager = false } = {}) {
  const closed = [];
  const front = frontmostApp();
  for (let pass = 0; pass < 2; pass++) {
    const fresh = windowTitles().filter((t) => !before.includes(t) && !closed.includes(t) && !(keepRenderManager && t === 'Render Manager'));
    if (!fresh.length) break;
    for (const t of fresh) if (closeOne(t)) closed.push(t);
  }
  if (front && front !== 'Cheetah3D' && frontmostApp() === 'Cheetah3D') osa(`tell application ${JSON.stringify(front)} to activate`);
  return closed;
}

/** Snapshots the current windows; the returned `cleanup()` (idempotent) closes everything opened since. */
export function trackWindows(opts = {}) {
  const before = windowTitles();
  let done = false;
  return () => {
    if (done) return [];
    done = true;
    if (process.env.C3D_KEEP_WINDOWS === '1') return [];
    return closeNewWindows(before, opts);
  };
}
