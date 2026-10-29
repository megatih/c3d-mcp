// Cleanup of dialogs/panels that the live tests themselves cause. Uses Accessibility (clicking the dialog's own button), never key
// presses: System Events delivers keystrokes to the frontmost APP, which is often not Cheetah3D (that left an Open panel behind).
import { execFileSync } from 'node:child_process';

const SCRIPT = `tell application "System Events"
  if not (exists process "Cheetah3D") then return "none"
  tell process "Cheetah3D"
    set handled to 0
    set n to count of windows
    repeat with i from n to 1 by -1
      try
        set w to window i
        if subrole of w is "AXDialog" then
          click button "OK" of w
          set handled to handled + 1
        else if (name of w) is "Open" or (name of w) is "Save" then
          try
            click button "Cancel" of w
          on error
            click button "Cancel" of splitter group 1 of w
          end try
          set handled to handled + 1
        end if
      end try
    end repeat
    return handled as text
  end tell
end tell`;

function run(): number {
  try {
    const out = execFileSync('osascript', ['-e', SCRIPT], { encoding: 'utf8', timeout: 15_000 }).trim();
    return out === 'none' ? 0 : Number.parseInt(out, 10) || 0;
  } catch {
    return 0;
  }
}

/** Dismisses every AXDialog and open/save panel (repeats because a dismissed dialog can let a queued one appear). */
export async function dismissTestDialogs(): Promise<number> {
  let total = 0;
  for (let i = 0; i < 6; i++) {
    const n = run();
    total += n;
    if (n === 0) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return total;
}
